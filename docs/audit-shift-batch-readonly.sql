-- READ-ONLY diagnostic queries for shift and batch review.
-- Run SELECT statements only. This file deliberately does not update historical records.

-- A. Historical sales whose stored shift differs from the agreed Jakarta-time schedule.
SELECT no_nota, cabang_id, tanggal, jam, "timestamp", shift AS shift_tersimpan,
       CASE
         WHEN extract(hour FROM "timestamp" AT TIME ZONE 'Asia/Jakarta') >= 7
          AND extract(hour FROM "timestamp" AT TIME ZONE 'Asia/Jakarta') < 14 THEN 'Pagi'
         WHEN extract(hour FROM "timestamp" AT TIME ZONE 'Asia/Jakarta') >= 14
          AND extract(hour FROM "timestamp" AT TIME ZONE 'Asia/Jakarta') < 21 THEN 'Sore'
         ELSE 'Luar Jam'
       END AS shift_berdasarkan_waktu
FROM public.trx_penjualan
WHERE shift IS DISTINCT FROM CASE
         WHEN extract(hour FROM "timestamp" AT TIME ZONE 'Asia/Jakarta') >= 7
          AND extract(hour FROM "timestamp" AT TIME ZONE 'Asia/Jakarta') < 14 THEN 'Pagi'
         WHEN extract(hour FROM "timestamp" AT TIME ZONE 'Asia/Jakarta') >= 14
          AND extract(hour FROM "timestamp" AT TIME ZONE 'Asia/Jakarta') < 21 THEN 'Sore'
         ELSE 'Luar Jam'
       END
ORDER BY cabang_id, tanggal, "timestamp";

-- B. Active stock batches with no batch code. Do not bulk-generate codes without
-- reconciling purchase invoices and physical labels first.
SELECT cabang_id, count(*) AS batch_aktif,
       count(*) FILTER (WHERE kode_batch IS NULL OR trim(kode_batch) = '') AS tanpa_kode_batch
FROM public.stok_batch
WHERE coalesce(stok_real, 0) > 0
GROUP BY cabang_id
ORDER BY cabang_id;

-- C. Expired batches that still have stock; these need branch/physical verification.
SELECT cabang_id, id_batch, kode_obat, kode_batch, expired_date, stok_real
FROM public.stok_batch
WHERE coalesce(stok_real, 0) > 0
  AND expired_date < (now() AT TIME ZONE 'Asia/Jakarta')::date
ORDER BY cabang_id, expired_date, kode_obat;
