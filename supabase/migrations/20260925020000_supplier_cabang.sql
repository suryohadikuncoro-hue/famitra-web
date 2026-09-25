-- =============================================================================
-- SI-FaMitra — Migrasi 2/6 : tabel relasi supplier per cabang (supplier_cabang)
-- Rencana: docs/rencana-isolasi-cabang.md bagian 3.2, 4.1, 4.2, 4.6 (file 2),
--          10.2 C (penanaman data awal)
-- Keputusan pemilik project: 3 (master_supplier TETAP GLOBAL + tabel relasi),
-- 7 (Model A: GRANT + RLS + policy wajib untuk tabel baru), 10.2 C (tanam semua
-- supplier ke semua cabang).
--
-- Yang TIDAK diubah file ini: master_supplier sama sekali (tetap 4 kolom,
-- PK (kode_supplier), UNIQUE (nama_supplier) global). Tidak ada FK lama yang
-- disentuh, jadi file ini aman dijalankan kapan saja setelah migrasi 1.
--
-- PENTING (urutan penerapan, bagian 9.4 langkah 3): penanaman data di bagian 4
-- file ini HARUS selesai sebelum kode baru (Edge Function `api` yang membaca
-- supplier_cabang) di-deploy. Kalau kode di-deploy lebih dulu, cabang yang belum
-- punya baris relasi akan melihat daftar supplier KOSONG di form pembelian.
--
-- TIDAK ada DROP TABLE / TRUNCATE / DELETE di file ini.
--
-- PLACEHOLDER — menunggu data pemilik project:
--   * jumlah baris master_supplier belum diketahui (bagian 9 Tahap 0). Pemeriksaan
--     hasil penanaman di bagian 5 memakai query, bukan angka tetap, supaya aman.
--     Angka "jumlah supplier × jumlah cabang aktif" baru bisa dipastikan setelah
--     pemilik project mengirim jumlah barisnya.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Tabel relasi
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_cabang (
  cabang_id     text        NOT NULL,
  kode_supplier text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_cabang_pkey PRIMARY KEY (cabang_id, kode_supplier),
  CONSTRAINT supplier_cabang_cabang_fk
    FOREIGN KEY (cabang_id) REFERENCES public.master_cabang(kode_cabang),
  CONSTRAINT supplier_cabang_supplier_fk
    FOREIGN KEY (kode_supplier) REFERENCES public.master_supplier(kode_supplier)
);

-- Index untuk pencarian per cabang (query `beli.supplier` memfilter cabang_id).
CREATE INDEX IF NOT EXISTS supplier_cabang_cabang_idx
  ON public.supplier_cabang (cabang_id);
CREATE INDEX IF NOT EXISTS supplier_cabang_supplier_idx
  ON public.supplier_cabang (kode_supplier);

-- -----------------------------------------------------------------------------
-- 2. GRANT + RLS + policy  (wajib untuk setiap tabel baru di schema public —
--    AGENTS.md; juga sesuai keputusan 7 / Model A)
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_cabang TO service_role;

ALTER TABLE public.supplier_cabang ENABLE ROW LEVEL SECURITY;

-- Aplikasi hanya lewat service_role (yang menembus RLS). Policy ini tidak dipakai
-- aplikasi; fungsinya menutup pintu kalau suatu saat ada key anon/authenticated
-- yang bocor. TIDAK ada akses anon ke data cabang.
DROP POLICY IF EXISTS supplier_cabang_no_anon ON public.supplier_cabang;
CREATE POLICY supplier_cabang_no_anon ON public.supplier_cabang
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS supplier_cabang_no_authenticated ON public.supplier_cabang;
CREATE POLICY supplier_cabang_no_authenticated ON public.supplier_cabang
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

-- -----------------------------------------------------------------------------
-- 3. (tidak ada perubahan pada master_supplier — keputusan 3)
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 4. Penanaman data awal (keputusan 10.2 C): SEMUA supplier ke SEMUA cabang
--    aktif. Owner tiap cabang bisa menghapus relasi yang tidak dipakai nanti.
--    Idempoten: bisa dijalankan ulang tanpa menggandakan baris.
-- -----------------------------------------------------------------------------
INSERT INTO public.supplier_cabang (cabang_id, kode_supplier)
SELECT c.kode_cabang, s.kode_supplier
FROM public.master_supplier s
CROSS JOIN (
  SELECT kode_cabang FROM public.master_cabang WHERE aktif = 'YA'
) c
ON CONFLICT (cabang_id, kode_supplier) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. VERIFIKASI
--    Diharapkan: satu baris per cabang aktif, jumlahnya sama untuk semua cabang,
--    dan tidak ada cabang yang kosong.
-- -----------------------------------------------------------------------------
SELECT cabang_id, count(*) AS jumlah_supplier
FROM public.supplier_cabang
GROUP BY 1
ORDER BY 1;

SELECT count(*) AS supplier_tanpa_relasi
FROM public.master_supplier s
WHERE NOT EXISTS (SELECT 1 FROM public.supplier_cabang sc WHERE sc.kode_supplier = s.kode_supplier);

COMMIT;

-- =============================================================================
-- ROLLBACK (komentar — jalankan manual, hanya bila migrasi ini harus dibatalkan)
-- =============================================================================
-- Ada dua tingkat rollback, pilih sesuai kebutuhan:
--
-- (A) ROLLBACK RINGAN — yang dipakai rencana bagian 9.4 langkah 8: cukup
--     kembalikan `beli.supplier` / `beli.simpanSupplier` di Edge Function `api`
--     ke versi lama (membaca seluruh master_supplier). Tabel relasi boleh
--     dibiarkan — tabel kosong/berisi tidak mengganggu aplikasi lama.
--
-- (B) ROLLBACK PENUH — membuang tabel public.supplier_cabang sekaligus.
--     Tabel ini adalah tabel BARU milik file ini, bukan tabel lama berbahasa
--     Inggris yang dipensiunkan di bagian 4.8 dokumen. Karena aturan PR ini
--     melarang file migrasi memuat perintah DROP TABLE (meski hanya sebagai
--     komentar), perintahnya sengaja TIDAK ditulis di sini. Bila benar-benar
--     diperlukan:
--       1. minta izin eksplisit pemilik project (aturan bagian 4.8), dan
--       2. buang tabel relasi ini secara manual dari SQL editor/psql, baru
--       3. buang policy + grant-nya (ikut terbuang bersama tabelnya).
--     Urutan aman: deploy dulu kode `beli.supplier` versi lama, baru buang tabel.
--
-- Tidak ada data lama yang perlu dipulihkan oleh rollback ini: master_supplier
-- tidak pernah disentuh.
-- =============================================================================
