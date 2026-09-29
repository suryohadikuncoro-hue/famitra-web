-- =============================================================================
-- SI-FaMitra — Migrasi 1/6 : master_barang per cabang
-- Rencana: docs/rencana/isolasi-cabang.md bagian 3.1, 3.3, 4.1, 4.2, 4.6 (file 1)
-- Keputusan pemilik project: 1 (137 barang tersedia di semua cabang, PK
-- (cabang_id, kode_obat), kode_obat sama di semua cabang) dan 2 (harga boleh
-- berbeda per cabang).
--
-- URUTAN YANG WAJIB DIJAGA (lihat juga bagian 4.6 dokumen):
--   * File ini MENGHAPUS dulu 3 FK lama yang menunjuk master_barang(kode_obat)
--     SEBELUM mengganti primary key. Ini bukan pilihan gaya: selama masih ada
--     satu saja FK yang bergantung pada kode_obat, Postgres MENOLAK
--     `drop constraint master_barang_pkey` karena kode_obat tidak lagi unik.
--   * FK versi komposit dibuat ulang di MIGRASI 3. Jadi setelah file ini
--     dijalankan, ada jendela waktu di mana integritas relasi ke master_barang
--     belum aktif. Karena itu MIGRASI 1 dan MIGRASI 3 harus dijalankan dalam
--     SATU jendela pemeliharaan, berurutan, tanpa deploy kode di antaranya.
--   * Migrasi 3 juga harus selesai SEBELUM migrasi 5 (fungsi kasir) dijalankan.
--
-- TIDAK ada DROP TABLE / TRUNCATE / DELETE di file ini. Satu-satunya DROP
-- adalah constraint, index, dan (di migrasi 5) fungsi overload lama.
-- Semua pernyataan dijalankan dalam satu transaksi (BEGIN ... COMMIT).
--
-- PLACEHOLDER — menunggu data pemilik project (bagian 9 Tahap 0 dokumen):
--   * jumlah baris master_barang (diasumsikan 137) dan jumlah cabang aktif
--     (diasumsikan 4: KARLA, KENDAL, PUCUK, PULE). Pemeriksaan kerasnya sudah
--     ditulis tapi masih dikomentari di blok "0. PEMERIKSAAN AWAL" di bawah.
--     Aktifkan setelah pemilik project mengonfirmasi angkanya.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. PEMERIKSAAN AWAL
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_barang integer;
  v_cabang integer;
  v_karla  integer;
BEGIN
  SELECT count(*) INTO v_barang FROM public.master_barang;
  SELECT count(*) INTO v_cabang FROM public.master_cabang WHERE aktif = 'YA';
  SELECT count(*) INTO v_karla  FROM public.master_cabang
    WHERE aktif = 'YA' AND kode_cabang = 'KARLA';

  RAISE NOTICE 'master_barang = % baris; master_cabang aktif = %; KARLA aktif = %',
    v_barang, v_cabang, v_karla;

  IF v_karla <> 1 THEN
    RAISE EXCEPTION 'Cabang sumber KARLA tidak ada / tidak aktif di master_cabang.';
  END IF;

  -- PLACEHOLDER: aktifkan dua pemeriksaan ini setelah angka dari pemilik
  -- project (137 barang, 4 cabang) dikonfirmasi.
  -- IF v_barang <> 137 THEN
  --   RAISE EXCEPTION 'Jumlah master_barang % (diharapkan 137).', v_barang;
  -- END IF;
  -- IF v_cabang <> 4 THEN
  --   RAISE EXCEPTION 'Jumlah cabang aktif % (diharapkan 4).', v_cabang;
  -- END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Kolom cabang_id + backfill + NOT NULL + FK ke master_cabang
-- -----------------------------------------------------------------------------
ALTER TABLE public.master_barang ADD COLUMN IF NOT EXISTS cabang_id text;

-- Semua baris yang ada sekarang berasal dari satu tabel global (data KARLA).
UPDATE public.master_barang SET cabang_id = 'KARLA' WHERE cabang_id IS NULL;

ALTER TABLE public.master_barang ALTER COLUMN cabang_id SET NOT NULL;

