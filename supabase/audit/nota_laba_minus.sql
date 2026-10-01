-- SI-FaMitra — audit "nota yang menyebabkan laba minus" (READ-ONLY)
--
-- Tujuan:
--   Menemukan nota penjualan yang laba kotornya negatif — harga akhir nota lebih
--   kecil daripada HPP-nya — beserta dugaan penyebabnya.
--
-- Definisi yang dipakai (sama dengan aplikasi):
--   laba kotor per nota = trx_penjualan.harga_akhir - trx_penjualan.total_hpp
--   harga_akhir         = subtotal - diskon kasir - diskon reward (lihat pos_checkout)
--   total_hpp           = SUM(qty x harga_modal batch) pada saat nota dibuat
--
-- PENTING:
--   - Berkas ini BUKAN migration dan tidak boleh dijalankan lewat `supabase db push`.
--   - Seluruh statement di bawah ini read-only SELECT: tidak ada DDL/DML.
--   - Tidak ada nama maupun nomor WhatsApp pelanggan yang diambil. Hasil berisi
--     nomor nota, tanggal, petugas, dan angka saja; tetap jangan dipublikasikan
--     ke luar tim.
--   - Jalankan dari Supabase Dashboard -> SQL Editor, satu bagian per satu bagian.
--
-- Cara membaca hasil:
--   - Mulai dari bagian 1. Kolom dugaan_sebab menjelaskan kenapa nota itu minus.
--   - Bagian 2 dan 3 menunjukkan apakah masalahnya sistemik (harga jual memang di
--     bawah modal) atau per transaksi (diskon/reward), dan di cabang/tipe pelanggan
--     mana yang paling parah.
--   - Bagian 5 adalah koreksi data: nota tanpa HPP membuat laba terlihat LEBIH
--     BESAR dari kenyataan, jadi perbaiki dulu sebelum menyimpulkan total laba.
--   - Laba bersih pada Laporan Laba-Rugi juga mengurangi retur dan seluruh biaya
--     operasional periode. Kalau laba kotor sehat tapi laba bersih minus, penyebabnya
--     biaya operasional, bukan satu nota tertentu — pakai bagian 2 untuk memastikan.

-- -----------------------------------------------------------------------------
-- 1. Daftar nota dengan laba kotor minus (terburuk lebih dulu).
-- -----------------------------------------------------------------------------
WITH retur AS (
  SELECT r.cabang_id, r.no_nota_asal, SUM(r.total_refund)::numeric AS refund
  FROM public.trx_retur_jual r
  GROUP BY r.cabang_id, r.no_nota_asal
),
reward_nota AS (
  SELECT lr.cabang_id, lr.no_nota, SUM(lr.reward_value)::numeric AS reward
  FROM public.loyalty_redemptions lr
  GROUP BY lr.cabang_id, lr.no_nota
),
kupon_nota AS (
  SELECT pr.cabang_id, pr.invoice_no AS no_nota, SUM(pr.discount_amount)::numeric AS kupon
  FROM public.promo_redemptions pr
  GROUP BY pr.cabang_id, pr.invoice_no
)
SELECT
  p.tanggal,
  p.jam,
  p.shift,
  p.cabang_id,
  p.no_nota,
  p.tipe_customer,
  p.petugas_transaksi,
  p.subtotal,
  COALESCE(p.diskon, 0)                                      AS diskon_nota,
  COALESCE(rw.reward, 0)                                     AS dari_reward,
  COALESCE(kp.kupon, 0)                                      AS dari_kupon,
  p.harga_akhir,
  p.total_hpp,
  (p.harga_akhir - COALESCE(p.total_hpp, 0))                 AS laba_kotor,
  COALESCE(rt.refund, 0)                                     AS refund_retur,
  CASE
    WHEN p.total_hpp IS NULL                                   THEN 'HPP kosong - laba tidak bisa dinilai'
    WHEN COALESCE(rt.refund, 0) >= p.harga_akhir               THEN 'Sudah diretur penuh'
    WHEN COALESCE(rw.reward, 0) + COALESCE(kp.kupon, 0) > 0     THEN 'Potongan reward/kupon melebihi margin'
    WHEN COALESCE(p.diskon, 0) > 0                             THEN 'Diskon kasir melebihi margin'
    ELSE 'Harga jual di bawah modal'
  END                                                        AS dugaan_sebab
FROM public.trx_penjualan p
LEFT JOIN retur rt       ON rt.cabang_id = p.cabang_id AND rt.no_nota_asal = p.no_nota
LEFT JOIN reward_nota rw ON rw.cabang_id = p.cabang_id AND rw.no_nota = p.no_nota
LEFT JOIN kupon_nota kp  ON kp.cabang_id = p.cabang_id AND kp.no_nota = p.no_nota
WHERE COALESCE(p.total_hpp, 0) > p.harga_akhir
ORDER BY laba_kotor ASC, p.tanggal DESC, p.no_nota
LIMIT 200;

