-- Jam operasional baru: 07:00-21:00
--   Pagi (shift 1): 07:00-13:59
--   Sore (shift 2): 14:00-20:59
--   di luar itu   : Luar Jam
-- Sebelumnya 08:00-21:00 (Pagi 08:00-14:59, Sore 15:00-20:59).
--
-- RPC public.pos_checkout menghitung kolom trx_penjualan.shift sendiri dari jam
-- server, bukan dari frontend, jadi batasnya wajib diubah di sini juga.
-- pos_checkout_promo dan pos_checkout_bundle tidak perlu diubah karena keduanya
-- memanggil pos_checkout.
--
-- Data historis SENGAJA tidak diubah: transaksi yang sudah tercatat tetap
-- memakai label shift sesuai jam yang berlaku saat transaksi itu dibuat.
--
-- Definisi fungsi diambil apa adanya dari database (pg_get_functiondef) lalu
-- hanya dua pola batas jam yang diganti. Ini menghindari menyalin badan fungsi
-- (~400 baris) yang bisa menyimpang dari definisi yang benar-benar berlaku.
-- Migrasi gagal keras kalau pola lama tidak ditemukan, dan memeriksa hasilnya
-- sebelum selesai. Aman dijalankan ulang: kalau batas baru sudah terpasang,
-- migrasi hanya memberi notice dan tidak mengubah apa pun.
--
-- Verifikasi (read-only, jalankan setelah push):
--   select pg_get_functiondef(p.oid) like '%between 7 and 13%'  as batas_pagi_baru,
--          pg_get_functiondef(p.oid) like '%between 14 and 20%' as batas_sore_baru,
--          pg_get_functiondef(p.oid) like '%between 8 and 14%'  as masih_pola_lama
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'pos_checkout';
--   -> diharapkan: batas_pagi_baru = true, batas_sore_baru = true, masih_pola_lama = false
--
-- Simulasi pemetaan shift (read-only, tidak menulis data):
--   select (case when extract(hour from timestamptz '2026-10-01 07:30:00+07') between 7 and 13 then 'Pagi'
--                when extract(hour from timestamptz '2026-10-01 07:30:00+07') between 14 and 20 then 'Sore'
--                else 'Luar Jam' end) as jam_0730,
--          (case when extract(hour from timestamptz '2026-10-01 14:30:00+07') between 7 and 13 then 'Pagi'
--                when extract(hour from timestamptz '2026-10-01 14:30:00+07') between 14 and 20 then 'Sore'
--                else 'Luar Jam' end) as jam_1430;
--   -> diharapkan: jam_0730 = Pagi, jam_1430 = Sore
--
-- Rollback: jalankan blok do di bawah dengan pasangan pola ditukar, yaitu
-- 'between 7 and 13' -> 'between 8 and 14' dan 'between 14 and 20' -> 'between 15 and 20'.

do $$
declare
  d text;
  pola_lama_pagi constant text := 'between 8 and 14';
  pola_lama_sore constant text := 'between 15 and 20';
  pola_baru_pagi constant text := 'between 7 and 13';
  pola_baru_sore constant text := 'between 14 and 20';
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'pos_checkout'
    and pg_get_function_identity_arguments(p.oid) = 'text, text, text, text, jsonb, numeric, numeric, text, uuid';

  if d is null then
    raise exception 'RPC pos_checkout dengan 9 argumen tidak ditemukan.';
  end if;

  -- Sudah memakai batas baru (mis. migrasi dijalankan ulang): tidak ada yang diubah.
  if position(pola_baru_pagi in d) > 0 and position(pola_baru_sore in d) > 0 then
    raise notice 'pos_checkout sudah memakai batas jam 07-13 / 14-20; tidak ada yang diubah.';
    return;
  end if;

  if position(pola_lama_pagi in d) = 0 or position(pola_lama_sore in d) = 0 then
    raise exception 'Pola batas jam lama tidak ditemukan pada pos_checkout. Periksa definisi fungsi sebelum melanjutkan.';
  end if;

  d := replace(d, pola_lama_pagi, pola_baru_pagi);
  d := replace(d, pola_lama_sore, pola_baru_sore);
  execute d;

  -- Pastikan hasilnya benar sebelum migrasi dianggap selesai.
  select pg_get_functiondef(p.oid) into d
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'pos_checkout'
    and pg_get_function_identity_arguments(p.oid) = 'text, text, text, text, jsonb, numeric, numeric, text, uuid';

  if position(pola_baru_pagi in d) = 0 or position(pola_baru_sore in d) = 0 then
    raise exception 'Definisi pos_checkout setelah perubahan tidak memuat batas jam baru.';
  end if;

  raise notice 'Batas jam shift pos_checkout diperbarui: Pagi 07-13, Sore 14-20.';
end $$;
