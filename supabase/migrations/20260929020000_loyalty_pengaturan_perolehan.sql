-- =====================================================================
-- Poin & Reward: pengaturan perolehan poin per cabang
--
-- Sebelumnya aturan perolehan poin tertulis tetap di trigger
-- loyalty_after_sale / loyalty_after_return (1 poin tiap Rp1.000,
-- Tenaga Kesehatan dan Apotek Lain 0 poin). Migrasi ini memindahkan aturan
-- itu ke tabel pengaturan per cabang.
--
-- PENTING - perilaku tidak berubah sampai Owner menyimpan pengaturan:
--   * Cabang tanpa baris di loyalty_settings memakai loyalty_cfg_default(),
--     yang persis sama dengan aturan lama (migrasi 20260925070000).
--   * Bila pembacaan/perhitungan pengaturan gagal, trigger jatuh ke rumus
--     lama sehingga penjualan tidak pernah ikut gagal.
--   * Tidak ada data yang diubah, tidak ada tabel lama yang diubah.
-- Migrasi ini aman dijalankan berulang.
-- =====================================================================

------------------------------------------------------------------------
-- 0. Pengaman prasyarat
--    Trigger di bawah menulis ke loyalty_transactions.expired dan mengikuti
--    aturan migrasi 20260925070000. Bila prasyarat itu belum ada, migrasi
--    ini dibatalkan seluruhnya agar penjualan tidak pernah gagal.
------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'loyalty_transactions' and column_name = 'expired')
     or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'expire_loyalty_points') then
    raise exception 'Prasyarat belum ada: terapkan dulu migrasi 20260925070000_loyalty_tk_zero_expiry.sql, lalu jalankan migrasi ini lagi.';
  end if;
end $$;

------------------------------------------------------------------------
-- 1. Fungsi bantu (murni, tanpa akses tabel)
------------------------------------------------------------------------
create or replace function public.loyalty_bulatkan(p_nilai numeric, p_mode text)
returns numeric language sql immutable as $$
  select case p_mode
    when 'atas' then ceil(p_nilai)
    when 'terdekat' then round(p_nilai)
    else floor(p_nilai)
  end
$$;

