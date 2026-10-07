-- Menu Pembelian: harga khusus/mutasi, edit faktur, dan batalkan faktur.
--
-- Latar belakang (temuan lapangan):
--   1. Harga khusus (nakes) dan harga jual mutasi (apotek lain) hanya bisa diubah
--      dari Master Barang, satu per satu. Akibatnya saat menerima barang, apoteker
--      menetapkan harga umum saja — dan lahir puluhan batch dengan harga nakes di
--      bawah modal (contoh: Siladex Antitusiv modal Rp74.412 vs nakes Rp15.000).
--   2. Faktur pembelian tidak bisa diedit sama sekali. Kalau ada item tertinggal
--      atau salah isi, satu-satunya jalan adalah "faktur susulan" — memaksa nomor
--      faktur PBF diberi penanda supaya tidak ditolak sistem.
--   3. Tidak ada cara membatalkan faktur yang salah input.
--
-- Isi migrasi:
--   A. Kolom baru pada trx_pembelian: status, jejak edit, jejak batal, riwayat_edit.
--   B. Kolom baru pada trx_pembelian_detail: harga_khusus_baru, harga_jual_mutasi_baru.
--   C. purchase_save  — menerima Harga_Khusus_Baru & Harga_Jual_Mutasi_Baru.
--                       Tanda tangan fungsi TIDAK berubah supaya tidak jadi overload.
--                       Isi fungsi disalin dari 20261002100434_purchase_batch_uuid.sql
--                       (pembuatan id_batch memakai gen_random_uuid) supaya perbaikan
--                       bentrok ID batch tidak ikut hilang.
--   D. purchase_update — edit faktur: header + item, dengan pembalikan efek lama.
--   E. purchase_cancel — batalkan faktur (void), efek dibalik, catatan tetap ada.
--
-- Catatan desain:
--   * purchase_update dan purchase_cancel TIDAK menulis harga master per item.
--     Harga master dihitung ulang dari pembelian AKTIF terakhir untuk barang itu.
--     Alasannya: saat mengedit faktur lama, menulis harga master per item akan
--     menimpa harga dari faktur yang lebih baru.
--   * Pembalikan stok DITOLAK kalau stok batch tidak cukup dikurangi (barangnya
--     sudah terjual). Pesannya menyebutkan barang dan jumlahnya.
--   * Faktur yang sudah punya pembayaran AKTIF tidak boleh diedit/dibatalkan.
--
-- Verifikasi setelah dijalankan (read-only):
--   select column_name from information_schema.columns
--     where table_name='trx_pembelian' and column_name in
--     ('status','diedit_oleh','diedit_at','dibatalkan_oleh','dibatalkan_at','alasan_batal','riwayat_edit');
--   -> diharapkan 7 baris
--   select column_name from information_schema.columns
--     where table_name='trx_pembelian_detail' and column_name in
--     ('harga_khusus_baru','harga_jual_mutasi_baru');
--   -> diharapkan 2 baris
--   select status, count(*) from public.trx_pembelian group by status;
--   -> seluruh faktur lama harus berstatus AKTIF
--   select p.proname, pg_get_function_arguments(p.oid) from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname='public' and p.proname in ('purchase_save','purchase_update','purchase_cancel');
--   -> diharapkan 3 baris
--
-- Rollback:
--   drop function if exists public.purchase_update(text,text,text,text,text,date,date,jsonb,text);
--   drop function if exists public.purchase_cancel(text,text,text,text);
--   alter table public.trx_pembelian_detail
--     drop column if exists harga_khusus_baru, drop column if exists harga_jual_mutasi_baru;
--   alter table public.trx_pembelian
--     drop column if exists status, drop column if exists diedit_oleh, drop column if exists diedit_at,
--     drop column if exists dibatalkan_oleh, drop column if exists dibatalkan_at,
--     drop column if exists alasan_batal, drop column if exists riwayat_edit;
--   drop index if exists public.trx_pembelian_status_idx;
--   (purchase_save harus dikembalikan manual ke isi 20261002100434 bila perlu)

