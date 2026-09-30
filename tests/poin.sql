-- LOCAL/isolated test DB ONLY. Requires migrasi loyalty 20260925070000 dan
-- 20260929020000_loyalty_pengaturan_perolehan.sql + skema aplikasi.
-- Jalankan: psql -v ON_ERROR_STOP=1 -f tests/poin.sql ; semua fixture di-rollback.
begin;
insert into public.master_cabang(kode_cabang,nama_cabang) values ('POIN_A','Poin Test A'),('POIN_B','Poin Test B');

-- 1. REGRESI: tanpa pengaturan, hasil identik dengan rumus lama (migrasi 070000).
do $$
declare r record; legacy integer; got integer; n integer := 0;
begin
  for r in select a::numeric as amt, t.tipe from generate_series(0, 250000, 137) a,
           unnest(array['Umum','Tenaga Kesehatan','Apotek Lain']) as t(tipe) loop
    legacy := case when r.tipe in ('Apotek Lain','Tenaga Kesehatan') then 0 else floor(greatest(0, r.amt) / 1000)::integer end;
    got := public.loyalty_hitung_poin('POIN_A', r.tipe, r.amt, r.amt, date '2026-09-30');
    assert got = legacy, format('jual %s %s: got %s want %s', r.tipe, r.amt, got, legacy);
    got := public.loyalty_hitung_poin('POIN_A', r.tipe, r.amt, r.amt, date '2026-09-30', true);
    assert got = legacy, format('retur %s %s: got %s want %s', r.tipe, r.amt, got, legacy);
    n := n + 1;
  end loop;
  -- nilai tepi
  assert public.loyalty_hitung_poin('POIN_A','Umum',999.99,999.99,date '2026-09-30') = 0;
  assert public.loyalty_hitung_poin('POIN_A','Umum',1000,1000,date '2026-09-30') = 1;
  assert public.loyalty_hitung_poin('POIN_A','Umum',-500,-500,date '2026-09-30') = 0;
  assert public.loyalty_hitung_poin('POIN_A','Umum',null,null,date '2026-09-30') = 0;
  assert public.loyalty_hitung_poin('POIN_A',null,5500,5500,date '2026-09-30') = 5;
  raise notice 'regresi default OK (% kombinasi)', n;
end $$;

-- 2. TRIGGER end-to-end tanpa pengaturan (cabang POIN_A) = perilaku lama.
insert into public.trx_penjualan(no_nota,tanggal,jam,nomor_wa,nama_pelanggan,tipe_customer,petugas_transaksi,shift,subtotal,diskon,harga_akhir,total_hpp,bayar,kembalian,cabang_id)
values ('PT-1','2026-09-30','10:00','628110000001','Umum Satu','Umum','t','Pagi',26000,1000,25500,10000,25500,0,'POIN_A'),
       ('PT-2','2026-09-30','10:05','628110000002','Nakes Satu','Tenaga Kesehatan','t','Pagi',50000,0,50000,20000,50000,0,'POIN_A'),
       ('PT-3','2026-09-30','10:10','628110000003','Apotek Satu','Apotek Lain','t','Pagi',50000,0,50000,20000,50000,0,'POIN_A');
do $$
begin
  assert (select total_points from public.master_customer where nomor_wa='628110000001') = 25, 'umum default 25 poin';
  assert (select total_points from public.master_customer where nomor_wa='628110000002') = 0, 'nakes default 0';
  assert (select total_points from public.master_customer where nomor_wa='628110000003') = 0, 'apotek lain default 0';
  assert (select points_change from public.loyalty_transactions where no_nota='PT-1') = 25;
  raise notice 'trigger default OK';
end $$;

