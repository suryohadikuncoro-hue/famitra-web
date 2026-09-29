-- LOCAL/isolated test DB ONLY. Requires all three lottery migrations + application schema.
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

-- Minimum cumulative spending: independent fixtures, never real patient data.
insert into public.master_customer(id,nomor_wa,nama,tipe_customer,cabang_id)
values ('10000000-0000-4000-8000-000000000005','628000000005','Below','Umum','LOT_TEST_A'),
       ('10000000-0000-4000-8000-000000000006','628000000006','Equal cumulative','Umum','LOT_TEST_A'),
       ('10000000-0000-4000-8000-000000000007','628000000007','Above','Umum','LOT_TEST_A'),
       ('10000000-0000-4000-8000-000000000008','628000000008','Wrong branch dates','Umum','LOT_TEST_A'),
       ('10000000-0000-4000-8000-000000000009','628000000009','Zero purchase','Umum','LOT_TEST_A');
insert into public.trx_penjualan(no_nota,tanggal,jam,nomor_wa,nama_pelanggan,tipe_customer,petugas_transaksi,shift,subtotal,diskon,harga_akhir,total_hpp,bayar,kembalian,cabang_id)
select invoice,day::date,'23:59',phone,'Lottery test','Umum','lot-test-owner','Sore',amount,0,amount,0,amount,0,branch
from (values
  ('LOT-MIN-BELOW','2026-09-30','628000000005',299999.99,'LOT_TEST_A'),
  ('LOT-MIN-EQUAL-START','2026-09-01','628000000006',100000,'LOT_TEST_A'),
  ('LOT-MIN-EQUAL-END','2026-09-30','628000000006',200000,'LOT_TEST_A'),
  ('LOT-MIN-ABOVE','2026-09-30','628000000007',300000.01,'LOT_TEST_A'),
  ('LOT-MIN-SCOPE-IN','2026-09-15','628000000008',50,'LOT_TEST_A'),
  ('LOT-MIN-OTHER-BRANCH','2026-09-30','628000000008',999999,'LOT_TEST_B'),
  ('LOT-MIN-BEFORE','2026-08-31','628000000008',999999,'LOT_TEST_A'),
  ('LOT-MIN-AFTER','2026-10-01','628000000008',999999,'LOT_TEST_A'),
  ('LOT-MIN-ZERO','2026-09-30','628000000009',0,'LOT_TEST_A')
) as fixture(invoice,day,phone,amount,branch);

do $$
declare
  cid uuid; legacycid uuid; pid uuid; legacypid uuid; payload jsonb; winner jsonb;
  savedprize jsonb; bad jsonb; customerid text;
