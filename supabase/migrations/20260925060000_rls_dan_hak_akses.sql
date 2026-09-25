-- =============================================================================
-- SI-FaMitra — Migrasi 6/6 : GRANT, RLS, policy, dan pencabutan EXECUTE
-- Rencana: docs/rencana-isolasi-cabang.md bagian 4.5, 4.6 (file 6)
-- Keputusan pemilik project: 7 (Model A — service_role sebagai satu-satunya jalur
-- data; otorisasi tetap di Edge Function, RLS sebagai penutup pintu)
--
-- Model A apa adanya, jujur: sesi database aplikasi adalah `service_role`, dan
-- `service_role` MENEMBUS RLS sepenuhnya. Jadi policy di file ini TIDAK dipakai
-- aplikasi dan TIDAK menegakkan otorisasi. Fungsinya hanya satu: kalau suatu saat
-- ada key anon/authenticated yang bocor, tabel aplikasi tidak terbuka.
-- Yang benar-benar menjaga isolasi cabang: (a) kode Edge Function, dan
-- (b) constraint database (PK/FK komposit, NOT NULL, CHECK, trigger).
--
-- Isi file:
--   1. GRANT + RLS + policy untuk tabel aplikasi yang belum punya.
--   2. REVOKE EXECUTE untuk fungsi SECURITY DEFINER yang menerima p_username /
--      p_cabang_id dari pemanggil, lalu GRANT hanya ke service_role.
--
-- URUTAN: jalankan SETELAH migrasi 5 (fungsi baru sudah ada) dan setelah Edge
-- Function versi baru di-deploy. Ini langkah terakhir sebelum regresi (9.4).
--
-- TIDAK ada DROP TABLE / TRUNCATE / DELETE di file ini. Tidak ada satu pun policy
-- yang dibuat untuk `anon` dengan hak akses; semuanya menolak.
--
-- PLACEHOLDER — menunggu data pemilik project (bagian 9 Tahap 0):
--   * STATUS RLS per tabel belum diketahui (snapshot CSV tidak memuat
--     pg_class.relrowsecurity). Query pemeriksaannya ada di bagian 0 di bawah;
--     `enable row level security` bersifat idempoten, jadi aman dijalankan
--     berapa pun status awalnya. Yang perlu dikonfirmasi pemilik project:
--     apakah ada tabel aplikasi yang RLS-nya sudah aktif DENGAN policy lain
--     (kalau ada, policy itu jangan sampai hilang — file ini hanya menambah
--     policy bernama <tabel>_no_anon / <tabel>_no_authenticated, tidak
--     menyentuh policy lain).
--   * hak EXECUTE yang berlaku sekarang juga belum diketahui; bagian 0
--     menampilkannya sebelum dicabut (bagian 9 Tahap 0).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. PEMERIKSAAN AWAL (bukti "sebelum") — simpan hasilnya sebagai lampiran PR
-- -----------------------------------------------------------------------------

-- 0a. Status RLS tiap tabel aplikasi sekarang:
SELECT c.relname AS tabel, c.relrowsecurity AS rls_aktif
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
ORDER BY c.relrowsecurity, c.relname;

-- 0b. Policy yang sudah ada di tabel aplikasi (harus kosong hari ini):
SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY 1, 2;

-- 0c. Hak EXECUTE fungsi SECURITY DEFINER sekarang:
SELECT p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') AS boleh_execute
FROM pg_proc p
CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) r(rolname)
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('pos_checkout','pos_checkout_promo','pos_checkout_bundle','purchase_save',
                    'generate_refill_reminders','refresh_customer_segments',
                    'reset_monthly_spend','redeem_loyalty_reward')
ORDER BY 1, 2;

