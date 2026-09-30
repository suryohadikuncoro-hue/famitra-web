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
-- Cara kerja migrasi ini: definisi fungsi diambil apa adanya dari database
-- (pg_get_functiondef) lalu hanya dua pola batas jam yang diganti. Ini
-- menghindari menyalin badan fungsi (~400 baris) yang bisa menyimpang dari
-- definisi yang benar-benar berlaku.
--
-- PENTING (revisi 1): pencarian fungsi memakai NAMA, bukan tanda tangan
-- argumen. Percobaan pertama memakai pg_get_function_identity_arguments dan
-- gagal di production dengan 'RPC pos_checkout tidak ditemukan' karena tanda
-- tangan di production tidak persis sama dengan yang tertulis di repo.
-- Pencocokan pola jam juga tidak peka huruf besar/kecil dan jumlah spasi.
--
-- Migrasi gagal keras kalau tidak ada definisi yang berhasil diperbarui, dan
-- pesan errornya menyebutkan semua kandidat tanda tangan yang ditemukan supaya
-- penyebabnya bisa langsung dilihat. Aman dijalankan ulang: definisi yang sudah
-- memakai batas baru hanya dilewati dengan notice.
--
-- Verifikasi (read-only, jalankan setelah push):
--   select p.oid::regprocedure::text as signature,
--          lower(pg_get_functiondef(p.oid)) ~ 'between\s+7\s+and\s+13'  as batas_pagi_baru,
--          lower(pg_get_functiondef(p.oid)) ~ 'between\s+14\s+and\s+20' as batas_sore_baru,
--          lower(pg_get_functiondef(p.oid)) ~ 'between\s+8\s+and\s+14'  as masih_pola_lama
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
  r record;
  d text;
  jumlah integer := 0;
  kandidat text := '';
  pola_pagi_lama constant text := 'between\s+8\s+and\s+14';
  pola_sore_lama constant text := 'between\s+15\s+and\s+20';
  pola_pagi_baru constant text := 'between\s+7\s+and\s+13';
  pola_sore_baru constant text := 'between\s+14\s+and\s+20';
begin
  for r in
    select p.oid, p.oid::regprocedure::text as tanda_tangan
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'pos_checkout'
    order by p.pronargs
  loop
    kandidat := kandidat || r.tanda_tangan || '; ';
    d := pg_get_functiondef(r.oid);

    -- Sudah memakai batas baru (mis. migrasi dijalankan ulang): lewati.
    if lower(d) ~ pola_pagi_baru and lower(d) ~ pola_sore_baru then
      raise notice 'Dilewati, sudah memakai batas jam baru: %', r.tanda_tangan;
      continue;
    end if;

    if lower(d) !~ pola_pagi_lama or lower(d) !~ pola_sore_lama then
      raise notice 'Dilewati, pola batas jam lama tidak ditemukan: %', r.tanda_tangan;
      continue;
    end if;

    d := regexp_replace(d, pola_pagi_lama, 'between 7 and 13', 'gi');
    d := regexp_replace(d, pola_sore_lama, 'between 14 and 20', 'gi');
    execute d;
    jumlah := jumlah + 1;
    raise notice 'Diperbarui: %', r.tanda_tangan;
  end loop;

  if jumlah = 0 then
    raise exception 'Tidak ada definisi pos_checkout yang diperbarui. Kandidat yang ditemukan: %',
      coalesce(nullif(kandidat, ''), '(tidak ada fungsi bernama pos_checkout)');
  end if;

  raise notice 'Selesai: % definisi pos_checkout memakai batas jam baru (Pagi 07-13, Sore 14-20).', jumlah;
end $$;
