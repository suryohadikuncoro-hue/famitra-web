-- =============================================================================
-- SI-FaMitra — Migrasi 5/6 : lima fungsi kasir jadi sadar cabang
-- Rencana: docs/rencana/isolasi-cabang.md bagian 5.1–5.6, 4.6 (file 5), 10.2 A/B
-- Keputusan pemilik project: 1, 2, 3, 4, 7, 10.2 A (nomor faktur PBF),
-- 10.2 B (supplier divalidasi lewat NAMA), dan keputusan 8 (temuan 15 TIDAK
-- dikerjakan di sini — lihat catatan di generate_refill_reminders).
--
-- Isi file:
--   a. DROP dua tanda tangan lama `purchase_save` (7 dan 8 parameter) dan
--      overload lama `pos_checkout` (7 parameter). Keduanya masih bisa dipanggil
--      dan masih menembus isolasi. Definisi lamanya disimpan sebagai komentar di
--      bagian ROLLBACK di akhir file ini.
--   b. Versi baru: pos_checkout (9 param), purchase_save (8 param),
--      generate_refill_reminders, pos_checkout_promo, pos_checkout_bundle.
--
-- URUTAN: migrasi 1, 2, 3, 4 HARUS sudah dijalankan lebih dulu.
--   * migrasi 3 wajib: kalau UNIQUE (kode_obat, kode_batch) masih global,
--     purchase_save gagal saat batch yang sama sudah ada di cabang lain.
--   * migrasi 2 wajib: purchase_save memvalidasi supplier lewat supplier_cabang.
--   * migrasi 4 wajib: kolom trx_pembelian.no_faktur_supplier dan hapus default
--     'KARLA' sudah dilakukan di sana.
-- Deploy Edge Function versi baru (file yang ikut di PR ini) HARUS bersamaan
-- dengan file ini: `api:beli.simpan` sekarang mengirim p_no_faktur_supplier.
--
-- TIDAK ada DROP TABLE / TRUNCATE / DELETE di file ini. DROP FUNCTION hanya untuk
-- overload lama yang memang bagian dari jalur aplikasi yang sedang diperbaiki.
--
-- PLACEHOLDER — menunggu data pemilik project:
--   * bagian VERIFIKASI memakai query katalog (pg_proc/pg_indexes), bukan angka
--     tetap, jadi bisa dijalankan sekarang.
--   * jumlah baris trx_pembelian/trx_penjualan belum diketahui; hanya dipakai
--     untuk memperkirakan berapa nomor nota/faktur lama yang formatnya beda.
--     Format nomor nota lama (INV<YYYYMMDD>-####) dan nomor faktur lama
--     (diketik manual) TIDAK diubah oleh file ini — nomor lama dibiarkan apa
--     adanya supaya tidak ada dokumen yang berubah.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. LEPAS OVERLOAD LAMA
--    `CREATE OR REPLACE FUNCTION` TIDAK BISA mengganti nama parameter input
--    (Postgres: "cannot change name of input parameter"), dan p_no_faktur pada
--    purchase_save berubah makna menjadi nomor PBF -> wajib DROP dulu.
--    Menghapus hanya 7-param saja TIDAK cukup: 8-param lama tetap hidup dan
--    tetap menerima nomor faktur dari pemanggil.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.pos_checkout(text, text, text, text, jsonb, numeric, numeric);

DROP FUNCTION IF EXISTS public.purchase_save(text, text, text, text, date, date, jsonb);

DROP FUNCTION IF EXISTS public.purchase_save(text, text, text, text, date, date, jsonb, text);

-- generate_refill_reminders lama punya DEFAULT NULL::text pada p_cabang_id;
-- perubahan ini MENGHAPUS default -> CREATE OR REPLACE tidak bisa -> must DROP dulu.
DROP FUNCTION IF EXISTS public.generate_refill_reminders(text);

-- -----------------------------------------------------------------------------
-- 1. pos_checkout (versi 9 parameter)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pos_checkout(
  p_username text, p_nomor_wa text, p_nama_pelanggan text, p_tipe_customer text,
  p_items jsonb, p_diskon numeric, p_bayar numeric,
  p_cabang_id text DEFAULT NULL::text, p_reward_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tanggal date := (now() at time zone 'Asia/Jakarta')::date;
  v_jam text := to_char(now() at time zone 'Asia/Jakarta','HH24:MI');
  v_shift text;
  v_no_nota text;
  v_subtotal numeric := 0;
  v_harga_akhir numeric;
  v_total_hpp numeric := 0;
  v_kembalian numeric;
  v_item jsonb;
  v_product record;
  v_batch record;
  v_remaining numeric;
  v_take numeric;
  v_unit_price numeric;
  v_detail jsonb := '[]'::jsonb;
  v_reward record;
  v_reward_discount numeric := 0;
  v_reward_points integer := 0;
  v_cabang_id text;
  v_user_cabang text;
  v_customer_type text;
BEGIN
  -- (1) CABANG: diambil dari app_users (sesi petugas). Fallback 'KARLA' DIHAPUS.
  --     Kalau cabang tidak bisa ditentukan, transaksi GAGAL — bukan diam-diam
  --     masuk KARLA (bagian 2 target 3).
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

  -- Lock per cabang, bukan satu lock global untuk semua cabang (bagian 5.1 poin 4).
  PERFORM pg_advisory_xact_lock(hashtext('pos_checkout:'||v_cabang_id));

  IF p_items IS NULL OR jsonb_array_length(p_items)=0 THEN
    RAISE EXCEPTION 'Keranjang kosong.';
  END IF;
  IF coalesce(p_diskon,0)<0 OR coalesce(p_bayar,0)<0 THEN
    RAISE EXCEPTION 'Nilai diskon atau pembayaran tidak valid.';
  END IF;

  v_shift := CASE WHEN extract(hour from (now() at time zone 'Asia/Jakarta')) between 8 and 14 THEN 'Pagi'
                  WHEN extract(hour from (now() at time zone 'Asia/Jakarta')) between 15 and 20 THEN 'Sore'
                  ELSE 'Luar Jam' END;

  SELECT 'INV-'||v_cabang_id||'-'||to_char(v_tanggal,'YYYYMMDD')||'-'||lpad((count(*)+1)::text,4,'0')
    INTO v_no_nota
  FROM trx_penjualan
  WHERE tanggal=v_tanggal AND cabang_id=v_cabang_id;

  -- (2) Harga barang: WAJIB per cabang. Tanpa ini keranjang bisa memakai harga
  --     barang cabang lain.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product
    FROM master_barang
    WHERE kode_obat=upper(v_item->>'kode') AND aktif='YA' AND cabang_id=v_cabang_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Barang % tidak ditemukan atau nonaktif di cabang %.', v_item->>'kode', v_cabang_id;
    END IF;

    v_unit_price := CASE WHEN p_tipe_customer='Tenaga Kesehatan' THEN nullif(v_product.harga_khusus,0)
                         WHEN p_tipe_customer='Apotek Lain' THEN nullif(v_product.harga_jual_mutasi,0)
                         ELSE nullif(v_product.harga_jual_umum,0) END;
    v_unit_price := coalesce(v_unit_price, v_product.harga_jual_umum, 0);

    IF coalesce((v_item->>'qty')::numeric,0)<=0 THEN
      RAISE EXCEPTION 'Qty barang % harus lebih dari nol.', v_product.nama_obat;
    END IF;

    v_subtotal := v_subtotal + v_unit_price * (v_item->>'qty')::numeric;
  END LOOP;

  IF p_reward_id IS NOT NULL THEN
    SELECT r.* INTO v_reward FROM loyalty_rewards r
    WHERE r.id=p_reward_id AND r.cabang_id=v_cabang_id AND r.is_active FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reward tidak tersedia pada cabang aktif.';
    END IF;
    IF nullif(norm_wa(p_nomor_wa),'') IS NULL THEN
      RAISE EXCEPTION 'Reward hanya dapat digunakan oleh pelanggan terdaftar.';
    END IF;

    SELECT c.total_points, c.tipe_customer INTO v_reward_points, v_customer_type
    FROM master_customer c
    WHERE c.cabang_id=v_cabang_id AND c.nomor_wa=norm_wa(p_nomor_wa)
      AND c.total_points>=v_reward.points_required
      AND (CASE WHEN v_reward.min_tier='gold' THEN 3 WHEN v_reward.min_tier='silver' THEN 2 ELSE 1 END)
          <= (CASE WHEN c.tier='gold' THEN 3 WHEN c.tier='silver' THEN 2 ELSE 1 END)
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Poin atau tier pelanggan tidak memenuhi syarat reward.';
    END IF;

    v_reward_points := v_reward.points_required;
    v_reward_discount := greatest(0, coalesce(v_reward.reward_value,0));
    IF v_customer_type='Tenaga Kesehatan' THEN
      v_reward_discount := floor(v_reward_discount/2);
    ELSIF v_customer_type='Apotek Lain' THEN
      RAISE EXCEPTION 'Pelanggan Apotek Lain tidak memiliki poin atau reward.';
    END IF;
  END IF;

  v_harga_akhir := greatest(0, v_subtotal - coalesce(p_diskon,0) - v_reward_discount);
  IF coalesce(p_bayar,0) < v_harga_akhir THEN
    RAISE EXCEPTION 'Pembayaran kurang.';
  END IF;
  v_kembalian := p_bayar - v_harga_akhir;

  INSERT INTO trx_penjualan(no_nota,tanggal,jam,nomor_wa,nama_pelanggan,tipe_customer,petugas_transaksi,shift,subtotal,diskon,harga_akhir,total_hpp,bayar,kembalian,cabang_id)
  VALUES(v_no_nota,v_tanggal,v_jam,nullif(norm_wa(p_nomor_wa),''),coalesce(nullif(p_nama_pelanggan,''),'Umum'),p_tipe_customer,p_username,v_shift,v_subtotal,coalesce(p_diskon,0)+v_reward_discount,v_harga_akhir,0,p_bayar,v_kembalian,v_cabang_id);

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product
    FROM master_barang
    WHERE kode_obat=upper(v_item->>'kode') AND aktif='YA' AND cabang_id=v_cabang_id;

    v_unit_price := CASE WHEN p_tipe_customer='Tenaga Kesehatan' THEN nullif(v_product.harga_khusus,0)
                         WHEN p_tipe_customer='Apotek Lain' THEN nullif(v_product.harga_jual_mutasi,0)
                         ELSE nullif(v_product.harga_jual_umum,0) END;
    v_unit_price := coalesce(v_unit_price, v_product.harga_jual_umum, 0);
    v_remaining := (v_item->>'qty')::numeric;

    WHILE v_remaining>0 LOOP
      -- (3) Stok: sudah per cabang sejak semula — tidak diubah.
      SELECT * INTO v_batch FROM stok_batch
      WHERE kode_obat=v_product.kode_obat AND cabang_id=v_cabang_id AND stok_real>0
      ORDER BY expired_date ASC, id_batch ASC
      FOR UPDATE SKIP LOCKED LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stok % tidak mencukupi.', v_product.nama_obat;
      END IF;

      v_take := least(v_remaining, v_batch.stok_real);
      UPDATE stok_batch SET stok_real=stok_real-v_take, updated_at=now() WHERE id_batch=v_batch.id_batch;
      INSERT INTO trx_penjualan_detail(no_nota,tanggal,kode_obat,nama_obat,kode_batch,expired_date,qty,harga_satuan,harga_modal,subtotal,cabang_id)
      VALUES(v_no_nota,v_tanggal,v_product.kode_obat,v_product.nama_obat,v_batch.kode_batch,v_batch.expired_date,v_take,v_unit_price,v_batch.harga_modal_batch,v_unit_price*v_take,v_cabang_id);
      v_total_hpp := v_total_hpp + v_batch.harga_modal_batch*v_take;
      v_detail := v_detail || jsonb_build_array(jsonb_build_object('Nama_Obat',v_product.nama_obat,'Qty',v_take,'Harga_Satuan',v_unit_price,'Subtotal',v_unit_price*v_take));
      v_remaining := v_remaining - v_take;
    END LOOP;
  END LOOP;

  UPDATE trx_penjualan SET total_hpp=v_total_hpp WHERE no_nota=v_no_nota AND cabang_id=v_cabang_id;

  IF p_reward_id IS NOT NULL THEN
    INSERT INTO loyalty_redemptions(cabang_id,customer_id,reward_id,no_nota,points_used,reward_value)
    SELECT v_cabang_id,c.id,p_reward_id,v_no_nota,v_reward.points_required,v_reward_discount
    FROM master_customer c WHERE c.cabang_id=v_cabang_id AND c.nomor_wa=norm_wa(p_nomor_wa);

    UPDATE master_customer SET total_points=total_points-v_reward.points_required
    WHERE cabang_id=v_cabang_id AND nomor_wa=norm_wa(p_nomor_wa);

    INSERT INTO loyalty_transactions(cabang_id,customer_id,no_nota,points_change,reason)
    SELECT v_cabang_id,c.id,v_no_nota,-v_reward.points_required,'redeem'
    FROM master_customer c WHERE c.cabang_id=v_cabang_id AND c.nomor_wa=norm_wa(p_nomor_wa);
  END IF;

  RETURN jsonb_build_object(
    'No_Nota',v_no_nota,'Tanggal',v_tanggal,'Jam',v_jam,'Petugas',p_username,'Shift',v_shift,
    'Apotek','Apotek Fa-Mitra','Nama_Pelanggan',coalesce(nullif(p_nama_pelanggan,''),'Umum'),
    'Subtotal',v_subtotal,'Diskon',coalesce(p_diskon,0)+v_reward_discount,'Reward_Diskon',v_reward_discount,
    'Reward_Points_Used',v_reward_points,'Harga_Akhir',v_harga_akhir,'Bayar',p_bayar,'Kembalian',v_kembalian,
    'Total_HPP',v_total_hpp,'items',v_detail);
END;
$function$;

-- -----------------------------------------------------------------------------
-- 2. purchase_save (versi 8 parameter)
--    Perubahan utama: nomor faktur dibuat SISTEM (prefix cabang) dan nomor asli
--    PBF masuk ke kolom baru no_faktur_supplier; harga hanya ditulis untuk cabang
--    sendiri; supplier divalidasi lewat NAMA + supplier_cabang.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purchase_save(
  p_username text, p_no_faktur_supplier text, p_supplier text, p_kategori text,
  p_tanggal date, p_jatuh_tempo date, p_items jsonb,
  p_cabang_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb;
  v_subtotal numeric;
  v_total_item numeric := 0;
  v_total_tagihan numeric := 0;
  v_product record;
  v_batch record;
  v_id_batch text;
  v_cabang_id text;
  v_user_cabang text;
  v_no_faktur text;
  v_no_faktur_supplier text;
  v_tanggal date;
BEGIN
  -- (1) CABANG dari app_users (sesi petugas), tanpa fallback 'KARLA'.
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

  -- Lock per cabang (bagian 5.2 poin 5).
  PERFORM pg_advisory_xact_lock(hashtext('purchase_save:'||v_cabang_id));

  IF nullif(trim(coalesce(p_supplier,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Supplier wajib dipilih.';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    raise exception 'Detail pembelian kosong.';
  END IF;

  -- (5) Nomor faktur SISTEM: FK-<CABANG>-<YYYYMMDD>-#### (keputusan 4).
  --     PK trx_pembelian(no_faktur) tetap global; nomor memuat cabang sehingga
  --     dua cabang tidak mungkin bertabrakan.
  SELECT 'FK-'||v_cabang_id||'-'||to_char(v_tanggal,'YYYYMMDD')||'-'||lpad((count(*)+1)::text,4,'0')
    INTO v_no_faktur
  FROM trx_pembelian
  WHERE cabang_id = v_cabang_id AND tanggal_faktur = v_tanggal;

  IF EXISTS (SELECT 1 FROM trx_pembelian WHERE no_faktur = v_no_faktur) THEN
    RAISE EXCEPTION 'Nomor faktur % sudah pernah dicatat.', v_no_faktur;
  END IF;

  -- Nomor PBF (kalau diisi) tidak boleh dobel untuk cabang + supplier yang sama.
  -- Ini juga pengaman yang sama dengan unique index parsial dari migrasi 4,
  -- tapi dengan pesan yang jelas.
  IF v_no_faktur_supplier IS NOT NULL AND EXISTS (
    SELECT 1 FROM trx_pembelian
    WHERE cabang_id = v_cabang_id
      AND supplier = p_supplier
      AND no_faktur_supplier = v_no_faktur_supplier
  ) THEN
    RAISE EXCEPTION 'Nomor faktur PBF "%" sudah pernah dicatat untuk supplier %.', v_no_faktur_supplier, p_supplier;
  END IF;

  -- (6) Supplier divalidasi lewat NAMA (keputusan 10.2 B): nama -> master_supplier
  --     -> supplier_cabang cabang ini. Data lama tidak dimigrasi; pindah ke kode
  --     supplier adalah PR lanjutan.
  --     Catatan jujur: pencocokan nama ini PERSIS (peka huruf besar/kecil).
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

  INSERT INTO trx_pembelian(no_faktur,supplier,kategori,tanggal_faktur,jatuh_tempo,total_item,total_tagihan,petugas,cabang_id,no_faktur_supplier)
  VALUES(v_no_faktur,p_supplier,coalesce(nullif(p_kategori,''),'Tidak Berpajak'),v_tanggal,p_jatuh_tempo,0,0,p_username,v_cabang_id,v_no_faktur_supplier);

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF coalesce((v_item->>'Qty')::numeric,0) <= 0 OR coalesce((v_item->>'Harga_Netto')::numeric,0) < 0 THEN
      RAISE EXCEPTION 'Qty dan harga netto item tidak valid.';
    END IF;

    -- (3) Barang: per cabang.
    SELECT * INTO v_product
    FROM master_barang
    WHERE kode_obat = upper(v_item->>'Kode_Obat') AND aktif = 'YA' AND cabang_id = v_cabang_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Barang % tidak ditemukan atau nonaktif di cabang %.', v_item->>'Kode_Obat', v_cabang_id;
    END IF;

    v_subtotal := ((v_item->>'Harga_Netto')::numeric * (v_item->>'Qty')::numeric) * (1 + coalesce((v_item->>'PPN')::numeric,0)/100) - coalesce((v_item->>'Diskon')::numeric,0);
    IF v_subtotal < 0 THEN
      RAISE EXCEPTION 'Subtotal item tidak boleh negatif.';
    END IF;

    INSERT INTO trx_pembelian_detail(no_faktur,kode_obat,nama_obat,kode_batch,expired_date,qty,harga_netto,ppn,diskon,harga_jual_umum_baru,subtotal,cabang_id)
    VALUES(v_no_faktur,v_product.kode_obat,v_product.nama_obat,v_item->>'Kode_Batch',(v_item->>'Expired_Date')::date,(v_item->>'Qty')::numeric,(v_item->>'Harga_Netto')::numeric,coalesce((v_item->>'PPN')::numeric,0),coalesce((v_item->>'Diskon')::numeric,0),coalesce((v_item->>'Harga_Jual_Umum_Baru')::numeric,0),v_subtotal,v_cabang_id);

    -- (4) Batch: sudah per cabang. Uniknya baru per cabang setelah migrasi 3.
    SELECT * INTO v_batch FROM stok_batch
    WHERE kode_obat = v_product.kode_obat AND kode_batch = v_item->>'Kode_Batch' AND cabang_id = v_cabang_id
    FOR UPDATE;

    IF FOUND THEN
      UPDATE stok_batch
      SET stok_real = stok_real + (v_item->>'Qty')::numeric,
          expired_date = (v_item->>'Expired_Date')::date,
          harga_modal_batch = (v_item->>'Harga_Netto')::numeric,
          updated_at = now()
      WHERE id_batch = v_batch.id_batch;
    ELSE
      v_id_batch := 'BT-' || to_char(now() at time zone 'Asia/Jakarta','YYMMDDHH24MISS') || '-' || lpad((floor(random()*900)+100)::int::text,3,'0');
      INSERT INTO stok_batch(id_batch,kode_obat,kode_batch,expired_date,stok_real,harga_modal_batch,cabang_id)
      VALUES(v_id_batch,v_product.kode_obat,v_item->>'Kode_Batch',(v_item->>'Expired_Date')::date,(v_item->>'Qty')::numeric,(v_item->>'Harga_Netto')::numeric,v_cabang_id);
    END IF;

    -- (2) HARGA: hanya cabang sendiri. Sebelumnya `where kode_obat = ...` tanpa
    --     cabang_id, sehingga pembelian di KENDAL mengubah harga di semua cabang.
    UPDATE master_barang
    SET harga_modal = (v_item->>'Harga_Netto')::numeric,
        harga_jual_umum = CASE WHEN coalesce((v_item->>'Harga_Jual_Umum_Baru')::numeric,0) > 0
                               THEN (v_item->>'Harga_Jual_Umum_Baru')::numeric
                               ELSE harga_jual_umum END,
        updated_at = now()
    WHERE kode_obat = v_product.kode_obat AND cabang_id = v_cabang_id;

    v_total_item := v_total_item + (v_item->>'Qty')::numeric;
    v_total_tagihan := v_total_tagihan + v_subtotal;
  END LOOP;

  UPDATE trx_pembelian SET total_item = v_total_item, total_tagihan = v_total_tagihan
  WHERE no_faktur = v_no_faktur AND cabang_id = v_cabang_id;

  RETURN jsonb_build_object('No_Faktur',v_no_faktur,'No_Faktur_Supplier',v_no_faktur_supplier,'Total_Item',v_total_item,'Total_Tagihan',v_total_tagihan);
END;
$function$;

-- -----------------------------------------------------------------------------
-- 3. generate_refill_reminders
--    PERUBAHAN DI FILE INI HANYA DUA:
--      (a) parameter cabang tidak lagi punya DEFAULT — pemanggil (Edge Function
--          `api:refill.generate`) WAJIB menyebut cabang sesi; job internal harus
--          mengirim NULL secara eksplisit. Arti NULL dipersempit ke "job internal".
--      (b) teks pesan menyebut nama cabang, supaya pelanggan Pucuk tidak
--          diarahkan ke Karla.
--    >>> TEMUAN 15 TIDAK DIPERBAIKI DI SINI (keputusan 8). Literal 'ACTIVE',
--        'n8n', dan 'PENDING' di bawah ini SENGAJA dibiarkan apa adanya, persis
--        seperti versi lama. Perbaikannya (mengikuti CHECK constraint huruf kecil)
--        adalah PR terpisah. Jangan "merapikan" hurufnya di file ini.
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.generate_refill_reminders(p_cabang_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
 INSERT INTO public.notification_log(cabang_id,customer_id,refill_program_id,channel,message,status)
 SELECT p.cabang_id,p.customer_id,p.id,'n8n','Halo '||c.nama||', waktunya isi ulang obat Anda. Silakan hubungi '||coalesce(nullif(cab.nama_cabang,''),'Apotek Fa-Mitra')||' untuk pengecekan ketersediaan.','PENDING'
 FROM public.refill_programs p
 JOIN public.master_customer c ON c.id=p.customer_id AND c.cabang_id=p.cabang_id
 JOIN public.master_cabang cab ON cab.kode_cabang=p.cabang_id
 WHERE p.status='ACTIVE' AND p.next_reminder_date<=current_date AND c.consent_marketing=true
   AND (p_cabang_id IS NULL OR p.cabang_id=p_cabang_id)
   AND NOT EXISTS (SELECT 1 FROM public.notification_log l WHERE l.refill_program_id=p.id AND l.channel='n8n' AND l.created_at >= date_trunc('day',now()))
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
RETURN n;
END;
$function$;

-- -----------------------------------------------------------------------------
-- 4. pos_checkout_promo
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pos_checkout_promo(
  p_username text, p_nomor_wa text, p_nama_pelanggan text, p_tipe_customer text,
  p_items jsonb, p_diskon numeric, p_bayar numeric,
  p_cabang_id text DEFAULT NULL::text, p_reward_id uuid DEFAULT NULL::uuid,
  p_coupon_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cabang_id text;
  v_user_cabang text;
  v_code text := upper(trim(coalesce(p_coupon_code,'')));
  v_coupon record;
  v_campaign record;
  v_customer record;
  v_subtotal numeric := 0;
  v_unit_price numeric;
  v_item jsonb;
  v_discount numeric := 0;
  v_used_total integer := 0;
  v_used_customer integer := 0;
  v_segment text;
  v_days integer;
  v_result jsonb;
BEGIN
  -- CABANG dari app_users (sesi petugas), tanpa fallback 'KARLA'.
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

  PERFORM pg_advisory_xact_lock(hashtext('promo:'||v_cabang_id||':'||v_code));

  IF v_code <> '' THEN
    IF nullif(norm_wa(p_nomor_wa),'') IS NULL THEN
      RAISE EXCEPTION 'Kupon hanya dapat digunakan oleh pelanggan terdaftar.';
    END IF;

    SELECT c.* INTO v_coupon FROM promo_coupons c
    WHERE c.cabang_id=v_cabang_id AND upper(c.code)=v_code AND c.is_active FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Kode kupon tidak ditemukan atau tidak aktif.';
    END IF;

    SELECT p.* INTO v_campaign FROM promo_campaigns p
    WHERE p.id=v_coupon.campaign_id AND p.cabang_id=v_cabang_id AND p.status='ACTIVE'
      AND now() BETWEEN p.starts_at AND p.ends_at FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Kampanye kupon tidak aktif atau sudah berakhir.';
    END IF;

    SELECT c.* INTO v_customer FROM master_customer c
    WHERE c.cabang_id=v_cabang_id AND c.nomor_wa=norm_wa(p_nomor_wa) FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Pelanggan belum terdaftar untuk promo ini.';
    END IF;

    v_days := CASE WHEN v_customer.tanggal_terakhir_beli IS NULL THEN NULL
                   ELSE current_date - v_customer.tanggal_terakhir_beli END;
    v_segment := CASE WHEN v_customer.jumlah_transaksi=0 OR v_customer.tanggal_terakhir_beli IS NULL THEN 'Baru'
                      WHEN v_days>180 THEN 'Dormant'
                      WHEN v_days>60 THEN 'At-Risk'
                      WHEN v_customer.total_belanja>=2000000 OR v_customer.jumlah_transaksi>=8 THEN 'VIP'
                      ELSE 'Active Routine' END;

    IF NOT EXISTS (SELECT 1 FROM promo_segment_targets t
                   WHERE t.campaign_id=v_campaign.id AND t.segment=v_segment
                     AND (t.customer_type IS NULL OR t.customer_type=p_tipe_customer)) THEN
      RAISE EXCEPTION 'Pelanggan tidak termasuk segmen promo ini.';
    END IF;

    SELECT count(*) INTO v_used_total FROM promo_redemptions r
    WHERE r.coupon_id=v_coupon.id AND r.status='APPLIED';
    SELECT count(*) INTO v_used_customer FROM promo_redemptions r
    WHERE r.coupon_id=v_coupon.id AND r.customer_id=v_customer.id AND r.status='APPLIED';

    IF v_coupon.usage_limit_total IS NOT NULL AND v_used_total>=v_coupon.usage_limit_total THEN
      RAISE EXCEPTION 'Kuota kupon sudah habis.';
    END IF;
    IF v_used_customer>=v_coupon.usage_limit_per_customer THEN
      RAISE EXCEPTION 'Kupon sudah pernah digunakan oleh pelanggan ini.';
    END IF;
  END IF;

  -- (2) Harga subtotal WAJIB per cabang; kalau barang tidak dijual di cabang ini,
  --     transaksi ditolak (bukan dihitung Rp0 dari harga cabang lain).
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT CASE WHEN p_tipe_customer='Tenaga Kesehatan' THEN nullif(harga_khusus,0)
                WHEN p_tipe_customer='Apotek Lain' THEN nullif(harga_jual_mutasi,0)
                ELSE nullif(harga_jual_umum,0) END
      INTO v_unit_price
    FROM master_barang
    WHERE kode_obat=upper(v_item->>'kode') AND aktif='YA' AND cabang_id=v_cabang_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Barang % tidak dijual di cabang %.', v_item->>'kode', v_cabang_id;
    END IF;

    v_subtotal := v_subtotal + coalesce(v_unit_price,0) * coalesce((v_item->>'qty')::numeric,0);
  END LOOP;

  IF v_code <> '' THEN
    IF v_subtotal < v_coupon.min_purchase THEN
      RAISE EXCEPTION 'Minimum belanja kupon adalah Rp%.', v_coupon.min_purchase;
    END IF;

    v_discount := CASE WHEN v_coupon.discount_type='PERCENT' THEN v_subtotal*v_coupon.discount_value/100
                       ELSE v_coupon.discount_value END;
    IF v_coupon.max_discount IS NOT NULL THEN
      v_discount := least(v_discount, v_coupon.max_discount);
    END IF;
    v_discount := least(greatest(v_discount,0), v_subtotal);

    v_result := public.pos_checkout(p_username,p_nomor_wa,p_nama_pelanggan,p_tipe_customer,p_items,coalesce(p_diskon,0)+v_discount,p_bayar,v_cabang_id,p_reward_id);

    UPDATE trx_penjualan
    SET coupon_id=v_coupon.id, coupon_code=v_coupon.code, campaign_id=v_campaign.id, coupon_discount=v_discount
    WHERE no_nota=v_result->>'No_Nota' AND cabang_id=v_cabang_id;

    INSERT INTO promo_redemptions(coupon_id,campaign_id,customer_id,cabang_id,invoice_no,discount_amount)
    VALUES(v_coupon.id,v_campaign.id,v_customer.id,v_cabang_id,v_result->>'No_Nota',v_discount);

    RETURN v_result || jsonb_build_object('Coupon_Code',v_coupon.code,'Campaign_Name',v_campaign.name,'Coupon_Discount',v_discount,'Customer_Segment',v_segment);
  END IF;

  RETURN public.pos_checkout(p_username,p_nomor_wa,p_nama_pelanggan,p_tipe_customer,p_items,p_diskon,p_bayar,v_cabang_id,p_reward_id);
END;
$function$;

-- -----------------------------------------------------------------------------
-- 5. pos_checkout_bundle
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pos_checkout_bundle(
  p_username text, p_nomor_wa text, p_nama_pelanggan text, p_tipe_customer text,
  p_items jsonb, p_diskon numeric, p_bayar numeric,
  p_cabang_id text DEFAULT NULL::text, p_reward_id uuid DEFAULT NULL::uuid,
  p_bundle_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_branch text;
  v_user_cabang text;
  v_code text := upper(trim(coalesce(p_bundle_code,'')));
  v_bundle record;
  v_item record;
  v_cart jsonb;
  v_qty numeric;
  v_price numeric;
  v_base numeric := 0;
  v_discount numeric := 0;
  v_result jsonb;
  v_item_total integer;
  v_item_cabang integer;
BEGIN
  -- CABANG dari app_users (sesi petugas), tanpa fallback 'KARLA'.
  SELECT u.cabang_id INTO v_user_cabang
  FROM public.app_users u
  WHERE u.username = p_username AND u.aktif = 'YA';

  IF v_user_cabang IS NULL THEN
    RAISE EXCEPTION 'Petugas % tidak dikenal atau tidak aktif.', p_username;
  END IF;

  IF nullif(p_cabang_id,'') IS NOT NULL AND p_cabang_id <> v_user_cabang THEN
    RAISE EXCEPTION 'Cabang % tidak sesuai dengan cabang petugas (%).', p_cabang_id, v_user_cabang;
  END IF;

  v_branch := v_user_cabang;

  IF v_code='' THEN
    RAISE EXCEPTION 'Kode bundle wajib diisi.';
  END IF;

  SELECT b.* INTO v_bundle FROM promo_bundles b
  WHERE b.cabang_id=v_branch AND upper(b.code)=v_code AND b.status='ACTIVE'
    AND now() BETWEEN b.starts_at AND b.ends_at FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bundle tidak aktif atau sudah berakhir.';
  END IF;

  -- (3) Semua anggota bundle harus benar-benar dijual di cabang ini. Tanpa
  --     pemeriksaan ini, JOIN yang tidak menemukan barang akan MELEWATKAN item
  --     itu diam-diam dan harga bundle dihitung tanpa barang tersebut.
  SELECT count(*) INTO v_item_total FROM promo_bundle_items i WHERE i.bundle_id=v_bundle.id;
  SELECT count(*) INTO v_item_cabang FROM promo_bundle_items i
  JOIN master_barang m ON m.kode_obat=i.kode_obat AND m.cabang_id=v_branch
  WHERE i.bundle_id=v_bundle.id;

  IF v_item_total <> v_item_cabang THEN
    RAISE EXCEPTION 'Bundle % memuat barang yang tidak dijual di cabang %.', v_bundle.code, v_branch;
  END IF;

  -- (2) Harga barang diambil dari master_barang CABANG INI.
  FOR v_item IN
    SELECT i.*, m.nama_obat, m.harga_jual_umum, m.harga_khusus, m.harga_jual_mutasi, m.aktif, m.golongan
    FROM promo_bundle_items i
    JOIN master_barang m ON m.kode_obat = i.kode_obat AND m.cabang_id = v_branch
    WHERE i.bundle_id = v_bundle.id
  LOOP
    IF v_item.aktif <> 'YA' OR coalesce(v_item.golongan,'') <> 'Bebas' THEN
      RAISE EXCEPTION 'Bundle hanya boleh berisi produk aktif golongan Bebas.';
    END IF;

    SELECT value INTO v_cart FROM jsonb_array_elements(p_items)
    WHERE upper(value->>'kode')=upper(v_item.kode_obat) LIMIT 1;
    IF v_cart IS NULL OR coalesce((v_cart->>'qty')::numeric,0) < v_item.qty THEN
      RAISE EXCEPTION 'Isi keranjang belum memenuhi bundle: % x %.', v_item.qty, v_item.nama_obat;
    END IF;

    v_price := CASE WHEN p_tipe_customer='Tenaga Kesehatan' THEN v_item.harga_khusus
                    WHEN p_tipe_customer='Apotek Lain' THEN v_item.harga_jual_mutasi
                    ELSE v_item.harga_jual_umum END;
    v_base := v_base + coalesce(v_price,0)*v_item.qty;
  END LOOP;

  IF v_base<=0 THEN
    RAISE EXCEPTION 'Bundle tidak memiliki harga dasar yang valid.';
  END IF;
  IF v_bundle.bundle_price>=v_base THEN
    RAISE EXCEPTION 'Harga bundle harus lebih rendah dari harga normal.';
  END IF;

  v_discount := v_base - v_bundle.bundle_price;
  v_result := public.pos_checkout(p_username,p_nomor_wa,p_nama_pelanggan,p_tipe_customer,p_items,coalesce(p_diskon,0)+v_discount,p_bayar,v_branch,p_reward_id);

  UPDATE trx_penjualan
  SET bundle_id=v_bundle.id, bundle_code=v_bundle.code, bundle_discount=v_discount
  WHERE no_nota=v_result->>'No_Nota' AND cabang_id=v_branch;

  RETURN v_result || jsonb_build_object('Bundle_Code',v_bundle.code,'Bundle_Name',v_bundle.name,'Bundle_Discount',v_discount,'Bundle_Base_Price',v_base);
END;
$function$;

-- -----------------------------------------------------------------------------
-- 6. VERIFIKASI — wajib dijalankan sebelum menyatakan migrasi 5 selesai
-- -----------------------------------------------------------------------------
-- 6a. Harus tepat SATU pos_checkout dan SATU purchase_save (uji T53):
SELECT p.proname, p.pronargs, pg_get_function_arguments(p.oid) AS argumen
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('pos_checkout','purchase_save','pos_checkout_promo','pos_checkout_bundle','generate_refill_reminders')
ORDER BY 1, 2;

-- 6b. Overload lama harus benar-benar hilang. Jalankan di lingkungan uji:
--   select public.purchase_save('x','x','x','x',current_date,null,'[]'::jsonb);
--   -> HARUS gagal: function public.purchase_save(...) does not exist
--   select public.pos_checkout('x','','','', '[]'::jsonb, 0, 0);
--   -> HARUS gagal: function public.pos_checkout(...) does not exist

-- 6c. Default parameter cabang pada generate_refill_reminders sudah tidak ada:
SELECT p.proname, pg_get_function_arguments(p.oid) AS argumen
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'generate_refill_reminders';

COMMIT;

-- =============================================================================
-- ROLLBACK — DEFINISI FUNGSI LAMA (komentar; sumber: supabase/schema/fungsi.csv)
-- =============================================================================
-- Cara pakai: jalankan blok yang perlu saja, di dalam satu transaksi, dengan
-- urutan: (1) buang versi baru bila tanda tangannya berbeda, (2) tempel kembali
-- definisi lama di bawah ini.
--
-- CATATAN PENTING untuk purchase_save: nama parameter ke-2 berubah
-- (p_no_faktur -> p_no_faktur_supplier), jadi mengembalikannya berarti DROP dulu
-- versi baru, baru CREATE versi lama:
--   BEGIN;
--     DROP FUNCTION IF EXISTS public.purchase_save(text,text,text,text,date,date,jsonb,text);
--     -- lalu tempel definisi purchase_save lama di bawah
--   COMMIT;
-- Untuk pos_checkout versi 9 parameter, `CREATE OR REPLACE` cukup (tanda tangan
-- sama), tapi rollback juga harus mengembalikan Edge Function `api` ke versi lama
-- (p_no_faktur) — lihat 9.4 langkah 8.
--
-- -----------------------------------------------------------------------------
-- A. OVERLOAD LAMA yang di-DROP file ini — pos_checkout 7 parameter
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION public.pos_checkout(p_username text, p_nomor_wa text, p_nama_pelanggan text, p_tipe_customer text, p_items jsonb, p_diskon numeric, p_bayar numeric)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$ declare v_tanggal date := (now() at time zone 'Asia/Jakarta')::date; v_jam text := to_char(now() at time zone 'Asia/Jakarta', 'HH24:MI'); v_shift text; v_no_nota text; v_subtotal numeric := 0; v_harga_akhir numeric; v_total_hpp numeric := 0; v_kembalian numeric; v_item jsonb; v_product record; v_batch record; v_remaining numeric; v_take numeric; v_unit_price numeric; v_detail jsonb := '[]'::jsonb; v_segment text; begin perform pg_advisory_xact_lock(hashtext('pos_checkout')); if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Keranjang kosong.'; end if; if coalesce(p_diskon,0) < 0 or coalesce(p_bayar,0) < 0 then raise exception 'Nilai diskon atau pembayaran tidak valid.'; end if; v_shift := case when extract(hour from (now() at time zone 'Asia/Jakarta')) between 8 and 14 then 'Pagi' when extract(hour from (now() at time zone 'Asia/Jakarta')) between 15 and 20 then 'Sore' else 'Luar Jam' end; select 'INV' || to_char(v_tanggal,'YYYYMMDD') || '-' || lpad((count(*) + 1)::text,4,'0') into v_no_nota from trx_penjualan where tanggal = v_tanggal; for v_item in select value from jsonb_array_elements(p_items) loop select * into v_product from master_barang where kode_obat = upper(v_item->>'kode') and aktif = 'YA' for share; if not found then raise exception 'Barang % tidak ditemukan atau nonaktif.', v_item->>'kode'; end if; v_unit_price := case when p_tipe_customer = 'Tenaga Kesehatan' then nullif(v_product.harga_khusus,0) when p_tipe_customer = 'Apotek Lain' then nullif(v_product.harga_jual_mutasi,0) else nullif(v_product.harga_jual_umum,0) end; v_unit_price := coalesce(v_unit_price, v_product.harga_jual_umum, 0); if coalesce((v_item->>'qty')::numeric,0) <= 0 then raise exception 'Qty barang % harus lebih dari nol.', v_product.nama_obat; end if; v_subtotal := v_subtotal + v_unit_price * (v_item->>'qty')::numeric; end loop; v_harga_akhir := greatest(0, v_subtotal - coalesce(p_diskon,0)); if coalesce(p_bayar,0) < v_harga_akhir then raise exception 'Pembayaran kurang.'; end if; v_kembalian := p_bayar - v_harga_akhir; insert into trx_penjualan(no_nota,tanggal,jam,nomor_wa,nama_pelanggan,tipe_customer,petugas_transaksi,shift,subtotal,diskon,harga_akhir,total_hpp,bayar,kembalian) values(v_no_nota,v_tanggal,v_jam,nullif(norm_wa(p_nomor_wa),''),coalesce(nullif(p_nama_pelanggan,''),'Umum'),p_tipe_customer,p_username,v_shift,v_subtotal,coalesce(p_diskon,0),v_harga_akhir,0,p_bayar,v_kembalian); for v_item in select value from jsonb_array_elements(p_items) loop select * into v_product from master_barang where kode_obat = upper(v_item->>'kode') and aktif = 'YA'; v_unit_price := case when p_tipe_customer = 'Tenaga Kesehatan' then nullif(v_product.harga_khusus,0) when p_tipe_customer = 'Apotek Lain' then nullif(v_product.harga_jual_mutasi,0) else nullif(v_product.harga_jual_umum,0) end; v_unit_price := coalesce(v_unit_price, v_product.harga_jual_umum, 0); v_remaining := (v_item->>'qty')::numeric; while v_remaining > 0 loop select * into v_batch from stok_batch where kode_obat = v_product.kode_obat and stok_real > 0 order by expired_date asc, id_batch asc for update skip locked limit 1; if not found then raise exception 'Stok % tidak mencukupi.', v_product.nama_obat; end if; v_take := least(v_remaining, v_batch.stok_real); update stok_batch set stok_real = stok_real - v_take, updated_at = now() where id_batch = v_batch.id_batch; insert into trx_penjualan_detail(no_nota,tanggal,kode_obat,nama_obat,kode_batch,expired_date,qty,harga_satuan,harga_modal,subtotal) values(v_no_nota,v_tanggal,v_product.kode_obat,v_product.nama_obat,v_batch.kode_batch,v_batch.expired_date,v_take,v_unit_price,v_batch.harga_modal_batch,v_unit_price*v_take); v_total_hpp := v_total_hpp + v_batch.harga_modal_batch*v_take; v_detail := v_detail || jsonb_build_array(jsonb_build_object('Nama_Obat',v_product.nama_obat,'Qty',v_take,'Harga_Satuan',v_unit_price,'Subtotal',v_unit_price*v_take)); v_remaining := v_remaining - v_take; end loop; end loop; update trx_penjualan set total_hpp = v_total_hpp where no_nota = v_no_nota; if nullif(norm_wa(p_nomor_wa),'') is not null then insert into master_customer(nomor_wa,nama,tipe_customer) values(norm_wa(p_nomor_wa),coalesce(nullif(p_nama_pelanggan,''),'Umum'),p_tipe_customer) on conflict (nomor_wa) do update set nama = excluded.nama, tipe_customer = excluded.tipe_customer; update master_customer set total_belanja = greatest(0,total_belanja + v_harga_akhir), jumlah_transaksi = jumlah_transaksi + 1, tanggal_terakhir_beli = v_tanggal where nomor_wa = norm_wa(p_nomor_wa); end if; return jsonb_build_object('No_Nota',v_no_nota,'Tanggal',v_tanggal,'Jam',v_jam,'Petugas',p_username,'Shift',v_shift,'Apotek','Apotek Fa-Mitra','Nama_Pelanggan',coalesce(nullif(p_nama_pelanggan,''),'Umum'),'Subtotal',v_subtotal,'Diskon',coalesce(p_diskon,0),'Harga_Akhir',v_harga_akhir,'Bayar',p_bayar,'Kembalian',v_kembalian,'Total_HPP',v_total_hpp,'items',v_detail); end; $function$
--
--

-- -----------------------------------------------------------------------------
-- B. OVERLOAD LAMA yang di-DROP file ini — purchase_save 7 parameter
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION public.purchase_save(p_username text, p_no_faktur text, p_supplier text, p_kategori text, p_tanggal date, p_jatuh_tempo date, p_items jsonb)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$ declare v_item jsonb; v_subtotal numeric; v_total_item numeric := 0; v_total_tagihan numeric := 0; v_product record; v_batch record; v_id_batch text; begin perform pg_advisory_xact_lock(hashtext('purchase_save')); if nullif(trim(p_no_faktur),'') is null then raise exception 'Nomor faktur wajib diisi.'; end if; if exists (select 1 from trx_pembelian where no_faktur = p_no_faktur) then raise exception 'Nomor faktur sudah pernah dicatat.'; end if; if nullif(trim(p_supplier),'') is null then raise exception 'Supplier wajib dipilih.'; end if; if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Detail pembelian kosong.'; end if; insert into trx_pembelian(no_faktur,supplier,kategori,tanggal_faktur,jatuh_tempo,total_item,total_tagihan,petugas) values(p_no_faktur,p_supplier,coalesce(nullif(p_kategori,''),'Tidak Berpajak'),coalesce(p_tanggal,current_date),p_jatuh_tempo,0,0,p_username); for v_item in select value from jsonb_array_elements(p_items) loop if coalesce((v_item->>'Qty')::numeric,0) <= 0 or coalesce((v_item->>'Harga_Netto')::numeric,0) < 0 then raise exception 'Qty dan harga netto item tidak valid.'; end if; select * into v_product from master_barang where kode_obat = upper(v_item->>'Kode_Obat') and aktif = 'YA' for update; if not found then raise exception 'Barang % tidak ditemukan atau nonaktif.', v_item->>'Kode_Obat'; end if; v_subtotal := ((v_item->>'Harga_Netto')::numeric * (v_item->>'Qty')::numeric) * (1 + coalesce((v_item->>'PPN')::numeric,0)/100) - coalesce((v_item->>'Diskon')::numeric,0); if v_subtotal < 0 then raise exception 'Subtotal item tidak boleh negatif.'; end if; insert into trx_pembelian_detail(no_faktur,kode_obat,nama_obat,kode_batch,expired_date,qty,harga_netto,ppn,diskon,harga_jual_umum_baru,subtotal) values(p_no_faktur,v_product.kode_obat,v_product.nama_obat,v_item->>'Kode_Batch',(v_item->>'Expired_Date')::date,(v_item->>'Qty')::numeric,(v_item->>'Harga_Netto')::numeric,coalesce((v_item->>'PPN')::numeric,0),coalesce((v_item->>'Diskon')::numeric,0),coalesce((v_item->>'Harga_Jual_Umum_Baru')::numeric,0),v_subtotal); select * into v_batch from stok_batch where kode_obat = v_product.kode_obat and kode_batch = v_item->>'Kode_Batch' for update; if found then update stok_batch set stok_real = stok_real + (v_item->>'Qty')::numeric, expired_date = (v_item->>'Expired_Date')::date, harga_modal_batch = (v_item->>'Harga_Netto')::numeric, updated_at = now() where id_batch = v_batch.id_batch; else v_id_batch := 'BT-' || to_char(now() at time zone 'Asia/Jakarta','YYMMDDHH24MISS') || '-' || lpad((floor(random()*900)+100)::int::text,3,'0'); insert into stok_batch(id_batch,kode_obat,kode_batch,expired_date,stok_real,harga_modal_batch) values(v_id_batch,v_product.kode_obat,v_item->>'Kode_Batch',(v_item->>'Expired_Date')::date,(v_item->>'Qty')::numeric,(v_item->>'Harga_Netto')::numeric); end if; update master_barang set harga_modal = (v_item->>'Harga_Netto')::numeric, harga_jual_umum = case when coalesce((v_item->>'Harga_Jual_Umum_Baru')::numeric,0) > 0 then (v_item->>'Harga_Jual_Umum_Baru')::numeric else harga_jual_umum end, updated_at = now() where kode_obat = v_product.kode_obat; v_total_item := v_total_item + (v_item->>'Qty')::numeric; v_total_tagihan := v_total_tagihan + v_subtotal; end loop; update trx_pembelian set total_item = v_total_item, total_tagihan = v_total_tagihan where no_faktur = p_no_faktur; return jsonb_build_object('No_Faktur',p_no_faktur,'Total_Item',v_total_item,'Total_Tagihan',v_total_tagihan); end; $function$
--
--

-- -----------------------------------------------------------------------------
-- C. OVERLOAD LAMA yang di-DROP file ini — purchase_save 8 parameter
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION public.purchase_save(p_username text, p_no_faktur text, p_supplier text, p_kategori text, p_tanggal date, p_jatuh_tempo date, p_items jsonb, p_cabang_id text DEFAULT NULL::text)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$ declare v_item jsonb; v_subtotal numeric; v_total_item numeric := 0; v_total_tagihan numeric := 0; v_product record; v_batch record; v_id_batch text; v_cabang_id text := coalesce(nullif(p_cabang_id, ''), (select cabang_id from app_users where username=p_username), 'KARLA'); begin perform pg_advisory_xact_lock(hashtext('purchase_save')); if nullif(trim(p_no_faktur),'') is null then raise exception 'Nomor faktur wajib diisi.'; end if; if exists (select 1 from trx_pembelian where no_faktur = p_no_faktur and cabang_id = v_cabang_id) then raise exception 'Nomor faktur sudah pernah dicatat.'; end if; if nullif(trim(p_supplier),'') is null then raise exception 'Supplier wajib dipilih.'; end if; if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Detail pembelian kosong.'; end if; insert into trx_pembelian(no_faktur,supplier,kategori,tanggal_faktur,jatuh_tempo,total_item,total_tagihan,petugas,cabang_id) values(p_no_faktur,p_supplier,coalesce(nullif(p_kategori,''),'Tidak Berpajak'),coalesce(p_tanggal,current_date),p_jatuh_tempo,0,0,p_username,v_cabang_id); for v_item in select value from jsonb_array_elements(p_items) loop if coalesce((v_item->>'Qty')::numeric,0) <= 0 or coalesce((v_item->>'Harga_Netto')::numeric,0) < 0 then raise exception 'Qty dan harga netto item tidak valid.'; end if; select * into v_product from master_barang where kode_obat = upper(v_item->>'Kode_Obat') and aktif = 'YA' for update; if not found then raise exception 'Barang % tidak ditemukan atau nonaktif.', v_item->>'Kode_Obat'; end if; v_subtotal := ((v_item->>'Harga_Netto')::numeric * (v_item->>'Qty')::numeric) * (1 + coalesce((v_item->>'PPN')::numeric,0)/100) - coalesce((v_item->>'Diskon')::numeric,0); if v_subtotal < 0 then raise exception 'Subtotal item tidak boleh negatif.'; end if; insert into trx_pembelian_detail(no_faktur,kode_obat,nama_obat,kode_batch,expired_date,qty,harga_netto,ppn,diskon,harga_jual_umum_baru,subtotal,cabang_id) values(p_no_faktur,v_product.kode_obat,v_product.nama_obat,v_item->>'Kode_Batch',(v_item->>'Expired_Date')::date,(v_item->>'Qty')::numeric,(v_item->>'Harga_Netto')::numeric,coalesce((v_item->>'PPN')::numeric,0),coalesce((v_item->>'Diskon')::numeric,0),coalesce((v_item->>'Harga_Jual_Umum_Baru')::numeric,0),v_subtotal,v_cabang_id); select * into v_batch from stok_batch where kode_obat = v_product.kode_obat and kode_batch = v_item->>'Kode_Batch' and cabang_id = v_cabang_id for update; if found then update stok_batch set stok_real = stok_real + (v_item->>'Qty')::numeric, expired_date = (v_item->>'Expired_Date')::date, harga_modal_batch = (v_item->>'Harga_Netto')::numeric, updated_at = now() where id_batch = v_batch.id_batch; else v_id_batch := 'BT-' || to_char(now() at time zone 'Asia/Jakarta','YYMMDDHH24MISS') || '-' || lpad((floor(random()*900)+100)::int::text,3,'0'); insert into stok_batch(id_batch,kode_obat,kode_batch,expired_date,stok_real,harga_modal_batch,cabang_id) values(v_id_batch,v_product.kode_obat,v_item->>'Kode_Batch',(v_item->>'Expired_Date')::date,(v_item->>'Qty')::numeric,(v_item->>'Harga_Netto')::numeric,v_cabang_id); end if; update master_barang set harga_modal = (v_item->>'Harga_Netto')::numeric, harga_jual_umum = case when coalesce((v_item->>'Harga_Jual_Umum_Baru')::numeric,0) > 0 then (v_item->>'Harga_Jual_Umum_Baru')::numeric else harga_jual_umum end, updated_at = now() where kode_obat = v_product.kode_obat; v_total_item := v_total_item + (v_item->>'Qty')::numeric; v_total_tagihan := v_total_tagihan + v_subtotal; end loop; update trx_pembelian set total_item = v_total_item, total_tagihan = v_total_tagihan where no_faktur = p_no_faktur and cabang_id = v_cabang_id; return jsonb_build_object('No_Faktur',p_no_faktur,'Total_Item',v_total_item,'Total_Tagihan',v_total_tagihan); end; $function$
--
--

-- -----------------------------------------------------------------------------
-- D. Versi SEBELUM file ini — pos_checkout 9 parameter
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION public.pos_checkout(p_username text, p_nomor_wa text, p_nama_pelanggan text, p_tipe_customer text, p_items jsonb, p_diskon numeric, p_bayar numeric, p_cabang_id text DEFAULT NULL::text, p_reward_id uuid DEFAULT NULL::uuid)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$ DECLARE v_tanggal date := (now() at time zone 'Asia/Jakarta')::date; v_jam text := to_char(now() at time zone 'Asia/Jakarta', 'HH24:MI'); v_shift text; v_no_nota text; v_subtotal numeric := 0; v_harga_akhir numeric; v_total_hpp numeric := 0; v_kembalian numeric; v_item jsonb; v_product record; v_batch record; v_remaining numeric; v_take numeric; v_unit_price numeric; v_detail jsonb := '[]'::jsonb; v_reward record; v_reward_discount numeric := 0; v_reward_points integer := 0; v_cabang_id text := coalesce(nullif(p_cabang_id,''),(select cabang_id from app_users where username=p_username),'KARLA'); v_customer_type text; BEGIN PERFORM pg_advisory_xact_lock(hashtext('pos_checkout')); IF p_items IS NULL OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Keranjang kosong.'; END IF; IF coalesce(p_diskon,0)<0 OR coalesce(p_bayar,0)<0 THEN RAISE EXCEPTION 'Nilai diskon atau pembayaran tidak valid.'; END IF; v_shift := CASE WHEN extract(hour from (now() at time zone 'Asia/Jakarta')) between 8 and 14 THEN 'Pagi' WHEN extract(hour from (now() at time zone 'Asia/Jakarta')) between 15 and 20 THEN 'Sore' ELSE 'Luar Jam' END; SELECT 'INV-'||v_cabang_id||'-'||to_char(v_tanggal,'YYYYMMDD')||'-'||lpad((count(*)+1)::text,4,'0') INTO v_no_nota FROM trx_penjualan WHERE tanggal=v_tanggal AND cabang_id=v_cabang_id; FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP SELECT * INTO v_product FROM master_barang WHERE kode_obat=upper(v_item->>'kode') AND aktif='YA' FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Barang % tidak ditemukan atau nonaktif.',v_item->>'kode'; END IF; v_unit_price := CASE WHEN p_tipe_customer='Tenaga Kesehatan' THEN nullif(v_product.harga_khusus,0) WHEN p_tipe_customer='Apotek Lain' THEN nullif(v_product.harga_jual_mutasi,0) ELSE nullif(v_product.harga_jual_umum,0) END; v_unit_price:=coalesce(v_unit_price,v_product.harga_jual_umum,0); IF coalesce((v_item->>'qty')::numeric,0)<=0 THEN RAISE EXCEPTION 'Qty barang % harus lebih dari nol.',v_product.nama_obat; END IF; v_subtotal:=v_subtotal+v_unit_price*(v_item->>'qty')::numeric; END LOOP; IF p_reward_id IS NOT NULL THEN SELECT r.* INTO v_reward FROM loyalty_rewards r WHERE r.id=p_reward_id AND r.cabang_id=v_cabang_id AND r.is_active FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Reward tidak tersedia pada cabang aktif.'; END IF; IF nullif(norm_wa(p_nomor_wa),'') IS NULL THEN RAISE EXCEPTION 'Reward hanya dapat digunakan oleh pelanggan terdaftar.'; END IF; SELECT c.total_points,c.tipe_customer INTO v_reward_points,v_customer_type FROM master_customer c WHERE c.cabang_id=v_cabang_id AND c.nomor_wa=norm_wa(p_nomor_wa) AND c.total_points>=v_reward.points_required AND (CASE WHEN v_reward.min_tier='gold' THEN 3 WHEN v_reward.min_tier='silver' THEN 2 ELSE 1 END)<=(CASE WHEN c.tier='gold' THEN 3 WHEN c.tier='silver' THEN 2 ELSE 1 END) FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Poin atau tier pelanggan tidak memenuhi syarat reward.'; END IF; v_reward_points:=v_reward.points_required; v_reward_discount:=greatest(0,coalesce(v_reward.reward_value,0)); IF v_customer_type='Tenaga Kesehatan' THEN v_reward_discount:=floor(v_reward_discount/2); ELSIF v_customer_type='Apotek Lain' THEN RAISE EXCEPTION 'Pelanggan Apotek Lain tidak memiliki poin atau reward.'; END IF; END IF; v_harga_akhir:=greatest(0,v_subtotal-coalesce(p_diskon,0)-v_reward_discount); IF coalesce(p_bayar,0)<v_harga_akhir THEN RAISE EXCEPTION 'Pembayaran kurang.'; END IF; v_kembalian:=p_bayar-v_harga_akhir; INSERT INTO trx_penjualan(no_nota,tanggal,jam,nomor_wa,nama_pelanggan,tipe_customer,petugas_transaksi,shift,subtotal,diskon,harga_akhir,total_hpp,bayar,kembalian,cabang_id) VALUES(v_no_nota,v_tanggal,v_jam,nullif(norm_wa(p_nomor_wa),''),coalesce(nullif(p_nama_pelanggan,''),'Umum'),p_tipe_customer,p_username,v_shift,v_subtotal,coalesce(p_diskon,0)+v_reward_discount,v_harga_akhir,0,p_bayar,v_kembalian,v_cabang_id); FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP SELECT * INTO v_product FROM master_barang WHERE kode_obat=upper(v_item->>'kode') AND aktif='YA'; v_unit_price:=CASE WHEN p_tipe_customer='Tenaga Kesehatan' THEN nullif(v_product.harga_khusus,0) WHEN p_tipe_customer='Apotek Lain' THEN nullif(v_product.harga_jual_mutasi,0) ELSE nullif(v_product.harga_jual_umum,0) END; v_unit_price:=coalesce(v_unit_price,v_product.harga_jual_umum,0); v_remaining:=(v_item->>'qty')::numeric; WHILE v_remaining>0 LOOP SELECT * INTO v_batch FROM stok_batch WHERE kode_obat=v_product.kode_obat AND cabang_id=v_cabang_id AND stok_real>0 ORDER BY expired_date ASC,id_batch ASC FOR UPDATE SKIP LOCKED LIMIT 1; IF NOT FOUND THEN RAISE EXCEPTION 'Stok % tidak mencukupi.',v_product.nama_obat; END IF; v_take:=least(v_remaining,v_batch.stok_real); UPDATE stok_batch SET stok_real=stok_real-v_take,updated_at=now() WHERE id_batch=v_batch.id_batch; INSERT INTO trx_penjualan_detail(no_nota,tanggal,kode_obat,nama_obat,kode_batch,expired_date,qty,harga_satuan,harga_modal,subtotal,cabang_id) VALUES(v_no_nota,v_tanggal,v_product.kode_obat,v_product.nama_obat,v_batch.kode_batch,v_batch.expired_date,v_take,v_unit_price,v_batch.harga_modal_batch,v_unit_price*v_take,v_cabang_id); v_total_hpp:=v_total_hpp+v_batch.harga_modal_batch*v_take; v_detail:=v_detail||jsonb_build_array(jsonb_build_object('Nama_Obat',v_product.nama_obat,'Qty',v_take,'Harga_Satuan',v_unit_price,'Subtotal',v_unit_price*v_take)); v_remaining:=v_remaining-v_take; END LOOP; END LOOP; UPDATE trx_penjualan SET total_hpp=v_total_hpp WHERE no_nota=v_no_nota AND cabang_id=v_cabang_id; IF p_reward_id IS NOT NULL THEN INSERT INTO loyalty_redemptions(cabang_id,customer_id,reward_id,no_nota,points_used,reward_value) SELECT v_cabang_id,c.id,p_reward_id,v_no_nota,v_reward.points_required,v_reward_discount FROM master_customer c WHERE c.cabang_id=v_cabang_id AND c.nomor_wa=norm_wa(p_nomor_wa); UPDATE master_customer SET total_points=total_points-v_reward.points_required WHERE cabang_id=v_cabang_id AND nomor_wa=norm_wa(p_nomor_wa); INSERT INTO loyalty_transactions(cabang_id,customer_id,no_nota,points_change,reason) SELECT v_cabang_id,c.id,v_no_nota,-v_reward.points_required,'redeem' FROM master_customer c WHERE c.cabang_id=v_cabang_id AND c.nomor_wa=norm_wa(p_nomor_wa); END IF; RETURN jsonb_build_object('No_Nota',v_no_nota,'Tanggal',v_tanggal,'Jam',v_jam,'Petugas',p_username,'Shift',v_shift,'Apotek','Apotek Fa-Mitra','Nama_Pelanggan',coalesce(nullif(p_nama_pelanggan,''),'Umum'),'Subtotal',v_subtotal,'Diskon',coalesce(p_diskon,0)+v_reward_discount,'Reward_Diskon',v_reward_discount,'Reward_Points_Used',v_reward_points,'Harga_Akhir',v_harga_akhir,'Bayar',p_bayar,'Kembalian',v_kembalian,'Total_HPP',v_total_hpp,'items',v_detail); END; $function$
--
--

-- -----------------------------------------------------------------------------
-- E. Versi SEBELUM file ini — purchase_save 8 parameter
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION public.purchase_save(p_username text, p_no_faktur text, p_supplier text, p_kategori text, p_tanggal date, p_jatuh_tempo date, p_items jsonb, p_cabang_id text DEFAULT NULL::text)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$ declare v_item jsonb; v_subtotal numeric; v_total_item numeric := 0; v_total_tagihan numeric := 0; v_product record; v_batch record; v_id_batch text; v_cabang_id text := coalesce(nullif(p_cabang_id, ''), (select cabang_id from app_users where username=p_username), 'KARLA'); begin perform pg_advisory_xact_lock(hashtext('purchase_save')); if nullif(trim(p_no_faktur),'') is null then raise exception 'Nomor faktur wajib diisi.'; end if; if exists (select 1 from trx_pembelian where no_faktur = p_no_faktur and cabang_id = v_cabang_id) then raise exception 'Nomor faktur sudah pernah dicatat.'; end if; if nullif(trim(p_supplier),'') is null then raise exception 'Supplier wajib dipilih.'; end if; if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Detail pembelian kosong.'; end if; insert into trx_pembelian(no_faktur,supplier,kategori,tanggal_faktur,jatuh_tempo,total_item,total_tagihan,petugas,cabang_id) values(p_no_faktur,p_supplier,coalesce(nullif(p_kategori,''),'Tidak Berpajak'),coalesce(p_tanggal,current_date),p_jatuh_tempo,0,0,p_username,v_cabang_id); for v_item in select value from jsonb_array_elements(p_items) loop if coalesce((v_item->>'Qty')::numeric,0) <= 0 or coalesce((v_item->>'Harga_Netto')::numeric,0) < 0 then raise exception 'Qty dan harga netto item tidak valid.'; end if; select * into v_product from master_barang where kode_obat = upper(v_item->>'Kode_Obat') and aktif = 'YA' for update; if not found then raise exception 'Barang % tidak ditemukan atau nonaktif.', v_item->>'Kode_Obat'; end if; v_subtotal := ((v_item->>'Harga_Netto')::numeric * (v_item->>'Qty')::numeric) * (1 + coalesce((v_item->>'PPN')::numeric,0)/100) - coalesce((v_item->>'Diskon')::numeric,0); if v_subtotal < 0 then raise exception 'Subtotal item tidak boleh negatif.'; end if; insert into trx_pembelian_detail(no_faktur,kode_obat,nama_obat,kode_batch,expired_date,qty,harga_netto,ppn,diskon,harga_jual_umum_baru,subtotal,cabang_id) values(p_no_faktur,v_product.kode_obat,v_product.nama_obat,v_item->>'Kode_Batch',(v_item->>'Expired_Date')::date,(v_item->>'Qty')::numeric,(v_item->>'Harga_Netto')::numeric,coalesce((v_item->>'PPN')::numeric,0),coalesce((v_item->>'Diskon')::numeric,0),coalesce((v_item->>'Harga_Jual_Umum_Baru')::numeric,0),v_subtotal,v_cabang_id); select * into v_batch from stok_batch where kode_obat = v_product.kode_obat and kode_batch = v_item->>'Kode_Batch' and cabang_id = v_cabang_id for update; if found then update stok_batch set stok_real = stok_real + (v_item->>'Qty')::numeric, expired_date = (v_item->>'Expired_Date')::date, harga_modal_batch = (v_item->>'Harga_Netto')::numeric, updated_at = now() where id_batch = v_batch.id_batch; else v_id_batch := 'BT-' || to_char(now() at time zone 'Asia/Jakarta','YYMMDDHH24MISS') || '-' || lpad((floor(random()*900)+100)::int::text,3,'0'); insert into stok_batch(id_batch,kode_obat,kode_batch,expired_date,stok_real,harga_modal_batch,cabang_id) values(v_id_batch,v_product.kode_obat,v_item->>'Kode_Batch',(v_item->>'Expired_Date')::date,(v_item->>'Qty')::numeric,(v_item->>'Harga_Netto')::numeric,v_cabang_id); end if; update master_barang set harga_modal = (v_item->>'Harga_Netto')::numeric, harga_jual_umum = case when coalesce((v_item->>'Harga_Jual_Umum_Baru')::numeric,0) > 0 then (v_item->>'Harga_Jual_Umum_Baru')::numeric else harga_jual_umum end, updated_at = now() where kode_obat = v_product.kode_obat; v_total_item := v_total_item + (v_item->>'Qty')::numeric; v_total_tagihan := v_total_tagihan + v_subtotal; end loop; update trx_pembelian set total_item = v_total_item, total_tagihan = v_total_tagihan where no_faktur = p_no_faktur and cabang_id = v_cabang_id; return jsonb_build_object('No_Faktur',p_no_faktur,'Total_Item',v_total_item,'Total_Tagihan',v_total_tagihan); end; $function$
--
--

-- -----------------------------------------------------------------------------
-- F. Versi SEBELUM file ini — pos_checkout_promo
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION public.pos_checkout_promo(p_username text, p_nomor_wa text, p_nama_pelanggan text, p_tipe_customer text, p_items jsonb, p_diskon numeric, p_bayar numeric, p_cabang_id text DEFAULT NULL::text, p_reward_id uuid DEFAULT NULL::uuid, p_coupon_code text DEFAULT NULL::text)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$ DECLARE v_cabang_id text := coalesce(nullif(p_cabang_id,''),(select cabang_id from app_users where username=p_username),'KARLA'); v_code text := upper(trim(coalesce(p_coupon_code,''))); v_coupon record; v_campaign record; v_customer record; v_subtotal numeric := 0; v_unit_price numeric; v_item jsonb; v_discount numeric := 0; v_used_total integer := 0; v_used_customer integer := 0; v_segment text; v_days integer; v_result jsonb; BEGIN PERFORM pg_advisory_xact_lock(hashtext('promo:'||v_cabang_id||':'||v_code)); IF v_code <> '' THEN IF nullif(norm_wa(p_nomor_wa),'') IS NULL THEN RAISE EXCEPTION 'Kupon hanya dapat digunakan oleh pelanggan terdaftar.'; END IF; SELECT c.* INTO v_coupon FROM promo_coupons c WHERE c.cabang_id=v_cabang_id AND upper(c.code)=v_code AND c.is_active FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Kode kupon tidak ditemukan atau tidak aktif.'; END IF; SELECT p.* INTO v_campaign FROM promo_campaigns p WHERE p.id=v_coupon.campaign_id AND p.cabang_id=v_cabang_id AND p.status='ACTIVE' AND now() BETWEEN p.starts_at AND p.ends_at FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Kampanye kupon tidak aktif atau sudah berakhir.'; END IF; SELECT c.* INTO v_customer FROM master_customer c WHERE c.cabang_id=v_cabang_id AND c.nomor_wa=norm_wa(p_nomor_wa) FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Pelanggan belum terdaftar untuk promo ini.'; END IF; v_days:=CASE WHEN v_customer.tanggal_terakhir_beli IS NULL THEN NULL ELSE current_date-v_customer.tanggal_terakhir_beli END; v_segment:=CASE WHEN v_customer.jumlah_transaksi=0 OR v_customer.tanggal_terakhir_beli IS NULL THEN 'Baru' WHEN v_days>180 THEN 'Dormant' WHEN v_days>60 THEN 'At-Risk' WHEN v_customer.total_belanja>=2000000 OR v_customer.jumlah_transaksi>=8 THEN 'VIP' ELSE 'Active Routine' END; IF NOT EXISTS (SELECT 1 FROM promo_segment_targets t WHERE t.campaign_id=v_campaign.id AND t.segment=v_segment AND (t.customer_type IS NULL OR t.customer_type=p_tipe_customer)) THEN RAISE EXCEPTION 'Pelanggan tidak termasuk segmen promo ini.'; END IF; SELECT count(*) INTO v_used_total FROM promo_redemptions r WHERE r.coupon_id=v_coupon.id AND r.status='APPLIED'; SELECT count(*) INTO v_used_customer FROM promo_redemptions r WHERE r.coupon_id=v_coupon.id AND r.customer_id=v_customer.id AND r.status='APPLIED'; IF v_coupon.usage_limit_total IS NOT NULL AND v_used_total>=v_coupon.usage_limit_total THEN RAISE EXCEPTION 'Kuota kupon sudah habis.'; END IF; IF v_used_customer>=v_coupon.usage_limit_per_customer THEN RAISE EXCEPTION 'Kupon sudah pernah digunakan oleh pelanggan ini.'; END IF; END IF; FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP SELECT CASE WHEN p_tipe_customer='Tenaga Kesehatan' THEN nullif(harga_khusus,0) WHEN p_tipe_customer='Apotek Lain' THEN nullif(harga_jual_mutasi,0) ELSE nullif(harga_jual_umum,0) END INTO v_unit_price FROM master_barang WHERE kode_obat=upper(v_item->>'kode') AND aktif='YA'; v_subtotal:=v_subtotal+coalesce(v_unit_price,0)*coalesce((v_item->>'qty')::numeric,0); END LOOP; IF v_code<>'' THEN IF v_subtotal<v_coupon.min_purchase THEN RAISE EXCEPTION 'Minimum belanja kupon adalah Rp%.',v_coupon.min_purchase; END IF; v_discount:=CASE WHEN v_coupon.discount_type='PERCENT' THEN v_subtotal*v_coupon.discount_value/100 ELSE v_coupon.discount_value END; IF v_coupon.max_discount IS NOT NULL THEN v_discount:=least(v_discount,v_coupon.max_discount); END IF; v_discount:=least(greatest(v_discount,0),v_subtotal); v_result:=public.pos_checkout(p_username,p_nomor_wa,p_nama_pelanggan,p_tipe_customer,p_items,coalesce(p_diskon,0)+v_discount,p_bayar,v_cabang_id,p_reward_id); UPDATE trx_penjualan SET coupon_id=v_coupon.id,coupon_code=v_coupon.code,campaign_id=v_campaign.id,coupon_discount=v_discount WHERE no_nota=v_result->>'No_Nota' AND cabang_id=v_cabang_id; INSERT INTO promo_redemptions(coupon_id,campaign_id,customer_id,cabang_id,invoice_no,discount_amount) VALUES(v_coupon.id,v_campaign.id,v_customer.id,v_cabang_id,v_result->>'No_Nota',v_discount); RETURN v_result || jsonb_build_object('Coupon_Code',v_coupon.code,'Campaign_Name',v_campaign.name,'Coupon_Discount',v_discount,'Customer_Segment',v_segment); END IF; RETURN public.pos_checkout(p_username,p_nomor_wa,p_nama_pelanggan,p_tipe_customer,p_items,p_diskon,p_bayar,v_cabang_id,p_reward_id); END; $function$
--
--

-- -----------------------------------------------------------------------------
-- G. Versi SEBELUM file ini — pos_checkout_bundle
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION public.pos_checkout_bundle(p_username text, p_nomor_wa text, p_nama_pelanggan text, p_tipe_customer text, p_items jsonb, p_diskon numeric, p_bayar numeric, p_cabang_id text DEFAULT NULL::text, p_reward_id uuid DEFAULT NULL::uuid, p_bundle_code text DEFAULT NULL::text)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$ DECLARE v_branch text:=coalesce(nullif(p_cabang_id,''),(select cabang_id from app_users where username=p_username),'KARLA'); v_code text:=upper(trim(coalesce(p_bundle_code,''))); v_bundle record; v_item record; v_cart jsonb; v_qty numeric; v_price numeric; v_base numeric:=0; v_discount numeric:=0; v_result jsonb; BEGIN IF v_code='' THEN RAISE EXCEPTION 'Kode bundle wajib diisi.'; END IF; SELECT b.* INTO v_bundle FROM promo_bundles b WHERE b.cabang_id=v_branch AND upper(b.code)=v_code AND b.status='ACTIVE' AND now() BETWEEN b.starts_at AND b.ends_at FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Bundle tidak aktif atau sudah berakhir.'; END IF; FOR v_item IN SELECT i.*,m.nama_obat,m.harga_jual_umum,m.harga_khusus,m.harga_jual_mutasi,m.aktif,m.golongan FROM promo_bundle_items i JOIN master_barang m ON m.kode_obat=i.kode_obat WHERE i.bundle_id=v_bundle.id LOOP IF v_item.aktif<>'YA' OR coalesce(v_item.golongan,'')<>'Bebas' THEN RAISE EXCEPTION 'Bundle hanya boleh berisi produk aktif golongan Bebas.'; END IF; SELECT value INTO v_cart FROM jsonb_array_elements(p_items) WHERE upper(value->>'kode')=upper(v_item.kode_obat) LIMIT 1; IF v_cart IS NULL OR coalesce((v_cart->>'qty')::numeric,0)<v_item.qty THEN RAISE EXCEPTION 'Isi keranjang belum memenuhi bundle: % x %.',v_item.qty,v_item.nama_obat; END IF; v_price:=CASE WHEN p_tipe_customer='Tenaga Kesehatan' THEN v_item.harga_khusus WHEN p_tipe_customer='Apotek Lain' THEN v_item.harga_jual_mutasi ELSE v_item.harga_jual_umum END; v_base:=v_base+coalesce(v_price,0)*v_item.qty; END LOOP; IF v_base<=0 THEN RAISE EXCEPTION 'Bundle tidak memiliki harga dasar yang valid.'; END IF; IF v_bundle.bundle_price>=v_base THEN RAISE EXCEPTION 'Harga bundle harus lebih rendah dari harga normal.'; END IF; v_discount:=v_base-v_bundle.bundle_price; v_result:=public.pos_checkout(p_username,p_nomor_wa,p_nama_pelanggan,p_tipe_customer,p_items,coalesce(p_diskon,0)+v_discount,p_bayar,v_branch,p_reward_id); UPDATE trx_penjualan SET bundle_id=v_bundle.id,bundle_code=v_bundle.code,bundle_discount=v_discount WHERE no_nota=v_result->>'No_Nota' AND cabang_id=v_branch; RETURN v_result||jsonb_build_object('Bundle_Code',v_bundle.code,'Bundle_Name',v_bundle.name,'Bundle_Discount',v_discount,'Bundle_Base_Price',v_base); END; $function$
--
--

-- -----------------------------------------------------------------------------
-- H. Versi SEBELUM file ini — generate_refill_reminders (dengan DEFAULT NULL)
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION public.generate_refill_reminders(p_cabang_id text DEFAULT NULL::text)
--  RETURNS integer
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- DECLARE n integer;
-- BEGIN
--  INSERT INTO public.notification_log(cabang_id,customer_id,refill_program_id,channel,message,status)
--  SELECT p.cabang_id,p.customer_id,p.id,'n8n','Halo '||c.nama||', waktunya isi ulang obat Anda. Silakan hubungi Apotek Fa-Mitra untuk pengecekan ketersediaan.','PENDING'
--  FROM public.refill_programs p JOIN public.master_customer c ON c.id=p.customer_id AND c.cabang_id=p.cabang_id
--  WHERE p.status='ACTIVE' AND p.next_reminder_date<=current_date AND c.consent_marketing=true
--    AND (p_cabang_id IS NULL OR p.cabang_id=p_cabang_id)
--    AND NOT EXISTS (SELECT 1 FROM public.notification_log l WHERE l.refill_program_id=p.id AND l.channel='n8n' AND l.created_at >= date_trunc('day',now()))
--  ON CONFLICT DO NOTHING;
--  GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
-- END;
-- $function$
--
--
-- =============================================================================
