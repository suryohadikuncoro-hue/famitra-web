-- Additive repair: atomic campaign editing and offline winner recording.
-- Do not run against production without separate deployment approval.
begin;
alter table public.lottery_prizes add column if not exists retired boolean not null default false;

create or replace function public.lottery_require_session(p_token text)
returns public.app_sessions
language plpgsql security invoker set search_path = public, pg_temp as $$
declare s public.app_sessions;
begin
  select * into s from public.app_sessions where token = p_token and expires_at > now();
  if not found then raise exception 'Sesi berakhir. Silakan login ulang.'; end if;
  if s.role not in ('Owner', 'Apoteker') then raise exception 'Akses lottery ditolak'; end if;
  if s.role = 'Apoteker' and nullif(btrim(s.cabang_id), '') is null then
    raise exception 'Sesi ini tidak punya cabang';
  end if;
  return s;
end $$;

create or replace function public.lottery_save_campaign(p_token text, p_data jsonb)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  s public.app_sessions; c public.lottery_campaigns; oldp public.lottery_prizes;
  cid uuid := nullif(p_data->>'id', '')::uuid;
  branch text := nullif(btrim(p_data->>'kode_cabang'), '');
  title text := nullif(btrim(p_data->>'nama'), '');
  start_date date := (p_data->>'periode_mulai')::date;
  end_date date := (p_data->>'periode_selesai')::date;
  p jsonb; pid uuid; ids uuid[] := '{}';
  pname text; product text; amount numeric; probability numeric; image text;
begin
  s := public.lottery_require_session(p_token);
  if branch is null or title is null or start_date is null or end_date is null or end_date < start_date then
    raise exception 'Nama, cabang dan periode campaign wajib valid';
  end if;
  if jsonb_typeof(p_data->'prizes') is distinct from 'array' then raise exception 'Daftar hadiah wajib dikirim'; end if;
  if s.role = 'Apoteker' and s.cabang_id <> branch then raise exception 'Akses cabang ditolak'; end if;
  if cid is not null then
    select * into c from public.lottery_campaigns where id = cid for update;
    if not found then raise exception 'Campaign tidak ditemukan'; end if;
    if s.role = 'Apoteker' and s.cabang_id <> c.kode_cabang then raise exception 'Akses cabang ditolak'; end if;
    -- Branch identity is immutable; make a new campaign for another branch.
    if c.kode_cabang <> branch then raise exception 'Cabang campaign tidak dapat dipindahkan'; end if;
    if (c.periode_mulai <> start_date or c.periode_selesai <> end_date)
       and exists(select 1 from public.lottery_winners where campaign_id = cid) then
      raise exception 'Periode campaign dengan pemenang tidak dapat diubah';
    end if;
    update public.lottery_campaigns set nama = title, periode_mulai = start_date,
      periode_selesai = end_date, catatan = p_data->>'catatan'
      where id = cid;
    -- Keep current active status; status has its own endpoint.
  else
    insert into public.lottery_campaigns(kode_cabang,nama,periode_mulai,periode_selesai,catatan,created_by)
    values(branch,title,start_date,end_date,p_data->>'catatan',s.username) returning id into cid;
  end if;
  for p in select value from jsonb_array_elements(p_data->'prizes') loop
    pid := nullif(p->>'id', '')::uuid;
    pname := coalesce(nullif(btrim(p->>'nama_hadiah'), ''), nullif(btrim(p->>'nama_produk'), ''));
    product := nullif(btrim(p->>'nama_produk'), '');
    image := nullif(btrim(p->>'gambar_url'), '');
    amount := (p->>'nilai_hadiah_idr')::numeric;
    probability := (p->>'probabilitas_persen')::numeric;
    if pname is null or amount is null or amount < 0 or amount > 999999999999.99
       or probability is null or probability < 0 or probability > 100
       or amount::text in ('NaN','Infinity','-Infinity') or probability::text in ('NaN','Infinity','-Infinity') then
      raise exception 'Nama, nilai atau probabilitas hadiah tidak valid';
    end if;
    if pid is not null then
      if pid = any(ids) then raise exception 'Hadiah duplikat'; end if;
      select * into oldp from public.lottery_prizes where id = pid and campaign_id = cid for update;
      if not found or oldp.retired then raise exception 'Hadiah tidak aktif atau bukan milik campaign'; end if;
      if exists(select 1 from public.lottery_winners where prize_id = pid)
         and (oldp.nama_hadiah is distinct from pname or oldp.nama_produk is distinct from product
           or oldp.nilai_hadiah_idr is distinct from amount or oldp.probabilitas_persen is distinct from probability
           or oldp.gambar_url is distinct from image) then
        raise exception 'Hadiah yang sudah memiliki pemenang tidak dapat diubah; tambahkan hadiah baru';
      end if;
      update public.lottery_prizes set nama_hadiah = pname, nama_produk = product,
        nilai_hadiah_idr = amount, probabilitas_persen = probability, gambar_url = image
        where id = pid and campaign_id = cid;
    else
      insert into public.lottery_prizes(campaign_id,nama_hadiah,nama_produk,nilai_hadiah_idr,probabilitas_persen,gambar_url)
      values(cid,pname,product,amount,probability,image) returning id into pid;
    end if;
    ids := array_append(ids, pid);
  end loop;
  -- Retire omitted prizes, never delete or break winner foreign keys/history.
  update public.lottery_prizes set retired = true where campaign_id = cid and not (id = any(ids));
  return jsonb_build_object('id', cid);