begin
  payload := '{"kode_cabang":"LOT_TEST_A","nama":"Spend threshold","periode_mulai":"2026-09-01","periode_selesai":"2026-09-30","min_total_belanja_idr":300000,"prizes":[{"nama_hadiah":"Spend prize","nilai_hadiah_idr":25,"probabilitas_persen":10}]}'::jsonb;
  cid := (public.lottery_save_campaign('lot-test-owner-token',payload)->>'id')::uuid;
  select id, jsonb_build_object('id',id,'nama_hadiah',nama_hadiah,'nilai_hadiah_idr',nilai_hadiah_idr,'probabilitas_persen',probabilitas_persen)
    into pid, savedprize from public.lottery_prizes where campaign_id=cid;
  if (select min_total_belanja_idr from public.lottery_campaigns where id=cid) <> 300000 then
    raise exception 'TEST FAILED: minimum not persisted';
  end if;
  -- Lower/higher boundary including direct RPC with bogus client totals/minimum.
  winner := jsonb_build_object('campaign_id',cid,'prize_id',pid,'coupon_expired_at','2026-10-31',
    'min_total_belanja_idr',0,'total_belanja_periode',99999999);
  foreach customerid in array array['10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000008'] loop
    begin
      perform public.lottery_record_winner('lot-test-owner-token',winner || jsonb_build_object('customer_id',customerid));
      raise exception 'TEST FAILED: below/scope threshold bypass';
    exception when raise_exception then
      if SQLERRM not like 'Total belanja pelanggan selama campaign belum memenuhi minimum%' then raise; end if;
    end;
  end loop;
  foreach customerid in array array['10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000007'] loop
    perform public.lottery_record_winner('lot-test-owner-token',winner || jsonb_build_object('customer_id',customerid));
  end loop;
  if (select count(*) from public.lottery_winners where campaign_id=cid) <> 2 then raise exception 'TEST FAILED: equal/above not eligible'; end if;

  -- Omitted field on edit preserves configured minimum; not reset by old clients.
  payload := payload || jsonb_build_object('id',cid,'prizes',jsonb_build_array(savedprize));
  perform public.lottery_save_campaign('lot-test-owner-token',payload - 'min_total_belanja_idr');
  if (select min_total_belanja_idr from public.lottery_campaigns where id=cid) <> 300000 then raise exception 'TEST FAILED: omitted edit reset minimum'; end if;
  -- New minimum changes FUTURE eligibility only. All historical winners stay.
  perform public.lottery_save_campaign('lot-test-owner-token',payload || '{"min_total_belanja_idr":"300000.02"}'::jsonb);
  if (select min_total_belanja_idr from public.lottery_campaigns where id=cid) <> 300000.02 then raise exception 'TEST FAILED: precision lost'; end if;
  begin
    perform public.lottery_record_winner('lot-test-owner-token',winner || '{"customer_id":"10000000-0000-4000-8000-000000000007"}'::jsonb);
    raise exception 'TEST FAILED: stale eligibility accepted';
  exception when raise_exception then
    if SQLERRM not like 'Total belanja pelanggan selama campaign belum memenuhi minimum%' then raise; end if;
  end;
  if (select count(*) from public.lottery_winners where campaign_id=cid) <> 2 then raise exception 'TEST FAILED: threshold edit changed history'; end if;

  -- Direct campaign RPC must reject malformed values before column rounding.
  for bad in select value from jsonb_array_elements('[-1,-0.01,null,""," ",true,false,[],{},"NaN","Infinity","-Infinity","300.001",0.001,"300,000","0x10","1e3",1000000000000]'::jsonb) loop
    begin
      perform public.lottery_save_campaign('lot-test-owner-token',payload || jsonb_build_object('nama','Must rollback','min_total_belanja_idr',bad));
      raise exception 'TEST FAILED: invalid minimum accepted %',bad;
    exception when raise_exception then
      if SQLERRM not like 'Minimum total belanja harus%' then raise; end if;
    end;
    if (select min_total_belanja_idr from public.lottery_campaigns where id=cid) <> 300000.02
       or (select nama from public.lottery_campaigns where id=cid) <> 'Spend threshold' then
      raise exception 'TEST FAILED: invalid minimum changed campaign';
    end if;
  end loop;
  -- Maximum permitted precision/range round-trip.
  perform public.lottery_save_campaign('lot-test-owner-token',payload || '{"min_total_belanja_idr":"999999999999.99"}'::jsonb);
  if (select min_total_belanja_idr from public.lottery_campaigns where id=cid) <> 999999999999.99 then raise exception 'TEST FAILED: maximum lost precision'; end if;
  -- Column constraint independently rejects a negative or NaN minimum.
  begin
    update public.lottery_campaigns set min_total_belanja_idr=-1 where id=cid;
    raise exception 'TEST FAILED: negative column accepted';
  exception when check_violation then null;
  end;
  begin
    update public.lottery_campaigns set min_total_belanja_idr='NaN'::numeric where id=cid;
    raise exception 'TEST FAILED: NaN column accepted';
  exception when check_violation then null;
  end;

  -- Legacy create omitted threshold defaults to zero, but still needs a purchase.
  legacycid := (public.lottery_save_campaign('lot-test-owner-token',
    (payload - 'id' - 'min_total_belanja_idr') || jsonb_build_object('prizes',jsonb_build_array(savedprize - 'id')))->>'id')::uuid;
  select id into legacypid from public.lottery_prizes where campaign_id=legacycid;
  if (select min_total_belanja_idr from public.lottery_campaigns where id=legacycid) <> 0 then raise exception 'TEST FAILED: legacy default'; end if;
  winner := jsonb_build_object('campaign_id',legacycid,'prize_id',legacypid,'coupon_expired_at','2026-10-31');
  perform public.lottery_record_winner('lot-test-owner-token',winner || '{"customer_id":"10000000-0000-4000-8000-000000000009"}'::jsonb);
  begin
    perform public.lottery_record_winner('lot-test-owner-token',winner || '{"customer_id":"10000000-0000-4000-8000-000000000003"}'::jsonb);
    raise exception 'TEST FAILED: no purchase at zero accepted';
  exception when raise_exception then
    if SQLERRM not like 'Pelanggan belum memiliki transaksi%' then raise; end if;
  end;
  -- No old signature/overload may remain available as an eligibility escape.
  foreach customerid in array array['lottery_save_campaign','lottery_record_winner'] loop
    if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=customerid) <> 1 then
      raise exception 'TEST FAILED: unexpected RPC overload %',customerid;
    end if;
    if has_function_privilege('anon',format('public.%I(text,jsonb)',customerid),'EXECUTE')
       or has_function_privilege('authenticated',format('public.%I(text,jsonb)',customerid),'EXECUTE')
       or not has_function_privilege('service_role',format('public.%I(text,jsonb)',customerid),'EXECUTE') then
      raise exception 'TEST FAILED: incorrect RPC grants %',customerid;
    end if;
  end loop;