-- 3. Pengaturan: rumus, pembulatan, minimal, batas.
do $$
declare c jsonb;
begin
  insert into public.loyalty_settings(cabang_id, rupiah_per_kelipatan, poin_per_kelipatan, pembulatan, min_belanja, maks_poin_per_transaksi)
  values ('POIN_B', 10000, 2, 'bawah', 20000, 50);
  -- 15.000: di bawah minimal 20.000 -> 0
  assert public.loyalty_hitung_poin('POIN_B','Umum',15000,15000,date '2026-09-30') = 0, 'di bawah minimal';
  -- tepat minimal (inklusif): 20.000 -> 2 kelipatan x 2 = 4
  assert public.loyalty_hitung_poin('POIN_B','Umum',20000,20000,date '2026-09-30') = 4, 'minimal inklusif';
  -- 25.000 bawah: 2 kelipatan -> 4 poin
  assert public.loyalty_hitung_poin('POIN_B','Umum',25000,25000,date '2026-09-30') = 4, 'bawah';
  -- batas maksimal 50: 1.000.000 -> 100 kelipatan x 2 = 200 -> 50
  assert public.loyalty_hitung_poin('POIN_B','Umum',1000000,1000000,date '2026-09-30') = 50, 'cap';
  -- retur mengabaikan minimal belanja dan batas maksimal per transaksi (hanya rasio dasar)
  assert public.loyalty_hitung_poin('POIN_B','Umum',15000,15000,date '2026-09-30', true) = 2, 'retur tidak kena minimal belanja';
  assert public.loyalty_hitung_poin('POIN_B','Umum',1000000,1000000,date '2026-09-30', true) = 200, 'retur tidak kena batas maksimal';
  update public.loyalty_settings set pembulatan='atas', min_belanja=0 where cabang_id='POIN_B';
  assert public.loyalty_hitung_poin('POIN_B','Umum',25000,25000,date '2026-09-30') = 6, 'atas: ceil(2.5)=3 x2';
  update public.loyalty_settings set pembulatan='terdekat' where cabang_id='POIN_B';
  assert public.loyalty_hitung_poin('POIN_B','Umum',25000,25000,date '2026-09-30') = 6, 'terdekat 2.5 -> 3';
  assert public.loyalty_hitung_poin('POIN_B','Umum',24999,24999,date '2026-09-30') = 4, 'terdekat 2.4999 -> 2';
  -- basis subtotal vs harga_akhir
  update public.loyalty_settings set pembulatan='bawah', basis_hitung='subtotal' where cabang_id='POIN_B';
  assert public.loyalty_hitung_poin('POIN_B','Umum',30000,10000,date '2026-09-30') = 6, 'basis subtotal';
  update public.loyalty_settings set basis_hitung='harga_akhir' where cabang_id='POIN_B';
  assert public.loyalty_hitung_poin('POIN_B','Umum',30000,10000,date '2026-09-30') = 2, 'basis harga_akhir';
  -- program nonaktif
  update public.loyalty_settings set aktif=false where cabang_id='POIN_B';
  assert public.loyalty_hitung_poin('POIN_B','Umum',30000,30000,date '2026-09-30') = 0, 'nonaktif';
  update public.loyalty_settings set aktif=true where cabang_id='POIN_B';
  -- faktor tipe: Tenaga Kesehatan boleh dapat poin 0,5x
  update public.loyalty_settings set faktor_tipe='{"Umum":1,"Tenaga Kesehatan":0.5,"Apotek Lain":0}' where cabang_id='POIN_B';
  assert public.loyalty_hitung_poin('POIN_B','Tenaga Kesehatan',40000,40000,date '2026-09-30') = 4, 'nakes 0,5x: 4 kel x2 x0,5';
  assert public.loyalty_hitung_poin('POIN_B','Apotek Lain',40000,40000,date '2026-09-30') = 0, 'apotek lain 0';
  raise notice 'rumus & batas OK';
end $$;

