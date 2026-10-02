-- Prevent purchase_save batch ID collisions.
-- The former second-resolution timestamp plus a three-digit random suffix has
-- only 900 possibilities per second and can collide with existing primary keys.
-- PostgreSQL's gen_random_uuid() is available natively on the deployed PG 17.
-- This migration preserves the existing purchase, branch, and stock semantics.

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
      v_id_batch := 'BT-' || pg_catalog.gen_random_uuid()::text;
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
