-- Kupon Undian: syarat jumlah transaksi minimum dan minimal belanja per transaksi.
-- Additive: dua kolom dengan default yang mempertahankan perilaku lama (minimal 1
-- transaksi, tanpa batas per transaksi). Tidak menulis ulang riwayat/pemenang.
-- Apply only with separate approval; never run tests/migrations on production.
-- Reconciliation-safe: production may already contain these columns/RPCs while
-- migration history is missing. Existing columns are validated, not overwritten.
begin;
alter table public.lottery_campaigns
  add column if not exists min_jumlah_transaksi integer not null default 1,
  add column if not exists min_belanja_per_transaksi_idr numeric(14,2) not null default 0;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lottery_campaigns'
      and column_name in ('min_jumlah_transaksi', 'min_belanja_per_transaksi_idr')
      and (is_nullable <> 'NO' or column_default is null)
  ) then
    raise exception 'Kolom minimum lottery sudah ada tetapi default/not-null tidak sesuai; rekonsiliasi manual diperlukan';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lottery_campaigns'::regclass
      and conname = 'lottery_campaigns_min_jumlah_transaksi_check'
  ) then
    alter table public.lottery_campaigns add constraint lottery_campaigns_min_jumlah_transaksi_check
      check (min_jumlah_transaksi >= 1 and min_jumlah_transaksi <= 1000);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lottery_campaigns'::regclass
      and conname = 'lottery_campaigns_min_belanja_per_trx_check'
  ) then
    alter table public.lottery_campaigns add constraint lottery_campaigns_min_belanja_per_trx_check
      check (min_belanja_per_transaksi_idr >= 0 and min_belanja_per_transaksi_idr <= 999999999999.99);
  end if;
end $$;
comment on column public.lottery_campaigns.min_jumlah_transaksi is
  'Jumlah minimum transaksi yang DIHITUNG (harga_akhir >= min_belanja_per_transaksi_idr) di cabang dan periode campaign. Berlaku untuk pencatatan pemenang berikutnya; tidak mengubah pemenang lama.';
comment on column public.lottery_campaigns.min_belanja_per_transaksi_idr is
  'Minimal harga_akhir satu transaksi agar dihitung sebagai 1 transaksi. Transaksi di bawah nilai ini tidak dihitung untuk jumlah transaksi maupun total belanja campaign. 0 = semua transaksi dihitung.';

-- Replace the EXISTING signatures; no alternate overload with old eligibility.
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
  minimum numeric; min_trx integer; min_per numeric;