-- -----------------------------------------------------------------------------
-- 1. GRANT + RLS + policy untuk tabel aplikasi
--    Daftar tabel = keluarga tabel Indonesia yang dipakai aplikasi. Tabel lama
--    berbahasa Inggris TIDAK disentuh (keputusan 6: jangan hapus/ubah apa pun
--    tanpa izin terpisah). `activity_log` dan `n8n_chat_histories` juga TIDAK
--    disentuh: keduanya ditulis dari luar aplikasi (n8n) dan bisa memakai key
--    lain — mengaktifkan RLS di sana berisiko memutus integrasi n8n.
--    `supplier_cabang` tidak perlu di sini: GRANT/RLS/policy-nya sudah dibuat di
--    migrasi 2.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tabel_aplikasi text[] := ARRAY[
    'app_sessions', 'app_users',
    'biaya_operasional',
    'loyalty_redemptions', 'loyalty_rewards', 'loyalty_transactions',
    'master_barang', 'master_cabang', 'master_customer', 'master_supplier',
    'notification_log',
    'promo_bundle_items', 'promo_bundles', 'promo_campaigns', 'promo_coupons',
    'promo_redemptions', 'promo_segment_targets',
    'referrals', 'refill_programs',
    'stok_batch', 'stok_opname',
    'trx_pembayaran_hutang', 'trx_pembelian', 'trx_pembelian_detail',
    'trx_penjualan', 'trx_penjualan_detail',
    'trx_retur_beli', 'trx_retur_beli_detail',
    'trx_retur_jual', 'trx_retur_jual_detail'
  ];