-- =============================================================================
-- A. Kolom baru pada trx_pembelian
-- =============================================================================
alter table public.trx_pembelian add column if not exists status text;
alter table public.trx_pembelian add column if not exists diedit_oleh text;
alter table public.trx_pembelian add column if not exists diedit_at timestamptz;
alter table public.trx_pembelian add column if not exists dibatalkan_oleh text;
alter table public.trx_pembelian add column if not exists dibatalkan_at timestamptz;
alter table public.trx_pembelian add column if not exists alasan_batal text;
alter table public.trx_pembelian add column if not exists riwayat_edit jsonb;

-- Pengaman: trx_pembelian adalah tabel lama, jadi kolom `status` mungkin sudah ada
-- dengan arti lain. Kalau isinya bukan AKTIF/DIBATALKAN, hentikan migrasi dengan
-- pesan jelas daripada menimpa data atau gagal dengan error yang membingungkan.
do $$
declare v_asing integer;
begin
  select count(*) into v_asing
  from public.trx_pembelian
  where status is not null and status not in ('AKTIF','DIBATALKAN');

  if v_asing > 0 then
    raise exception 'Kolom trx_pembelian.status sudah ada dan berisi % baris dengan nilai lain. Periksa dulu sebelum menjalankan migrasi ini.', v_asing;
  end if;
end $$;

update public.trx_pembelian set status = 'AKTIF' where status is null;
update public.trx_pembelian set riwayat_edit = '[]'::jsonb where riwayat_edit is null;

alter table public.trx_pembelian alter column status set default 'AKTIF';
alter table public.trx_pembelian alter column status set not null;
alter table public.trx_pembelian alter column riwayat_edit set default '[]'::jsonb;
alter table public.trx_pembelian alter column riwayat_edit set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'trx_pembelian_status_check'
      and conrelid = 'public.trx_pembelian'::regclass
  ) then
    alter table public.trx_pembelian
      add constraint trx_pembelian_status_check check (status in ('AKTIF','DIBATALKAN'));
  end if;
end $$;

create index if not exists trx_pembelian_status_idx
  on public.trx_pembelian (cabang_id, status, tanggal_faktur);

-- =============================================================================
-- B. Kolom baru pada trx_pembelian_detail
-- =============================================================================
alter table public.trx_pembelian_detail add column if not exists harga_khusus_baru numeric not null default 0;
alter table public.trx_pembelian_detail add column if not exists harga_jual_mutasi_baru numeric not null default 0;

