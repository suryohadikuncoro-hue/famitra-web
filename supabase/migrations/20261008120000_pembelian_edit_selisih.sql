-- Edit faktur pembelian: terapkan HANYA selisih qty per batch.
--
-- Masalah yang diperbaiki:
--   purchase_update versi pertama (20261008010000) membalik SELURUH baris faktur
--   lama lebih dulu, baru menerapkan semuanya lagi. Akibatnya, kalau satu baris
--   saja stoknya sudah berkurang karena terjual, SELURUH edit ditolak â€” termasuk
--   kasus yang paling sering dibutuhkan: menambahkan satu item yang tertinggal.
--
--   Data KARLA 30 Sep - 4 Okt 2026: 95 dari 118 faktur (80,5%) tidak bisa diedit
--   sama sekali karena aturan itu.
--
-- Cara baru:
--   1. Validasi & normalkan item baru.
--   2. Hitung selisih qty per (kode_obat, kode_batch): baru - lama.
--   3. Terapkan HANYA selisihnya. Baris yang tidak berubah tidak menyentuh stok
--      sama sekali. Pengurangan hanya perlu stok sebesar pengurangannya, bukan
--      sebesar qty lama.
--   4. Buat batch baru hanya bila memang belum ada dan qty bertambah.
--   5. Ganti rincian faktur, lalu hitung ulang harga master dari pembelian AKTIF
--      terakhir (sama seperti versi sebelumnya).
--
-- Perbaikan tambahan:
--   Barang yang sudah dinonaktifkan TETAP boleh dipertahankan pada faktur lama
--   (baris yang sudah ada), karena itu bagian dari riwayat. Syarat "aktif" hanya
--   berlaku untuk barang yang benar-benar baru ditambahkan ke faktur.
--
-- Verifikasi setelah diterapkan (read-only):
--   select p.proname, pg_get_function_arguments(p.oid) from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname='public' and p.proname='purchase_update';
--   -> diharapkan 1 baris, argumen tetap 9 seperti sebelumnya
--
-- Rollback:
--   Jalankan ulang isi fungsi purchase_update dari
--   supabase/migrations/20261008010000_pembelian_edit_dan_harga_tambahan.sql