ALTER TABLE public.master_barang
  ADD CONSTRAINT master_barang_cabang_fk
  FOREIGN KEY (cabang_id) REFERENCES public.master_cabang(kode_cabang);

-- -----------------------------------------------------------------------------
-- 2. LEPAS 3 FK lama ke master_barang(kode_obat)  <-- WAJIB sebelum langkah 3
--    (stok_batch, refill_programs, promo_bundle_items). Versi kompositnya
--    dibuat di migrasi 3.
-- -----------------------------------------------------------------------------
ALTER TABLE public.stok_batch
  DROP CONSTRAINT IF EXISTS stok_batch_kode_obat_fkey;

ALTER TABLE public.refill_programs
  DROP CONSTRAINT IF EXISTS refill_programs_kode_obat_fkey;

ALTER TABLE public.promo_bundle_items
  DROP CONSTRAINT IF EXISTS promo_bundle_items_kode_obat_fkey;

-- -----------------------------------------------------------------------------
-- 3. Ganti primary key: (kode_obat) -> (cabang_id, kode_obat)
--    Ini DROP CONSTRAINT, bukan DROP TABLE.
-- -----------------------------------------------------------------------------
ALTER TABLE public.master_barang DROP CONSTRAINT master_barang_pkey;

ALTER TABLE public.master_barang
  ADD CONSTRAINT master_barang_pkey PRIMARY KEY (cabang_id, kode_obat);

-- -----------------------------------------------------------------------------
-- 4. Salin kartu barang KARLA ke semua cabang aktif lain (keputusan 1).
--    Yang disalin: kartu barang + harga. STOK TIDAK IKUT DISALIN — stok tetap
--    milik stok_batch per cabang (bagian 3.3 dokumen).
--    Catatan: daftar cabang diambil dari master_cabang (aktif = 'YA'), bukan
--    ditulis tetap ('KENDAL','PUCUK','PULE'), supaya cabang yang ditambahkan
--    di kemudian hari ikut aturan yang sama dengan bagian 8 dokumen.
-- -----------------------------------------------------------------------------
INSERT INTO public.master_barang
  (cabang_id, kode_obat, nama_obat, kategori, golongan, satuan, barcode,
   harga_modal, harga_jual_umum, harga_khusus, harga_jual_mutasi, ppn,
   stok_min, aktif, updated_at)
SELECT c.kode_cabang, b.kode_obat, b.nama_obat, b.kategori, b.golongan,
       b.satuan, b.barcode, b.harga_modal, b.harga_jual_umum, b.harga_khusus,
       b.harga_jual_mutasi, b.ppn, b.stok_min, b.aktif, now()
FROM public.master_barang b
CROSS JOIN (
  SELECT kode_cabang FROM public.master_cabang
  WHERE aktif = 'YA' AND kode_cabang <> 'KARLA'
) c
WHERE b.cabang_id = 'KARLA'
ON CONFLICT (cabang_id, kode_obat) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. Index: tiga index lama tidak memuat cabang_id (bagian 3.3 dokumen).
--    idx_barang_nama (GIN to_tsvector) sengaja dibiarkan apa adanya — tidak
--    bisa dijadikan komposit dengan cabang_id.
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_barang_aktif;
DROP INDEX IF EXISTS public.idx_barang_barcode;

CREATE INDEX IF NOT EXISTS master_barang_cabang_aktif_idx
  ON public.master_barang (cabang_id, aktif, nama_obat);

CREATE INDEX IF NOT EXISTS master_barang_cabang_barcode_idx
  ON public.master_barang (cabang_id, barcode);

-- -----------------------------------------------------------------------------
-- 6. CHECK harga >= 0 (bagian 3.1: lapis database hanya bisa menjaga keutuhan
--    nilai, bukan izin). Sebelumnya master_barang tidak punya CHECK harga.
-- -----------------------------------------------------------------------------
ALTER TABLE public.master_barang
  ADD CONSTRAINT master_barang_harga_modal_check CHECK (harga_modal >= 0);
