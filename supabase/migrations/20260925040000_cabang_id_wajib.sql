-- =============================================================================
-- SI-FaMitra — Migrasi 4/6 : cabang_id wajib, nomor nota terkunci, nomor faktur PBF
-- Rencana: docs/rencana-isolasi-cabang.md bagian 4.2, 4.3, 4.6 (file 4),
--          5.2 poin 5, 10.2 A
-- Keputusan pemilik project: 4 (nomor faktur pembelian berprefix cabang, PK
-- (no_faktur) tetap global), 10.2 A (kolom no_faktur_supplier + unique index parsial)
--
-- Isi file:
--   a. hapus DEFAULT 'KARLA' di 14 kolom cabang_id (bagian 4.3). Setelah ini,
--      INSERT yang lupa mengisi cabang_id GAGAL (melanggar NOT NULL) — bukan
--      diam-diam mendarat di KARLA.
--   b. unique index (cabang_id, tanggal, no_nota) pada trx_penjualan.
--   c. kolom trx_pembelian.no_faktur_supplier + unique index parsial
--      (cabang_id, supplier, no_faktur_supplier) WHERE no_faktur_supplier IS NOT NULL.
--
-- URUTAN: file ini masih kompatibel dengan kode LAMA (kode lama mengirim cabang_id
-- di hampir semua jalur tulis), TETAPI dua jalur tulis kode lama tidak mengirim
-- cabang_id: `retur.jualSimpan` dan `retur.beliSimpan` (temuan 4 & 6). Karena itu
-- hapus default (bagian a) baru boleh dijalankan SETELAH Edge Function `api` versi
-- baru di-deploy — persis urutan bagian 9.4 langkah 2 dan 4 dokumen.
--
-- TIDAK ada DROP TABLE / TRUNCATE / DELETE di file ini.
--
-- PLACEHOLDER — menunggu data pemilik project:
--   * bagian 0 memeriksa apakah ada baris cabang_id NULL di 14 tabel itu.
--     Saat ini kolomnya NOT NULL, jadi jawabannya pasti 0; pemeriksaan ini
--     disimpan sebagai bukti sebelum default dihapus (bagian 9 Tahap 0).
--   * jumlah baris trx_pembelian (untuk memperkirakan berapa baris lama yang
--     no_faktur_supplier-nya NULL) belum diketahui — tidak menghalangi migrasi,
--     hanya memengaruhi cakupan perlindungan unique index parsial (bagian 5.2).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. PEMERIKSAAN AWAL — semua angka harus 0
-- -----------------------------------------------------------------------------
SELECT 'app_sessions' AS tabel, count(*) AS cabang_id_null FROM public.app_sessions WHERE cabang_id IS NULL
UNION ALL SELECT 'app_users', count(*) FROM public.app_users WHERE cabang_id IS NULL
UNION ALL SELECT 'biaya_operasional', count(*) FROM public.biaya_operasional WHERE cabang_id IS NULL
UNION ALL SELECT 'master_customer', count(*) FROM public.master_customer WHERE cabang_id IS NULL
UNION ALL SELECT 'stok_batch', count(*) FROM public.stok_batch WHERE cabang_id IS NULL
UNION ALL SELECT 'stok_opname', count(*) FROM public.stok_opname WHERE cabang_id IS NULL
UNION ALL SELECT 'trx_pembelian', count(*) FROM public.trx_pembelian WHERE cabang_id IS NULL
UNION ALL SELECT 'trx_pembelian_detail', count(*) FROM public.trx_pembelian_detail WHERE cabang_id IS NULL
UNION ALL SELECT 'trx_penjualan', count(*) FROM public.trx_penjualan WHERE cabang_id IS NULL
UNION ALL SELECT 'trx_penjualan_detail', count(*) FROM public.trx_penjualan_detail WHERE cabang_id IS NULL
UNION ALL SELECT 'trx_retur_beli', count(*) FROM public.trx_retur_beli WHERE cabang_id IS NULL
UNION ALL SELECT 'trx_retur_beli_detail', count(*) FROM public.trx_retur_beli_detail WHERE cabang_id IS NULL
UNION ALL SELECT 'trx_retur_jual', count(*) FROM public.trx_retur_jual WHERE cabang_id IS NULL
UNION ALL SELECT 'trx_retur_jual_detail', count(*) FROM public.trx_retur_jual_detail WHERE cabang_id IS NULL
ORDER BY 1;