end $$;

-- ============================================================================
-- Syarat transaksi (migrasi 20260929010000_lottery_min_transaksi.sql):
-- min_jumlah_transaksi + min_belanja_per_transaksi_idr. Transaksi di bawah batas per
-- transaksi TIDAK dihitung (jumlah maupun total belanja). Default = perilaku lama.
-- ============================================================================
insert into public.master_customer(id,nomor_wa,nama,tipe_customer,cabang_id)
values ('20000000-0000-4000-8000-000000000001','628100000001','Sepuluh x 25rb','Umum','LOT_TEST_A'),
       ('20000000-0000-4000-8000-000000000002','628100000002','Sembilan x 25rb + kecil','Umum','LOT_TEST_A'),
       ('20000000-0000-4000-8000-000000000003','628100000003','Sepuluh x 24999.99','Umum','LOT_TEST_A'),
       ('20000000-0000-4000-8000-000000000004','628100000004','Satu transaksi besar','Umum','LOT_TEST_A');
insert into public.trx_penjualan(no_nota,tanggal,jam,nomor_wa,nama_pelanggan,tipe_customer,petugas_transaksi,shift,subtotal,diskon,harga_akhir,total_hpp,bayar,kembalian,cabang_id)
select 'LOT-RULE-'||phone||'-'||n,'2026-09-15','10:00',phone,'Lottery rule test','Umum','lot-test-owner','Pagi',amount,0,amount,0,amount,0,'LOT_TEST_A'
from (
  select '628100000001' phone, n, 25000::numeric amount from generate_series(1,10) n            -- tepat 25.000 x10 (batas inklusif)
  union all select '628100000002', n, 25000 from generate_series(1,9) n                          -- 9 transaksi yang dihitung
  union all select '628100000002', 100+n, 10000 from generate_series(1,5) n                      -- 5 transaksi kecil: tidak dihitung
  union all select '628100000003', n, 24999.99 from generate_series(1,10) n                      -- semua sesen di bawah batas
  union all select '628100000004', 1, 900000
) x(phone,n,amount);

do $$
declare
  cid uuid; pid uuid; payload jsonb; winner jsonb; savedprize jsonb; customerid text; bad jsonb;
