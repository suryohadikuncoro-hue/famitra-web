-- Migrasi: Kupon Undian (Marketing)
-- Tanggal: 2026-09-27
--
-- Aturan AGENTS.md (mulai 30 Okt 2026):
-- - Tabel baru WAJIB grant service_role + ENABLE RLS + policy no_anon/no_authenticated dalam migrasi yang sama
-- - Tidak memberi akses anon ke data pelanggan / transaksi

-- =========================================================
-- 1) lottery_campaigns: header kampanye undian
-- =========================================================
create table if not exists public.lottery_campaigns (
  id uuid primary key default gen_random_uuid(),
  kode_cabang text not null references public.master_cabang(kode_cabang) on update cascade,
  nama text not null,
  periode_mulai date not null,
  periode_selesai date not null,
  aktif boolean not null default false,
  catatan text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lottery_campaigns_periode_check check (periode_selesai >= periode_mulai)
);

create index if not exists lottery_campaigns_cabang_idx on public.lottery_campaigns(kode_cabang);
create index if not exists lottery_campaigns_periode_idx on public.lottery_campaigns(periode_mulai, periode_selesai);
create index if not exists lottery_campaigns_aktif_idx on public.lottery_campaigns(aktif) where aktif = true;

-- =========================================================
-- 2) lottery_prizes: hadiah per kampanye
--    hadiah BOLEH berupa produk yang tidak ada di inventory
-- =========================================================
create table if not exists public.lottery_prizes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.lottery_campaigns(id) on delete cascade,
  nama_hadiah text not null,
  nama_produk text,
  nilai_hadiah_idr numeric(14,2) not null default 0,
  probabilitas_persen numeric(5,2) not null default 0,
  gambar_url text,
  created_at timestamptz not null default now(),
  constraint lottery_prizes_probabilitas_check check (probabilitas_persen >= 0 and probabilitas_persen <= 100),
  constraint lottery_prizes_nilai_check check (nilai_hadiah_idr >= 0)
);

create index if not exists lottery_prizes_campaign_idx on public.lottery_prizes(campaign_id);

-- =========================================================
-- 3) lottery_winners: pemenang undian (dicatat manual offline)
--    coupon_code = kode tiket/bukti pemenang
--    coupon_expired_at = masa berlaku customize
--    pickup_date / pickup_status = pencatatan offline oleh admin
-- =========================================================
create type public.lottery_pickup_status as enum ('belum_diambil', 'sudah_diambil');

create table if not exists public.lottery_winners (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.lottery_campaigns(id) on delete cascade,
  customer_id uuid not null references public.master_customer(id) on delete restrict,
  prize_id uuid not null references public.lottery_prizes(id) on delete restrict,
  coupon_code text not null unique,
  coupon_expired_at date not null,
  pickup_date date,
  pickup_status public.lottery_pickup_status not null default 'belum_diambil',
  recorded_by text,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lottery_winners_campaign_idx on public.lottery_winners(campaign_id);
create index if not exists lottery_winners_customer_idx on public.lottery_winners(customer_id);
create index if not exists lottery_winners_prize_idx on public.lottery_winners(prize_id);

-- =========================================================
-- 4) Trigger: updated_at otomatis
-- =========================================================
create or replace function public.lottery_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_lottery_campaigns_updated_at on public.lottery_campaigns;
create trigger trg_lottery_campaigns_updated_at
  before update on public.lottery_campaigns
  for each row execute function public.lottery_set_updated_at();

drop trigger if exists trg_lottery_winners_updated_at on public.lottery_winners;
create trigger trg_lottery_winners_updated_at
  before update on public.lottery_winners
  for each row execute function public.lottery_set_updated_at();

-- =========================================================
-- 5) GRANT + RLS — sesuai aturan AGENTS.md
-- =========================================================
do $$
declare
  t text;
  tables text[] := array[
    'lottery_campaigns',
    'lottery_prizes',
    'lottery_winners'
  ];
begin
  foreach t in array tables loop
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);

    -- tolak anon
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_no_anon'
    ) then
      execute format(
        'create policy %I on public.%I for all to anon using (false) with check (false)',
        t || '_no_anon', t
      );
    end if;

    -- tolak authenticated (akses hanya lewat Edge Function dgn service_role)
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_no_authenticated'
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated using (false) with check (false)',
        t || '_no_authenticated', t
      );
    end if;
  end loop;
end $$;

-- =========================================================
-- 6) Register ke tabel_aplikasi RLS helper (jika ada)
--    agar konsisten dengan migrasi 20260925060000_rls_dan_hak_akses.sql
-- =========================================================
-- Catatan: migrasi 20260925060000_rls_dan_hak_akses.sql menggunakan
-- array tabel_aplikasi. Tabel kupon undian dibuat SETELAH migrasi itu,
-- sehingga RLS di-handle di blok do $$ di atas. Tidak perlu ALTER ke array.