-- -----------------------------------------------------------------------------
-- 1. Hapus DEFAULT 'KARLA' di 14 kolom (bagian 4.3)
--    11 tabel lain (loyalty_*, notification_log, promo_*, referrals,
--    refill_programs, trx_pembayaran_hutang) sudah NOT NULL tanpa default —
--    itu pola yang benar dan tidak disentuh.
-- -----------------------------------------------------------------------------
ALTER TABLE public.app_sessions           ALTER COLUMN cabang_id DROP DEFAULT;
ALTER TABLE public.app_users              ALTER COLUMN cabang_id DROP DEFAULT;
ALTER TABLE public.biaya_operasional      ALTER COLUMN cabang_id DROP DEFAULT;
ALTER TABLE public.master_customer        ALTER COLUMN cabang_id DROP DEFAULT;
ALTER TABLE public.stok_batch             ALTER COLUMN cabang_id DROP DEFAULT;
ALTER TABLE public.stok_opname            ALTER COLUMN cabang_id DROP DEFAULT;
ALTER TABLE public.trx_pembelian          ALTER COLUMN cabang_id DROP DEFAULT;
ALTER TABLE public.trx_pembelian_detail   ALTER COLUMN cabang_id DROP DEFAULT;
ALTER TABLE public.trx_penjualan          ALTER COLUMN cabang_id DROP DEFAULT;
ALTER TABLE public.trx_penjualan_detail   ALTER COLUMN cabang_id DROP DEFAULT;
ALTER TABLE public.trx_retur_beli         ALTER COLUMN cabang_id DROP DEFAULT;
ALTER TABLE public.trx_retur_beli_detail  ALTER COLUMN cabang_id DROP DEFAULT;
ALTER TABLE public.trx_retur_jual         ALTER COLUMN cabang_id DROP DEFAULT;
ALTER TABLE public.trx_retur_jual_detail  ALTER COLUMN cabang_id DROP DEFAULT;

-- -----------------------------------------------------------------------------
-- 2. Pengaman keunikan nomor nota per cabang (bagian 4.2)
--    Hari ini keunikan nomor per cabang bergantung sepenuhnya pada format string
--    di pos_checkout; tidak ada index yang mencegah dua baris KENDAL bernomor sama.
--    Catatan jujur: selama PK trx_penjualan tetap (no_nota) global, index ini
--    tidak mungkin dilanggar (no_nota sudah unik sendirinya). Fungsinya adalah
--    mendokumentasikan maksud per cabang dan menjadi pengaman yang benar-benar
--    bekerja kalau suatu saat PK dokumen dijadikan komposit.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS trx_penjualan_cabang_tanggal_nota_key
  ON public.trx_penjualan (cabang_id, tanggal, no_nota);

-- -----------------------------------------------------------------------------
-- 3. Nomor faktur PBF (keputusan 4 + 10.2 A)
--    no_faktur           (sistem)  FK-<CABANG>-<YYYYMMDD>-####  -> dibuat fungsi
--    no_faktur_supplier  (diketik) nomor asli dari PBF, boleh kosong
--    Data lama dibiarkan NULL (tidak dimigrasi).
-- -----------------------------------------------------------------------------
ALTER TABLE public.trx_pembelian
  ADD COLUMN IF NOT EXISTS no_faktur_supplier text;

CREATE UNIQUE INDEX IF NOT EXISTS trx_pembelian_faktur_supplier_unik
  ON public.trx_pembelian (cabang_id, supplier, no_faktur_supplier)
  WHERE no_faktur_supplier IS NOT NULL;