-- 4. Pengganda: hari, periode, cara gabung.
do $$
begin
  -- 2026-09-29 = Selasa (dow 2), 2026-09-30 = Rabu (dow 3)
  update public.loyalty_settings set rupiah_per_kelipatan=1000, poin_per_kelipatan=1, pembulatan='bawah',
    maks_poin_per_transaksi=null, faktor_tipe='{"Umum":1,"Tenaga Kesehatan":0,"Apotek Lain":0}',
    gabung_pengganda='tertinggi',
    pengganda='[{"nama":"Selasa 2x","aktif":true,"faktor":2,"hari":[2]},
                {"nama":"Akhir bulan 3x","aktif":true,"faktor":3,"mulai":"2026-09-30","selesai":"2026-09-30"},
                {"nama":"Mati","aktif":false,"faktor":10}]'::jsonb
  where cabang_id='POIN_B';
  assert public.loyalty_hitung_poin('POIN_B','Umum',10000,10000,date '2026-09-29') = 20, 'selasa 2x';
  assert public.loyalty_hitung_poin('POIN_B','Umum',10000,10000,date '2026-09-30') = 30, 'periode 3x (rabu)';
  assert public.loyalty_hitung_poin('POIN_B','Umum',10000,10000,date '2026-10-01') = 10, 'di luar pengganda';
  update public.loyalty_settings set gabung_pengganda='kali' where cabang_id='POIN_B';
  update public.loyalty_settings set pengganda='[{"nama":"A","aktif":true,"faktor":2},{"nama":"B","aktif":true,"faktor":3}]' where cabang_id='POIN_B';
  assert public.loyalty_hitung_poin('POIN_B','Umum',10000,10000,date '2026-09-30') = 60, 'kali 2x3';
  update public.loyalty_settings set gabung_pengganda='jumlah' where cabang_id='POIN_B';
  assert public.loyalty_hitung_poin('POIN_B','Umum',10000,10000,date '2026-09-30') = 40, 'jumlah 1+1+2 = 4x';
  update public.loyalty_settings set gabung_pengganda='tertinggi' where cabang_id='POIN_B';
  assert public.loyalty_hitung_poin('POIN_B','Umum',10000,10000,date '2026-09-30') = 30, 'tertinggi 3x';
  -- pengganda tidak berlaku di retur
  assert public.loyalty_hitung_poin('POIN_B','Umum',10000,10000,date '2026-09-30', true) = 10, 'retur tanpa pengganda';
  -- rincian
  assert (public.loyalty_hitung_poin_detail((select to_jsonb(s) from public.loyalty_settings s where cabang_id='POIN_B'),
          'Umum',10000,10000,date '2026-09-30')->>'faktor_promo')::numeric = 3, 'rincian faktor_promo';
  raise notice 'pengganda OK';
end $$;

-- 5. Trigger memakai pengaturan cabang + retur.
do $$
begin
  update public.loyalty_settings set pengganda='[]', gabung_pengganda='tertinggi',
    rupiah_per_kelipatan=5000, poin_per_kelipatan=1 where cabang_id='POIN_B';
end $$;
insert into public.master_customer(nomor_wa,nama,tipe_customer,cabang_id) values ('628220000001','Cust B','Umum','POIN_B');
insert into public.trx_penjualan(no_nota,tanggal,jam,nomor_wa,nama_pelanggan,tipe_customer,petugas_transaksi,shift,subtotal,diskon,harga_akhir,total_hpp,bayar,kembalian,cabang_id)
values ('PT-B1','2026-09-30','11:00','628220000001','Cust B','Umum','t','Pagi',30000,0,30000,10000,30000,0,'POIN_B');
do $$
begin
  assert (select total_points from public.master_customer where nomor_wa='628220000001') = 6, 'trigger pakai 5000/poin';
end $$;
insert into public.trx_retur_jual(no_retur,no_nota_asal,tanggal,jam,nomor_wa,nama_pelanggan,petugas,shift,alasan,total_refund,cabang_id)
values ('RT-B1','PT-B1','2026-09-30','12:00','628220000001','Cust B','t','Pagi','uji',10000,'POIN_B');
do $$
begin
  assert (select total_points from public.master_customer where nomor_wa='628220000001') = 4, 'retur 10000/5000 = -2';
  update public.loyalty_settings set retur_kurangi_poin=false where cabang_id='POIN_B';
end $$;
insert into public.trx_retur_jual(no_retur,no_nota_asal,tanggal,jam,nomor_wa,nama_pelanggan,petugas,shift,alasan,total_refund,cabang_id)
values ('RT-B2','PT-B1','2026-09-30','12:10','628220000001','Cust B','t','Pagi','uji',10000,'POIN_B');
do $$
begin
  assert (select total_points from public.master_customer where nomor_wa='628220000001') = 4, 'retur tidak kurangi poin';
  -- cabang lain tetap default (isolasi per cabang)
  assert (select total_points from public.master_customer where nomor_wa='628110000001') = 25, 'cabang A tidak terpengaruh';
  raise notice 'trigger + retur OK';
end $$;