-- =============================================================================
-- C. purchase_save — menerima Harga_Khusus_Baru & Harga_Jual_Mutasi_Baru
-- =============================================================================
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
  SELECT 'FK-'||v_cabang_id||'-'||to_char(v_tanggal,'YYYYMMDD')||'-'||lpad((count(*)+1)::text,4,'0')
    INTO v_no_faktur
  FROM trx_pembelian
  WHERE cabang_id = v_cabang_id AND tanggal_faktur = v_tanggal;

  IF EXISTS (SELECT 1 FROM trx_pembelian WHERE no_faktur = v_no_faktur) THEN
    RAISE EXCEPTION 'Nomor faktur % sudah pernah dicatat.', v_no_faktur;
  END IF;

  -- Nomor PBF (kalau diisi) tidak boleh dobel untuk cabang + supplier yang sama.
  IF v_no_faktur_supplier IS NOT NULL AND EXISTS (
    SELECT 1 FROM trx_pembelian
    WHERE cabang_id = v_cabang_id
      AND supplier = p_supplier
      AND no_faktur_supplier = v_no_faktur_supplier
  ) THEN
    RAISE EXCEPTION 'Nomor faktur PBF "%" sudah pernah dicatat untuk supplier %.', v_no_faktur_supplier, p_supplier;
  END IF;

  -- (6) Supplier divalidasi lewat NAMA: nama -> master_supplier -> supplier_cabang.
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

  -- status sengaja TIDAK disebut: kolomnya punya default 'AKTIF', jadi fungsi ini
  -- tetap jalan walau migrasi ini belum diterapkan (urutan deploy tidak jadi masalah).
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

    INSERT INTO trx_pembelian_detail(no_faktur,kode_obat,nama_obat,kode_batch,expired_date,qty,harga_netto,ppn,diskon,harga_jual_umum_baru,harga_khusus_baru,harga_jual_mutasi_baru,subtotal,cabang_id)
    VALUES(v_no_faktur,v_product.kode_obat,v_product.nama_obat,v_item->>'Kode_Batch',(v_item->>'Expired_Date')::date,(v_item->>'Qty')::numeric,(v_item->>'Harga_Netto')::numeric,coalesce((v_item->>'PPN')::numeric,0),coalesce((v_item->>'Diskon')::numeric,0),coalesce((v_item->>'Harga_Jual_Umum_Baru')::numeric,0),coalesce((v_item->>'Harga_Khusus_Baru')::numeric,0),coalesce((v_item->>'Harga_Jual_Mutasi_Baru')::numeric,0),v_subtotal,v_cabang_id);

    -- (4) Batch: sudah per cabang.
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
      v_id_batch := 'BT-' || pg_catalog.gen_random_uuid()::text;
      INSERT INTO stok_batch(id_batch,kode_obat,kode_batch,expired_date,stok_real,harga_modal_batch,cabang_id)
      VALUES(v_id_batch,v_product.kode_obat,v_item->>'Kode_Batch',(v_item->>'Expired_Date')::date,(v_item->>'Qty')::numeric,(v_item->>'Harga_Netto')::numeric,v_cabang_id);
    END IF;

    -- (2) HARGA: hanya cabang sendiri. Harga khusus & mutasi hanya ditimpa bila
    --     diisi > 0 — faktur tidak pernah menghapus harga yang tidak disebutkan.
    UPDATE master_barang
    SET harga_modal = (v_item->>'Harga_Netto')::numeric,
        harga_jual_umum = CASE WHEN coalesce((v_item->>'Harga_Jual_Umum_Baru')::numeric,0) > 0
                               THEN (v_item->>'Harga_Jual_Umum_Baru')::numeric
                               ELSE harga_jual_umum END,
        harga_khusus = CASE WHEN coalesce((v_item->>'Harga_Khusus_Baru')::numeric,0) > 0
                            THEN (v_item->>'Harga_Khusus_Baru')::numeric
                            ELSE harga_khusus END,
        harga_jual_mutasi = CASE WHEN coalesce((v_item->>'Harga_Jual_Mutasi_Baru')::numeric,0) > 0
                                 THEN (v_item->>'Harga_Jual_Mutasi_Baru')::numeric
                                 ELSE harga_jual_mutasi END,
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

