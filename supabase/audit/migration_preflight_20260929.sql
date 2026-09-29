-- SI-FaMitra — preflight migration production (READ-ONLY)
--
-- Tujuan:
--   1. Memeriksa objek schema yang dibutuhkan migration terbaru.
--   2. Menghitung kandidat backfill kupon setelah retur penuh.
--   3. Menyediakan bukti sebelum review/persetujuan migration.
--
-- PENTING:
--   - File ini BUKAN migration dan tidak boleh dijalankan dengan `supabase db push`.
--   - Seluruh statement di bawah ini read-only SELECT.
--   - Jangan menambahkan DDL/DML ke file ini.
--   - Hasil berisi metadata/identifier transaksi untuk review internal; jangan dipublikasikan.

-- -----------------------------------------------------------------------------
-- 1. Schema drift: kolom lottery yang dibutuhkan migration 20260929010000.
-- -----------------------------------------------------------------------------
SELECT
  c.table_schema,
  c.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name = 'lottery_campaigns'
  AND c.column_name IN ('min_jumlah_transaksi', 'min_belanja_per_transaksi_idr')
ORDER BY c.column_name
LIMIT 20;

-- -----------------------------------------------------------------------------
-- 2. Schema drift: RPC yang ditargetkan migration lottery.
-- -----------------------------------------------------------------------------
SELECT
  r.routine_schema,
  r.routine_name,
  r.routine_type,
  r.data_type AS return_data_type
FROM information_schema.routines r
WHERE r.routine_schema = 'public'
  AND r.routine_name IN ('lottery_save_campaign', 'lottery_record_winner')
ORDER BY r.routine_name
LIMIT 20;

-- -----------------------------------------------------------------------------
-- 3. Object check: function/trigger promo-retur yang ditargetkan migration.
-- -----------------------------------------------------------------------------
SELECT
  r.routine_schema,
  r.routine_name,
  r.routine_type
FROM information_schema.routines r
WHERE r.routine_schema = 'public'
  AND r.routine_name = 'promo_reverse_on_full_return'
LIMIT 10;

SELECT
  t.trigger_name,
  t.event_manipulation,
  t.event_object_table,
  t.action_timing,
  t.action_statement
FROM information_schema.triggers t
WHERE t.trigger_schema = 'public'
  AND t.trigger_name = 'trg_promo_reverse_on_full_return'
LIMIT 10;

-- -----------------------------------------------------------------------------
-- 4. Backfill preview: redemption APPLIED yang tampak sudah diretur penuh.
--    Logika qty mengikuti migration 20260929000000:
--    semua kombinasi kode_obat + kode_batch harus memiliki qty retur >= qty jual.
-- -----------------------------------------------------------------------------
WITH sold AS (
  SELECT
    d.no_nota AS invoice_no,
    d.cabang_id,
    d.kode_obat,
    d.kode_batch,
    SUM(d.qty) AS sold_qty
  FROM public.trx_penjualan_detail d
  GROUP BY d.no_nota, d.cabang_id, d.kode_obat, d.kode_batch
), returned AS (
  SELECT
    rj.no_nota_asal AS invoice_no,
    rj.cabang_id,
    rd.kode_obat,
    rd.kode_batch,
    SUM(rd.qty) AS returned_qty
  FROM public.trx_retur_jual rj
  JOIN public.trx_retur_jual_detail rd
    ON rd.no_retur = rj.no_retur
   AND rd.cabang_id = rj.cabang_id
  GROUP BY rj.no_nota_asal, rj.cabang_id, rd.kode_obat, rd.kode_batch
), open_items AS (
  SELECT s.invoice_no, s.cabang_id
  FROM sold s
  LEFT JOIN returned r
    ON r.invoice_no = s.invoice_no
   AND r.cabang_id = s.cabang_id
   AND r.kode_obat = s.kode_obat
   AND r.kode_batch = s.kode_batch
  WHERE s.sold_qty > COALESCE(r.returned_qty, 0)
  GROUP BY s.invoice_no, s.cabang_id
), candidates AS (
  SELECT
    pr.id,
    pr.invoice_no,
    pr.cabang_id,
    pr.campaign_id,
    pr.status
  FROM public.promo_redemptions pr
  WHERE pr.status = 'APPLIED'
    AND EXISTS (
      SELECT 1
      FROM sold s
      WHERE s.invoice_no = pr.invoice_no
        AND s.cabang_id = pr.cabang_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM open_items oi
      WHERE oi.invoice_no = pr.invoice_no
        AND oi.cabang_id = pr.cabang_id
    )
)
SELECT
  c.id,
  c.invoice_no,
  c.cabang_id,
  c.campaign_id,
  c.status
FROM candidates c
ORDER BY c.cabang_id, c.invoice_no
LIMIT 100;

-- -----------------------------------------------------------------------------
-- 5. Backfill preview summary: angka aman untuk review tanpa identifier.
-- -----------------------------------------------------------------------------
WITH sold AS (
  SELECT d.no_nota AS invoice_no, d.cabang_id, d.kode_obat, d.kode_batch, SUM(d.qty) AS sold_qty
  FROM public.trx_penjualan_detail d
  GROUP BY d.no_nota, d.cabang_id, d.kode_obat, d.kode_batch
), returned AS (
  SELECT rj.no_nota_asal AS invoice_no, rj.cabang_id, rd.kode_obat, rd.kode_batch, SUM(rd.qty) AS returned_qty
  FROM public.trx_retur_jual rj
  JOIN public.trx_retur_jual_detail rd ON rd.no_retur = rj.no_retur AND rd.cabang_id = rj.cabang_id
  GROUP BY rj.no_nota_asal, rj.cabang_id, rd.kode_obat, rd.kode_batch
), open_items AS (
  SELECT s.invoice_no, s.cabang_id
  FROM sold s
  LEFT JOIN returned r ON r.invoice_no = s.invoice_no AND r.cabang_id = s.cabang_id
    AND r.kode_obat = s.kode_obat AND r.kode_batch = s.kode_batch
  WHERE s.sold_qty > COALESCE(r.returned_qty, 0)
  GROUP BY s.invoice_no, s.cabang_id
), candidates AS (
  SELECT pr.id, pr.cabang_id
  FROM public.promo_redemptions pr
  WHERE pr.status = 'APPLIED'
    AND EXISTS (SELECT 1 FROM sold s WHERE s.invoice_no = pr.invoice_no AND s.cabang_id = pr.cabang_id)
    AND NOT EXISTS (SELECT 1 FROM open_items oi WHERE oi.invoice_no = pr.invoice_no AND oi.cabang_id = pr.cabang_id)
)
SELECT
  COUNT(*)::integer AS candidate_redemptions,
  COUNT(DISTINCT cabang_id)::integer AS affected_branches
FROM candidates;

-- -----------------------------------------------------------------------------
-- 6. Baseline counts for post-change verification.
-- -----------------------------------------------------------------------------
SELECT 'promo_redemptions' AS object_name, COUNT(*)::integer AS row_count
FROM public.promo_redemptions
UNION ALL
SELECT 'lottery_campaigns', COUNT(*)::integer FROM public.lottery_campaigns
UNION ALL
SELECT 'lottery_winners', COUNT(*)::integer FROM public.lottery_winners
UNION ALL
SELECT 'trx_retur_jual', COUNT(*)::integer FROM public.trx_retur_jual
UNION ALL
SELECT 'trx_retur_jual_detail', COUNT(*)::integer FROM public.trx_retur_jual_detail
LIMIT 20;