-- Dua batas jujur index ini (bagian 5.2 & 10.2 A), jangan dianggap jaminan mutlak:
--   1. `supplier` menyimpan NAMA, bukan kode (keputusan 10.2 B). Kalau nama
--      supplier diubah di master, faktur lama tetap memakai nama lama dan index
--      ini tidak lagi mengenalinya sebagai duplikat.
--   2. Baris lama bernilai NULL dan `WHERE ... IS NOT NULL` membuatnya tidak
--      diperiksa — faktur lama tidak mendapat perlindungan ini.

-- -----------------------------------------------------------------------------
-- 4. VERIFIKASI
-- -----------------------------------------------------------------------------
-- 4a. Tidak ada lagi default 'KARLA' (harus 0 baris):
SELECT table_name, column_name, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'cabang_id'
  AND column_default IS NOT NULL
ORDER BY 1;

-- 4b. Kolom & index baru:
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'trx_pembelian'
  AND column_name IN ('no_faktur', 'no_faktur_supplier');

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('trx_penjualan_cabang_tanggal_nota_key',
                    'trx_pembelian_faktur_supplier_unik')
ORDER BY 1;

COMMIT;

-- =============================================================================
-- ROLLBACK (komentar — jalankan manual, hanya bila migrasi ini harus dibatalkan)
-- =============================================================================
-- BEGIN;
--   -- a. kembalikan default 'KARLA' (bagian 9.4 langkah 8)
--   ALTER TABLE public.app_sessions           ALTER COLUMN cabang_id SET DEFAULT 'KARLA';
--   ALTER TABLE public.app_users              ALTER COLUMN cabang_id SET DEFAULT 'KARLA';
--   ALTER TABLE public.biaya_operasional      ALTER COLUMN cabang_id SET DEFAULT 'KARLA';
--   ALTER TABLE public.master_customer        ALTER COLUMN cabang_id SET DEFAULT 'KARLA';
--   ALTER TABLE public.stok_batch             ALTER COLUMN cabang_id SET DEFAULT 'KARLA';
--   ALTER TABLE public.stok_opname            ALTER COLUMN cabang_id SET DEFAULT 'KARLA';
--   ALTER TABLE public.trx_pembelian          ALTER COLUMN cabang_id SET DEFAULT 'KARLA';
--   ALTER TABLE public.trx_pembelian_detail   ALTER COLUMN cabang_id SET DEFAULT 'KARLA';
--   ALTER TABLE public.trx_penjualan          ALTER COLUMN cabang_id SET DEFAULT 'KARLA';
--   ALTER TABLE public.trx_penjualan_detail   ALTER COLUMN cabang_id SET DEFAULT 'KARLA';
--   ALTER TABLE public.trx_retur_beli         ALTER COLUMN cabang_id SET DEFAULT 'KARLA';
--   ALTER TABLE public.trx_retur_beli_detail  ALTER COLUMN cabang_id SET DEFAULT 'KARLA';
--   ALTER TABLE public.trx_retur_jual         ALTER COLUMN cabang_id SET DEFAULT 'KARLA';
--   ALTER TABLE public.trx_retur_jual_detail  ALTER COLUMN cabang_id SET DEFAULT 'KARLA';
--
--   -- b. index
--   DROP INDEX IF EXISTS public.trx_penjualan_cabang_tanggal_nota_key;
--   DROP INDEX IF EXISTS public.trx_pembelian_faktur_supplier_unik;
--
--   -- c. kolom nomor faktur PBF (PERHATIAN: nomor PBF yang sudah diisi hilang)
--   ALTER TABLE public.trx_pembelian DROP COLUMN IF EXISTS no_faktur_supplier;
-- COMMIT;
--
-- Peringatan: rollback (c) membuang nomor faktur PBF yang sudah tersimpan dan
-- tidak bisa dikembalikan kecuali dari backup penuh. Sebelum menjalankannya,
-- ekspor dulu: select no_faktur, no_faktur_supplier from public.trx_pembelian
-- where no_faktur_supplier is not null;
-- =============================================================================
