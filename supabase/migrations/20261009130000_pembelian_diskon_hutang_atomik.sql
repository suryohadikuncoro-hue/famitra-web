-- Pembelian: modal bersih setelah diskon persen, proteksi stok gabungan, dan pembayaran hutang atomik.
-- Harga modal disimpan tanpa PPN (sesuai arti Harga_Netto pada form). Diskon form
-- adalah persentase dari bruto baris setelah PPN. Routine legacy yang masih
-- menerima nominal diberi payload konversi sementara; nilai detail dipulihkan
-- sebagai persentase sebelum transaksi selesai.
--
-- Migrasi ini tidak mengubah qty stok atau nilai tagihan faktur. Backfill di akhir
-- hanya memperbarui harga_modal_batch dan harga_modal dari faktur pembelian aktif.

-- -----------------------------------------------------------------------------
-- Rumus biaya modal unit yang dipakai konsisten oleh seluruh fungsi pembelian.
CREATE OR REPLACE FUNCTION public.purchase_effective_unit_cost(
  p_harga_netto numeric,
  p_qty numeric,
  p_ppn numeric,
  p_diskon numeric
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN coalesce(p_qty, 0) <= 0 OR (1 + coalesce(p_ppn, 0) / 100) <= 0 THEN NULL
    ELSE round(
      (coalesce(p_harga_netto, 0) * p_qty * (1 + coalesce(p_ppn, 0) / 100)
       * (1 - least(greatest(coalesce(p_diskon, 0), 0), 100) / 100)
       / p_qty),
      2
    )
  END
$function$;

CREATE OR REPLACE FUNCTION public.purchase_validate_items(p_items jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb;
  v_qty numeric;
  v_netto numeric;
  v_ppn numeric;
  v_diskon numeric;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Detail pembelian kosong.';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty := coalesce((v_item->>'Qty')::numeric, 0);
    v_netto := coalesce((v_item->>'Harga_Netto')::numeric, 0);
    v_ppn := coalesce((v_item->>'PPN')::numeric, 0);
    v_diskon := coalesce((v_item->>'Diskon')::numeric, 0);
    IF v_qty <= 0 OR v_netto < 0 THEN
      RAISE EXCEPTION 'Qty harus lebih dari nol dan harga netto tidak boleh negatif.';
    END IF;
    IF v_ppn < 0 OR v_ppn > 100 THEN
      RAISE EXCEPTION 'PPN harus berada di antara 0 dan 100 persen.';
    END IF;
    IF v_diskon < 0 OR v_diskon > 100 THEN
      RAISE EXCEPTION 'Diskon item tidak valid: nilainya harus antara 0 dan 100 persen.';
    END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.purchase_validate_category(
  p_kategori text,
  p_items jsonb
) RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb;
  v_kategori text := coalesce(nullif(trim(p_kategori), ''), 'Tidak Berpajak');
  v_ppn numeric;
BEGIN
  IF v_kategori NOT IN ('Berpajak', 'Tidak Berpajak', 'Konsinyasi') THEN
    RAISE EXCEPTION 'Kategori pembelian tidak valid.';
  END IF;
  IF v_kategori = 'Tidak Berpajak' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
      v_ppn := coalesce((v_item->>'PPN')::numeric, 0);
      IF v_ppn <> 0 THEN
        RAISE EXCEPTION 'Kategori Tidak Berpajak harus menggunakan PPN 0 persen.';
      END IF;
    END LOOP;
  END IF;
END;
$function$;

-- Modal aktif NULL berarti tidak ada faktur pembelian aktif yang menjadi
-- sumber biaya. Nilai historis tetap disimpan terpisah untuk audit.
ALTER TABLE public.master_barang
  ADD COLUMN IF NOT EXISTS harga_modal_terakhir numeric;
ALTER TABLE public.stok_batch
  ADD COLUMN IF NOT EXISTS harga_modal_batch_terakhir numeric;
ALTER TABLE public.master_barang
  ALTER COLUMN harga_modal DROP NOT NULL;
ALTER TABLE public.stok_batch
  ALTER COLUMN harga_modal_batch DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.purchase_assert_no_shared_batches(p_cabang_id text, p_no_faktur text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.trx_pembelian_detail own
    JOIN public.trx_pembelian_detail other
      ON other.cabang_id = own.cabang_id
     AND other.kode_obat = own.kode_obat
     AND coalesce(other.kode_batch, '') = coalesce(own.kode_batch, '')
     AND other.no_faktur <> own.no_faktur
    JOIN public.trx_pembelian other_head
      ON other_head.cabang_id = other.cabang_id
     AND other_head.no_faktur = other.no_faktur
     AND other_head.status = 'AKTIF'
    WHERE own.cabang_id = p_cabang_id
      AND own.no_faktur = p_no_faktur
  ) THEN
    RAISE EXCEPTION 'Faktur tidak dapat diedit atau dibatalkan: salah satu batch juga tercatat pada faktur aktif lain. Stok batch tergabung sehingga asal unit tidak dapat dipastikan.';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.purchase_assert_new_batches_exclusive(
  p_cabang_id text, p_no_faktur text, p_items jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) x(value)
    JOIN public.trx_pembelian_detail other
      ON other.cabang_id = p_cabang_id
     AND upper(other.kode_obat) = upper(x.value->>'Kode_Obat')
     AND coalesce(other.kode_batch, '') = coalesce(x.value->>'Kode_Batch', '')
     AND other.no_faktur <> p_no_faktur
    JOIN public.trx_pembelian other_head
      ON other_head.cabang_id = other.cabang_id
     AND other_head.no_faktur = other.no_faktur
     AND other_head.status = 'AKTIF'
  ) THEN
    RAISE EXCEPTION 'Faktur tidak dapat diedit dengan batch yang juga dipakai faktur aktif lain. Stok batch tergabung sehingga asal unit tidak dapat dipastikan.';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.purchase_refresh_costs(p_cabang_id text, p_kode_obat text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_kode_obat IS NULL OR cardinality(p_kode_obat) = 0 THEN RETURN; END IF;

  WITH per_invoice_batch AS (
    SELECT p.no_faktur, p.timestamp, d.cabang_id, d.kode_obat,
           coalesce(d.kode_batch, '') AS batch_key,
           sum(d.qty) AS qty,
           sum(public.purchase_effective_unit_cost(d.harga_netto, d.qty, d.ppn, d.diskon) * d.qty)
             / nullif(sum(d.qty), 0) AS modal
    FROM public.trx_pembelian_detail d
    JOIN public.trx_pembelian p
      ON p.cabang_id = d.cabang_id AND p.no_faktur = d.no_faktur AND p.status = 'AKTIF'
    WHERE d.cabang_id = p_cabang_id AND d.kode_obat = ANY(p_kode_obat)
    GROUP BY p.no_faktur, p.timestamp, d.cabang_id, d.kode_obat, coalesce(d.kode_batch, '')
  ), latest_batch AS (
    SELECT DISTINCT ON (cabang_id, kode_obat, batch_key)
           cabang_id, kode_obat, batch_key, modal
    FROM per_invoice_batch
    ORDER BY cabang_id, kode_obat, batch_key, timestamp DESC, no_faktur DESC
  )
  UPDATE public.stok_batch s
     SET harga_modal_batch = latest_batch.modal,
         harga_modal_batch_terakhir = latest_batch.modal,
         updated_at = now()
    FROM latest_batch
   WHERE s.cabang_id = latest_batch.cabang_id
     AND s.kode_obat = latest_batch.kode_obat
     AND coalesce(s.kode_batch, '') = latest_batch.batch_key;

  WITH per_invoice_product AS (
    SELECT p.no_faktur, p.timestamp, d.cabang_id, d.kode_obat,
           sum(d.qty) AS qty,
           sum(public.purchase_effective_unit_cost(d.harga_netto, d.qty, d.ppn, d.diskon) * d.qty)
             / nullif(sum(d.qty), 0) AS modal
    FROM public.trx_pembelian_detail d
    JOIN public.trx_pembelian p
      ON p.cabang_id = d.cabang_id AND p.no_faktur = d.no_faktur AND p.status = 'AKTIF'
    WHERE d.cabang_id = p_cabang_id AND d.kode_obat = ANY(p_kode_obat)
    GROUP BY p.no_faktur, p.timestamp, d.cabang_id, d.kode_obat
  ), latest_product AS (
    SELECT DISTINCT ON (cabang_id, kode_obat) cabang_id, kode_obat, modal
    FROM per_invoice_product
    ORDER BY cabang_id, kode_obat, timestamp DESC, no_faktur DESC
  )
  UPDATE public.master_barang m
     SET harga_modal = latest_product.modal,
         harga_modal_terakhir = latest_product.modal,
         updated_at = now()
    FROM latest_product
   WHERE m.cabang_id = latest_product.cabang_id
     AND m.kode_obat = latest_product.kode_obat;

  -- Bila faktur aktif terakhir dibatalkan atau dihapus dari rincian saat edit,
  -- modal aktif dikosongkan. Nilai terakhir tetap tersedia untuk audit.
  UPDATE public.master_barang m
     SET harga_modal_terakhir = coalesce(m.harga_modal_terakhir, m.harga_modal),
         harga_modal = NULL,
         updated_at = now()
   WHERE m.cabang_id = p_cabang_id
     AND m.kode_obat = ANY(p_kode_obat)
     AND EXISTS (
       SELECT 1
       FROM public.trx_pembelian_detail d
       WHERE d.cabang_id = m.cabang_id AND d.kode_obat = m.kode_obat
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.trx_pembelian_detail d
       JOIN public.trx_pembelian p
         ON p.cabang_id = d.cabang_id AND p.no_faktur = d.no_faktur
      WHERE d.cabang_id = m.cabang_id
        AND d.kode_obat = m.kode_obat
        AND p.status = 'AKTIF'
     );

  UPDATE public.stok_batch s
     SET harga_modal_batch_terakhir = coalesce(s.harga_modal_batch_terakhir, s.harga_modal_batch),
         harga_modal_batch = NULL,
         updated_at = now()
   WHERE s.cabang_id = p_cabang_id
     AND s.kode_obat = ANY(p_kode_obat)
     AND EXISTS (
       SELECT 1
       FROM public.trx_pembelian_detail d
       WHERE d.cabang_id = s.cabang_id
         AND d.kode_obat = s.kode_obat
         AND coalesce(d.kode_batch, '') = coalesce(s.kode_batch, '')
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.trx_pembelian_detail d
       JOIN public.trx_pembelian p
         ON p.cabang_id = d.cabang_id AND p.no_faktur = d.no_faktur
      WHERE d.cabang_id = s.cabang_id
        AND d.kode_obat = s.kode_obat
        AND coalesce(d.kode_batch, '') = coalesce(s.kode_batch, '')
        AND p.status = 'AKTIF'
     );
END;
$function$;

REVOKE ALL ON FUNCTION public.purchase_effective_unit_cost(numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_validate_items(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_validate_category(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_assert_no_shared_batches(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_assert_new_batches_exclusive(text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_refresh_costs(text, text[]) FROM PUBLIC, anon, authenticated;

-- Compatibility bridge: the older routine computes with nominal discount,
-- while the public purchase contract and detail column use percentage.
CREATE OR REPLACE FUNCTION public.purchase_items_discount_nominal(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb; v_out jsonb := '[]'::jsonb;
  v_gross numeric; v_pct numeric;
BEGIN
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_gross := coalesce((v_item->>'Harga_Netto')::numeric, 0)
      * coalesce((v_item->>'Qty')::numeric, 0)
      * (1 + coalesce((v_item->>'PPN')::numeric, 0) / 100);
    v_pct := least(greatest(coalesce((v_item->>'Diskon')::numeric, 0), 0), 100);
    v_item := jsonb_set(v_item, '{Diskon}', to_jsonb(round(v_gross * v_pct / 100, 2)), true);
    v_out := v_out || jsonb_build_array(v_item);
  END LOOP;
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.purchase_restore_discount_percent(
  p_cabang_id text, p_no_faktur text, p_items jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_item jsonb;
BEGIN
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    UPDATE public.trx_pembelian_detail
       SET diskon = least(greatest(coalesce((v_item->>'Diskon')::numeric, 0), 0), 100)
     WHERE cabang_id = p_cabang_id AND no_faktur = p_no_faktur
       AND upper(kode_obat) = upper(v_item->>'Kode_Obat')
       AND coalesce(kode_batch, '') = coalesce(v_item->>'Kode_Batch', '');
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.purchase_items_discount_nominal(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_restore_discount_percent(text,text,jsonb) FROM PUBLIC, anon, authenticated;

-- Keep the existing tested purchase logic, adding guarded wrappers that normalize
-- costs after the legacy routines complete within the same database transaction.
ALTER FUNCTION public.purchase_save(text, text, text, text, date, date, jsonb, text)
  RENAME TO purchase_save_before_discount_fix;
ALTER FUNCTION public.purchase_update(text, text, text, text, text, date, date, jsonb, text)
  RENAME TO purchase_update_before_discount_fix;
ALTER FUNCTION public.purchase_cancel(text, text, text, text)
  RENAME TO purchase_cancel_before_discount_fix;

REVOKE ALL ON FUNCTION public.purchase_save_before_discount_fix(text, text, text, text, date, date, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_update_before_discount_fix(text, text, text, text, text, date, date, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purchase_cancel_before_discount_fix(text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.purchase_save(
  p_username text, p_no_faktur_supplier text, p_supplier text, p_kategori text,
  p_tanggal date, p_jatuh_tempo date, p_items jsonb,
  p_cabang_id text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_cabang_id text;
  v_kode text[];
  v_items_nominal jsonb;
BEGIN
  PERFORM public.purchase_validate_items(p_items);
  PERFORM public.purchase_validate_category(p_kategori, p_items);
  v_items_nominal := public.purchase_items_discount_nominal(p_items);
  v_result := public.purchase_save_before_discount_fix(
    p_username, p_no_faktur_supplier, p_supplier, p_kategori,
    p_tanggal, p_jatuh_tempo, v_items_nominal, p_cabang_id);
  SELECT u.cabang_id INTO v_cabang_id
    FROM public.app_users u WHERE u.username = p_username AND u.aktif = 'YA';
  PERFORM public.purchase_restore_discount_percent(v_cabang_id, v_result->>'No_Faktur', p_items);
  SELECT array_agg(DISTINCT d.kode_obat) INTO v_kode
    FROM public.trx_pembelian_detail d
   WHERE d.cabang_id = v_cabang_id AND d.no_faktur = v_result->>'No_Faktur';
  PERFORM public.purchase_refresh_costs(v_cabang_id, v_kode);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.purchase_update(
  p_username text, p_no_faktur text, p_no_faktur_supplier text, p_supplier text,
  p_kategori text, p_tanggal date, p_jatuh_tempo date, p_items jsonb,
  p_cabang_id text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_cabang_id text;
  v_kode_lama text[];
  v_kode_baru text[];
  v_kode text[];
  v_items_nominal jsonb;
BEGIN
  PERFORM public.purchase_validate_items(p_items);
  PERFORM public.purchase_validate_category(p_kategori, p_items);
  SELECT u.cabang_id INTO v_cabang_id
    FROM public.app_users u WHERE u.username = p_username AND u.aktif = 'YA';
  IF v_cabang_id IS NULL THEN RAISE EXCEPTION 'Petugas tidak dikenal atau tidak aktif.'; END IF;
  IF nullif(p_cabang_id, '') IS NOT NULL AND p_cabang_id <> v_cabang_id THEN
    RAISE EXCEPTION 'Cabang permintaan tidak sesuai dengan cabang petugas.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('purchase_save:' || v_cabang_id));
  PERFORM public.purchase_assert_no_shared_batches(v_cabang_id, p_no_faktur);
  PERFORM public.purchase_assert_new_batches_exclusive(v_cabang_id, p_no_faktur, p_items);
  v_items_nominal := public.purchase_items_discount_nominal(p_items);
  SELECT array_agg(DISTINCT d.kode_obat) INTO v_kode_lama
    FROM public.trx_pembelian_detail d
   WHERE d.cabang_id = v_cabang_id AND d.no_faktur = p_no_faktur;

  v_result := public.purchase_update_before_discount_fix(
    p_username, p_no_faktur, p_no_faktur_supplier, p_supplier,
    p_kategori, p_tanggal, p_jatuh_tempo, v_items_nominal, p_cabang_id);

  PERFORM public.purchase_restore_discount_percent(v_cabang_id, p_no_faktur, p_items);
  SELECT array_agg(DISTINCT d.kode_obat) INTO v_kode_baru
    FROM public.trx_pembelian_detail d
   WHERE d.cabang_id = v_cabang_id AND d.no_faktur = p_no_faktur;
  SELECT array_agg(DISTINCT x.kode) INTO v_kode
    FROM unnest(coalesce(v_kode_lama, ARRAY[]::text[]) || coalesce(v_kode_baru, ARRAY[]::text[])) AS x(kode);
  PERFORM public.purchase_refresh_costs(v_cabang_id, v_kode);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.purchase_cancel(
  p_username text, p_no_faktur text, p_alasan text,
  p_cabang_id text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_cabang_id text;
  v_kode text[];
BEGIN
  SELECT u.cabang_id INTO v_cabang_id
    FROM public.app_users u WHERE u.username = p_username AND u.aktif = 'YA';
  IF v_cabang_id IS NULL THEN RAISE EXCEPTION 'Petugas tidak dikenal atau tidak aktif.'; END IF;
  IF nullif(p_cabang_id, '') IS NOT NULL AND p_cabang_id <> v_cabang_id THEN
    RAISE EXCEPTION 'Cabang permintaan tidak sesuai dengan cabang petugas.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('purchase_save:' || v_cabang_id));
  PERFORM public.purchase_assert_no_shared_batches(v_cabang_id, p_no_faktur);

  IF EXISTS (
    SELECT 1
      FROM (
        SELECT d.kode_obat, coalesce(d.kode_batch, '') AS batch_key, sum(d.qty) AS qty
          FROM public.trx_pembelian_detail d
         WHERE d.cabang_id = v_cabang_id AND d.no_faktur = p_no_faktur
         GROUP BY d.kode_obat, coalesce(d.kode_batch, '')
      ) item
      LEFT JOIN public.stok_batch s
        ON s.cabang_id = v_cabang_id AND s.kode_obat = item.kode_obat
       AND coalesce(s.kode_batch, '') = item.batch_key
     WHERE s.id_batch IS NULL OR coalesce(s.stok_real, 0) < item.qty
  ) THEN
    RAISE EXCEPTION 'Pembatalan ditolak: batch tidak ditemukan atau stoknya tidak cukup untuk membalik seluruh faktur.';
  END IF;

  SELECT array_agg(DISTINCT d.kode_obat) INTO v_kode
    FROM public.trx_pembelian_detail d
   WHERE d.cabang_id = v_cabang_id AND d.no_faktur = p_no_faktur;
  v_result := public.purchase_cancel_before_discount_fix(p_username, p_no_faktur, p_alasan, p_cabang_id);
  PERFORM public.purchase_refresh_costs(v_cabang_id, v_kode);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.purchase_save(text, text, text, text, date, date, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_save(text, text, text, text, date, date, jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.purchase_update(text, text, text, text, text, date, date, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_update(text, text, text, text, text, date, date, jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.purchase_cancel(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_cancel(text, text, text, text) TO service_role;

-- -----------------------------------------------------------------------------
-- Pembayaran hutang harus memakai lock faktur dan validasi saldo dalam transaksi
-- yang sama. Dengan begitu dua permintaan bersamaan tidak dapat membayar melebihi
-- sisa tagihan atau membayar faktur yang sedang dibatalkan/diedit.
CREATE OR REPLACE FUNCTION public.purchase_payment_save(
  p_username text,
  p_no_faktur text,
  p_tanggal_bayar date,
  p_jumlah_bayar numeric,
  p_metode_bayar text,
  p_referensi text DEFAULT '',
  p_catatan text DEFAULT '',
  p_cabang_id text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cabang_id text;
  v_user_cabang text;
  v_role text;
  v_invoice public.trx_pembelian%ROWTYPE;
  v_paid numeric;
  v_payment public.trx_pembayaran_hutang%ROWTYPE;
  v_catatan text := trim(coalesce(p_catatan, ''));
BEGIN
  SELECT u.cabang_id, u.role INTO v_user_cabang, v_role
    FROM public.app_users u WHERE u.username = p_username AND u.aktif = 'YA';
  IF v_user_cabang IS NULL THEN RAISE EXCEPTION 'Petugas tidak dikenal atau tidak aktif.'; END IF;
  IF v_role NOT IN ('Owner', 'Apoteker') THEN RAISE EXCEPTION 'Hanya Owner dan Apoteker yang dapat mencatat pembayaran hutang.'; END IF;
  IF nullif(p_cabang_id, '') IS NOT NULL AND p_cabang_id <> v_user_cabang THEN
    RAISE EXCEPTION 'Cabang permintaan tidak sesuai dengan cabang petugas.';
  END IF;
  v_cabang_id := v_user_cabang;
  IF nullif(trim(coalesce(p_no_faktur, '')), '') IS NULL THEN RAISE EXCEPTION 'Nomor faktur wajib diisi.'; END IF;
  IF p_jumlah_bayar IS NULL OR p_jumlah_bayar <= 0 THEN RAISE EXCEPTION 'Jumlah pembayaran harus lebih dari Rp0.'; END IF;
  IF p_metode_bayar NOT IN ('Tunai', 'Transfer Bank', 'QRIS', 'E-wallet', 'Kartu Debit', 'Kartu Kredit', 'Cek/Giro', 'Lainnya') THEN
    RAISE EXCEPTION 'Metode pembayaran tidak valid.';
  END IF;
  IF p_metode_bayar = 'Lainnya' AND v_catatan = '' THEN RAISE EXCEPTION 'Catatan wajib diisi untuk metode Lainnya.'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('purchase_save:' || v_cabang_id));
  SELECT * INTO v_invoice
    FROM public.trx_pembelian
   WHERE cabang_id = v_cabang_id AND no_faktur = p_no_faktur
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Faktur tidak ditemukan pada cabang aktif.'; END IF;
  IF v_invoice.status <> 'AKTIF' THEN RAISE EXCEPTION 'Faktur ini sudah dibatalkan, pembayaran tidak bisa dicatat.'; END IF;

  SELECT coalesce(sum(p.jumlah_bayar), 0) INTO v_paid
    FROM public.trx_pembayaran_hutang p
   WHERE p.cabang_id = v_cabang_id AND p.no_faktur = p_no_faktur AND p.status = 'AKTIF';
  IF p_jumlah_bayar > greatest(0, coalesce(v_invoice.total_tagihan, 0) - v_paid) THEN
    RAISE EXCEPTION 'Pembayaran melebihi sisa hutang.';
  END IF;

  INSERT INTO public.trx_pembayaran_hutang(
    cabang_id, no_faktur, tanggal_bayar, jumlah_bayar, metode_bayar,
    referensi, catatan, dibayar_oleh, status
  ) VALUES (
    v_cabang_id, p_no_faktur, coalesce(p_tanggal_bayar, current_date), p_jumlah_bayar,
    p_metode_bayar, nullif(trim(coalesce(p_referensi, '')), ''), v_catatan,
    p_username, 'AKTIF'
  ) RETURNING * INTO v_payment;
  RETURN to_jsonb(v_payment);
END;
$function$;

CREATE OR REPLACE FUNCTION public.purchase_payment_cancel(
  p_username text,
  p_id text,
  p_alasan text,
  p_cabang_id text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cabang_id text;
  v_user_cabang text;
  v_role text;
  v_no_faktur text;
  v_payment public.trx_pembayaran_hutang%ROWTYPE;
  v_reason text := trim(coalesce(p_alasan, ''));
BEGIN
  SELECT u.cabang_id, u.role INTO v_user_cabang, v_role
    FROM public.app_users u WHERE u.username = p_username AND u.aktif = 'YA';
  IF v_user_cabang IS NULL THEN RAISE EXCEPTION 'Petugas tidak dikenal atau tidak aktif.'; END IF;
  IF v_role NOT IN ('Owner', 'Apoteker') THEN RAISE EXCEPTION 'Hanya Owner dan Apoteker yang dapat membatalkan pembayaran hutang.'; END IF;
  IF nullif(p_cabang_id, '') IS NOT NULL AND p_cabang_id <> v_user_cabang THEN
    RAISE EXCEPTION 'Cabang permintaan tidak sesuai dengan cabang petugas.';
  END IF;
  v_cabang_id := v_user_cabang;
  IF nullif(trim(coalesce(p_id, '')), '') IS NULL OR v_reason = '' THEN
    RAISE EXCEPTION 'ID pembayaran dan alasan pembatalan wajib diisi.';
  END IF;

  SELECT p.no_faktur INTO v_no_faktur
    FROM public.trx_pembayaran_hutang p
   WHERE p.id::text = p_id AND p.cabang_id = v_cabang_id;
  IF v_no_faktur IS NULL THEN RAISE EXCEPTION 'Pembayaran tidak ditemukan pada cabang aktif.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('purchase_save:' || v_cabang_id));
  PERFORM 1 FROM public.trx_pembelian
   WHERE cabang_id = v_cabang_id AND no_faktur = v_no_faktur
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Faktur asal pembayaran tidak ditemukan.'; END IF;

  UPDATE public.trx_pembayaran_hutang
     SET status = 'DIBATALKAN', alasan_pembatalan = v_reason,
         dibatalkan_oleh = p_username, dibatalkan_pada = now()
   WHERE id::text = p_id AND cabang_id = v_cabang_id AND status = 'AKTIF'
   RETURNING * INTO v_payment;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pembayaran tidak ditemukan atau sudah dibatalkan.'; END IF;
  RETURN to_jsonb(v_payment);
END;
$function$;

REVOKE ALL ON FUNCTION public.purchase_payment_save(text, text, date, numeric, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_payment_save(text, text, date, numeric, text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.purchase_payment_cancel(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_payment_cancel(text, text, text, text) TO service_role;

-- -----------------------------------------------------------------------------
-- Backfill modal satuan yang saat ini tersimpan. Nilai tagihan dan qty stok tetap.
WITH per_invoice_batch AS (
  SELECT p.no_faktur, p.timestamp, d.cabang_id, d.kode_obat,
         coalesce(d.kode_batch, '') AS batch_key,
         sum(d.qty) AS qty,
         sum(public.purchase_effective_unit_cost(d.harga_netto, d.qty, d.ppn, d.diskon) * d.qty)
           / nullif(sum(d.qty), 0) AS modal
  FROM public.trx_pembelian_detail d
  JOIN public.trx_pembelian p
    ON p.cabang_id = d.cabang_id AND p.no_faktur = d.no_faktur AND p.status = 'AKTIF'
  GROUP BY p.no_faktur, p.timestamp, d.cabang_id, d.kode_obat, coalesce(d.kode_batch, '')
), latest_batch AS (
  SELECT DISTINCT ON (cabang_id, kode_obat, batch_key)
         cabang_id, kode_obat, batch_key, modal
  FROM per_invoice_batch
  ORDER BY cabang_id, kode_obat, batch_key, timestamp DESC, no_faktur DESC
)
UPDATE public.stok_batch s
   SET harga_modal_batch = latest_batch.modal,
       harga_modal_batch_terakhir = latest_batch.modal,
       updated_at = now()
  FROM latest_batch
 WHERE s.cabang_id = latest_batch.cabang_id
   AND s.kode_obat = latest_batch.kode_obat
   AND coalesce(s.kode_batch, '') = latest_batch.batch_key;

WITH per_invoice_product AS (
  SELECT p.no_faktur, p.timestamp, d.cabang_id, d.kode_obat,
         sum(d.qty) AS qty,
         sum(public.purchase_effective_unit_cost(d.harga_netto, d.qty, d.ppn, d.diskon) * d.qty)
           / nullif(sum(d.qty), 0) AS modal
  FROM public.trx_pembelian_detail d
  JOIN public.trx_pembelian p
    ON p.cabang_id = d.cabang_id AND p.no_faktur = d.no_faktur AND p.status = 'AKTIF'
  GROUP BY p.no_faktur, p.timestamp, d.cabang_id, d.kode_obat
), latest_product AS (
  SELECT DISTINCT ON (cabang_id, kode_obat) cabang_id, kode_obat, modal
  FROM per_invoice_product
  ORDER BY cabang_id, kode_obat, timestamp DESC, no_faktur DESC
)
UPDATE public.master_barang m
   SET harga_modal = latest_product.modal,
       harga_modal_terakhir = latest_product.modal,
       updated_at = now()
  FROM latest_product
 WHERE m.cabang_id = latest_product.cabang_id
   AND m.kode_obat = latest_product.kode_obat;

-- Produk yang seluruh faktur pembeliannya sudah tidak aktif tidak memiliki
-- modal aktif. Simpan angka terakhir untuk audit, lalu tandai modal aktif NULL.
UPDATE public.master_barang m
   SET harga_modal_terakhir = coalesce(m.harga_modal_terakhir, m.harga_modal),
       harga_modal = NULL,
       updated_at = now()
 WHERE EXISTS (
   SELECT 1
   FROM public.trx_pembelian_detail d
   WHERE d.cabang_id = m.cabang_id AND d.kode_obat = m.kode_obat
 )
 AND NOT EXISTS (
   SELECT 1
   FROM public.trx_pembelian_detail d
   JOIN public.trx_pembelian p
     ON p.cabang_id = d.cabang_id AND p.no_faktur = d.no_faktur
  WHERE d.cabang_id = m.cabang_id
    AND d.kode_obat = m.kode_obat
    AND p.status = 'AKTIF'
 );

UPDATE public.stok_batch s
   SET harga_modal_batch_terakhir = coalesce(s.harga_modal_batch_terakhir, s.harga_modal_batch),
       harga_modal_batch = NULL,
       updated_at = now()
 WHERE EXISTS (
   SELECT 1
   FROM public.trx_pembelian_detail d
   WHERE d.cabang_id = s.cabang_id
     AND d.kode_obat = s.kode_obat
     AND coalesce(d.kode_batch, '') = coalesce(s.kode_batch, '')
 )
 AND NOT EXISTS (
   SELECT 1
   FROM public.trx_pembelian_detail d
   JOIN public.trx_pembelian p
     ON p.cabang_id = d.cabang_id AND p.no_faktur = d.no_faktur
  WHERE d.cabang_id = s.cabang_id
    AND d.kode_obat = s.kode_obat
    AND coalesce(d.kode_batch, '') = coalesce(s.kode_batch, '')
    AND p.status = 'AKTIF'
 );

-- Verifikasi read-only setelah deploy:
-- 1) harga_modal_batch / harga_modal sama dengan modal efektif terbaru (di luar PPN).
-- 2) qty stok, total_item, dan total_tagihan tidak berubah.
-- Rollback: fungsi legacy masih tersimpan sebagai *_before_discount_fix; hapus
-- wrapper, kembalikan nama legacy ke nama aslinya, lalu pulihkan harga modal dari
-- harga_netto pada faktur AKTIF terbaru (bukan dengan mengubah qty/total faktur).
