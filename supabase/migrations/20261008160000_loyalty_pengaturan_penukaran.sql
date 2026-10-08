-- =====================================================================
-- Poin & Reward: pengaturan penukaran reward nominal per cabang
--
-- Sebelumnya aturan penukaran tertulis tetap di pos_checkout():
--   * Tenaga Kesehatan: nilai potongan dipotong setengah.
--   * Apotek Lain: ditolak sama sekali.
--   * Tidak ada batas minimal poin, batas persentase transaksi, maupun
--     batas penukaran harian/bulanan.
-- Migrasi ini memindahkan aturan itu ke pengaturan per cabang.
--
-- NILAI BAWAAN = PERILAKU SEKARANG (perhatikan faktor_tipe_tukar):
--   Umum 1x, Tenaga Kesehatan 0,5x, Apotek Lain 0x (0 = tidak boleh menukar).
--   min_poin_tukar 0, maks_persen_tukar 100 (100 = tanpa batas tambahan),
--   maks_tukar_per_hari 0 dan maks_tukar_per_bulan 0 (0 = tanpa batas).
-- Jadi perilaku tidak berubah sampai Owner menyimpan pengaturan.
--
-- Seluruh keputusan penukaran dihitung di SATU fungsi:
--   loyalty_tukar_periksa(). pos_checkout() memakainya, dan simulasi di
--   halaman Poin & Reward memakai fungsi yang sama supaya angkanya konsisten.
--   Bila pengaturan tidak terbaca, pos_checkout() jatuh ke aturan lama
--   sehingga penjualan tidak pernah gagal karena pengaturan.
--
-- PRASYARAT: migrasi 20260929020000 (tabel loyalty_settings) dan
-- 20260925050000 (fungsi pos_checkout). Bila belum ada, migrasi ini menolak
-- berjalan tanpa mengubah apa pun. Migrasi ini aditif dan aman dijalankan
-- berulang.
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
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'pos_checkout') then
    raise exception 'Prasyarat belum ada: fungsi pos_checkout belum ada (migrasi 20260925050000).';
  end if;
end $$;

------------------------------------------------------------------------
-- 1. Pengaturan penukaran per cabang
--    Bawaan = perilaku lama.
------------------------------------------------------------------------
alter table public.loyalty_settings
  add column if not exists faktor_tipe_tukar jsonb not null
    default jsonb_build_object('Umum', 1, 'Tenaga Kesehatan', 0.5, 'Apotek Lain', 0)
    check (public.loyalty_faktor_tipe_valid(faktor_tipe_tukar)),
  add column if not exists min_poin_tukar integer not null default 0
    check (min_poin_tukar between 0 and 1000000),
  add column if not exists maks_persen_tukar numeric(5,2) not null default 100
    check (maks_persen_tukar between 1 and 100),
  add column if not exists maks_tukar_per_hari integer not null default 0
    check (maks_tukar_per_hari between 0 and 1000),
  add column if not exists maks_tukar_per_bulan integer not null default 0
    check (maks_tukar_per_bulan between 0 and 10000);

comment on column public.loyalty_settings.faktor_tipe_tukar is
  'Faktor nilai penukaran per tipe pelanggan. 1 = penuh, 0,5 = setengah, 0 = tidak boleh menukar.';
comment on column public.loyalty_settings.min_poin_tukar is
  'Minimal saldo poin yang harus dimiliki pelanggan supaya bisa menukar. 0 = tanpa minimal.';
comment on column public.loyalty_settings.maks_persen_tukar is
  'Batas maksimal nilai transaksi yang boleh dibayar dengan poin, dalam persen. 100 = tanpa batas tambahan.';
comment on column public.loyalty_settings.maks_tukar_per_hari is
  'Batas jumlah penukaran per pelanggan per hari. 0 = tanpa batas.';
comment on column public.loyalty_settings.maks_tukar_per_bulan is
  'Batas jumlah penukaran per pelanggan per bulan. 0 = tanpa batas.';