-- =============================================================================
-- D. purchase_update — edit faktur pembelian
-- =============================================================================
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
  v_old record;
  v_product record;
  v_batch record;
  v_id_batch text;
  v_subtotal numeric;
  v_total_item numeric := 0;
  v_total_tagihan numeric := 0;
  v_no_faktur_supplier text;
  v_tanggal date;
  v_kode jsonb := '[]'::jsonb;
  v_sebelum jsonb;
  v_sesudah jsonb;
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

  -- Kondisi lama untuk jejak audit.
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

  -- (1) BALIK efek stok faktur lama. Ditolak bila stok tidak cukup.
  FOR v_old IN
    SELECT * FROM trx_pembelian_detail
    WHERE cabang_id = v_cabang_id AND no_faktur = p_no_faktur
  LOOP
    v_kode := v_kode || to_jsonb(v_old.kode_obat);

    SELECT * INTO v_batch FROM stok_batch
    WHERE cabang_id = v_cabang_id AND kode_obat = v_old.kode_obat
      AND coalesce(kode_batch,'') = coalesce(v_old.kode_batch,'')
    FOR UPDATE;

    IF FOUND THEN
      IF v_batch.stok_real < v_old.qty THEN
        RAISE EXCEPTION 'Tidak bisa mengedit: stok % (batch "%") tinggal %, padahal faktur lama mencatat %. Barangnya sudah terjual — sesuaikan lewat Stokopname lebih dulu.',
          v_old.nama_obat, coalesce(v_old.kode_batch,''), v_batch.stok_real, v_old.qty;
      END IF;
      UPDATE stok_batch SET stok_real = stok_real - v_old.qty, updated_at = now()
      WHERE id_batch = v_batch.id_batch;
    END IF;
  END LOOP;

  DELETE FROM trx_pembelian_detail WHERE cabang_id = v_cabang_id AND no_faktur = p_no_faktur;

  -- (2) TERAPKAN item baru. Harga master TIDAK ditulis di sini — dihitung ulang
  --     di langkah (3) dari pembelian AKTIF terakhir.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF coalesce((v_item->>'Qty')::numeric,0) <= 0 OR coalesce((v_item->>'Harga_Netto')::numeric,0) < 0 THEN
      RAISE EXCEPTION 'Qty dan harga netto item tidak valid.';
    END IF;

    SELECT * INTO v_product
    FROM master_barang
    WHERE kode_obat = upper(v_item->>'Kode_Obat') AND aktif = 'YA' AND cabang_id = v_cabang_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Barang % tidak ditemukan atau nonaktif di cabang %.', v_item->>'Kode_Obat', v_cabang_id;
    END IF;

    v_kode := v_kode || to_jsonb(v_product.kode_obat);

    v_subtotal := ((v_item->>'Harga_Netto')::numeric * (v_item->>'Qty')::numeric) * (1 + coalesce((v_item->>'PPN')::numeric,0)/100) - coalesce((v_item->>'Diskon')::numeric,0);
    IF v_subtotal < 0 THEN
      RAISE EXCEPTION 'Subtotal item tidak boleh negatif.';
    END IF;

    INSERT INTO trx_pembelian_detail(no_faktur,kode_obat,nama_obat,kode_batch,expired_date,qty,harga_netto,ppn,diskon,harga_jual_umum_baru,harga_khusus_baru,harga_jual_mutasi_baru,subtotal,cabang_id)
    VALUES(p_no_faktur,v_product.kode_obat,v_product.nama_obat,v_item->>'Kode_Batch',(v_item->>'Expired_Date')::date,(v_item->>'Qty')::numeric,(v_item->>'Harga_Netto')::numeric,coalesce((v_item->>'PPN')::numeric,0),coalesce((v_item->>'Diskon')::numeric,0),coalesce((v_item->>'Harga_Jual_Umum_Baru')::numeric,0),coalesce((v_item->>'Harga_Khusus_Baru')::numeric,0),coalesce((v_item->>'Harga_Jual_Mutasi_Baru')::numeric,0),v_subtotal,v_cabang_id);

    SELECT * INTO v_batch FROM stok_batch
    WHERE kode_obat = v_product.kode_obat
      AND coalesce(kode_batch,'') = coalesce(v_item->>'Kode_Batch','')
      AND cabang_id = v_cabang_id
    FOR UPDATE;

    IF FOUND THEN
      UPDATE stok_batch
      SET stok_real = stok_real + (v_item->>'Qty')::numeric,
          expired_date = (v_item->>'Expired_Date')::date,
          harga_modal_batch = (v_item->>'Harga_Netto')::numeric,
          updated_at = now()
      WHERE id_batch = v_batch.id_batch;
    ELSE
      v_id_batch := 'BT-' || pg_catalog.gen_random_uuid()::text;
      INSERT INTO stok_batch(id_batch,kode_obat,kode_batch,expired_date,stok_real,harga_modal_batch,cabang_id)
      VALUES(v_id_batch,v_product.kode_obat,v_item->>'Kode_Batch',(v_item->>'Expired_Date')::date,(v_item->>'Qty')::numeric,(v_item->>'Harga_Netto')::numeric,v_cabang_id);
    END IF;

    v_total_item := v_total_item + (v_item->>'Qty')::numeric;
    v_total_tagihan := v_total_tagihan + v_subtotal;
  END LOOP;

  -- (3) Hitung ulang harga master untuk semua barang yang tersentuh, diambil dari
  --     pembelian AKTIF paling baru.
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