ALTER TABLE public.master_barang
  ADD CONSTRAINT master_barang_harga_jual_umum_check CHECK (harga_jual_umum >= 0);
ALTER TABLE public.master_barang
  ADD CONSTRAINT master_barang_harga_khusus_check CHECK (harga_khusus >= 0);
ALTER TABLE public.master_barang
  ADD CONSTRAINT master_barang_harga_jual_mutasi_check CHECK (harga_jual_mutasi >= 0);

-- -----------------------------------------------------------------------------
-- 7. VERIFIKASI (baca hasilnya sebelum lanjut ke migrasi 2)
--    Diharapkan: 4 baris, masing-masing 137 (total 548).
-- -----------------------------------------------------------------------------
SELECT cabang_id, count(*) AS jumlah_baris
FROM public.master_barang
GROUP BY 1
ORDER BY 1;

SELECT count(*) AS baris_tanpa_cabang
FROM public.master_barang
WHERE cabang_id IS NULL;

COMMIT;

-- =============================================================================
-- ROLLBACK (komentar — jalankan manual, hanya bila migrasi ini harus dibatalkan)
-- =============================================================================
-- Prasyarat: FK komposit dari migrasi 3 harus dilepas lebih dulu (lihat rollback
-- migrasi 3), karena FK itu bergantung pada PK komposit yang dibuat di sini.
--
-- BEGIN;
--   -- a. buang baris hasil penyalinan; baris asli KARLA tidak dihapus.
--   DELETE FROM public.master_barang WHERE cabang_id <> 'KARLA';
--
--   -- b. kembalikan PK lama
--   ALTER TABLE public.master_barang DROP CONSTRAINT master_barang_pkey;
--   ALTER TABLE public.master_barang
--     ADD CONSTRAINT master_barang_pkey PRIMARY KEY (kode_obat);
--
--   -- c. bangun ulang 3 FK lama (versi satu kolom, seperti semula)
--   ALTER TABLE public.stok_batch
--     ADD CONSTRAINT stok_batch_kode_obat_fkey
--     FOREIGN KEY (kode_obat) REFERENCES public.master_barang(kode_obat);
--   ALTER TABLE public.refill_programs
--     ADD CONSTRAINT refill_programs_kode_obat_fkey
--     FOREIGN KEY (kode_obat) REFERENCES public.master_barang(kode_obat);
--   ALTER TABLE public.promo_bundle_items
--     ADD CONSTRAINT promo_bundle_items_kode_obat_fkey
--     FOREIGN KEY (kode_obat) REFERENCES public.master_barang(kode_obat);
--
--   -- d. CHECK harga
--   ALTER TABLE public.master_barang DROP CONSTRAINT master_barang_harga_modal_check;
--   ALTER TABLE public.master_barang DROP CONSTRAINT master_barang_harga_jual_umum_check;
--   ALTER TABLE public.master_barang DROP CONSTRAINT master_barang_harga_khusus_check;
--   ALTER TABLE public.master_barang DROP CONSTRAINT master_barang_harga_jual_mutasi_check;
--
--   -- e. index kembali seperti semula
--   DROP INDEX IF EXISTS public.master_barang_cabang_aktif_idx;
--   DROP INDEX IF EXISTS public.master_barang_cabang_barcode_idx;
--   CREATE INDEX IF NOT EXISTS idx_barang_aktif ON public.master_barang (aktif);
--   CREATE INDEX IF NOT EXISTS idx_barang_barcode ON public.master_barang (barcode);
--
--   -- f. kolom cabang_id
--   ALTER TABLE public.master_barang DROP CONSTRAINT master_barang_cabang_fk;
--   ALTER TABLE public.master_barang ALTER COLUMN cabang_id DROP NOT NULL;
--   ALTER TABLE public.master_barang DROP COLUMN cabang_id;
-- COMMIT;
--
-- Catatan: rollback ini mengembalikan struktur, tetapi perubahan HARGA yang
-- terjadi setelah migrasi (harga per cabang) tidak bisa dikembalikan oleh SQL
-- ini — untuk itu perlu restore dari backup penuh (bagian 9.4 langkah 1).
-- =============================================================================