------------------------------------------------------------------------
-- 2. Nilai bawaan pengaturan (dipakai UI, validasi, dan perhitungan)
--    Ditambah lima kolom penukaran; sisanya tetap sama dengan migrasi
--    20261008150000 supaya perilaku tidak berubah.
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
    'masa_berlaku_bulan', 12,
    'faktor_tipe_tukar', jsonb_build_object('Umum', 1, 'Tenaga Kesehatan', 0.5, 'Apotek Lain', 0),
    'min_poin_tukar', 0,
    'maks_persen_tukar', 100,
    'maks_tukar_per_hari', 0,
    'maks_tukar_per_bulan', 0
  )
$$;

------------------------------------------------------------------------
-- 3. Satu sumber kebenaran untuk keputusan penukaran
--    Dipakai pos_checkout() dan simulasi di halaman Poin & Reward, supaya
--    angka yang dilihat Owner sama dengan yang berlaku di kasir.
--
--    Catatan pemakaian poin: poin yang dipotong SELALU sebesar
--    loyalty_rewards.points_required (tidak berubah karena faktor tipe).
--    Faktor tipe hanya mempengaruhi NILAI POTONGAN dalam rupiah, sama
--    seperti perilaku lama yang memotong setengah untuk Tenaga Kesehatan.
------------------------------------------------------------------------
create or replace function public.loyalty_tukar_periksa(
  p_cabang_id text,
  p_reward_id uuid,
  p_nomor_wa text,
  p_subtotal numeric,
  p_diskon numeric default 0
) returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_cfg jsonb;
  v_reward public.loyalty_rewards%rowtype;
  v_cust public.master_customer%rowtype;
  v_faktor numeric;
  v_nilai numeric;
  v_dasar numeric;
  v_batas numeric;
  v_poin integer;
  v_min integer;
  v_persen numeric;
  v_batas_hari integer;
  v_batas_bulan integer;
  v_hari_ini integer := 0;
  v_bulan_ini integer := 0;
  v_tier_min integer;
  v_tier_cust integer;
  v_alasan text := null;