BEGIN
  FOREACH t IN ARRAY tabel_aplikasi LOOP
    -- AGENTS.md: setiap tabel di schema public minimal bisa diakses service_role
    EXECUTE format('grant select, insert, update, delete on public.%I to service_role', t);

    -- RLS aktif (idempoten). RLS tanpa policy = tidak ada anon/authenticated
    -- yang bisa membaca; service_role tetap lewat.
    EXECUTE format('alter table public.%I enable row level security', t);

    -- Policy eksplisit menolak anon dan authenticated. Policy lain yang sudah
    -- ada TIDAK dihapus — hanya policy dengan nama di bawah ini yang dikelola.
    EXECUTE format('drop policy if exists %I on public.%I', t || '_no_anon', t);
    EXECUTE format('create policy %I on public.%I for all to anon using (false) with check (false)',
                   t || '_no_anon', t);

    EXECUTE format('drop policy if exists %I on public.%I', t || '_no_authenticated', t);
    EXECUTE format('create policy %I on public.%I for all to authenticated using (false) with check (false)',
                   t || '_no_authenticated', t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2. CABUT HAK EXECUTE fungsi SECURITY DEFINER
--    Semua fungsi ini menerima p_username / p_cabang_id DARI PEMANGGIL. Selama
--    EXECUTE-nya terbuka, siapa pun yang bisa memanggil RPC bisa mengirim
--    p_username milik cabang lain. Otorisasi harus di Edge Function (service_role),
--    dan hak EXECUTE di database harus dicabut dari anon/authenticated.
--    Catatan teknis: di Postgres, EXECUTE diberikan ke PUBLIC secara default.
--    Mencabut dari anon/authenticated saja TIDAK cukup (keduanya tetap mendapat
--    hak lewat PUBLIC), jadi PUBLIC ikut dicabut, lalu service_role diberi ulang.
--    Catatan lingkup: `create_sale_with_fefo` (warisan) SENGAJA tidak disentuh —
--    keputusan 6, pensiunnya butuh izin eksplisit terpisah (bagian 4.8).
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.pos_checkout(text, text, text, text, jsonb, numeric, numeric, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_checkout_promo(text, text, text, text, jsonb, numeric, numeric, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_checkout_bundle(text, text, text, text, jsonb, numeric, numeric, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_save(text, text, text, text, date, date, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_refill_reminders(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_customer_segments(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_monthly_spend() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redeem_loyalty_reward(text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.pos_checkout(text, text, text, text, jsonb, numeric, numeric, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_checkout_promo(text, text, text, text, jsonb, numeric, numeric, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_checkout_bundle(text, text, text, text, jsonb, numeric, numeric, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.purchase_save(text, text, text, text, date, date, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_refill_reminders(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_customer_segments(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_monthly_spend() TO service_role;
GRANT EXECUTE ON FUNCTION public.redeem_loyalty_reward(text, uuid, uuid, text) TO service_role;

-- -----------------------------------------------------------------------------
-- 3. VERIFIKASI
-- -----------------------------------------------------------------------------
-- 3a. Semua tabel aplikasi harus rls_aktif = true:
SELECT c.relname AS tabel, c.relrowsecurity AS rls_aktif
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relkind = 'r'
  AND c.relname = ANY (ARRAY[
    'app_sessions','app_users','biaya_operasional','loyalty_redemptions','loyalty_rewards',
    'loyalty_transactions','master_barang','master_cabang','master_customer','master_supplier',
    'notification_log','promo_bundle_items','promo_bundles','promo_campaigns','promo_coupons',
    'promo_redemptions','promo_segment_targets','referrals','refill_programs','stok_batch',
    'stok_opname','supplier_cabang','trx_pembayaran_hutang','trx_pembelian','trx_pembelian_detail',
    'trx_penjualan','trx_penjualan_detail','trx_retur_beli','trx_retur_beli_detail',
    'trx_retur_jual','trx_retur_jual_detail'])
ORDER BY 2, 1;

-- 3b. anon & authenticated TIDAK boleh punya EXECUTE lagi (harus false):
SELECT p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') AS boleh_execute
FROM pg_proc p
CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) r(rolname)
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('pos_checkout','pos_checkout_promo','pos_checkout_bundle','purchase_save',
                    'generate_refill_reminders','refresh_customer_segments',
                    'reset_monthly_spend','redeem_loyalty_reward')
ORDER BY 1, 2;

-- 3c. Bukti penolakan (jalankan di lingkungan uji, sebagai role anon):
--   set role anon;
--   select public.pos_checkout('x','','','', '[]'::jsonb, 0, 0);
--   -> HARUS gagal: permission denied for function pos_checkout
--   reset role;

COMMIT;

-- =============================================================================
-- ROLLBACK (komentar — jalankan manual, hanya bila migrasi ini harus dibatalkan)
-- =============================================================================
-- BEGIN;
--   -- a. kembalikan hak EXECUTE ke PUBLIC (keadaan default Postgres, yaitu
--   --    apa yang berlaku sebelum file ini):
--   GRANT EXECUTE ON FUNCTION public.pos_checkout(text, text, text, text, jsonb, numeric, numeric, text, uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.pos_checkout_promo(text, text, text, text, jsonb, numeric, numeric, text, uuid, text) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.pos_checkout_bundle(text, text, text, text, jsonb, numeric, numeric, text, uuid, text) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.purchase_save(text, text, text, text, date, date, jsonb, text) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.generate_refill_reminders(text) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.refresh_customer_segments(text) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.reset_monthly_spend() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.redeem_loyalty_reward(text, uuid, uuid, text) TO PUBLIC;
--
--   -- b. buang policy yang dibuat file ini
--   --    (jalankan satu per satu, atau lewat loop DO seperti di bagian 1)
--   DROP POLICY IF EXISTS <tabel>_no_anon ON public.<tabel>;
--   DROP POLICY IF EXISTS <tabel>_no_authenticated ON public.<tabel>;
--
--   -- c. RLS: HANYA matikan untuk tabel yang sebelumnya memang belum aktif.
--   --    Statusnya ada di hasil query bagian 0a — jangan dimatikan asal-asalan,
--   --    karena mematikan RLS di tabel yang tadinya aktif berarti membuka data.
--   --    ALTER TABLE public.<tabel> DISABLE ROW LEVEL SECURITY;   -- <-- manual
-- COMMIT;
--
-- Catatan: mengembalikan GRANT/RLS TIDAK mengembalikan isolasi cabang — isolasi
-- ditegakkan kode Edge Function. Rollback file ini hanya relevan kalau ada
-- masalah hak akses, bukan untuk membatalkan isolasi.
-- =============================================================================
