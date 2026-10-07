-- =====================================================================
-- Poin & Reward: kedaluwarsa poin dengan urutan FIFO + masa berlaku per cabang
--
-- MASALAH YANG DIPERBAIKI
--   expire_loyalty_points() versi lama mengurangi saldo pelanggan dengan
--   jumlah SELURUH perolehan yang berumur lebih dari 12 bulan, tanpa
--   memperhitungkan poin yang sudah dipakai untuk reward. Contoh:
--
--     13 bulan lalu dapat +100   (masih tercatat, expired = false)
--     bulan lalu dapat     +100
--     menukar reward       -100  -> saldo 100
--     saat kedaluwarsa dijalankan:
--       saldo 100 - 100 (perolehan lama) = 0   <-- SALAH
--
--   Saldo yang benar adalah 100: penukaran seharusnya memakai poin TERLAMA
--   lebih dulu (FIFO), sehingga tidak ada sisa poin lama yang perlu hangus.
--
--   Catatan: bug ini BELUM pernah merugikan pelanggan. Penjualan paling awal
--   di semua cabang adalah 1-3 Oktober 2026, jadi belum ada poin yang berumur
--   12 bulan. Perbaikan ini mencegahnya terjadi sebelum poin mulai menua.
--
-- CARA BARU
--   * Pemakaian poin (redeem, return_adjustment) dialokasikan ke perolehan
--     secara FIFO: perolehan tertua dipakai lebih dulu.
--   * Yang hangus hanya SISA yang belum terpakai dari perolehan yang sudah
--     melewati masa berlaku.
--   * Masa berlaku diatur per cabang: 12 bulan (bawaan, sama seperti
--     sebelumnya), selamanya, atau sampai akhir tahun berikutnya.
--   * Penghangusan dicatat di buku mutasi poin (reason = 'expire') sehingga
--     ada jejak audit dan saldo bisa ditelusuri.
--   * Tersedia uji kering (dry-run) lewat loyalty_poin_akan_hangus(): melihat
--     siapa dan berapa yang AKAN hangus tanpa mengubah apa pun.
--
-- PRASYARAT: migrasi 20260929020000 (tabel loyalty_settings) dan
-- 20260925070000 (kolom loyalty_transactions.expired). Bila belum ada,
-- migrasi ini menolak berjalan tanpa mengubah apa pun.
-- Migrasi ini aditif dan aman dijalankan berulang.
-- =====================================================================

------------------------------------------------------------------------
-- 0. Pengaman prasyarat
------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'loyalty_settings') then
    raise exception 'Prasyarat belum ada: terapkan dulu migrasi 20260929020000_loyalty_pengaturan_perolehan.sql.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'loyalty_transactions'
                   and column_name = 'expired') then
    raise exception 'Prasyarat belum ada: kolom loyalty_transactions.expired belum ada (migrasi 20260925070000).';
  end if;
end $$;

------------------------------------------------------------------------
-- 1. Pengaturan masa berlaku per cabang
--    Bawaan = perilaku lama: 12 bulan sejak poin diperoleh.
------------------------------------------------------------------------
alter table public.loyalty_settings
  add column if not exists masa_berlaku_mode text not null default 'bulan',
  add column if not exists masa_berlaku_bulan integer not null default 12;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'loyalty_settings_masa_berlaku_mode_check'
                   and conrelid = 'public.loyalty_settings'::regclass) then
    alter table public.loyalty_settings
      add constraint loyalty_settings_masa_berlaku_mode_check
      check (masa_berlaku_mode in ('bulan','selamanya','akhir_tahun'));
  end if;
  if not exists (select 1 from pg_constraint
                 where conname = 'loyalty_settings_masa_berlaku_bulan_check'
                   and conrelid = 'public.loyalty_settings'::regclass) then
    alter table public.loyalty_settings
      add constraint loyalty_settings_masa_berlaku_bulan_check
      check (masa_berlaku_bulan between 1 and 120);
  end if;
end $$;

comment on column public.loyalty_settings.masa_berlaku_mode is
  'Masa berlaku poin: bulan = X bulan sejak diperoleh (bawaan 12), selamanya = tidak pernah hangus, akhir_tahun = hangus 31 Desember tahun berikutnya.';
comment on column public.loyalty_settings.masa_berlaku_bulan is
  'Dipakai hanya bila masa_berlaku_mode = ''bulan''.';

