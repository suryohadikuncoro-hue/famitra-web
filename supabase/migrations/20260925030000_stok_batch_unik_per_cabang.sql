-- =============================================================================
-- SI-FaMitra — Migrasi 3/6 : stok & relasi barang jadi per cabang
-- Rencana: docs/rencana-isolasi-cabang.md bagian 4.1, 4.2, 4.7, 4.6 (file 3),
--          5.5 poin 3, 10.2 D (promo_bundle_items: kolom cabang_id WAJIB + trigger)
-- Keputusan pemilik project: 1, 3, 11/10.2 D.
--
-- Isi file:
--   a. stok_batch : UNIQUE (kode_obat, kode_batch) -> (cabang_id, kode_obat, kode_batch)
--                   + FK komposit ke master_barang + index FEFO memuat cabang_id
--   b. refill_programs : FK komposit ke master_barang
--   c. promo_bundle_items : kolom cabang_id + FK komposit + trigger kesamaan
--                   cabang + index sku_idx memuat cabang_id
--
-- URUTAN: file ini MEMBUAT ULANG FK yang dilepas di migrasi 1, jadi:
--   * migrasi 1 harus sudah dijalankan (PK master_barang sudah komposit), dan
--   * file ini harus selesai SEBELUM migrasi 5 (fungsi kasir). Kalau tidak,
--     `purchase_save` masih memakai UNIQUE (kode_obat, kode_batch) yang global
--     dan penerimaan barang dengan kode batch yang sama di cabang berbeda gagal.
--   * Jangan deploy kode baru di antara migrasi 1 dan 3 (jendela tanpa FK).
--
-- TIDAK ada DROP TABLE / TRUNCATE / DELETE di file ini.
--
-- PLACEHOLDER — menunggu data pemilik project:
--   * bagian 0 memeriksa jumlah baris promo_bundle_items yang akan GAGAL masuk
--     FK komposit (bundle yang cabangnya tidak punya barang itu di master_barang).
--     Pemeriksaan ini memakai query, bukan angka tetap, sehingga bisa dijalankan
--     sekarang; yang ditunggu hanya keputusan pemilik project bila hasilnya > 0.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. PEMERIKSAAN AWAL — semua harus 0 sebelum melanjutkan
-- -----------------------------------------------------------------------------

-- 0a. Ada baris promo_bundle_items yang cabangnya (dari promo_bundles) tidak
--     punya (cabang_id, kode_obat) di master_barang? Kalau ada, FK komposit di
--     langkah 3c akan GAGAL dan baris itu harus dibersihkan/dipindahkan dulu.
SELECT i.bundle_id, i.kode_obat, b.cabang_id
FROM public.promo_bundle_items i
JOIN public.promo_bundles b ON b.id = i.bundle_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.master_barang m
  WHERE m.cabang_id = b.cabang_id AND m.kode_obat = i.kode_obat
);

-- 0b. Ada baris stok_batch yang pasangan (cabang_id, kode_obat)-nya tidak ada di
--     master_barang? (harus 0; kalau > 0, FK komposit langkah 1b akan gagal)
SELECT s.cabang_id, s.kode_obat, count(*)
FROM public.stok_batch s
WHERE NOT EXISTS (
  SELECT 1 FROM public.master_barang m
  WHERE m.cabang_id = s.cabang_id AND m.kode_obat = s.kode_obat
)
GROUP BY 1, 2;

-- -----------------------------------------------------------------------------
-- 1. stok_batch
-- -----------------------------------------------------------------------------
-- 1a. Keunikan batch harus per cabang. Ini penghalang teknis paling keras untuk
--     isolasi stok (bagian 1.4): dua cabang wajar menerima nomor batch yang sama
--     dari PBF yang sama.
ALTER TABLE public.stok_batch
  DROP CONSTRAINT IF EXISTS stok_batch_kode_obat_kode_batch_key;

ALTER TABLE public.stok_batch
  ADD CONSTRAINT stok_batch_cabang_kode_obat_kode_batch_key
  UNIQUE (cabang_id, kode_obat, kode_batch);