begin
  -- Bawaan ditimpa kolom yang tersimpan. to_jsonb(baris) membuat kolom baru
  -- otomatis ikut terbaca tanpa perlu menyebut satu per satu.
  select public.loyalty_cfg_default() || coalesce(to_jsonb(s), '{}'::jsonb)
    into v_cfg
  from (select 1) satu
  left join public.loyalty_settings s on s.cabang_id = p_cabang_id;

  select * into v_reward from public.loyalty_rewards
   where id = p_reward_id and cabang_id = p_cabang_id and is_active;
  if not found then
    return jsonb_build_object('boleh', false, 'alasan', 'Reward tidak tersedia pada cabang aktif.');
  end if;

  select * into v_cust from public.master_customer
   where cabang_id = p_cabang_id and nomor_wa = p_nomor_wa;
  if not found then
    return jsonb_build_object('boleh', false, 'alasan', 'Reward hanya dapat digunakan oleh pelanggan terdaftar.');
  end if;

  v_poin := coalesce(v_reward.points_required, 0);
  -- tipe_customer kosong diperlakukan sebagai Umum, supaya pelanggan lama tidak
  -- ikut terblokir hanya karena kolomnya belum terisi.
  v_faktor := coalesce((v_cfg->'faktor_tipe_tukar'->>coalesce(v_cust.tipe_customer, 'Umum'))::numeric, 0);
  v_min := coalesce((v_cfg->>'min_poin_tukar')::integer, 0);
  v_persen := coalesce((v_cfg->>'maks_persen_tukar')::numeric, 100);
  v_batas_hari := coalesce((v_cfg->>'maks_tukar_per_hari')::integer, 0);
  v_batas_bulan := coalesce((v_cfg->>'maks_tukar_per_bulan')::integer, 0);

  v_tier_min := case v_reward.min_tier when 'gold' then 3 when 'silver' then 2 else 1 end;
  v_tier_cust := case v_cust.tier when 'gold' then 3 when 'silver' then 2 else 1 end;

  v_dasar := greatest(0, coalesce(p_subtotal, 0) - greatest(0, coalesce(p_diskon, 0)));
  v_nilai := greatest(0, floor(coalesce(v_reward.reward_value, 0) * v_faktor));
  -- maks_persen_tukar 100 = tanpa batas tambahan (nilai boleh melebihi dasar,
  -- persis seperti perilaku lama; harga akhir tetap tidak pernah di bawah nol).
  if v_persen < 100 then
    v_batas := floor(v_dasar * v_persen / 100);
    if v_nilai > v_batas then v_nilai := v_batas; end if;
  end if;

  -- Hitungan penukaran dihitung SELALU, bukan hanya saat ada batas, supaya
  -- simulasi menampilkan angka yang benar. Baris yang ditandai batal
  -- (status 'CANCELLED') tidak ikut dihitung.
  select count(*) filter (where (d.created_at at time zone 'Asia/Jakarta')::date
                                = (now() at time zone 'Asia/Jakarta')::date),
         count(*)
    into v_hari_ini, v_bulan_ini
  from public.loyalty_redemptions d
  where d.cabang_id = p_cabang_id
    and d.customer_id = v_cust.id
    and coalesce(d.status, '') <> 'CANCELLED'
    and (d.created_at at time zone 'Asia/Jakarta')
        >= date_trunc('month', now() at time zone 'Asia/Jakarta');

  if v_faktor <= 0 then
    v_alasan := 'Tipe pelanggan ' || coalesce(v_cust.tipe_customer, 'Umum') || ' tidak mendapat penukaran poin.';
  elsif v_tier_cust < v_tier_min then
    v_alasan := 'Tier pelanggan belum memenuhi syarat reward ini (butuh ' || coalesce(v_reward.min_tier, 'reguler') || ').';
  elsif v_cust.total_points < v_poin then
    v_alasan := 'Poin tidak mencukupi: butuh ' || v_poin || ', tersedia ' || v_cust.total_points || '.';
  elsif v_min > 0 and v_cust.total_points < v_min then
    v_alasan := 'Minimal saldo ' || v_min || ' poin untuk bisa menukar.';
  elsif v_nilai <= 0 then
    v_alasan := 'Nilai penukaran reward ini nol.';
  elsif v_batas_hari > 0 and v_hari_ini >= v_batas_hari then
    v_alasan := 'Batas penukaran hari ini sudah tercapai (' || v_batas_hari || ' kali).';
  elsif v_batas_bulan > 0 and v_bulan_ini >= v_batas_bulan then
    v_alasan := 'Batas penukaran bulan ini sudah tercapai (' || v_batas_bulan || ' kali).';
  end if;

  return jsonb_build_object(
    'boleh', v_alasan is null,
    'alasan', v_alasan,
    'poin_dibutuhkan', v_poin,
    'poin_tersedia', v_cust.total_points,
    'sisa_setelah', greatest(0, v_cust.total_points - v_poin),
    'nilai_penukaran', case when v_alasan is null then v_nilai else 0 end,
    'nilai_reward', coalesce(v_reward.reward_value, 0),
    'faktor_tipe', v_faktor,
    'tipe_customer', coalesce(v_cust.tipe_customer, 'Umum'),
    'tier', coalesce(v_cust.tier, 'reguler'),
    'dasar', v_dasar,
    'maks_persen', v_persen,
    'min_poin', v_min,
    'batas_harian', v_batas_hari,
    'batas_bulanan', v_batas_bulan,
    'tukar_hari_ini', v_hari_ini,
    'tukar_bulan_ini', v_bulan_ini
  );
end;
$function$;

comment on function public.loyalty_tukar_periksa(text, uuid, text, numeric, numeric) is
  'Keputusan penukaran reward: tier, faktor tipe pelanggan, minimal poin, batas persentase transaksi, dan batas harian/bulanan. Dipakai pos_checkout dan simulasi.';

