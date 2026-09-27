-- Migrasi: Marketing Target Omset & Laba Bersih
-- Tanggal: 2026-09-28
--
-- Aturan AGENTS.md:
-- - Tabel baru WAJIB grant service_role + ENABLE RLS + policy no_anon/no_authenticated dalam migrasi yang sama
-- - Tidak memberi akses anon ke data finansial
--
-- Fitur: Owner set target omset per cabang per periode. Dashboard menampilkan
-- progress omset & laba bersih (omset - HPP - biaya_op) per cabang. Biaya
-- operasional dibaca dari tabel biaya_operasional yang sudah ada.

-- =========================================================
-- 1) marketing_target_omsets: target omset per cabang per periode
-- =========================================================
create table if not exists public.marketing_target_omsets (
  id uuid primary key default gen_random_uuid(),
  kode_cabang text not null references public.master_cabang(kode_cabang) on update cascade,
  nama_target text not null,
  periode_mulai date not null,
  periode_selesai date not null,
  target_omset_idr numeric(14,2) not null default 0,
  aktif boolean not null default true,
  catatan text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_target_omsets_periode_check check (periode_selesai >= periode_mulai),
  constraint marketing_target_omsets_target_check check (target_omset_idr >= 0)
);

create index if not exists marketing_target_omsets_cabang_idx on public.marketing_target_omsets(kode_cabang);
create index if not exists marketing_target_omsets_periode_idx on public.marketing_target_omsets(periode_mulai, periode_selesai);
create index if not exists marketing_target_omsets_aktif_idx on public.marketing_target_omsets(aktif) where aktif = true;

-- Unique active target per branch (only one aktif=true per kode_cabang)
create unique index if not exists marketing_target_omsets_unique_aktif
  on public.marketing_target_omsets(kode_cabang)
  where aktif = true;

-- =========================================================
-- 2) Trigger: updated_at otomatis
-- =========================================================
drop trigger if exists trg_marketing_target_omsets_updated_at on public.marketing_target_omsets;
create trigger trg_marketing_target_omsets_updated_at
  before update on public.marketing_target_omsets
  for each row execute function public.lottery_set_updated_at();

-- =========================================================
-- 3) GRANT + RLS — sesuai aturan AGENTS.md
-- =========================================================
do $$
declare
  t text;
  tables text[] := array[
    'marketing_target_omsets'
  ];
begin
  foreach t in array tables loop
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_no_anon'
    ) then
      execute format(
        'create policy %I on public.%I for all to anon using (false) with check (false)',
        t || '_no_anon', t
      );
    end if;

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
-- 4) RPC marketing_require_session (paralel dengan lottery_require_session)
--    Validasi token dan return session untuk auth function marketing
-- =========================================================
create or replace function public.marketing_require_session(p_token text)
returns public.app_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.app_sessions;
begin
  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'Token sesi kosong' using errcode = '28000';
  end if;

  select * into s
  from public.app_sessions
  where token = p_token and expires_at > now()
  limit 1;

  if not found then
    raise exception 'Sesi berakhir. Silakan login ulang.' using errcode = '28000';
  end if;

  return s;
end;
$$;

revoke all on function public.marketing_require_session(text) from public, anon, authenticated;
grant execute on function public.marketing_require_session(text) to service_role;

-- =========================================================
-- 5) RPC marketing_save_target_omset
--    Insert / update / activate target omset
--    Hanya boleh 1 aktif per cabang (handled by unique index)
-- =========================================================
create or replace function public.marketing_save_target_omset(
  p_token text,
  p_data jsonb
)
returns table(id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.app_sessions;
  v_id uuid;
  v_kode_cabang text;
  v_nama text;
  v_periode_mulai date;
  v_periode_selesai date;
  v_target_omset_idr numeric(14,2);
  v_aktif boolean;
  v_catatan text;
  v_existing_id uuid;
begin
  s := public.marketing_require_session(p_token);

  if s.role <> 'Owner' then
    raise exception 'Akses ditolak untuk role % pada target omset', s.role using errcode = '42501';
  end if;

  v_kode_cabang := p_data->>'kode_cabang';
  v_nama := p_data->>'nama';
  v_periode_mulai := (p_data->>'periode_mulai')::date;
  v_periode_selesai := (p_data->>'periode_selesai')::date;
  v_target_omset_idr := (p_data->>'target_omset_idr')::numeric;
  v_aktif := coalesce((p_data->>'aktif')::boolean, true);
  v_catatan := p_data->>'catatan';

  if v_kode_cabang is null or length(trim(v_kode_cabang)) = 0 then
    raise exception 'kode_cabang wajib diisi' using errcode = '22023';
  end if;
  if v_nama is null or length(trim(v_nama)) = 0 then
    raise exception 'nama target wajib diisi' using errcode = '22023';
  end if;
  if v_periode_mulai is null or v_periode_selesai is null then
    raise exception 'periode_mulai dan periode_selesai wajib diisi' using errcode = '22023';
  end if;
  if v_periode_selesai < v_periode_mulai then
    raise exception 'periode_selesai tidak boleh sebelum periode_mulai' using errcode = '22023';
  end if;
  if v_target_omset_idr is null or v_target_omset_idr < 0 then
    raise exception 'target_omset_idr tidak valid' using errcode = '22023';
  end if;

  v_id := (p_data->>'id')::uuid;

  if v_id is not null then
    select id into v_existing_id
    from public.marketing_target_omsets
    where id = v_id and kode_cabang = v_kode_cabang
    limit 1;

    if not found then
      raise exception 'Target omset tidak ditemukan atau bukan milik cabang ini' using errcode = 'P0002';
    end if;

    update public.marketing_target_omsets
    set
      nama = v_nama,
      periode_mulai = v_periode_mulai,
      periode_selesai = v_periode_selesai,
      target_omset_idr = v_target_omset_idr,
      aktif = v_aktif,
      catatan = v_catatan,
      updated_at = now()
    where id = v_id
    returning id into v_id;
  else
    insert into public.marketing_target_omsets (
      kode_cabang, nama, periode_mulai, periode_selesai,
      target_omset_idr, aktif, catatan, created_by
    ) values (
      v_kode_cabang, v_nama, v_periode_mulai, v_periode_selesai,
      v_target_omset_idr, v_aktif, v_catatan, s.username
    )
    returning id into v_id;
  end if;

  return query select v_id;
end;
$$;

revoke all on function public.marketing_save_target_omset(text, jsonb) from public, anon, authenticated;
grant execute on function public.marketing_save_target_omset(text, jsonb) to service_role;

-- =========================================================
-- 6) Catatan: perhitungan laba bersih (omset, hpp, biaya_op)
--    dilakukan di Edge Function marketing lewat REST query
--    ke trx_penjualan & biaya_operasional, bukan di RPC SQL,
--    mengikuti pola yang sudah dipakai Edge Function lottery.
-- =========================================================