-- 1b. FK komposit (versi lama dilepas di migrasi 1).
ALTER TABLE public.stok_batch
  ADD CONSTRAINT stok_batch_kode_obat_fkey
  FOREIGN KEY (cabang_id, kode_obat)
  REFERENCES public.master_barang (cabang_id, kode_obat);

-- 1c. Index FEFO (jalur panas pos_checkout) belum memuat cabang_id (bagian 4.7).
DROP INDEX IF EXISTS public.idx_batch_fefo;
CREATE INDEX IF NOT EXISTS idx_batch_fefo
  ON public.stok_batch (cabang_id, kode_obat, expired_date)
  WHERE stok_real > 0;

-- -----------------------------------------------------------------------------
-- 2. refill_programs — FK komposit
-- -----------------------------------------------------------------------------
ALTER TABLE public.refill_programs
  ADD CONSTRAINT refill_programs_kode_obat_fkey
  FOREIGN KEY (cabang_id, kode_obat)
  REFERENCES public.master_barang (cabang_id, kode_obat);

-- -----------------------------------------------------------------------------
-- 3. promo_bundle_items — kolom cabang_id + FK komposit + trigger
--    (keputusan 10.2 D: ini wajib, bukan pilihan. Tanpa cabang_id, FK ke
--    master_barang harus dibuang karena kode_obat tidak lagi unik sendiri.)
-- -----------------------------------------------------------------------------
-- 3a. kolom + backfill dari bundle induk
ALTER TABLE public.promo_bundle_items ADD COLUMN IF NOT EXISTS cabang_id text;

UPDATE public.promo_bundle_items i
SET cabang_id = b.cabang_id
FROM public.promo_bundles b
WHERE b.id = i.bundle_id
  AND i.cabang_id IS DISTINCT FROM b.cabang_id;

ALTER TABLE public.promo_bundle_items ALTER COLUMN cabang_id SET NOT NULL;

-- 3b. trigger BEFORE INSERT OR UPDATE: cabang_id SELALU diambil dari
--     promo_bundles.cabang_id induknya. Harus BEFORE supaya nilainya sudah benar
--     saat FK diperiksa. Trigger ini juga yang membuat bundle tidak bisa berisi
--     barang yang tidak dijual di cabang itu (validasi silang 5.5 poin 3).
CREATE OR REPLACE FUNCTION public.promo_bundle_items_set_cabang()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE v_cabang text;
BEGIN
  SELECT b.cabang_id INTO v_cabang
  FROM public.promo_bundles b
  WHERE b.id = NEW.bundle_id;

  IF v_cabang IS NULL THEN
    RAISE EXCEPTION 'Bundle % tidak ditemukan untuk item bundle ini.', NEW.bundle_id;
  END IF;

  NEW.cabang_id := v_cabang;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_promo_bundle_items_set_cabang ON public.promo_bundle_items;
CREATE TRIGGER trg_promo_bundle_items_set_cabang
  BEFORE INSERT OR UPDATE ON public.promo_bundle_items
  FOR EACH ROW
  EXECUTE FUNCTION public.promo_bundle_items_set_cabang();

-- 3c. FK komposit ke master_barang (versi lama dilepas di migrasi 1).
ALTER TABLE public.promo_bundle_items
  ADD CONSTRAINT promo_bundle_items_kode_obat_fkey
  FOREIGN KEY (cabang_id, kode_obat)
  REFERENCES public.master_barang (cabang_id, kode_obat);

-- 3d. index pencarian SKU ikut memuat cabang_id (bagian 4.2 poin 4)
DROP INDEX IF EXISTS public.promo_bundle_items_sku_idx;
CREATE INDEX IF NOT EXISTS promo_bundle_items_sku_idx
  ON public.promo_bundle_items (cabang_id, kode_obat);

-- PK promo_bundle_items (bundle_id, kode_obat) TIDAK diubah — bundle_id sudah
-- uuid unik, tidak perlu jadi komposit. GRANT/RLS tabel ini tidak diubah
-- (tabelnya sudah ada; migrasi 6 yang merapikan grant/RLS tabel aplikasi).