create or replace function public.loyalty_faktor_tipe_valid(p jsonb)
returns boolean language plpgsql immutable as $$
declare k text; v jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  for k, v in select key, value from jsonb_each(p) loop
    if k not in ('Umum','Tenaga Kesehatan','Apotek Lain') then return false; end if;
    if jsonb_typeof(v) <> 'number' then return false; end if;
    if (v #>> '{}')::numeric < 0 or (v #>> '{}')::numeric > 100 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;

create or replace function public.loyalty_pengganda_valid(p jsonb)
returns boolean language plpgsql immutable as $$
declare it jsonb; h jsonb; m date; s date; f numeric;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return false; end if;
  if jsonb_array_length(p) > 50 then return false; end if;
  for it in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(it) <> 'object' then return false; end if;
    if coalesce(length(btrim(it->>'nama')), 0) not between 1 and 60 then return false; end if;
    if jsonb_typeof(it->'aktif') <> 'boolean' then return false; end if;
    if jsonb_typeof(it->'faktor') <> 'number' then return false; end if;
    f := (it->>'faktor')::numeric;
    if f <= 0 or f > 100 then return false; end if;
    if it ? 'hari' and jsonb_typeof(it->'hari') <> 'null' then
      if jsonb_typeof(it->'hari') <> 'array' or jsonb_array_length(it->'hari') = 0 then return false; end if;
      for h in select value from jsonb_array_elements(it->'hari') loop
        if jsonb_typeof(h) <> 'number' or (h #>> '{}')::numeric not in (0,1,2,3,4,5,6) then return false; end if;
      end loop;
    end if;
    m := nullif(it->>'mulai','')::date;
    s := nullif(it->>'selesai','')::date;
    if m is not null and s is not null and s < m then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;

-- Nilai bawaan = aturan lama (migrasi 20260925070000).
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
    'retur_kurangi_poin', true
  )
$$;

------------------------------------------------------------------------
-- 2. Tabel pengaturan per cabang + riwayat perubahan
------------------------------------------------------------------------
create table if not exists public.loyalty_settings (
  cabang_id text primary key references public.master_cabang(kode_cabang),
  aktif boolean not null default true,
  basis_hitung text not null default 'harga_akhir' check (basis_hitung in ('harga_akhir','subtotal')),
  rupiah_per_kelipatan numeric(14,2) not null default 1000 check (rupiah_per_kelipatan > 0),
  poin_per_kelipatan integer not null default 1 check (poin_per_kelipatan between 1 and 1000),
  pembulatan text not null default 'bawah' check (pembulatan in ('bawah','atas','terdekat')),
  min_belanja numeric(14,2) not null default 0 check (min_belanja >= 0),
  maks_poin_per_transaksi integer check (maks_poin_per_transaksi is null or maks_poin_per_transaksi between 1 and 1000000),
  faktor_tipe jsonb not null default jsonb_build_object('Umum', 1, 'Tenaga Kesehatan', 0, 'Apotek Lain', 0)
    check (public.loyalty_faktor_tipe_valid(faktor_tipe)),
  gabung_pengganda text not null default 'tertinggi' check (gabung_pengganda in ('tertinggi','kali','jumlah')),
  pengganda jsonb not null default '[]'::jsonb check (public.loyalty_pengganda_valid(pengganda)),
  retur_kurangi_poin boolean not null default true,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists public.loyalty_settings_riwayat (
  id bigint generated always as identity primary key,
  cabang_id text not null,
  disimpan_oleh text,
  disimpan_pada timestamptz not null default now(),
  snapshot jsonb not null
);
create index if not exists idx_loyalty_settings_riwayat_cabang
  on public.loyalty_settings_riwayat (cabang_id, disimpan_pada desc);

create or replace function public.loyalty_settings_riwayat_tolak_ubah()
returns trigger language plpgsql as $$
begin
  raise exception 'Riwayat pengaturan poin tidak boleh diubah atau dihapus.';
end $$;
drop trigger if exists trg_loyalty_settings_riwayat_immutable on public.loyalty_settings_riwayat;
create trigger trg_loyalty_settings_riwayat_immutable
  before update or delete on public.loyalty_settings_riwayat
  for each row execute function public.loyalty_settings_riwayat_tolak_ubah();

-- Akses: hanya service_role (Edge Function `promo`), RLS aktif.
alter table public.loyalty_settings enable row level security;
alter table public.loyalty_settings_riwayat enable row level security;
drop policy if exists loyalty_settings_service_role on public.loyalty_settings;
create policy loyalty_settings_service_role on public.loyalty_settings
  for all to service_role using (true) with check (true);
drop policy if exists loyalty_settings_riwayat_service_role on public.loyalty_settings_riwayat;
create policy loyalty_settings_riwayat_service_role on public.loyalty_settings_riwayat
  for all to service_role using (true) with check (true);
revoke all on public.loyalty_settings from public, anon, authenticated;
revoke all on public.loyalty_settings_riwayat from public, anon, authenticated;
grant select, insert, update on public.loyalty_settings to service_role;
grant select, insert on public.loyalty_settings_riwayat to service_role;

------------------------------------------------------------------------
-- 3. Perhitungan poin (satu sumber kebenaran untuk trigger dan simulasi)
------------------------------------------------------------------------
-- Urutan: program aktif -> faktor tipe pelanggan (0 = tanpa poin) ->
-- minimal belanja -> kelipatan (dibulatkan) x poin per kelipatan ->
-- pengganda promo -> pembulatan akhir -> batas maksimal per transaksi.
-- Hari pada pengganda: 0 = Minggu ... 6 = Sabtu.
-- gabung_pengganda: tertinggi = ambil terbesar; kali = dikalikan;
-- jumlah = 1 + jumlah selisih (dua pengganda 2x menjadi 3x).
-- p_retur = true dipakai saat retur: hanya rasio dasar dan faktor tipe
-- (tanpa minimal belanja, pengganda promo, batas maksimal); bila
-- retur_kurangi_poin = false hasilnya 0. Pada retur, p_subtotal dan
-- p_harga_akhir diisi total_refund.
create or replace function public.loyalty_hitung_poin_detail(
  cfg jsonb, p_tipe text, p_subtotal numeric, p_harga_akhir numeric,
  p_tanggal date, p_retur boolean default false)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_aktif boolean := coalesce((cfg->>'aktif')::boolean, true);
  v_dasar_hitung text := coalesce(cfg->>'basis_hitung', 'harga_akhir');
  v_mode text := coalesce(cfg->>'pembulatan', 'bawah');
  v_rp numeric := coalesce((cfg->>'rupiah_per_kelipatan')::numeric, 1000);
  v_pk integer := coalesce((cfg->>'poin_per_kelipatan')::integer, 1);
  v_min numeric := coalesce((cfg->>'min_belanja')::numeric, 0);
  v_cap integer := nullif(cfg->>'maks_poin_per_transaksi', '')::integer;
  v_gabung text := coalesce(cfg->>'gabung_pengganda', 'tertinggi');
  v_basis numeric; v_ft numeric; v_fp numeric := 1; v_k numeric; v_dasar numeric;
  v_total numeric; v_it jsonb; v_f numeric; v_cocok boolean; v_dow integer;
  v_terpakai jsonb := '[]'::jsonb; v_ada boolean := false; v_acc numeric := 0;
  v_dibatasi boolean := false; v_hasil integer;
begin
  if v_rp <= 0 then raise exception 'rupiah_per_kelipatan harus lebih dari 0'; end if;
  if p_retur then
    if not coalesce((cfg->>'retur_kurangi_poin')::boolean, true) then
      return jsonb_build_object('poin', 0, 'alasan', 'Retur tidak mengurangi poin (sesuai pengaturan)');
    end if;
  elsif not v_aktif then
    return jsonb_build_object('poin', 0, 'alasan', 'Program poin nonaktif');
  end if;

  v_basis := greatest(0, coalesce(case when v_dasar_hitung = 'subtotal' then p_subtotal else p_harga_akhir end, 0));
  v_ft := coalesce((cfg->'faktor_tipe'->>p_tipe)::numeric, 1);
  if v_ft = 0 then
    return jsonb_build_object('poin', 0, 'alasan', 'Tipe pelanggan ini tidak mendapat poin', 'basis', v_basis);
  end if;
  if not p_retur and v_basis < v_min then
    return jsonb_build_object('poin', 0, 'alasan', 'Belanja di bawah minimal untuk mendapat poin', 'basis', v_basis);
  end if;

  v_k := public.loyalty_bulatkan(v_basis / v_rp, v_mode);
  v_dasar := v_k * v_pk;

  if not p_retur then
    v_dow := extract(dow from p_tanggal)::integer;
    for v_it in select value from jsonb_array_elements(coalesce(cfg->'pengganda', '[]'::jsonb)) loop
      continue when not coalesce((v_it->>'aktif')::boolean, false);
      v_cocok := true;
      if jsonb_typeof(v_it->'hari') = 'array' then
        v_cocok := exists (select 1 from jsonb_array_elements_text(v_it->'hari') h where h::integer = v_dow);
      end if;
      if v_cocok and nullif(v_it->>'mulai', '') is not null and p_tanggal < (v_it->>'mulai')::date then v_cocok := false; end if;
      if v_cocok and nullif(v_it->>'selesai', '') is not null and p_tanggal > (v_it->>'selesai')::date then v_cocok := false; end if;
      continue when not v_cocok;
      v_f := (v_it->>'faktor')::numeric;
      v_terpakai := v_terpakai || to_jsonb(v_it->>'nama');
      if v_gabung = 'kali' then
        v_fp := case when v_ada then v_fp * v_f else v_f end;
      elsif v_gabung = 'jumlah' then
        v_acc := v_acc + (v_f - 1);
      else
        v_fp := case when v_ada then greatest(v_fp, v_f) else v_f end;
      end if;
      v_ada := true;
    end loop;
    if v_gabung = 'jumlah' then v_fp := greatest(0, 1 + v_acc); end if;
  end if;

  v_total := public.loyalty_bulatkan(v_dasar * v_ft * v_fp, v_mode);
  if not p_retur and v_cap is not null and v_total > v_cap then
    v_total := v_cap; v_dibatasi := true;
  end if;
  v_hasil := greatest(0, v_total)::integer;

  return jsonb_build_object(
    'poin', v_hasil,
    'alasan', case when v_hasil = 0 then 'Belanja belum mencapai satu kelipatan' end,
    'basis', v_basis, 'kelipatan', v_k, 'poin_dasar', v_dasar,
    'faktor_tipe', v_ft, 'faktor_promo', v_fp,
    'pengganda_terpakai', v_terpakai, 'dibatasi', v_dibatasi);
end $$;

-- Membaca pengaturan cabang (atau nilai bawaan) lalu menghitung poin.
create or replace function public.loyalty_hitung_poin(
  p_cabang text, p_tipe text, p_subtotal numeric, p_harga_akhir numeric,
  p_tanggal date, p_retur boolean default false)
returns integer language plpgsql stable set search_path = public as $$
declare v_cfg jsonb;
begin
  select to_jsonb(s) into v_cfg from public.loyalty_settings s where s.cabang_id = p_cabang;
  if v_cfg is null then v_cfg := public.loyalty_cfg_default(); end if;
  return coalesce((public.loyalty_hitung_poin_detail(v_cfg, p_tipe, p_subtotal, p_harga_akhir, p_tanggal, p_retur)->>'poin')::integer, 0);
end $$;

revoke all on function public.loyalty_hitung_poin(text, text, numeric, numeric, date, boolean) from public, anon, authenticated;
grant execute on function public.loyalty_hitung_poin(text, text, numeric, numeric, date, boolean) to service_role;
grant execute on function public.loyalty_hitung_poin_detail(jsonb, text, numeric, numeric, date, boolean) to service_role;
grant execute on function public.loyalty_cfg_default() to service_role;

------------------------------------------------------------------------
-- 4. Trigger penjualan dan retur membaca pengaturan
--    (isi lain identik dengan migrasi 20260925070000; hanya perhitungan
--    v_points yang berubah, dengan cadangan rumus lama bila gagal)
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_after_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_customer public.master_customer%ROWTYPE; v_points integer;
BEGIN
  IF NULLIF(TRIM(NEW.nomor_wa),'') IS NULL THEN RETURN NEW; END IF;
  BEGIN
    v_points := public.loyalty_hitung_poin(NEW.cabang_id, NEW.tipe_customer, NEW.subtotal, NEW.harga_akhir, NEW.tanggal, false);
  EXCEPTION WHEN OTHERS THEN
    -- Cadangan: rumus lama, agar penjualan tidak pernah gagal karena pengaturan.
    v_points := CASE
      WHEN NEW.tipe_customer IN ('Apotek Lain','Tenaga Kesehatan') THEN 0
      ELSE FLOOR(GREATEST(0, NEW.harga_akhir) / 1000)::integer
    END;
  END;
  INSERT INTO public.master_customer (cabang_id, nomor_wa, nama, tipe_customer, total_belanja, jumlah_transaksi, tanggal_terakhir_beli, total_points, total_spend_mtd)
  VALUES (NEW.cabang_id, NEW.nomor_wa, COALESCE(NULLIF(NEW.nama_pelanggan,''),'Umum'), NEW.tipe_customer, GREATEST(0,NEW.harga_akhir), 1, NEW.tanggal, v_points, GREATEST(0,NEW.harga_akhir))
  ON CONFLICT (cabang_id, nomor_wa) DO UPDATE SET
    nama=EXCLUDED.nama, tipe_customer=EXCLUDED.tipe_customer,
    total_belanja=public.master_customer.total_belanja+GREATEST(0,NEW.harga_akhir),
    jumlah_transaksi=public.master_customer.jumlah_transaksi+1,
    tanggal_terakhir_beli=NEW.tanggal,
    total_points=GREATEST(0,public.master_customer.total_points+v_points),
    total_spend_mtd=public.master_customer.total_spend_mtd+GREATEST(0,NEW.harga_akhir);
  SELECT * INTO v_customer FROM public.master_customer WHERE cabang_id=NEW.cabang_id AND nomor_wa=NEW.nomor_wa;
  INSERT INTO public.loyalty_transactions(cabang_id,customer_id,no_nota,points_change,reason,expired)
  VALUES (NEW.cabang_id,v_customer.id,NEW.no_nota,v_points,'purchase',false);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.loyalty_after_return()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_customer public.master_customer%ROWTYPE; v_points integer;
BEGIN
  IF NULLIF(TRIM(NEW.nomor_wa),'') IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_customer FROM public.master_customer WHERE cabang_id=NEW.cabang_id AND nomor_wa=NEW.nomor_wa FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  BEGIN
    v_points := public.loyalty_hitung_poin(NEW.cabang_id, v_customer.tipe_customer, NEW.total_refund, NEW.total_refund, NEW.tanggal, true);
  EXCEPTION WHEN OTHERS THEN
    v_points := CASE
      WHEN v_customer.tipe_customer IN ('Apotek Lain','Tenaga Kesehatan') THEN 0
      ELSE FLOOR(GREATEST(0, NEW.total_refund) / 1000)::integer
    END;
  END;
  UPDATE public.master_customer
  SET total_belanja=GREATEST(0,total_belanja-GREATEST(0,NEW.total_refund)),
      total_spend_mtd=GREATEST(0,total_spend_mtd-GREATEST(0,NEW.total_refund)),
      total_points=GREATEST(0,total_points-v_points)
  WHERE id=v_customer.id;
  INSERT INTO public.loyalty_transactions(cabang_id,customer_id,no_nota,points_change,reason)
  VALUES (NEW.cabang_id,v_customer.id,NEW.no_retur,-v_points,'return_adjustment');
  RETURN NEW;
END;
$$;