-- -----------------------------------------------------------------------------
-- 2. Seberapa sering dan seberapa besar, per bulan per cabang.
-- -----------------------------------------------------------------------------
SELECT
  date_trunc('month', p.tanggal)::date                        AS bulan,
  p.cabang_id,
  COUNT(*)                                                    AS nota_total,
  COUNT(*) FILTER (WHERE COALESCE(p.total_hpp, 0) > p.harga_akhir) AS nota_minus,
  ROUND(100.0 * COUNT(*) FILTER (WHERE COALESCE(p.total_hpp, 0) > p.harga_akhir)
        / NULLIF(COUNT(*), 0), 2)                             AS persen_nota_minus,
  COALESCE(SUM(CASE WHEN COALESCE(p.total_hpp, 0) > p.harga_akhir
                    THEN p.harga_akhir - p.total_hpp END), 0) AS total_minus_idr,
  COUNT(*) FILTER (WHERE p.total_hpp IS NULL)                 AS nota_tanpa_hpp
FROM public.trx_penjualan p
GROUP BY 1, 2
ORDER BY 1 DESC, 2;

-- -----------------------------------------------------------------------------
-- 3. Pola per tipe pelanggan (Umum / Tenaga Kesehatan / Apotek Lain).
--    Harga Tenaga Kesehatan memakai harga_khusus dan Apotek Lain memakai
--    harga_jual_mutasi, jadi dua tipe ini yang paling sering di bawah modal.
-- -----------------------------------------------------------------------------
SELECT
  p.tipe_customer,
  COUNT(*)                                                    AS nota,
  COUNT(*) FILTER (WHERE COALESCE(p.total_hpp, 0) > p.harga_akhir) AS nota_minus,
  COALESCE(SUM(CASE WHEN COALESCE(p.total_hpp, 0) > p.harga_akhir
                    THEN p.harga_akhir - p.total_hpp END), 0) AS total_minus_idr,
  ROUND(100.0 * SUM(p.harga_akhir - COALESCE(p.total_hpp, 0))
        / NULLIF(SUM(p.harga_akhir), 0), 2)                   AS margin_kotor_persen
FROM public.trx_penjualan p
WHERE p.total_hpp IS NOT NULL
GROUP BY 1
ORDER BY total_minus_idr ASC;

-- -----------------------------------------------------------------------------
-- 4. Baris nota yang dijual di bawah modal (penyebab di tingkat barang/batch).
--    Berguna kalau minusnya hanya pada batch lama ber-modal tinggi.
-- -----------------------------------------------------------------------------
SELECT
  d.cabang_id,
  d.tanggal,
  d.kode_obat,
  d.nama_obat,
  d.kode_batch,
  d.qty,
  d.harga_satuan,
  d.harga_modal,
  (d.harga_satuan - COALESCE(d.harga_modal, 0))               AS selisih_per_unit,
  d.subtotal,
  (d.subtotal - COALESCE(d.harga_modal, 0) * d.qty)           AS laba_kotor_baris
FROM public.trx_penjualan_detail d
WHERE COALESCE(d.harga_modal, 0) > d.harga_satuan
ORDER BY laba_kotor_baris ASC, d.tanggal DESC
LIMIT 200;

-- -----------------------------------------------------------------------------
-- 5. Nota tanpa HPP (kualitas data). Nota ini dihitung omzetnya tetapi HPP-nya
--    dianggap 0, sehingga laba terlihat lebih besar dari kenyataan.
-- -----------------------------------------------------------------------------
SELECT
  date_trunc('month', p.tanggal)::date                        AS bulan,
  p.cabang_id,
  COUNT(*)                                                    AS nota_tanpa_hpp,
  SUM(p.harga_akhir)                                          AS omzet
FROM public.trx_penjualan p
WHERE p.total_hpp IS NULL
GROUP BY 1, 2
ORDER BY 1 DESC, 2;

-- -----------------------------------------------------------------------------
-- 6. Penyebab struktural: harga master sudah di bawah modal, jadi nota minus
--    terjadi tanpa perlu diskon sama sekali. Perbaiki harga master di sini lebih
--    dulu sebelum mengejar diskon kasir.
-- -----------------------------------------------------------------------------
SELECT
  b.cabang_id,
  b.kode_obat,
  b.nama_obat,
  b.harga_modal,
  b.harga_jual_umum,
  b.harga_khusus,
  b.harga_jual_mutasi,
  (b.harga_jual_umum - COALESCE(b.harga_modal, 0))            AS margin_umum,
  (COALESCE(NULLIF(b.harga_khusus, 0), b.harga_jual_umum)
    - COALESCE(b.harga_modal, 0))                             AS margin_khusus,
  (COALESCE(NULLIF(b.harga_jual_mutasi, 0), b.harga_jual_umum)
    - COALESCE(b.harga_modal, 0))                             AS margin_mutasi
FROM public.master_barang b
WHERE b.aktif = 'YA'
  AND (
        b.harga_jual_umum < COALESCE(b.harga_modal, 0)
     OR COALESCE(NULLIF(b.harga_khusus, 0), b.harga_jual_umum) < COALESCE(b.harga_modal, 0)
     OR COALESCE(NULLIF(b.harga_jual_mutasi, 0), b.harga_jual_umum) < COALESCE(b.harga_modal, 0)
  )
ORDER BY margin_umum ASC, b.cabang_id, b.kode_obat;
