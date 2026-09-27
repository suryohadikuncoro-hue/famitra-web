-- LOCAL/isolated test DB ONLY. Requires both lottery migrations + application schema.
-- Run with psql -v ON_ERROR_STOP=1 -f tests/lottery.sql ; all fixtures rolled back.
begin;
insert into public.master_cabang(kode_cabang,nama_cabang) values ('LOT_TEST_A','Lottery Test A'),('LOT_TEST_B','Lottery Test B');
insert into public.app_users(username,nama,password_hash,role,aktif,cabang_id)
values ('lot-test-owner','Test owner','not-a-login-hash','Owner','YA','LOT_TEST_A'),
       ('lot-test-pharm','Test pharmacist','not-a-login-hash','Apoteker','YA','LOT_TEST_A');
insert into public.app_sessions(token,username,nama,role,shift,expires_at,cabang_id)
values ('lot-test-owner-token','lot-test-owner','Test owner','Owner','Pagi',now()+interval '1 hour','LOT_TEST_A'),
       ('lot-test-pharm-token','lot-test-pharm','Test pharmacist','Apoteker','Pagi',now()+interval '1 hour','LOT_TEST_A');
insert into public.master_customer(id,nomor_wa,nama,tipe_customer,cabang_id)
values ('10000000-0000-4000-8000-000000000001','628000000001','Eligible','Umum','LOT_TEST_A'),
       ('10000000-0000-4000-8000-000000000002','628000000002','Other branch','Umum','LOT_TEST_B'),
       ('10000000-0000-4000-8000-000000000003','628000000003','No purchase','Umum','LOT_TEST_A'),
       ('10000000-0000-4000-8000-000000000004','628000000004','Other pharmacy','Apotek Lain','LOT_TEST_A');
insert into public.trx_penjualan(no_nota,tanggal,jam,nomor_wa,nama_pelanggan,tipe_customer,petugas_transaksi,shift,subtotal,diskon,harga_akhir,total_hpp,bayar,kembalian,cabang_id)
values ('LOT-TEST-INVOICE','2026-09-30','20:59','628000000001','Eligible','Umum','lot-test-owner','Sore',100,0,100,60,100,0,'LOT_TEST_A');

do $$
declare
  cid uuid; othercid uuid; pid uuid; winner jsonb; payload jsonb; original_count integer;
begin
  payload := '{"kode_cabang":"LOT_TEST_A","nama":"Original","periode_mulai":"2026-09-01","periode_selesai":"2026-09-30","prizes":[{"nama_hadiah":"Prize","nilai_hadiah_idr":25,"probabilitas_persen":10}]}'::jsonb;
  cid := (public.lottery_save_campaign('lot-test-owner-token',payload)->>'id')::uuid;
  select id into pid from public.lottery_prizes where campaign_id=cid;
  othercid := (public.lottery_save_campaign('lot-test-owner-token',jsonb_set(payload,'{kode_cabang}','"LOT_TEST_B"'))->>'id')::uuid;
  -- Existing campaign authorization is checked before accepting supplied branch.
  begin
    perform public.lottery_save_campaign('lot-test-pharm-token', payload || jsonb_build_object('id',othercid));
    raise exception 'TEST FAILED: cross-branch update accepted';
  exception when raise_exception then
    if SQLERRM like 'TEST FAILED:%' then raise; end if;
  end;
  winner := jsonb_build_object('campaign_id',cid,'customer_id','10000000-0000-4000-8000-000000000001','prize_id',pid,'coupon_expired_at','2026-10-31');
  perform public.lottery_record_winner('lot-test-pharm-token',winner);
  perform public.lottery_record_winner('lot-test-pharm-token',winner); -- no invented once/customer rule
  if (select count(*) from public.lottery_winners where campaign_id=cid) <> 2 then raise exception 'TEST FAILED: multiple awards'; end if;
  for original_count in 2..4 loop
    begin
      perform public.lottery_record_winner('lot-test-owner-token',winner || jsonb_build_object('customer_id','10000000-0000-4000-8000-'||lpad(original_count::text,12,'0')));
      raise exception 'TEST FAILED: ineligible customer accepted';
    exception when raise_exception then
      if SQLERRM like 'TEST FAILED:%' then raise; end if;
    end;
  end loop;
  -- Mid-save failure must roll back the header, not leave partial changes.
  begin
    perform public.lottery_save_campaign('lot-test-owner-token',payload || jsonb_build_object('id',cid,'nama','Should rollback','prizes',jsonb_build_array(jsonb_build_object('id',pid,'nama_hadiah','Changed historical prize','nilai_hadiah_idr',999,'probabilitas_persen',10))));
    raise exception 'TEST FAILED: historical prize changed';
  exception when raise_exception then
    if SQLERRM like 'TEST FAILED:%' then raise; end if;
  end;
  if (select nama from public.lottery_campaigns where id=cid) <> 'Original' then raise exception 'TEST FAILED: partial header update'; end if;
  if (select nilai_hadiah_idr from public.lottery_prizes where id=pid) <> 25 then raise exception 'TEST FAILED: historical value changed'; end if;
  perform public.lottery_save_campaign('lot-test-owner-token',payload || jsonb_build_object('id',cid,'prizes','[]'::jsonb));
  if not (select retired from public.lottery_prizes where id=pid) then raise exception 'TEST FAILED: prize not retired'; end if;
  if (select count(*) from public.lottery_winners where campaign_id=cid) <> 2 then raise exception 'TEST FAILED: history lost'; end if;
  begin
    perform public.lottery_record_winner('lot-test-owner-token',winner);
    raise exception 'TEST FAILED: retired prize accepted';
  exception when raise_exception then
    if SQLERRM like 'TEST FAILED:%' then raise; end if;
  end;
  update public.app_sessions set expires_at=now()-interval '1 minute' where token='lot-test-pharm-token';
  begin
    perform public.lottery_save_campaign('lot-test-pharm-token',payload);
    raise exception 'TEST FAILED: expired session accepted';
  exception when raise_exception then
    if SQLERRM like 'TEST FAILED:%' then raise; end if;
  end;
  if has_function_privilege('anon','public.lottery_record_winner(text,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.lottery_save_campaign(text,jsonb)','EXECUTE') then
    raise exception 'TEST FAILED: public RPC grant';
  end if;
end $$;
rollback;
