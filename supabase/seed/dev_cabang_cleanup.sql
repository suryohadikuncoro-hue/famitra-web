-- =============================================================================
-- SI-FaMitra — HAPUS cabang uji coba "DEV" beserta seluruh datanya
--
-- CARA PAKAI: Supabase Dashboard > SQL Editor > paste > Run.
-- Hanya menghapus baris yang cabang_id / kode_cabang-nya PERSIS 'DEV'.
-- Data KARLA / KENDAL / PUCUK / PULE tidak tersentuh.
--
-- WAJIB dijalankan sebelum go-live (tgl 30), atau saat ingin reset data DEV.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  r record;
  pass int;
  remaining int;
BEGIN
  -- Hapus dari semua tabel yang punya kolom cabang_id / kode_cabang. Urutan FK tidak
  -- diketahui, jadi diulang: tabel yang gagal karena masih dirujuk tabel anak dicoba
  -- lagi di putaran berikutnya setelah anaknya terhapus.
  FOR pass IN 1..15 LOOP
    remaining := 0;
    FOR r IN
      SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public'
        AND c.column_name IN ('cabang_id', 'kode_cabang')
        AND c.table_name <> 'master_cabang'
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE %I = $1', r.table_name, r.column_name) USING 'DEV';
      EXCEPTION WHEN foreign_key_violation THEN
        remaining := remaining + 1;
      END;
    END LOOP;
    EXIT WHEN remaining = 0;
  END LOOP;

  DELETE FROM public.master_cabang WHERE kode_cabang = 'DEV';
END $$;

COMMIT;

-- Verifikasi: semua angka harus 0
SELECT
  (SELECT count(*) FROM public.master_cabang       WHERE kode_cabang = 'DEV') AS cabang,
  (SELECT count(*) FROM public.app_users           WHERE cabang_id   = 'DEV') AS users,
  (SELECT count(*) FROM public.master_barang       WHERE cabang_id   = 'DEV') AS barang,
  (SELECT count(*) FROM public.stok_batch          WHERE cabang_id   = 'DEV') AS batch,
  (SELECT count(*) FROM public.master_customer     WHERE cabang_id   = 'DEV') AS pelanggan,
  (SELECT count(*) FROM public.trx_penjualan       WHERE cabang_id   = 'DEV') AS penjualan,
  (SELECT count(*) FROM public.trx_penjualan_detail WHERE cabang_id  = 'DEV') AS penjualan_detail,
  (SELECT count(*) FROM public.biaya_operasional   WHERE cabang_id   = 'DEV') AS biaya,
  (SELECT count(*) FROM public.trx_retur_jual      WHERE cabang_id   = 'DEV') AS retur;