-- =============================================================================
-- E. purchase_cancel — batalkan faktur (void)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.purchase_cancel(
  p_username text,
  p_no_faktur text,
  p_alasan text,
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
  v_old record;
  v_batch record;
  v_kode jsonb := '[]'::jsonb;
  v_dibalik integer := 0;
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

  PERFORM pg_advisory_xact_lock(hashtext('purchase_save:'||v_cabang_id));

  IF nullif(trim(coalesce(p_alasan,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Alasan pembatalan wajib diisi.';
  END IF;

  SELECT * INTO v_head FROM trx_pembelian
  WHERE cabang_id = v_cabang_id AND no_faktur = p_no_faktur
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Faktur % tidak ditemukan di cabang %.', p_no_faktur, v_cabang_id;
  END IF;

  IF v_head.status <> 'AKTIF' THEN
    RAISE EXCEPTION 'Faktur % sudah dibatalkan sebelumnya.', p_no_faktur;
  END IF;

  IF EXISTS (
    SELECT 1 FROM trx_pembayaran_hutang
    WHERE cabang_id = v_cabang_id AND no_faktur = p_no_faktur AND status = 'AKTIF'
  ) THEN
    RAISE EXCEPTION 'Faktur % sudah ada pembayaran. Batalkan pembayarannya dulu.', p_no_faktur;
  END IF;

  FOR v_old IN
    SELECT * FROM trx_pembelian_detail
    WHERE cabang_id = v_cabang_id AND no_faktur = p_no_faktur
  LOOP
    v_kode := v_kode || to_jsonb(v_old.kode_obat);

    SELECT * INTO v_batch FROM stok_batch
    WHERE cabang_id = v_cabang_id AND kode_obat = v_old.kode_obat
      AND coalesce(kode_batch,'') = coalesce(v_old.kode_batch,'')
    FOR UPDATE;

    IF FOUND THEN
      IF v_batch.stok_real < v_old.qty THEN
        RAISE EXCEPTION 'Tidak bisa membatalkan: stok % (batch "%") tinggal %, padahal faktur mencatat %. Barangnya sudah terjual — sesuaikan lewat Stokopname lebih dulu.',
          v_old.nama_obat, coalesce(v_old.kode_batch,''), v_batch.stok_real, v_old.qty;
      END IF;
      UPDATE stok_batch SET stok_real = stok_real - v_old.qty, updated_at = now()
      WHERE id_batch = v_batch.id_batch;
      v_dibalik := v_dibalik + 1;
    END IF;
  END LOOP;

  UPDATE master_barang m SET
    harga_modal = coalesce((
      SELECT d.harga_netto FROM trx_pembelian_detail d
      JOIN trx_pembelian p ON p.cabang_id = d.cabang_id AND p.no_faktur = d.no_faktur
      WHERE d.cabang_id = m.cabang_id AND d.kode_obat = m.kode_obat AND p.status = 'AKTIF'
      ORDER BY p.timestamp DESC, d.no_faktur DESC LIMIT 1), m.harga_modal),
    updated_at = now()
  WHERE m.cabang_id = v_cabang_id
    AND m.kode_obat IN (SELECT jsonb_array_elements_text(v_kode));

  UPDATE trx_pembelian SET
    status = 'DIBATALKAN',
    dibatalkan_oleh = p_username,
    dibatalkan_at = now(),
    alasan_batal = p_alasan
  WHERE cabang_id = v_cabang_id AND no_faktur = p_no_faktur;

  RETURN jsonb_build_object('No_Faktur', p_no_faktur, 'Batch_Dibalik', v_dibalik);
END;
$function$;

-- =============================================================================
-- Hak akses: hanya lewat Edge Function (service_role).
-- purchase_save sudah punya GRANT dari 20260925060000; fungsi baru harus diberi
-- GRANT eksplisit karena REVOKE dari PUBLIC juga mencabut akses service_role.
-- =============================================================================
REVOKE ALL ON FUNCTION public.purchase_update(text, text, text, text, text, date, date, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_update(text, text, text, text, text, date, date, jsonb, text) TO service_role;

REVOKE ALL ON FUNCTION public.purchase_cancel(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_cancel(text, text, text, text) TO service_role;
