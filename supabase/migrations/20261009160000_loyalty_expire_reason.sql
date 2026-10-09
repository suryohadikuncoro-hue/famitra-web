-- =====================================================================
-- Poin & Reward: izinkan reason 'expire' di buku mutasi poin
--
-- MASALAH YANG DIPERBAIKI
--   Tabel loyalty_transactions memiliki aturan pembatas:
--     CHECK (reason = ANY (ARRAY['purchase','redeem','return_adjustment',
--                                'birthday_bonus','referral','manual_adjustment']))
--
--   Fungsi expire_loyalty_points() (migrasi 20261008150000) menulis baris
--   dengan reason = 'expire', dan nilai itu TIDAK ada di daftar tersebut.
--   Akibatnya penghangusan poin akan gagal karena pelanggaran constraint,
--   seluruh transaksi dibatalkan, dan karena pemanggilnya (api: crm.list)
--   mengabaikan galat, kegagalannya tidak terlihat sama sekali.
--
--   Dampak HARI INI: tidak ada. Belum ada poin yang berumur 12 bulan, jadi
--   baris itu belum pernah ditulis - perulangan di dalam fungsi hanya
--   berjalan untuk pelanggan yang benar-benar punya poin kedaluwarsa.
--
--   Dampak nanti (sekitar Oktober 2027): setiap kali ada poin yang harus
--   hangus, penghangusan gagal diam-diam. Poin tidak akan pernah hangus,
--   kebalikan dari yang dirancang.
--
-- PERBAIKAN
--   Menambahkan 'expire' ke daftar nilai yang diizinkan. SELURUH nilai lama
--   dipertahankan, jadi tidak ada perilaku lain yang berubah. Tidak ada
--   fungsi yang perlu diubah - expire_loyalty_points() sudah benar, yang
--   kurang hanya izin di tingkat tabel.
--
-- CATATAN ASAL TEMUAN
--   Aturan ini tidak terlihat dari repo karena tabel loyalty_transactions
--   dibuat di luar riwayat migrasi. Ditemukan lewat `supabase db dump`
--   pada 9 Oktober 2026 - persis jenis masalah yang hanya bisa dilihat
--   dengan membaca skema database langsung.
--
-- PRASYARAT: tabel loyalty_transactions. Migrasi ini aditif dan aman
-- dijalankan berulang.
-- =====================================================================

------------------------------------------------------------------------
-- 0. Pengaman prasyarat
------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'loyalty_transactions') then
    raise exception 'Prasyarat belum ada: tabel public.loyalty_transactions tidak ditemukan.';
  end if;
end $$;

------------------------------------------------------------------------
-- 1. Ganti aturan pembatas: nilai lama + 'expire'
------------------------------------------------------------------------
alter table public.loyalty_transactions
  drop constraint if exists loyalty_transactions_reason_check;

alter table public.loyalty_transactions
  add constraint loyalty_transactions_reason_check
  check (reason = any (array[
    'purchase',
    'redeem',
    'return_adjustment',
    'birthday_bonus',
    'referral',
    'manual_adjustment',
    'expire'
  ]::text[]));

comment on constraint loyalty_transactions_reason_check on public.loyalty_transactions is
  'Alasan mutasi poin. Nilai ''expire'' dipakai expire_loyalty_points() untuk mencatat penghangusan poin (ditambahkan di migrasi 20261009160000).';

------------------------------------------------------------------------
-- 2. Verifikasi di dalam migrasi: pastikan 'expire' benar-benar diizinkan
--    dan seluruh nilai lama masih ada. Kalau tidak, migrasi dibatalkan.
------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_wajib text[] := array['purchase','redeem','return_adjustment','birthday_bonus','referral','manual_adjustment','expire'];
  v_nilai text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.loyalty_transactions'::regclass
    and conname = 'loyalty_transactions_reason_check';

  if v_def is null then
    raise exception 'Gagal: constraint loyalty_transactions_reason_check tidak ditemukan setelah ditulis.';
  end if;

  foreach v_nilai in array v_wajib loop
    if position('''' || v_nilai || '''' in v_def) = 0 then
      raise exception 'Gagal: nilai % tidak ada di constraint reason.', v_nilai;
    end if;
  end loop;
end $$;
