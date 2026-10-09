-- Pembelian: diskon selalu disimpan sebagai persentase, juga untuk data lama.
-- Baris legacy nominal dikonversi hanya bila subtotal membuktikan nominal sebagai
-- representasi asal. Subtotal, total faktur, dan qty stok tidak diubah.

COMMENT ON FUNCTION public.purchase_effective_unit_cost(numeric, numeric, numeric, numeric)
IS 'Argumen p_diskon adalah persentase 0..100. Modal/unit = netto incl. PPN × (1 - diskon_persen/100), dibagi qty dan dibulatkan 2 desimal.';

-- Ganti pemulihan berdasarkan (barang,batch), yang menimpa diskon pada semua
-- baris duplikat, dengan pemadanan urutan per (barang,batch) ke ID detail.
CREATE OR REPLACE FUNCTION public.purchase_restore_discount_percent(
  p_cabang_id text, p_no_faktur text, p_items jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_detail_count integer;
  v_updated integer;
  v_item_count integer;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Detail pembelian untuk pemulihan diskon tidak valid.';
  END IF;
  v_item_count := jsonb_array_length(p_items);
  SELECT count(*) INTO v_detail_count
    FROM public.trx_pembelian_detail d
   WHERE d.cabang_id = p_cabang_id AND d.no_faktur = p_no_faktur;
  IF v_item_count <> v_detail_count THEN
    RAISE EXCEPTION 'Jumlah baris faktur tidak cocok saat memulihkan diskon persen.';
  END IF;

  WITH input_ranked AS (
    SELECT upper(x.value->>'Kode_Obat') AS kode_obat,
           coalesce(x.value->>'Kode_Batch', '') AS batch_key,
           row_number() OVER (
             PARTITION BY upper(x.value->>'Kode_Obat'), coalesce(x.value->>'Kode_Batch', '')
             ORDER BY x.ordinality
           ) AS urutan,
           least(greatest(coalesce((x.value->>'Diskon')::numeric, 0), 0), 100) AS diskon_persen
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS x(value, ordinality)
  ), detail_ranked AS (
    SELECT d.id,
           upper(d.kode_obat) AS kode_obat,
           coalesce(d.kode_batch, '') AS batch_key,
           row_number() OVER (
             PARTITION BY upper(d.kode_obat), coalesce(d.kode_batch, '')
             ORDER BY d.id
           ) AS urutan
      FROM public.trx_pembelian_detail d
     WHERE d.cabang_id = p_cabang_id AND d.no_faktur = p_no_faktur
  ), paired AS (
    SELECT d.id, i.diskon_persen
      FROM detail_ranked d
      JOIN input_ranked i USING (kode_obat, batch_key, urutan)
  )
  UPDATE public.trx_pembelian_detail AS target
     SET diskon = paired.diskon_persen
    FROM paired
   WHERE target.id = paired.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> v_item_count THEN
    RAISE EXCEPTION 'Tidak semua baris faktur dapat dipasangkan untuk memulihkan diskon persen.';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.purchase_restore_discount_percent(text,text,jsonb)
  FROM PUBLIC, anon, authenticated;

-- Simpan nilai sebelumnya agar rollback terkontrol dapat mengembalikan hanya
-- baris yang sejak migration belum diedit/diganti.
CREATE TABLE public.purchase_discount_percent_repair_backup (
  detail_id bigint PRIMARY KEY,
  cabang_id text NOT NULL,
  kode_obat text NOT NULL,
  kode_batch text,
  diskon_lama numeric NOT NULL,
  diskon_persen_baru numeric NOT NULL,
  harga_modal_lama numeric,
  harga_modal_terakhir_lama numeric,
  harga_modal_batch_lama numeric,
  harga_modal_batch_terakhir_lama numeric,
  diperbaiki_pada timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.purchase_discount_percent_repair_backup ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_discount_percent_repair_backup_service_role
  ON public.purchase_discount_percent_repair_backup
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.purchase_discount_percent_repair_backup FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.purchase_discount_percent_repair_backup TO service_role;

-- Pengaman: diskon >100 tidak mungkin merupakan persentase valid. Konversi hanya
-- diizinkan bila subtotal lama cocok dengan bruto - diskon nominal; jika tidak,
-- migration gagal secara atomik agar baris tidak ditebak.
DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.trx_pembelian_detail d
     WHERE d.diskon > 100
       AND (
         d.subtotal IS NULL
         OR d.harga_netto IS NULL
         OR d.qty IS NULL
         OR d.harga_netto * d.qty * (1 + coalesce(d.ppn, 0) / 100) <= 0
         OR d.harga_netto * d.qty * (1 + coalesce(d.ppn, 0) / 100) IS NULL
         OR d.diskon > d.harga_netto * d.qty * (1 + coalesce(d.ppn, 0) / 100)
         OR abs(
              d.subtotal
              - round(d.harga_netto * d.qty * (1 + coalesce(d.ppn, 0) / 100) - d.diskon, 2)
            ) > 0.02
       )
  ) THEN
    RAISE EXCEPTION 'Ada diskon historis >100 yang tidak dapat dibuktikan sebagai nominal dari subtotal; hentikan migration dan tinjau baris tersebut.';
  END IF;
END;
$preflight$;

DO $preflight_nominal_bounds$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.trx_pembelian_detail d
     WHERE d.diskon > 0
       AND abs(
             d.subtotal
             - round(d.harga_netto * d.qty * (1 + coalesce(d.ppn, 0) / 100) - d.diskon, 2)
           ) <= 0.02
       AND (
         d.subtotal IS NULL
         OR d.harga_netto IS NULL
         OR d.qty IS NULL
         OR d.harga_netto * d.qty * (1 + coalesce(d.ppn, 0) / 100) IS NULL
         OR d.harga_netto * d.qty * (1 + coalesce(d.ppn, 0) / 100) <= 0
         OR d.diskon > d.harga_netto * d.qty * (1 + coalesce(d.ppn, 0) / 100)
         OR d.subtotal < 0
       )
  ) THEN
    RAISE EXCEPTION 'Kandidat nominal menghasilkan bruto/subtotal/diskon di luar batas; hentikan migration untuk pemeriksaan manual.';
  END IF;