revoke all on function public.loyalty_tukar_periksa(text, uuid, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.loyalty_tukar_periksa(text, uuid, text, numeric, numeric) to service_role;

revoke all on function public.loyalty_cfg_default() from public, anon, authenticated;
grant execute on function public.loyalty_cfg_default() to service_role;

------------------------------------------------------------------------
-- 4. pos_checkout(): blok reward memakai pengaturan di atas.
--    Sisanya TIDAK diubah sama sekali - fungsi ini disalin apa adanya dari
--    migrasi 20260925050000, hanya blok p_reward_id yang diganti.
--    pos_checkout_promo() dan pos_checkout_bundle() memanggil fungsi ini,
--    jadi keduanya ikut memakai pengaturan yang sama.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pos_checkout(
  p_username text, p_nomor_wa text, p_nama_pelanggan text, p_tipe_customer text,
  p_items jsonb, p_diskon numeric, p_bayar numeric,
  p_cabang_id text DEFAULT NULL::text, p_reward_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tanggal date := (now() at time zone 'Asia/Jakarta')::date;
  v_jam text := to_char(now() at time zone 'Asia/Jakarta','HH24:MI');
  v_shift text;
  v_no_nota text;
  v_subtotal numeric := 0;
  v_harga_akhir numeric;
  v_total_hpp numeric := 0;
  v_kembalian numeric;
  v_item jsonb;
  v_product record;
  v_batch record;
  v_remaining numeric;
  v_take numeric;
  v_unit_price numeric;
  v_detail jsonb := '[]'::jsonb;
  v_reward record;
  v_reward_discount numeric := 0;
  v_reward_points integer := 0;
  v_tier_pelanggan text;
  v_hasil_tukar jsonb;
  v_cabang_id text;
  v_user_cabang text;
  v_customer_type text;
BEGIN
  -- (1) CABANG: diambil dari app_users (sesi petugas). Fallback 'KARLA' DIHAPUS.
  --     Kalau cabang tidak bisa ditentukan, transaksi GAGAL — bukan diam-diam
  --     masuk KARLA (bagian 2 target 3).
  SELECT u.cabang_id INTO v_user_cabang
  FROM public.app_users u
  WHERE u.username = p_username AND u.aktif = 'YA';

  IF v_user_cabang IS NULL THEN
    RAISE EXCEPTION 'Petugas % tidak dikenal atau tidak aktif.', p_username;
  END IF;

  IF nullif(p_cabang_id,'') IS NOT NULL AND p_cabang_id <> v_user_cabang THEN
    RAISE EXCEPTION 'Cabang % tidak sesuai dengan cabang petugas (%).', p_cabang_id, v_user_cabang;
  END IF;

  v_cabang_id := v_user_cabang;

  -- Lock per cabang, bukan satu lock global untuk semua cabang (bagian 5.1 poin 4).
  PERFORM pg_advisory_xact_lock(hashtext('pos_checkout:'||v_cabang_id));

  IF p_items IS NULL OR jsonb_array_length(p_items)=0 THEN
    RAISE EXCEPTION 'Keranjang kosong.';
  END IF;
  IF coalesce(p_diskon,0)<0 OR coalesce(p_bayar,0)<0 THEN
    RAISE EXCEPTION 'Nilai diskon atau pembayaran tidak valid.';
  END IF;

  v_shift := CASE WHEN extract(hour from (now() at time zone 'Asia/Jakarta')) between 8 and 14 THEN 'Pagi'
                  WHEN extract(hour from (now() at time zone 'Asia/Jakarta')) between 15 and 20 THEN 'Sore'
                  ELSE 'Luar Jam' END;

  SELECT 'INV-'||v_cabang_id||'-'||to_char(v_tanggal,'YYYYMMDD')||'-'||lpad((count(*)+1)::text,4,'0')
    INTO v_no_nota
  FROM trx_penjualan
  WHERE tanggal=v_tanggal AND cabang_id=v_cabang_id;

  -- (2) Harga barang: WAJIB per cabang. Tanpa ini keranjang bisa memakai harga
  --     barang cabang lain.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product
    FROM master_barang
    WHERE kode_obat=upper(v_item->>'kode') AND aktif='YA' AND cabang_id=v_cabang_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Barang % tidak ditemukan atau nonaktif di cabang %.', v_item->>'kode', v_cabang_id;
    END IF;

    v_unit_price := CASE WHEN p_tipe_customer='Tenaga Kesehatan' THEN nullif(v_product.harga_khusus,0)
                         WHEN p_tipe_customer='Apotek Lain' THEN nullif(v_product.harga_jual_mutasi,0)
                         ELSE nullif(v_product.harga_jual_umum,0) END;
    v_unit_price := coalesce(v_unit_price, v_product.harga_jual_umum, 0);

    IF coalesce((v_item->>'qty')::numeric,0)<=0 THEN
      RAISE EXCEPTION 'Qty barang % harus lebih dari nol.', v_product.nama_obat;
    END IF;

    v_subtotal := v_subtotal + v_unit_price * (v_item->>'qty')::numeric;
  END LOOP;

    IF p_reward_id IS NOT NULL THEN
      SELECT r.* INTO v_reward FROM loyalty_rewards r
      WHERE r.id=p_reward_id AND r.cabang_id=v_cabang_id AND r.is_active FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Reward tidak tersedia pada cabang aktif.';
      END IF;
      IF nullif(norm_wa(p_nomor_wa),'') IS NULL THEN
        RAISE EXCEPTION 'Reward hanya dapat digunakan oleh pelanggan terdaftar.';
      END IF;

      SELECT c.total_points, c.tipe_customer, c.tier INTO v_reward_points, v_customer_type, v_tier_pelanggan
      FROM master_customer c
      WHERE c.cabang_id=v_cabang_id AND c.nomor_wa=norm_wa(p_nomor_wa)
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Pelanggan belum terdaftar pada cabang ini.';
      END IF;

      -- Seluruh aturan penukaran (tier, faktor tipe pelanggan, minimal poin,
      -- batas persentase transaksi, batas harian/bulanan) dihitung di satu
      -- fungsi, supaya kasir dan simulasi memakai aturan yang sama.
      BEGIN
        v_hasil_tukar := public.loyalty_tukar_periksa(v_cabang_id, p_reward_id, norm_wa(p_nomor_wa), v_subtotal, greatest(0, coalesce(p_diskon,0)));
      EXCEPTION WHEN others THEN
        v_hasil_tukar := NULL;
      END;

      IF v_hasil_tukar IS NULL THEN
        -- Cadangan (mis. pengaturan belum terbaca): aturan lama tetap berlaku
        -- supaya penjualan tidak pernah gagal.
        IF v_reward_points < v_reward.points_required THEN
          RAISE EXCEPTION 'Poin pelanggan tidak mencukupi untuk reward ini.';
        END IF;
        IF (CASE WHEN v_reward.min_tier='gold' THEN 3 WHEN v_reward.min_tier='silver' THEN 2 ELSE 1 END)
           > (CASE WHEN v_tier_pelanggan='gold' THEN 3 WHEN v_tier_pelanggan='silver' THEN 2 ELSE 1 END) THEN
          RAISE EXCEPTION 'Tier pelanggan belum memenuhi syarat reward ini.';
        END IF;
        v_reward_points := v_reward.points_required;
        v_reward_discount := greatest(0, coalesce(v_reward.reward_value,0));
        IF v_customer_type='Tenaga Kesehatan' THEN
          v_reward_discount := floor(v_reward_discount/2);
        ELSIF v_customer_type='Apotek Lain' THEN
          RAISE EXCEPTION 'Pelanggan Apotek Lain tidak memiliki poin atau reward.';
        END IF;
      ELSE
        IF NOT coalesce((v_hasil_tukar->>'boleh')::boolean, false) THEN
          RAISE EXCEPTION '%', coalesce(v_hasil_tukar->>'alasan', 'Penukaran reward tidak memenuhi syarat.');
        END IF;
        v_reward_points := coalesce((v_hasil_tukar->>'poin_dibutuhkan')::integer, v_reward.points_required);
        v_reward_discount := greatest(0, coalesce((v_hasil_tukar->>'nilai_penukaran')::numeric, 0));
      END IF;
    END IF;

  v_harga_akhir := greatest(0, v_subtotal - coalesce(p_diskon,0) - v_reward_discount);
  IF coalesce(p_bayar,0) < v_harga_akhir THEN
    RAISE EXCEPTION 'Pembayaran kurang.';
  END IF;
  v_kembalian := p_bayar - v_harga_akhir;

  INSERT INTO trx_penjualan(no_nota,tanggal,jam,nomor_wa,nama_pelanggan,tipe_customer,petugas_transaksi,shift,subtotal,diskon,harga_akhir,total_hpp,bayar,kembalian,cabang_id)
  VALUES(v_no_nota,v_tanggal,v_jam,nullif(norm_wa(p_nomor_wa),''),coalesce(nullif(p_nama_pelanggan,''),'Umum'),p_tipe_customer,p_username,v_shift,v_subtotal,coalesce(p_diskon,0)+v_reward_discount,v_harga_akhir,0,p_bayar,v_kembalian,v_cabang_id);

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product
    FROM master_barang
    WHERE kode_obat=upper(v_item->>'kode') AND aktif='YA' AND cabang_id=v_cabang_id;

    v_unit_price := CASE WHEN p_tipe_customer='Tenaga Kesehatan' THEN nullif(v_product.harga_khusus,0)
                         WHEN p_tipe_customer='Apotek Lain' THEN nullif(v_product.harga_jual_mutasi,0)
                         ELSE nullif(v_product.harga_jual_umum,0) END;
    v_unit_price := coalesce(v_unit_price, v_product.harga_jual_umum, 0);
    v_remaining := (v_item->>'qty')::numeric;

    WHILE v_remaining>0 LOOP
      -- (3) Stok: sudah per cabang sejak semula — tidak diubah.
      SELECT * INTO v_batch FROM stok_batch
      WHERE kode_obat=v_product.kode_obat AND cabang_id=v_cabang_id AND stok_real>0
      ORDER BY expired_date ASC, id_batch ASC
      FOR UPDATE SKIP LOCKED LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stok % tidak mencukupi.', v_product.nama_obat;
      END IF;

      v_take := least(v_remaining, v_batch.stok_real);
      UPDATE stok_batch SET stok_real=stok_real-v_take, updated_at=now() WHERE id_batch=v_batch.id_batch;
      INSERT INTO trx_penjualan_detail(no_nota,tanggal,kode_obat,nama_obat,kode_batch,expired_date,qty,harga_satuan,harga_modal,subtotal,cabang_id)
      VALUES(v_no_nota,v_tanggal,v_product.kode_obat,v_product.nama_obat,v_batch.kode_batch,v_batch.expired_date,v_take,v_unit_price,v_batch.harga_modal_batch,v_unit_price*v_take,v_cabang_id);
      v_total_hpp := v_total_hpp + v_batch.harga_modal_batch*v_take;
      v_detail := v_detail || jsonb_build_array(jsonb_build_object('Nama_Obat',v_product.nama_obat,'Qty',v_take,'Harga_Satuan',v_unit_price,'Subtotal',v_unit_price*v_take));
      v_remaining := v_remaining - v_take;
    END LOOP;
  END LOOP;

  UPDATE trx_penjualan SET total_hpp=v_total_hpp WHERE no_nota=v_no_nota AND cabang_id=v_cabang_id;

  IF p_reward_id IS NOT NULL THEN
    INSERT INTO loyalty_redemptions(cabang_id,customer_id,reward_id,no_nota,points_used,reward_value)
    SELECT v_cabang_id,c.id,p_reward_id,v_no_nota,v_reward.points_required,v_reward_discount
    FROM master_customer c WHERE c.cabang_id=v_cabang_id AND c.nomor_wa=norm_wa(p_nomor_wa);

    UPDATE master_customer SET total_points=total_points-v_reward.points_required
    WHERE cabang_id=v_cabang_id AND nomor_wa=norm_wa(p_nomor_wa);

    INSERT INTO loyalty_transactions(cabang_id,customer_id,no_nota,points_change,reason)
    SELECT v_cabang_id,c.id,v_no_nota,-v_reward.points_required,'redeem'
    FROM master_customer c WHERE c.cabang_id=v_cabang_id AND c.nomor_wa=norm_wa(p_nomor_wa);
  END IF;

  RETURN jsonb_build_object(
    'No_Nota',v_no_nota,'Tanggal',v_tanggal,'Jam',v_jam,'Petugas',p_username,'Shift',v_shift,
    'Apotek','Apotek Fa-Mitra','Nama_Pelanggan',coalesce(nullif(p_nama_pelanggan,''),'Umum'),
    'Subtotal',v_subtotal,'Diskon',coalesce(p_diskon,0)+v_reward_discount,'Reward_Diskon',v_reward_discount,
    'Reward_Points_Used',v_reward_points,'Harga_Akhir',v_harga_akhir,'Bayar',p_bayar,'Kembalian',v_kembalian,
    'Total_HPP',v_total_hpp,'items',v_detail);
END;
$function$;