begin
  s := public.lottery_require_session(p_token);
  -- Match UI/Edge decimal validation before NUMERIC(14,2) can round input.
  -- Omitted field preserves an existing minimum; explicit null/blank is invalid.
  if p_data ? 'min_total_belanja_idr' then
    if jsonb_typeof(p_data->'min_total_belanja_idr') not in ('number','string')
       or (p_data->>'min_total_belanja_idr') !~ '^[0-9]{1,12}([.][0-9]{1,2})?$' then
      raise exception 'Minimum total belanja harus 0–999999999999.99, maksimal 2 desimal';
    end if;
    minimum := (p_data->>'min_total_belanja_idr')::numeric;
  end if;
  -- Field baru: sama seperti minimum, kunci yang tidak dikirim mempertahankan nilai tersimpan.
  if p_data ? 'min_jumlah_transaksi' then
    if jsonb_typeof(p_data->'min_jumlah_transaksi') not in ('number','string')
       or (p_data->>'min_jumlah_transaksi') !~ '^[0-9]{1,4}$'
       or (p_data->>'min_jumlah_transaksi')::integer not between 1 and 1000 then
      raise exception 'Minimal jumlah transaksi harus bilangan bulat 1–1000';
    end if;
    min_trx := (p_data->>'min_jumlah_transaksi')::integer;
  end if;
  if p_data ? 'min_belanja_per_transaksi_idr' then
    if jsonb_typeof(p_data->'min_belanja_per_transaksi_idr') not in ('number','string')
       or (p_data->>'min_belanja_per_transaksi_idr') !~ '^[0-9]{1,12}([.][0-9]{1,2})?$' then
      raise exception 'Minimal belanja per transaksi harus 0–999999999999.99, maksimal 2 desimal';
    end if;
    min_per := (p_data->>'min_belanja_per_transaksi_idr')::numeric;
  end if;
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
      periode_selesai = end_date, catatan = p_data->>'catatan',
      min_total_belanja_idr = coalesce(minimum, c.min_total_belanja_idr),
      min_jumlah_transaksi = coalesce(min_trx, c.min_jumlah_transaksi),
      min_belanja_per_transaksi_idr = coalesce(min_per, c.min_belanja_per_transaksi_idr)
      where id = cid;
    -- Keep current active status; status has its own endpoint.
  else
    insert into public.lottery_campaigns(kode_cabang,nama,periode_mulai,periode_selesai,catatan,created_by,min_total_belanja_idr,min_jumlah_transaksi,min_belanja_per_transaksi_idr)
    values(branch,title,start_date,end_date,p_data->>'catatan',s.username,coalesce(minimum,0),coalesce(min_trx,1),coalesce(min_per,0)) returning id into cid;
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
  purchase_count bigint; valid_amount_count bigint; purchase_total numeric;
  qualifying_count bigint; qualifying_total numeric;
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
  -- Recompute from authoritative final amounts, NOT customer lifetime totals
  -- or client-supplied eligibility. DATE boundaries include the entire last day.
  -- Campaign lock serializes this check with changes to minimum/period/prizes.
  select count(*), count(t.harga_akhir), sum(t.harga_akhir)
    into purchase_count, valid_amount_count, purchase_total
    from public.trx_penjualan t where t.cabang_id = c.kode_cabang
      and btrim(t.nomor_wa) = btrim(customer.nomor_wa)
      and t.tanggal >= c.periode_mulai and t.tanggal <= c.periode_selesai;
  if purchase_count = 0 then
    raise exception 'Pelanggan belum memiliki transaksi dalam periode campaign';
  end if;
  if valid_amount_count <> purchase_count or purchase_total::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Nilai transaksi tidak lengkap atau tidak valid';
  end if;
  -- Hanya transaksi dengan harga_akhir >= minimal per transaksi yang DIHITUNG
  -- (jumlah transaksi maupun total belanja). Default 0 = semua transaksi, sama seperti sebelumnya.
  select count(*), sum(t.harga_akhir)
    into qualifying_count, qualifying_total
    from public.trx_penjualan t where t.cabang_id = c.kode_cabang
      and btrim(t.nomor_wa) = btrim(customer.nomor_wa)
      and t.tanggal >= c.periode_mulai and t.tanggal <= c.periode_selesai
      and t.harga_akhir >= c.min_belanja_per_transaksi_idr;
  if qualifying_count < greatest(c.min_jumlah_transaksi, 1) then
    raise exception 'Jumlah transaksi pelanggan selama campaign belum memenuhi minimum (% dari % transaksi yang dihitung)', qualifying_count, greatest(c.min_jumlah_transaksi, 1);
  end if;
  if coalesce(qualifying_total, 0) < c.min_total_belanja_idr then
    raise exception 'Total belanja pelanggan selama campaign belum memenuhi minimum';
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

-- Preserve private RPC access and invoker security; no new public grants/RLS.
revoke all on function public.lottery_save_campaign(text,jsonb) from public, anon, authenticated;
revoke all on function public.lottery_record_winner(text,jsonb) from public, anon, authenticated;
grant execute on function public.lottery_save_campaign(text,jsonb) to service_role;
grant execute on function public.lottery_record_winner(text,jsonb) to service_role;
commit;
-- Rollback application only with coordinated approval. Keep columns/history;
-- never restore an RPC that bypasses a configured campaign minimum or transaction rule.