begin
  payload := '{"kode_cabang":"LOT_TEST_A","nama":"Syarat transaksi","periode_mulai":"2026-09-01","periode_selesai":"2026-09-30","min_jumlah_transaksi":10,"min_belanja_per_transaksi_idr":25000,"prizes":[{"nama_hadiah":"Rule prize","nilai_hadiah_idr":25,"probabilitas_persen":10}]}'::jsonb;
  cid := (public.lottery_save_campaign('lot-test-owner-token',payload)->>'id')::uuid;
  select id, jsonb_build_object('id',id,'nama_hadiah',nama_hadiah,'nilai_hadiah_idr',nilai_hadiah_idr,'probabilitas_persen',probabilitas_persen)
    into pid, savedprize from public.lottery_prizes where campaign_id=cid;
  if (select min_jumlah_transaksi from public.lottery_campaigns where id=cid) <> 10
     or (select min_belanja_per_transaksi_idr from public.lottery_campaigns where id=cid) <> 25000 then
    raise exception 'TEST FAILED: syarat transaksi tidak tersimpan';
  end if;
  winner := jsonb_build_object('campaign_id',cid,'prize_id',pid,'coupon_expired_at','2026-10-31',
    'min_jumlah_transaksi',1,'min_belanja_per_transaksi_idr',0);  -- nilai klien palsu harus diabaikan

  -- 10 x Rp25.000 (tepat di batas per transaksi, tepat 10 transaksi): lolos.
  perform public.lottery_record_winner('lot-test-owner-token',winner || '{"customer_id":"20000000-0000-4000-8000-000000000001"}'::jsonb);
  -- 9 dihitung + 5 kecil (total 14 transaksi tapi hanya 9 dihitung): ditolak dengan pesan jumlah.
  begin
    perform public.lottery_record_winner('lot-test-owner-token',winner || '{"customer_id":"20000000-0000-4000-8000-000000000002"}'::jsonb);
    raise exception 'TEST FAILED: 9 transaksi yang dihitung lolos';
  exception when raise_exception then
    if SQLERRM not like 'Jumlah transaksi pelanggan selama campaign belum memenuhi minimum (9 dari 10%' then raise; end if;
  end;
  -- 10 transaksi masing-masing Rp24.999,99 (sesen di bawah batas): tidak ada yang dihitung.
  begin
    perform public.lottery_record_winner('lot-test-owner-token',winner || '{"customer_id":"20000000-0000-4000-8000-000000000003"}'::jsonb);
    raise exception 'TEST FAILED: transaksi di bawah batas per transaksi dihitung';
  exception when raise_exception then
    if SQLERRM not like 'Jumlah transaksi pelanggan selama campaign belum memenuhi minimum (0 dari 10%' then raise; end if;
  end;
  -- 1 transaksi besar tidak menggantikan syarat jumlah transaksi.
  begin
    perform public.lottery_record_winner('lot-test-owner-token',winner || '{"customer_id":"20000000-0000-4000-8000-000000000004"}'::jsonb);
    raise exception 'TEST FAILED: satu transaksi besar menggantikan jumlah transaksi';
  exception when raise_exception then
    if SQLERRM not like 'Jumlah transaksi pelanggan selama campaign belum memenuhi minimum (1 dari 10%' then raise; end if;
  end;
  if (select count(*) from public.lottery_winners where campaign_id=cid) <> 1 then raise exception 'TEST FAILED: jumlah pemenang salah'; end if;

  -- Edit tanpa kunci baru mempertahankan nilai tersimpan (klien lama tidak mereset).
  payload := payload || jsonb_build_object('id',cid,'prizes',jsonb_build_array(savedprize));
  perform public.lottery_save_campaign('lot-test-owner-token',(payload - 'min_jumlah_transaksi') - 'min_belanja_per_transaksi_idr');
  if (select min_jumlah_transaksi from public.lottery_campaigns where id=cid) <> 10
     or (select min_belanja_per_transaksi_idr from public.lottery_campaigns where id=cid) <> 25000 then
    raise exception 'TEST FAILED: edit tanpa kunci baru mereset syarat';
  end if;

  -- Turunkan jumlah ke 9: pelanggan 2 (9 dihitung) kini lolos; pemenang lama tidak berubah.
  perform public.lottery_save_campaign('lot-test-owner-token',payload || '{"min_jumlah_transaksi":"9"}'::jsonb);
  perform public.lottery_record_winner('lot-test-owner-token',winner || '{"customer_id":"20000000-0000-4000-8000-000000000002"}'::jsonb);
  if (select count(*) from public.lottery_winners where campaign_id=cid) <> 2 then raise exception 'TEST FAILED: pemenang setelah ubah syarat'; end if;

  -- Total belanja hanya dari transaksi yang dihitung: pelanggan 2 = 225.000 dihitung (+50.000 kecil tidak dihitung).
  perform public.lottery_save_campaign('lot-test-owner-token',payload || '{"min_jumlah_transaksi":9,"min_total_belanja_idr":250000}'::jsonb);
  begin
    perform public.lottery_record_winner('lot-test-owner-token',winner || '{"customer_id":"20000000-0000-4000-8000-000000000002"}'::jsonb);
    raise exception 'TEST FAILED: belanja transaksi kecil ikut dihitung ke total';
  exception when raise_exception then
    if SQLERRM not like 'Total belanja pelanggan selama campaign belum memenuhi minimum%' then raise; end if;
  end;
  perform public.lottery_save_campaign('lot-test-owner-token',payload || '{"min_jumlah_transaksi":9,"min_total_belanja_idr":225000}'::jsonb);
  perform public.lottery_record_winner('lot-test-owner-token',winner || '{"customer_id":"20000000-0000-4000-8000-000000000002"}'::jsonb);

  -- Batas per transaksi 0 = semua transaksi dihitung (perilaku lama): 14 transaksi pelanggan 2.
  perform public.lottery_save_campaign('lot-test-owner-token',payload || '{"min_jumlah_transaksi":14,"min_belanja_per_transaksi_idr":0,"min_total_belanja_idr":0}'::jsonb);
  perform public.lottery_record_winner('lot-test-owner-token',winner || '{"customer_id":"20000000-0000-4000-8000-000000000002"}'::jsonb);

  -- Nilai tidak valid ditolak dan tidak mengubah data tersimpan.
  foreach customerid in array array['min_jumlah_transaksi','min_belanja_per_transaksi_idr'] loop
    for bad in select value from jsonb_array_elements(case customerid
      when 'min_jumlah_transaksi' then '[0,-1,1001,"1.5","",null,true,"abc","10000",1.5]'::jsonb
      else '[-1,"-0.01","",null,true,"NaN","25000.001","25,000",1000000000000]'::jsonb end) loop
      begin
        perform public.lottery_save_campaign('lot-test-owner-token',payload || jsonb_build_object(customerid,bad));
        raise exception 'TEST FAILED: % menerima %',customerid,bad;
      exception when raise_exception then
        if SQLERRM like 'TEST FAILED%' then raise; end if;
      end;
    end loop;
  end loop;
  if (select min_jumlah_transaksi from public.lottery_campaigns where id=cid) <> 14 then raise exception 'TEST FAILED: nilai tidak valid mengubah data'; end if;
  -- Batas atas diterima; kendala tabel menjaga nilai di luar rentang.
  perform public.lottery_save_campaign('lot-test-owner-token',payload || '{"min_jumlah_transaksi":1000,"min_belanja_per_transaksi_idr":"999999999999.99"}'::jsonb);
  begin update public.lottery_campaigns set min_jumlah_transaksi=0 where id=cid; raise exception 'TEST FAILED: check jumlah'; exception when check_violation then null; end;
  begin update public.lottery_campaigns set min_belanja_per_transaksi_idr=-1 where id=cid; raise exception 'TEST FAILED: check per transaksi'; exception when check_violation then null; end;

  -- Campaign baru tanpa kunci baru memakai default lama (1 transaksi, semua transaksi dihitung).
  cid := (public.lottery_save_campaign('lot-test-owner-token',(payload - 'id' - 'min_jumlah_transaksi' - 'min_belanja_per_transaksi_idr') || jsonb_build_object('prizes',jsonb_build_array(savedprize - 'id')))->>'id')::uuid;
  if (select min_jumlah_transaksi from public.lottery_campaigns where id=cid) <> 1
     or (select min_belanja_per_transaksi_idr from public.lottery_campaigns where id=cid) <> 0 then
    raise exception 'TEST FAILED: default campaign baru';
  end if;
end $$;
rollback;