-- -----------------------------------------------------------------------------
-- 4. VERIFIKASI
-- -----------------------------------------------------------------------------
-- 4a. Bukti keunikan batch sudah per cabang (harus 2 baris, kode_batch sama):
-- INSERT INTO public.stok_batch (id_batch, kode_obat, kode_batch, expired_date,
--   stok_real, harga_modal_batch, cabang_id)
-- VALUES ('BT-UJI-KARLA', '<kode_obat_uji>', 'BATCH-UJI', current_date, 1, 1, 'KARLA'),
--        ('BT-UJI-KENDAL', '<kode_obat_uji>', 'BATCH-UJI', current_date, 1, 1, 'KENDAL');
-- (jalankan di lingkungan uji, di dalam transaksi yang di-rollback)

-- 4b. Semua FK ke master_barang harus komposit sekarang:
SELECT con.conname, pg_get_constraintdef(con.oid) AS definisi
FROM pg_constraint con
JOIN pg_class t ON t.oid = con.conrelid
WHERE con.contype = 'f'
  AND con.confrelid = 'public.master_barang'::regclass
ORDER BY 1;

-- 4c. Ringkasan unique index per cabang:
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('stok_batch', 'promo_bundle_items', 'refill_programs')
ORDER BY 1, 2;

COMMIT;

-- =============================================================================
-- ROLLBACK (komentar — jalankan manual, hanya bila migrasi ini harus dibatalkan)
-- =============================================================================
-- Urutan: kembalikan dulu ke bentuk sebelum isolasi, lalu (bila perlu) rollback
-- migrasi 1. Karena migrasi 1 TIDAK bisa di-rollback selama FK komposit masih
-- ada, rollback ini harus dijalankan lebih dulu.
--
-- BEGIN;
--   -- a. promo_bundle_items
--   DROP TRIGGER IF EXISTS trg_promo_bundle_items_set_cabang ON public.promo_bundle_items;
--   DROP FUNCTION IF EXISTS public.promo_bundle_items_set_cabang();
--   ALTER TABLE public.promo_bundle_items DROP CONSTRAINT promo_bundle_items_kode_obat_fkey;
--   ALTER TABLE public.promo_bundle_items
--     ADD CONSTRAINT promo_bundle_items_kode_obat_fkey
--     FOREIGN KEY (kode_obat) REFERENCES public.master_barang(kode_obat);
--   DROP INDEX IF EXISTS public.promo_bundle_items_sku_idx;
--   CREATE INDEX IF NOT EXISTS promo_bundle_items_sku_idx
--     ON public.promo_bundle_items (kode_obat);
--   ALTER TABLE public.promo_bundle_items DROP COLUMN cabang_id;
--
--   -- b. refill_programs
--   ALTER TABLE public.refill_programs DROP CONSTRAINT refill_programs_kode_obat_fkey;
--   ALTER TABLE public.refill_programs
--     ADD CONSTRAINT refill_programs_kode_obat_fkey
--     FOREIGN KEY (kode_obat) REFERENCES public.master_barang(kode_obat);
--
--   -- c. stok_batch
--   ALTER TABLE public.stok_batch DROP CONSTRAINT stok_batch_kode_obat_fkey;
--   ALTER TABLE public.stok_batch
--     ADD CONSTRAINT stok_batch_kode_obat_fkey
--     FOREIGN KEY (kode_obat) REFERENCES public.master_barang(kode_obat);
--   ALTER TABLE public.stok_batch
--     DROP CONSTRAINT stok_batch_cabang_kode_obat_kode_batch_key;
--   ALTER TABLE public.stok_batch
--     ADD CONSTRAINT stok_batch_kode_obat_kode_batch_key UNIQUE (kode_obat, kode_batch);
--   DROP INDEX IF EXISTS public.idx_batch_fefo;
--   CREATE INDEX IF NOT EXISTS idx_batch_fefo
--     ON public.stok_batch (kode_obat, expired_date) WHERE stok_real > 0;
-- COMMIT;
--
-- Catatan: rollback (c) GAGAL bila sudah ada dua cabang dengan kode batch yang
-- sama (justru keadaan yang mau dicapai migrasi ini). Dalam keadaan itu rollback
-- struktur tidak mungkin tanpa membersihkan data — pakai restore backup penuh.
-- =============================================================================