-- 6. Cadangan: bila perhitungan gagal, penjualan tetap masuk dengan rumus lama.
create or replace function public.loyalty_hitung_poin(p_cabang text, p_tipe text, p_subtotal numeric, p_harga_akhir numeric, p_tanggal date, p_retur boolean default false)
returns integer language plpgsql as $$ begin raise exception 'sengaja gagal'; end $$;
insert into public.trx_penjualan(no_nota,tanggal,jam,nomor_wa,nama_pelanggan,tipe_customer,petugas_transaksi,shift,subtotal,diskon,harga_akhir,total_hpp,bayar,kembalian,cabang_id)
values ('PT-FB','2026-09-30','13:00','628330000001','Fallback','Umum','t','Pagi',7300,0,7300,1000,7300,0,'POIN_A');
do $$
begin
  assert (select total_points from public.master_customer where nomor_wa='628330000001') = 7, 'cadangan rumus lama';
  raise notice 'cadangan OK';
end $$;

-- 7. Constraint menolak nilai tidak valid.
do $$
declare bad text[] := array[
  'rupiah_per_kelipatan = 0', 'poin_per_kelipatan = 0', 'poin_per_kelipatan = 1001',
  'pembulatan = ''x''', 'min_belanja = -1', 'maks_poin_per_transaksi = 0',
  'basis_hitung = ''x''', 'gabung_pengganda = ''x''',
  'faktor_tipe = ''{"Lainnya":1}''::jsonb', 'faktor_tipe = ''{"Umum":-1}''::jsonb', 'faktor_tipe = ''{"Umum":101}''::jsonb',
  'faktor_tipe = ''[]''::jsonb',
  'pengganda = ''{}''::jsonb',
  'pengganda = ''[{"nama":"","aktif":true,"faktor":2}]''::jsonb',
  'pengganda = ''[{"nama":"A","aktif":true,"faktor":0}]''::jsonb',
  'pengganda = ''[{"nama":"A","aktif":true,"faktor":101}]''::jsonb',
  'pengganda = ''[{"nama":"A","aktif":true,"faktor":2,"hari":[7]}]''::jsonb',
  'pengganda = ''[{"nama":"A","aktif":true,"faktor":2,"hari":[]}]''::jsonb',
  'pengganda = ''[{"nama":"A","aktif":true,"faktor":2,"mulai":"2026-10-02","selesai":"2026-10-01"}]''::jsonb',
  'pengganda = ''[{"nama":"A","aktif":"ya","faktor":2}]''::jsonb'];
  b text;
begin
  foreach b in array bad loop
    begin
      execute 'update public.loyalty_settings set ' || b || ' where cabang_id = ''POIN_B''';
      raise exception 'seharusnya ditolak: %', b;
    exception when check_violation then null; end;
  end loop;
  raise notice 'constraint OK (% kasus)', array_length(bad, 1);
end $$;

-- 8. Riwayat tidak bisa diubah/dihapus.
insert into public.loyalty_settings_riwayat(cabang_id, disimpan_oleh, snapshot) values ('POIN_B','uji','{}');
do $$
begin
  begin update public.loyalty_settings_riwayat set disimpan_oleh='x' where cabang_id='POIN_B'; raise exception 'update lolos';
  exception when raise_exception then if sqlerrm like 'update lolos' then raise; end if; end;
  begin delete from public.loyalty_settings_riwayat where cabang_id='POIN_B'; raise exception 'delete lolos';
  exception when raise_exception then if sqlerrm like 'delete lolos' then raise; end if; end;
  raise notice 'riwayat immutable OK';
end $$;

-- 9. Hak akses.
do $$
begin
  assert has_table_privilege('service_role','public.loyalty_settings','select,insert,update'), 'service_role settings';
  assert has_table_privilege('service_role','public.loyalty_settings_riwayat','select,insert'), 'service_role riwayat';
  assert not has_table_privilege('service_role','public.loyalty_settings_riwayat','update'), 'riwayat tanpa update';
  assert not has_table_privilege('anon','public.loyalty_settings','select'), 'anon tanpa akses settings';
  assert not has_table_privilege('authenticated','public.loyalty_settings','select'), 'authenticated tanpa akses';
  assert not has_table_privilege('anon','public.loyalty_settings_riwayat','select'), 'anon tanpa akses riwayat';
  assert (select relrowsecurity from pg_class where oid='public.loyalty_settings'::regclass), 'RLS settings';
  assert (select relrowsecurity from pg_class where oid='public.loyalty_settings_riwayat'::regclass), 'RLS riwayat';
  assert not has_function_privilege('anon','public.loyalty_hitung_poin(text,text,numeric,numeric,date,boolean)','execute'), 'anon tanpa execute';
  raise notice 'hak akses OK';
end $$;
rollback;