------------------------------------------------------------------------
-- 2. Nilai bawaan pengaturan (dipakai UI dan validasi)
--    Ditambah dua kolom masa berlaku; sisanya tetap sama dengan migrasi
--    20260929020000 supaya perilaku tidak berubah.
------------------------------------------------------------------------
create or replace function public.loyalty_cfg_default()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'aktif', true,
    'basis_hitung', 'harga_akhir',
    'rupiah_per_kelipatan', 1000,
    'poin_per_kelipatan', 1,
    'pembulatan', 'bawah',
    'min_belanja', 0,
    'maks_poin_per_transaksi', null,
    'faktor_tipe', jsonb_build_object('Umum', 1, 'Tenaga Kesehatan', 0, 'Apotek Lain', 0),
    'gabung_pengganda', 'tertinggi',
    'pengganda', '[]'::jsonb,
    'retur_kurangi_poin', true,
    'masa_berlaku_mode', 'bulan',
    'masa_berlaku_bulan', 12
  )
$$;

------------------------------------------------------------------------
-- 3. Tanggal kedaluwarsa sebuah perolehan poin
--    Akhir tahun = 31 Desember TAHUN BERIKUTNYA, supaya poin yang diperoleh
--    di akhir tahun tidak langsung hangus beberapa hari kemudian.
------------------------------------------------------------------------
create or replace function public.loyalty_tanggal_kedaluwarsa(
  p_diperoleh timestamptz, p_mode text, p_bulan integer)
returns date language sql immutable as $$
  select case
    when p_diperoleh is null then null
    when coalesce(p_mode,'bulan') = 'selamanya' then null
    when coalesce(p_mode,'bulan') = 'akhir_tahun' then make_date(
      extract(year from (p_diperoleh at time zone 'Asia/Jakarta'))::int + 1, 12, 31)
    else ((p_diperoleh at time zone 'Asia/Jakarta')::date
          + make_interval(months => greatest(1, coalesce(p_bulan, 12))))::date
  end
$$;

comment on function public.loyalty_tanggal_kedaluwarsa(timestamptz, text, integer) is
  'Tanggal berakhirnya sebuah perolehan poin. NULL berarti tidak pernah hangus.';

------------------------------------------------------------------------
-- 4. Uji kering: siapa dan berapa yang AKAN hangus (tidak mengubah apa pun)
--    Pemakaian poin dialokasikan FIFO ke perolehan, sehingga yang dihitung
--    hanya sisa yang benar-benar belum terpakai.
------------------------------------------------------------------------
create or replace function public.loyalty_poin_akan_hangus(p_cabang_id text)
returns table (
  customer_id text,
  nomor_wa text,
  nama text,
  total_points numeric,
  akan_hangus numeric,
  jumlah_perolehan integer,
  kedaluwarsa_terawal date,
  saldo_cukup boolean
)
language sql stable security definer set search_path to 'public'
as $function$
with cfg as (
  select coalesce(s.masa_berlaku_mode, 'bulan') as mode,
         coalesce(s.masa_berlaku_bulan, 12) as bulan
  from (select 1) satu
  left join public.loyalty_settings s on s.cabang_id = p_cabang_id
),
perolehan as (
  select t.customer_id,
         t.points_change::numeric as earned,
         public.loyalty_tanggal_kedaluwarsa(t.created_at, c.mode, c.bulan) as kedaluwarsa,
         sum(t.points_change) over (
           partition by t.customer_id
           order by t.created_at, t.points_change desc
           rows between unbounded preceding and current row)::numeric as cum_end
  from public.loyalty_transactions t
  cross join cfg c
  where t.cabang_id = p_cabang_id
    and t.points_change > 0
    and coalesce(t.expired, false) = false
),
pakai as (
  -- Semua pemakaian dianggap pemakaian; hanya baris 'expire' yang dikecualikan
  -- karena baris itu justru catatan penghangusan, bukan pemakaian pelanggan.
  select t.customer_id, sum(-t.points_change)::numeric as terpakai
  from public.loyalty_transactions t
  where t.cabang_id = p_cabang_id
    and t.points_change < 0
    and coalesce(t.reason, '') <> 'expire'
  group by t.customer_id
),
sisa as (
  select p.customer_id, p.kedaluwarsa,
         greatest(0, p.cum_end - greatest(coalesce(k.terpakai, 0), p.cum_end - p.earned)) as sisa
  from perolehan p
  left join pakai k on k.customer_id = p.customer_id
)
select c.id::text,
       c.nomor_wa,
       c.nama,
       c.total_points::numeric,
       coalesce(sum(s.sisa) filter (where s.kedaluwarsa is not null and s.kedaluwarsa < (now() at time zone 'Asia/Jakarta')::date), 0)::numeric,
       count(*) filter (where s.kedaluwarsa is not null and s.kedaluwarsa < (now() at time zone 'Asia/Jakarta')::date)::int,
       min(s.kedaluwarsa) filter (where s.kedaluwarsa is not null and s.kedaluwarsa < (now() at time zone 'Asia/Jakarta')::date),
       (c.total_points::numeric >= coalesce(sum(s.sisa) filter (where s.kedaluwarsa is not null and s.kedaluwarsa < (now() at time zone 'Asia/Jakarta')::date), 0))