end $$;

create or replace function public.lottery_record_winner(p_token text, p_data jsonb)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  s public.app_sessions; c public.lottery_campaigns; customer public.master_customer;
  prize public.lottery_prizes; w public.lottery_winners;
  cid uuid := (p_data->>'campaign_id')::uuid;
  customerid uuid := (p_data->>'customer_id')::uuid;
  prizeid uuid := (p_data->>'prize_id')::uuid;
  expiry date := (p_data->>'coupon_expired_at')::date;
  pickup date := nullif(p_data->>'pickup_date', '')::date;
  pickupstatus public.lottery_pickup_status := coalesce(nullif(p_data->>'pickup_status',''), 'belum_diambil')::public.lottery_pickup_status;
begin
  s := public.lottery_require_session(p_token);
  select * into c from public.lottery_campaigns where id = cid for update;
  if not found then raise exception 'Campaign tidak ditemukan'; end if;
  if s.role = 'Apoteker' and s.cabang_id <> c.kode_cabang then raise exception 'Akses cabang ditolak'; end if;
  if expiry is null then raise exception 'Masa berlaku wajib diisi'; end if;
  if pickupstatus = 'sudah_diambil' and pickup is null then raise exception 'Tanggal ambil wajib diisi'; end if;
  select * into customer from public.master_customer where id = customerid for share;
  if not found or customer.cabang_id <> c.kode_cabang
     or customer.tipe_customer = 'Apotek Lain' or nullif(btrim(customer.nomor_wa),'') is null then
    raise exception 'Pelanggan tidak memenuhi syarat cabang/tipe/WhatsApp';
  end if;
  if not exists(select 1 from public.trx_penjualan t where t.cabang_id = c.kode_cabang
      and btrim(t.nomor_wa) = btrim(customer.nomor_wa)
      and t.tanggal >= c.periode_mulai and t.tanggal <= c.periode_selesai) then
    raise exception 'Pelanggan belum memiliki transaksi dalam periode campaign';
  end if;
  select * into prize from public.lottery_prizes where id = prizeid and campaign_id = cid and not retired for share;
  if not found then raise exception 'Hadiah tidak aktif atau bukan milik campaign'; end if;
  -- UUID-derived coupon, not a draw. Multiple awards per customer are allowed.
  for attempt in 1..5 loop
    begin
      insert into public.lottery_winners(campaign_id,customer_id,prize_id,coupon_code,coupon_expired_at,pickup_date,pickup_status,recorded_by)
      values(cid,customerid,prizeid,'LOT-' || upper(replace(gen_random_uuid()::text,'-','')),expiry,pickup,pickupstatus,s.username)
      returning * into w;
      return to_jsonb(w);
    exception when unique_violation then
      if attempt = 5 then raise; end if;
    end;
  end loop;
end $$;

-- Application RPCs must not be callable with public/anon/authenticated roles.
revoke all on function public.lottery_require_session(text) from public, anon, authenticated;
revoke all on function public.lottery_save_campaign(text,jsonb) from public, anon, authenticated;
revoke all on function public.lottery_record_winner(text,jsonb) from public, anon, authenticated;
grant execute on function public.lottery_require_session(text) to service_role;
grant execute on function public.lottery_save_campaign(text,jsonb) to service_role;
grant execute on function public.lottery_record_winner(text,jsonb) to service_role;
commit;
-- Rollback: revert lottery Edge/UI together; retain retired column and historical
-- rows. Do not restore the old DELETE-all-prizes implementation or remove history.