CREATE OR REPLACE FUNCTION public.purchase_update(
  p_username text,
  p_no_faktur text,
  p_no_faktur_supplier text,
  p_supplier text,
  p_kategori text,
  p_tanggal date,
  p_jatuh_tempo date,
  p_items jsonb,
  p_cabang_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cabang_id text;
  v_user_cabang text;
  v_head record;
  v_item jsonb;
  v_prod record;
  v_subtotal numeric;
  v_total_item numeric := 0;
  v_total_tagihan numeric := 0;
  v_no_faktur_supplier text;
  v_tanggal date;
  v_valid jsonb := '[]'::jsonb;
  v_kode jsonb := '[]'::jsonb;
  v_sebelum jsonb;
  v_sesudah jsonb;
  v_kurang text;
BEGIN
  SELECT u.cabang_id INTO v_user_cabang
  FROM public.app_users u
  WHERE u.username = p_username AND u.aktif = 'YA';

  IF v_user_cabang IS NULL THEN
    RAISE EXCEPTION 'Petugas % tidak dikenal atau tidak aktif.', p_username;
  END IF;

  IF nullif(p_cabang_id,'') IS NOT NULL AND p_cabang_id <> v_user_cabang THEN
    RAISE EXCEPTION 'Cabang % tidak sesuai dengan cabang petugas (%).', p_cabang_id, v_user_cabang;
  END IF;

  v_cabang_id := v_user_cabang;
  v_tanggal := coalesce(p_tanggal, current_date);
  v_no_faktur_supplier := nullif(trim(coalesce(p_no_faktur_supplier,'')),'');

  PERFORM pg_advisory_xact_lock(hashtext('purchase_save:'||v_cabang_id));

  IF nullif(trim(coalesce(p_supplier,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Supplier wajib dipilih.';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Detail pembelian kosong.';
  END IF;

  SELECT * INTO v_head FROM trx_pembelian
  WHERE cabang_id = v_cabang_id AND no_faktur = p_no_faktur
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Faktur % tidak ditemukan di cabang %.', p_no_faktur, v_cabang_id;
  END IF;

  IF v_head.status <> 'AKTIF' THEN
    RAISE EXCEPTION 'Faktur % sudah dibatalkan dan tidak bisa diedit.', p_no_faktur;
  END IF;

  IF EXISTS (
    SELECT 1 FROM trx_pembayaran_hutang
    WHERE cabang_id = v_cabang_id AND no_faktur = p_no_faktur AND status = 'AKTIF'
  ) THEN
    RAISE EXCEPTION 'Faktur % sudah ada pembayaran. Batalkan pembayarannya dulu sebelum mengedit.', p_no_faktur;
  END IF;

  IF v_no_faktur_supplier IS NOT NULL AND EXISTS (
    SELECT 1 FROM trx_pembelian
    WHERE cabang_id = v_cabang_id
      AND supplier = p_supplier
      AND no_faktur_supplier = v_no_faktur_supplier
      AND no_faktur <> p_no_faktur
  ) THEN
    RAISE EXCEPTION 'Nomor faktur PBF "%" sudah dipakai faktur lain untuk supplier %.', v_no_faktur_supplier, p_supplier;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.master_supplier ms
    JOIN public.supplier_cabang sc
      ON sc.kode_supplier = ms.kode_supplier
     AND sc.cabang_id = v_cabang_id
    WHERE ms.nama_supplier = p_supplier
  ) THEN
    RAISE EXCEPTION 'Supplier "%" tidak terdaftar untuk cabang %.', p_supplier, v_cabang_id;
  END IF;

  -- Kondisi lama untuk jejak audit (diambil sebelum rincian diganti).
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'kode_obat', d.kode_obat, 'kode_batch', d.kode_batch, 'qty', d.qty,
           'harga_netto', d.harga_netto, 'ppn', d.ppn, 'diskon', d.diskon,
           'harga_jual_umum_baru', d.harga_jual_umum_baru,
           'harga_khusus_baru', d.harga_khusus_baru,
           'harga_jual_mutasi_baru', d.harga_jual_mutasi_baru,
           'expired_date', d.expired_date) ORDER BY d.kode_obat, d.kode_batch), '[]'::jsonb)
    INTO v_sebelum
  FROM trx_pembelian_detail d
  WHERE d.cabang_id = v_cabang_id AND d.no_faktur = p_no_faktur;

  -- (1) Validasi & normalkan item baru.
  --     Barang nonaktif masih boleh bila memang sudah ada di faktur ini â€”
  --     baris lamanya bagian dari riwayat, bukan penambahan baru.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF coalesce((v_item->>'Qty')::numeric,0) <= 0 OR coalesce((v_item->>'Harga_Netto')::numeric,0) < 0 THEN
      RAISE EXCEPTION 'Qty dan harga netto item tidak valid.';
    END IF;

    SELECT * INTO v_prod FROM master_barang
    WHERE kode_obat = upper(v_item->>'Kode_Obat')
      AND cabang_id = v_cabang_id
      AND (
        aktif = 'YA'
        OR EXISTS (
          SELECT 1 FROM trx_pembelian_detail d
          WHERE d.cabang_id = v_cabang_id
            AND d.no_faktur = p_no_faktur
            AND upper(d.kode_obat) = upper(v_item->>'Kode_Obat')
        )
      )
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Barang % tidak ditemukan atau nonaktif di cabang %.', v_item->>'Kode_Obat', v_cabang_id;
    END IF;

    v_subtotal := ((v_item->>'Harga_Netto')::numeric * (v_item->>'Qty')::numeric)
                  * (1 + coalesce((v_item->>'PPN')::numeric,0)/100)
                  - coalesce((v_item->>'Diskon')::numeric,0);
    IF v_subtotal < 0 THEN
      RAISE EXCEPTION 'Subtotal item tidak boleh negatif.';
    END IF;

    v_kode := v_kode || to_jsonb(v_prod.kode_obat);
    v_total_item := v_total_item + (v_item->>'Qty')::numeric;
    v_total_tagihan := v_total_tagihan + v_subtotal;

    v_valid := v_valid || jsonb_build_array(jsonb_build_object(
      'kode_obat', v_prod.kode_obat,
      'nama_obat', v_prod.nama_obat,
      'kode_batch', coalesce(v_item->>'Kode_Batch',''),
      'expired_date', (v_item->>'Expired_Date')::date,
      'qty', (v_item->>'Qty')::numeric,
      'harga_netto', (v_item->>'Harga_Netto')::numeric,
      'ppn', coalesce((v_item->>'PPN')::numeric,0),
      'diskon', coalesce((v_item->>'Diskon')::numeric,0),
      'hju', coalesce((v_item->>'Harga_Jual_Umum_Baru')::numeric,0),
      'hk', coalesce((v_item->>'Harga_Khusus_Baru')::numeric,0),
      'hjm', coalesce((v_item->>'Harga_Jual_Mutasi_Baru')::numeric,0),
      'subtotal', v_subtotal));
  END LOOP;

  -- (2) Selisih qty per (barang, batch): baru - lama.
  DROP TABLE IF EXISTS pg_temp.tmp_selisih_faktur;
  CREATE TEMP TABLE tmp_selisih_faktur ON COMMIT DROP AS
  WITH lama AS (
    SELECT upper(d.kode_obat) AS kode_obat,
           coalesce(d.kode_batch,'') AS kode_batch,
           sum(d.qty) AS qty
    FROM trx_pembelian_detail d
    WHERE d.cabang_id = v_cabang_id AND d.no_faktur = p_no_faktur
    GROUP BY 1, 2
  ), baru AS (
    SELECT upper(x.value->>'kode_obat') AS kode_obat,
           coalesce(x.value->>'kode_batch','') AS kode_batch,
           sum((x.value->>'qty')::numeric) AS qty,
           max((x.value->>'expired_date')::date) AS expired_date,
           max((x.value->>'harga_netto')::numeric) AS harga_netto
    FROM jsonb_array_elements(v_valid) AS x(value)
    GROUP BY 1, 2
  )
  SELECT coalesce(l.kode_obat, b.kode_obat) AS kode_obat,
         coalesce(l.kode_batch, b.kode_batch) AS kode_batch,
         coalesce(b.qty, 0) - coalesce(l.qty, 0) AS delta,
         b.expired_date,
         b.harga_netto
  FROM lama l
  FULL OUTER JOIN baru b
    ON l.kode_obat = b.kode_obat AND l.kode_batch = b.kode_batch;

  -- (3) Pastikan stok cukup untuk setiap PENGURANGAN (bukan untuk qty lama).
  SELECT string_agg(format('%s (batch "%s") kurang %s', d.kode_obat, d.kode_batch,
                           (-d.delta) - coalesce(s.stok_real, 0)), '; ')
    INTO v_kurang
  FROM pg_temp.tmp_selisih_faktur d
  LEFT JOIN stok_batch s
    ON s.cabang_id = v_cabang_id
   AND s.kode_obat = d.kode_obat
   AND coalesce(s.kode_batch,'') = d.kode_batch
  WHERE d.delta < 0 AND coalesce(s.stok_real, 0) < -d.delta;

  IF v_kurang IS NOT NULL THEN
    RAISE EXCEPTION 'Tidak bisa mengedit: stok tidak cukup untuk dikurangi â€” %. Barangnya sudah terjual; sesuaikan lewat Stokopname lebih dulu.', v_kurang;
  END IF;

  -- (4) Terapkan selisih pada batch yang sudah ada.
  UPDATE stok_batch s SET
    stok_real = s.stok_real + d.delta,
    expired_date = coalesce(d.expired_date, s.expired_date),
    harga_modal_batch = coalesce(d.harga_netto, s.harga_modal_batch),
    updated_at = now()
  FROM pg_temp.tmp_selisih_faktur d
  WHERE s.cabang_id = v_cabang_id
    AND s.kode_obat = d.kode_obat
    AND coalesce(s.kode_batch,'') = d.kode_batch;

  -- (5) Buat batch baru hanya untuk yang belum ada dan qty bertambah.
  INSERT INTO stok_batch(id_batch,kode_obat,kode_batch,expired_date,stok_real,harga_modal_batch,cabang_id)
  SELECT 'BT-' || pg_catalog.gen_random_uuid()::text,
         d.kode_obat, d.kode_batch, d.expired_date, d.delta, coalesce(d.harga_netto, 0), v_cabang_id
  FROM pg_temp.tmp_selisih_faktur d
  WHERE d.delta > 0
    AND NOT EXISTS (
      SELECT 1 FROM stok_batch s
      WHERE s.cabang_id = v_cabang_id
        AND s.kode_obat = d.kode_obat
        AND coalesce(s.kode_batch,'') = d.kode_batch
    );

  -- (6) Ganti rincian faktur.
  DELETE FROM trx_pembelian_detail WHERE cabang_id = v_cabang_id AND no_faktur = p_no_faktur;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_valid) LOOP
    INSERT INTO trx_pembelian_detail(no_faktur,kode_obat,nama_obat,kode_batch,expired_date,qty,harga_netto,ppn,diskon,harga_jual_umum_baru,harga_khusus_baru,harga_jual_mutasi_baru,subtotal,cabang_id)
    VALUES(p_no_faktur,
           v_item->>'kode_obat', v_item->>'nama_obat', v_item->>'kode_batch',
           (v_item->>'expired_date')::date, (v_item->>'qty')::numeric,
           (v_item->>'harga_netto')::numeric, (v_item->>'ppn')::numeric, (v_item->>'diskon')::numeric,
           (v_item->>'hju')::numeric, (v_item->>'hk')::numeric, (v_item->>'hjm')::numeric,
           (v_item->>'subtotal')::numeric, v_cabang_id);
  END LOOP;

  -- (7) Hitung ulang harga master dari pembelian AKTIF paling baru.
  UPDATE master_barang m SET
    harga_modal = coalesce((
      SELECT d.harga_netto FROM trx_pembelian_detail d
      JOIN trx_pembelian p ON p.cabang_id = d.cabang_id AND p.no_faktur = d.no_faktur
      WHERE d.cabang_id = m.cabang_id AND d.kode_obat = m.kode_obat AND p.status = 'AKTIF'
      ORDER BY p.timestamp DESC, d.no_faktur DESC LIMIT 1), m.harga_modal),
    harga_jual_umum = coalesce((
      SELECT d.harga_jual_umum_baru FROM trx_pembelian_detail d
      JOIN trx_pembelian p ON p.cabang_id = d.cabang_id AND p.no_faktur = d.no_faktur
      WHERE d.cabang_id = m.cabang_id AND d.kode_obat = m.kode_obat AND p.status = 'AKTIF'
        AND coalesce(d.harga_jual_umum_baru,0) > 0
      ORDER BY p.timestamp DESC, d.no_faktur DESC LIMIT 1), m.harga_jual_umum),
    harga_khusus = coalesce((
      SELECT d.harga_khusus_baru FROM trx_pembelian_detail d
      JOIN trx_pembelian p ON p.cabang_id = d.cabang_id AND p.no_faktur = d.no_faktur
      WHERE d.cabang_id = m.cabang_id AND d.kode_obat = m.kode_obat AND p.status = 'AKTIF'
        AND coalesce(d.harga_khusus_baru,0) > 0
      ORDER BY p.timestamp DESC, d.no_faktur DESC LIMIT 1), m.harga_khusus),
    harga_jual_mutasi = coalesce((
      SELECT d.harga_jual_mutasi_baru FROM trx_pembelian_detail d
      JOIN trx_pembelian p ON p.cabang_id = d.cabang_id AND p.no_faktur = d.no_faktur
      WHERE d.cabang_id = m.cabang_id AND d.kode_obat = m.kode_obat AND p.status = 'AKTIF'
        AND coalesce(d.harga_jual_mutasi_baru,0) > 0
      ORDER BY p.timestamp DESC, d.no_faktur DESC LIMIT 1), m.harga_jual_mutasi),
    updated_at = now()
  WHERE m.cabang_id = v_cabang_id
    AND m.kode_obat IN (SELECT jsonb_array_elements_text(v_kode));

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'kode_obat', d.kode_obat, 'kode_batch', d.kode_batch, 'qty', d.qty,
           'harga_netto', d.harga_netto, 'ppn', d.ppn, 'diskon', d.diskon,
           'harga_jual_umum_baru', d.harga_jual_umum_baru,
           'harga_khusus_baru', d.harga_khusus_baru,
           'harga_jual_mutasi_baru', d.harga_jual_mutasi_baru,
           'expired_date', d.expired_date) ORDER BY d.kode_obat, d.kode_batch), '[]'::jsonb)
    INTO v_sesudah
  FROM trx_pembelian_detail d
  WHERE d.cabang_id = v_cabang_id AND d.no_faktur = p_no_faktur;

  UPDATE trx_pembelian SET
    supplier = p_supplier,
    kategori = coalesce(nullif(p_kategori,''),'Tidak Berpajak'),
    no_faktur_supplier = v_no_faktur_supplier,
    tanggal_faktur = v_tanggal,
    jatuh_tempo = p_jatuh_tempo,
    total_item = v_total_item,
    total_tagihan = v_total_tagihan,
    diedit_oleh = p_username,
    diedit_at = now(),
    riwayat_edit = coalesce(riwayat_edit, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'oleh', p_username, 'waktu', now(),
      'sebelum', v_sebelum, 'sesudah', v_sesudah))
  WHERE cabang_id = v_cabang_id AND no_faktur = p_no_faktur;

  RETURN jsonb_build_object('No_Faktur', p_no_faktur, 'Total_Item', v_total_item, 'Total_Tagihan', v_total_tagihan);
END;
$function$;

-- Hak akses tidak berubah: hanya lewat Edge Function (service_role).
REVOKE ALL ON FUNCTION public.purchase_update(text, text, text, text, text, date, date, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_update(text, text, text, text, text, date, date, jsonb, text) TO service_role;