from public.master_customer c
left join sisa s on s.customer_id = c.id
where c.cabang_id = p_cabang_id
group by c.id, c.nomor_wa, c.nama, c.total_points
having coalesce(sum(s.sisa) filter (where s.kedaluwarsa is not null and s.kedaluwarsa < (now() at time zone 'Asia/Jakarta')::date), 0) > 0
order by 5 desc, c.nama
$function$;

------------------------------------------------------------------------
-- 5. Penghangusan FIFO
--    Menggantikan versi lama. Tanda tangan fungsi TIDAK berubah supaya
--    pemanggil yang sudah ada (api: crm.list dan loyalty.expire) tetap jalan.
--    Nilai kembalian kini = TOTAL POIN yang dihanguskan (sebelumnya: jumlah
--    baris yang ditandai - angka itu tidak bermakna dan tidak dipakai UI).
------------------------------------------------------------------------
create or replace function public.expire_loyalty_points()
returns integer
language plpgsql
security definer
set search_path TO 'public'
as $function$
declare
  v_cab text;
  v_mode text;
  v_bulan integer;
  v_total integer := 0;
  r record;
begin
  for v_cab in select kode_cabang from public.master_cabang loop
    -- Bawaan bila cabang belum punya pengaturan: 12 bulan (perilaku lama).
    select coalesce(s.masa_berlaku_mode, 'bulan'), coalesce(s.masa_berlaku_bulan, 12)
      into v_mode, v_bulan
    from (select 1) satu
    left join public.loyalty_settings s on s.cabang_id = v_cab;

    for r in select * from public.loyalty_poin_akan_hangus(v_cab) loop
      -- Saldo tidak sinkron dengan buku mutasi: jangan diubah, perlu
      -- pemeriksaan manual. Pelanggan ini tetap muncul di uji kering.
      if not r.saldo_cukup then
        continue;
      end if;

      if r.akan_hangus > 0 then
        update public.master_customer
           set total_points = greatest(0, total_points - r.akan_hangus::integer)
         where id::text = r.customer_id and cabang_id = v_cab;

        insert into public.loyalty_transactions(cabang_id, customer_id, no_nota, points_change, reason, expired)
        select v_cab, c.id,
               'EXPIRE-' || to_char(now() at time zone 'Asia/Jakarta', 'YYYYMMDD') || '-' || left(c.id::text, 8),
               -r.akan_hangus::integer, 'expire', false
        from public.master_customer c
        where c.id::text = r.customer_id and c.cabang_id = v_cab;

        v_total := v_total + r.akan_hangus::integer;
      end if;

      -- Tandai perolehan yang sudah lewat masa berlaku sebagai hangus, supaya
      -- tidak dihitung lagi pada pemeriksaan berikutnya.
      update public.loyalty_transactions t
         set expired = true
       where t.cabang_id = v_cab
         and t.customer_id::text = r.customer_id
         and t.points_change > 0
         and coalesce(t.expired, false) = false
         and public.loyalty_tanggal_kedaluwarsa(t.created_at, v_mode, v_bulan) < (now() at time zone 'Asia/Jakarta')::date;
    end loop;
  end loop;

  return v_total;
end;
$function$;

comment on function public.expire_loyalty_points() is
  'Hanguskan poin yang melewati masa berlaku dengan urutan FIFO. Nilai kembalian = total poin yang dihanguskan. Poin yang sudah dipakai untuk reward tidak ikut hangus.';

------------------------------------------------------------------------
-- 6. Indeks bantu untuk penelusuran perolehan per pelanggan
------------------------------------------------------------------------
create index if not exists idx_loyalty_transactions_cabang_customer_created
  on public.loyalty_transactions (cabang_id, customer_id, created_at);

------------------------------------------------------------------------
-- 7. Hak akses: hanya lewat Edge Function (service_role)
------------------------------------------------------------------------
revoke all on function public.loyalty_tanggal_kedaluwarsa(timestamptz, text, integer) from public, anon, authenticated;
grant execute on function public.loyalty_tanggal_kedaluwarsa(timestamptz, text, integer) to service_role;

revoke all on function public.loyalty_poin_akan_hangus(text) from public, anon, authenticated;
grant execute on function public.loyalty_poin_akan_hangus(text) to service_role;

revoke all on function public.expire_loyalty_points() from public, anon, authenticated;
grant execute on function public.expire_loyalty_points() to service_role;

revoke all on function public.loyalty_cfg_default() from public, anon, authenticated;
grant execute on function public.loyalty_cfg_default() to service_role;