END;
$preflight_nominal_bounds$;

-- Catat kandidat legacy yang teridentifikasi dari subtotal, sebelum mengubahnya.
-- Untuk persentase yang tersimpan dengan benar, subtotal cocok dengan rumus persen
-- sehingga baris tidak masuk daftar ini. Jika bruto=100 dan dua bentuk identik,
-- nilai angka diskon juga identik dan tidak perlu dikonversi.
CREATE TEMP TABLE tmp_purchase_discount_nominal_repair AS
SELECT d.id, d.cabang_id, d.kode_obat,
       d.harga_netto * d.qty * (1 + coalesce(d.ppn, 0) / 100) AS bruto,
       d.subtotal
  FROM public.trx_pembelian_detail d
 WHERE d.diskon > 0
   AND d.harga_netto * d.qty * (1 + coalesce(d.ppn, 0) / 100) > 0
   AND abs(
         d.subtotal
         - round(d.harga_netto * d.qty * (1 + coalesce(d.ppn, 0) / 100) - d.diskon, 2)
       ) <= 0.02
   AND abs(
         d.subtotal
         - round(
             d.harga_netto * d.qty * (1 + coalesce(d.ppn, 0) / 100)
             * (1 - d.diskon / 100), 2
           )
       ) > 0.02;

-- Bila modal perlu disegarkan untuk SKU yang terkena normalisasi, seluruh baris
-- aktif SKU tersebut harus dapat dibaca sebagai nominal atau persen dari subtotal.
-- Diskon nol dikecualikan karena kedua representasi sama.
DO $preflight_refresh$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.trx_pembelian_detail d
      JOIN public.trx_pembelian p
        ON p.cabang_id = d.cabang_id AND p.no_faktur = d.no_faktur
       AND p.status = 'AKTIF'
     JOIN (SELECT DISTINCT cabang_id, kode_obat FROM tmp_purchase_discount_nominal_repair) affected
        ON affected.cabang_id = d.cabang_id AND affected.kode_obat = d.kode_obat
     WHERE (coalesce(d.diskon, 0) > 0 AND (
             d.subtotal IS NULL
             OR d.harga_netto IS NULL
             OR d.qty IS NULL
             OR d.harga_netto * d.qty * (1 + coalesce(d.ppn, 0) / 100) <= 0
             OR abs(
             d.subtotal
             - round(d.harga_netto * d.qty * (1 + coalesce(d.ppn, 0) / 100) - d.diskon, 2)
           ) > 0.02
       AND abs(
             d.subtotal
             - round(
                 d.harga_netto * d.qty * (1 + coalesce(d.ppn, 0) / 100)
                 * (1 - d.diskon / 100), 2
               )
           ) > 0.02))
  ) THEN
    RAISE EXCEPTION 'SKU terdampak memiliki baris aktif dengan semantik diskon ambigu; hentikan migration sebelum menyegarkan modal.';
  END IF;
END;
$preflight_refresh$;

-- Pulihkan representasi diskon persen dari nilai rupiah yang benar-benar sudah
-- membentuk subtotal. Pembulatan 8 desimal mempertahankan nilai rupiah baris.
INSERT INTO public.purchase_discount_percent_repair_backup
  (detail_id, cabang_id, kode_obat, kode_batch, diskon_lama, diskon_persen_baru,
   harga_modal_lama, harga_modal_terakhir_lama,
   harga_modal_batch_lama, harga_modal_batch_terakhir_lama)
SELECT d.id, d.cabang_id, d.kode_obat, d.kode_batch, d.diskon,
       least(100, greatest(0, round((r.bruto - r.subtotal) / nullif(r.bruto, 0) * 100, 8))),
       m.harga_modal, m.harga_modal_terakhir,
       s.harga_modal_batch, s.harga_modal_batch_terakhir
  FROM public.trx_pembelian_detail d
  JOIN tmp_purchase_discount_nominal_repair r ON r.id = d.id
  LEFT JOIN public.master_barang m
    ON m.cabang_id = d.cabang_id AND m.kode_obat = d.kode_obat
  LEFT JOIN public.stok_batch s
    ON s.cabang_id = d.cabang_id AND s.kode_obat = d.kode_obat
   AND coalesce(s.kode_batch, '') = coalesce(d.kode_batch, '');

UPDATE public.trx_pembelian_detail AS d
   SET diskon = least(
     100,
     greatest(0, round((r.bruto - r.subtotal) / nullif(r.bruto, 0) * 100, 8))
   )
  FROM tmp_purchase_discount_nominal_repair r
 WHERE d.id = r.id;

-- Refresh hanya kode obat yang benar-benar berubah dan punya faktur aktif.
-- purchase_refresh_costs memperbarui modal master/batch saja; tidak menyentuh stok,
-- detail penjualan, atau total faktur.
DO $refresh$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT r.cabang_id, array_agg(DISTINCT r.kode_obat) AS kode_obat
      FROM tmp_purchase_discount_nominal_repair r
      JOIN public.trx_pembelian_detail d ON d.id = r.id
      JOIN public.trx_pembelian p
        ON p.cabang_id = d.cabang_id AND p.no_faktur = d.no_faktur
       AND p.status = 'AKTIF'
     GROUP BY r.cabang_id
  LOOP
    PERFORM public.purchase_refresh_costs(v.cabang_id, v.kode_obat);
  END LOOP;
END;
$refresh$;
