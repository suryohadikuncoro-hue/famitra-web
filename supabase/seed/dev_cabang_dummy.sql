-- =============================================================================
-- SI-FaMitra — Cabang UJI COBA "DEV" berisi data dummy
--
-- CARA PAKAI: Supabase Dashboard > SQL Editor > paste seluruh file > Run.
-- Skrip ini SENGAJA tidak ada di supabase/migrations/ supaya `supabase db push`
-- tidak pernah menjalankannya. Semua data bertanda cabang_id = 'DEV', jadi
-- tidak menyentuh data KARLA / KENDAL / PUCUK / PULE.
--
-- Isi:
--   1. cabang DEV
--   2. 3 akun uji coba (dev_owner, dev_apoteker, dev_kasir) dengan password YANG ANDA ISI
--      sendiri di baris "EDIT DI SINI" di bawah. Jangan pernah commit password asli ke Git
--      (repo ini publik). Akun ini ikut terhapus oleh dev_cabang_cleanup.sql.
--   3. 25 barang (salinan kartu barang KARLA) + 2 batch stok per barang
--   4. 8 pelanggan dummy (nomor WA SENGAJA tidak valid, supaya n8n/WA tidak
--      pernah mengirim pesan ke orang sungguhan)
--   5. transaksi penjualan dummy sejak tanggal 1 bulan ini sampai hari ini
--   6. biaya operasional dummy dan 3 retur penjualan dummy
--
-- RESET dari awal : jalankan dev_cabang_cleanup.sql, lalu skrip ini lagi.
-- HAPUS TOTAL     : jalankan dev_cabang_cleanup.sql (WAJIB sebelum go-live).
-- =============================================================================

-- >>> EDIT DI SINI: ganti teks di antara tanda kutip dengan password uji coba (min. 10 karakter).
-- >>> Setelah Run, JANGAN simpan/commit file ini dengan password terisi.
SELECT set_config('dev.password', 'GANTI_DENGAN_PASSWORD_ANDA', false);

BEGIN;

DO $$
BEGIN
  IF current_setting('dev.password') = 'GANTI_DENGAN_PASSWORD_ANDA'
     OR length(current_setting('dev.password')) < 10 THEN
    RAISE EXCEPTION 'Isi password uji coba dulu di baris "EDIT DI SINI" (min. 10 karakter).';
  END IF;
  IF EXISTS (SELECT 1 FROM public.master_cabang WHERE kode_cabang = 'DEV') THEN
    RAISE EXCEPTION 'Cabang DEV sudah ada. Jalankan dev_cabang_cleanup.sql dulu kalau mau mengulang dari awal.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.master_cabang WHERE kode_cabang = 'KARLA') THEN
    RAISE EXCEPTION 'Cabang KARLA tidak ditemukan. Skrip ini memakainya sebagai contoh baris cabang & sumber kartu barang.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Cabang DEV (salin baris KARLA, timpa kode & nama; kolom lain ikut apa adanya)
-- -----------------------------------------------------------------------------
INSERT INTO public.master_cabang
SELECT (jsonb_populate_record(
  NULL::public.master_cabang,
  to_jsonb(k) || jsonb_build_object(
    'kode_cabang', 'DEV',
    'nama_cabang', '[DEV] Cabang Uji Coba',
    'alamat',      'Data dummy - bukan cabang sungguhan',
    'aktif',       'YA'
  )
)).*
FROM public.master_cabang k
WHERE k.kode_cabang = 'KARLA';

-- -----------------------------------------------------------------------------
-- 2. Akun uji coba. Hash sama dengan yang dipakai login: SHA-256 hex dari password.
--    Catatan: akun ini hidup di database yang SAMA dengan produksi, jadi pakai password yang
--    kuat dan hapus akun (jalankan dev_cabang_cleanup.sql) sebelum go-live. Sejak isolasi cabang,
--    dev_owner hanya melihat data cabang DEV; data KARLA/KENDAL/PUCUK/PULE tidak terlihat.
-- -----------------------------------------------------------------------------
INSERT INTO public.app_users (username, nama, role, aktif, cabang_id, password_hash)
VALUES
  ('dev_owner',    'Owner Dev',    'Owner',    'YA', 'DEV', encode(sha256(convert_to(current_setting('dev.password'), 'UTF8')), 'hex')),
  ('dev_apoteker', 'Apoteker Dev', 'Apoteker', 'YA', 'DEV', encode(sha256(convert_to(current_setting('dev.password'), 'UTF8')), 'hex')),
  ('dev_kasir',    'Kasir Dev',    'Kasir',    'YA', 'DEV', encode(sha256(convert_to(current_setting('dev.password'), 'UTF8')), 'hex'));

-- -----------------------------------------------------------------------------
-- 3. Barang: 25 kartu barang KARLA yang aktif & berharga, disalin ke DEV
-- -----------------------------------------------------------------------------
INSERT INTO public.master_barang
  (cabang_id, kode_obat, nama_obat, kategori, golongan, satuan, barcode,
   harga_modal, harga_jual_umum, harga_khusus, harga_jual_mutasi, ppn,
   stok_min, aktif, updated_at)
SELECT 'DEV', b.kode_obat, b.nama_obat, b.kategori, b.golongan, b.satuan, b.barcode,
       b.harga_modal, b.harga_jual_umum, b.harga_khusus, b.harga_jual_mutasi, b.ppn,
       b.stok_min, 'YA', now()
FROM public.master_barang b
WHERE b.cabang_id = 'KARLA' AND b.aktif = 'YA'
  AND coalesce(b.harga_modal, 0) > 0 AND coalesce(b.harga_jual_umum, 0) > 0
ORDER BY b.kode_obat
LIMIT 25;

-- Batch A: stok besar, kedaluwarsa jauh (dipakai transaksi dummy).
-- Batch B: stok kecil, hampir kedaluwarsa (untuk menguji peringatan stok kritis).
INSERT INTO public.stok_batch
  (cabang_id, id_batch, kode_obat, kode_batch, expired_date, stok_real, harga_modal_batch)
SELECT 'DEV', 'DEV-' || kode_obat || '-A', kode_obat, 'DEVA-' || kode_obat,
       current_date + 365, 300, harga_modal
FROM public.master_barang WHERE cabang_id = 'DEV';

INSERT INTO public.stok_batch
  (cabang_id, id_batch, kode_obat, kode_batch, expired_date, stok_real, harga_modal_batch)
SELECT 'DEV', 'DEV-' || kode_obat || '-B', kode_obat, 'DEVB-' || kode_obat,
       current_date + 45, 15, harga_modal
FROM public.master_barang WHERE cabang_id = 'DEV';

-- -----------------------------------------------------------------------------
-- 4. Pelanggan dummy (nomor 629000000xxx bukan nomor seluler Indonesia yang valid)
-- -----------------------------------------------------------------------------
INSERT INTO public.master_customer (cabang_id, nomor_wa, nama, tipe_customer, alamat, nomor_izin)
VALUES
  ('DEV', '629000000001', 'Budi Dummy',        'Umum',             'Alamat dummy 1', ''),
  ('DEV', '629000000002', 'Siti Dummy',        'Umum',             'Alamat dummy 2', ''),
  ('DEV', '629000000003', 'Agus Dummy',        'Umum',             'Alamat dummy 3', ''),
  ('DEV', '629000000004', 'Dewi Dummy',        'Umum',             'Alamat dummy 4', ''),
  ('DEV', '629000000005', 'Rina Dummy',        'Umum',             'Alamat dummy 5', ''),
  ('DEV', '629000000006', 'dr. Hadi Dummy',    'Tenaga Kesehatan', 'Klinik dummy',   'IZIN-DUMMY-01'),
  ('DEV', '629000000007', 'Bidan Lina Dummy',  'Tenaga Kesehatan', 'Praktik dummy',  'IZIN-DUMMY-02'),
  ('DEV', '629000000008', 'Apotek Sehat Dummy','Apotek Lain',      'Apotek dummy',   'SIA-DUMMY-01');

-- -----------------------------------------------------------------------------
-- 5. Transaksi penjualan dummy (2-5 nota/hari, sejak tgl 1 bulan ini s.d. hari ini)
--    Meniru pos_checkout: harga per tipe pelanggan, HPP dari harga_modal batch.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_day date; v_n int; i int;
  v_no text; v_cust record; v_wa text; v_nama text; v_tipe text;
  v_hour int; v_jam text; v_shift text;
  v_item record; v_batch record; v_price numeric; v_qty numeric; v_nitems int;
  v_sub numeric; v_hpp numeric; v_disc numeric; v_akhir numeric; v_bayar numeric;
BEGIN
  PERFORM setseed(0.42);  -- hasil sama setiap kali dijalankan

  FOR v_day IN
    SELECT g::date FROM generate_series(date_trunc('month', current_date)::date, current_date, interval '1 day') g
  LOOP
    v_n := 2 + floor(random() * 4)::int;
    FOR i IN 1..v_n LOOP
      v_no := 'INV-DEV-' || to_char(v_day, 'YYYYMMDD') || '-' || lpad(i::text, 4, '0');

      IF random() < 0.7 THEN
        SELECT * INTO v_cust FROM public.master_customer WHERE cabang_id = 'DEV' ORDER BY random() LIMIT 1;
        v_wa := v_cust.nomor_wa; v_nama := v_cust.nama; v_tipe := v_cust.tipe_customer;
      ELSE
        v_wa := NULL; v_nama := 'Umum'; v_tipe := 'Umum';
      END IF;

      v_hour  := 8 + floor(random() * 13)::int;
      v_jam   := lpad(v_hour::text, 2, '0') || ':' || lpad(floor(random() * 60)::int::text, 2, '0');
      v_shift := CASE WHEN v_hour <= 14 THEN 'Pagi' ELSE 'Sore' END;

      INSERT INTO public.trx_penjualan
        (no_nota, tanggal, jam, nomor_wa, nama_pelanggan, tipe_customer, petugas_transaksi, shift,
         subtotal, diskon, harga_akhir, total_hpp, bayar, kembalian, cabang_id, "timestamp")
      VALUES
        (v_no, v_day, v_jam, v_wa, v_nama, v_tipe, 'dev_kasir', v_shift,
         0, 0, 0, 0, 0, 0, 'DEV', (v_day::text || ' ' || v_jam || ':00+07')::timestamptz);

      v_sub := 0; v_hpp := 0;
      v_nitems := 1 + floor(random() * 3)::int;

      FOR v_item IN
        SELECT * FROM public.master_barang WHERE cabang_id = 'DEV' ORDER BY random() LIMIT v_nitems
      LOOP
        SELECT * INTO v_batch FROM public.stok_batch
        WHERE cabang_id = 'DEV' AND kode_obat = v_item.kode_obat AND kode_batch = 'DEVA-' || v_item.kode_obat;

        v_price := CASE WHEN v_tipe = 'Tenaga Kesehatan' THEN nullif(v_item.harga_khusus, 0)
                        WHEN v_tipe = 'Apotek Lain'      THEN nullif(v_item.harga_jual_mutasi, 0)
                        ELSE nullif(v_item.harga_jual_umum, 0) END;
        v_price := coalesce(v_price, v_item.harga_jual_umum, 0);
        v_qty   := 1 + floor(random() * 4)::int;

        INSERT INTO public.trx_penjualan_detail
          (no_nota, tanggal, kode_obat, nama_obat, kode_batch, expired_date, qty,
           harga_satuan, harga_modal, subtotal, cabang_id)
        VALUES
          (v_no, v_day, v_item.kode_obat, v_item.nama_obat, v_batch.kode_batch, v_batch.expired_date, v_qty,
           v_price, v_batch.harga_modal_batch, v_price * v_qty, 'DEV');

        v_sub := v_sub + v_price * v_qty;
        v_hpp := v_hpp + v_batch.harga_modal_batch * v_qty;
      END LOOP;

      v_disc  := CASE WHEN random() < 0.2 THEN round(v_sub * 0.05 / 100) * 100 ELSE 0 END;
      v_akhir := greatest(0, v_sub - v_disc);
      v_bayar := ceil(v_akhir / 10000) * 10000;

      UPDATE public.trx_penjualan
      SET subtotal = v_sub, diskon = v_disc, harga_akhir = v_akhir, total_hpp = v_hpp,
          bayar = v_bayar, kembalian = v_bayar - v_akhir
      WHERE cabang_id = 'DEV' AND no_nota = v_no;
    END LOOP;
  END LOOP;

  -- Kurangi stok batch A sesuai barang yang sudah "terjual"
  UPDATE public.stok_batch sb
  SET stok_real = greatest(sb.stok_real - d.q, 0)
  FROM (
    SELECT kode_obat, kode_batch, sum(qty) AS q
    FROM public.trx_penjualan_detail WHERE cabang_id = 'DEV' GROUP BY kode_obat, kode_batch
  ) d
  WHERE sb.cabang_id = 'DEV' AND sb.kode_obat = d.kode_obat AND sb.kode_batch = d.kode_batch;
END $$;

-- -----------------------------------------------------------------------------
-- 6a. Biaya operasional dummy
-- -----------------------------------------------------------------------------
INSERT INTO public.biaya_operasional (cabang_id, id, tanggal, keterangan, nominal, shift, petugas)
VALUES
  ('DEV', 'BY-DEV-0001', date_trunc('month', current_date)::date,           'Gaji karyawan (dummy)', 2500000, 'Pagi', 'dev_kasir'),
  ('DEV', 'BY-DEV-0002', date_trunc('month', current_date)::date + 4,       'Listrik (dummy)',        450000, 'Pagi', 'dev_kasir'),
  ('DEV', 'BY-DEV-0003', date_trunc('month', current_date)::date + 5,       'Air (dummy)',            150000, 'Pagi', 'dev_kasir'),
  ('DEV', 'BY-DEV-0004', date_trunc('month', current_date)::date + 9,       'Internet (dummy)',       350000, 'Sore', 'dev_kasir'),
  ('DEV', 'BY-DEV-0005', date_trunc('month', current_date)::date + 14,      'ATK (dummy)',            120000, 'Pagi', 'dev_kasir'),
  ('DEV', 'BY-DEV-0006', date_trunc('month', current_date)::date + 19,      'Kebersihan (dummy)',     200000, 'Sore', 'dev_kasir'),
  ('DEV', 'BY-DEV-0007', date_trunc('month', current_date)::date + 24,      'Transport (dummy)',      180000, 'Pagi', 'dev_kasir');

-- -----------------------------------------------------------------------------
-- 6b. 3 retur penjualan dummy (barang kondisi Baik -> stok kembali)
-- -----------------------------------------------------------------------------
DO $$
DECLARE v_n record; v_d record; v_no text; k int := 0;
BEGIN
  FOR v_n IN
    SELECT * FROM public.trx_penjualan WHERE cabang_id = 'DEV' ORDER BY no_nota OFFSET 8 LIMIT 3
  LOOP
    k := k + 1;
    SELECT * INTO v_d FROM public.trx_penjualan_detail
    WHERE cabang_id = 'DEV' AND no_nota = v_n.no_nota ORDER BY kode_obat LIMIT 1;
    v_no := 'RTJ-DEV-' || lpad(k::text, 4, '0');

    INSERT INTO public.trx_retur_jual
      (cabang_id, no_retur, no_nota_asal, tanggal, jam, nomor_wa, nama_pelanggan,
       petugas, shift, alasan, total_refund, "timestamp")
    VALUES
      ('DEV', v_no, v_n.no_nota, v_n.tanggal, '16:00', v_n.nomor_wa, v_n.nama_pelanggan,
       'dev_kasir', 'Sore', 'Data dummy: barang tidak sesuai', v_d.harga_satuan,
       (v_n.tanggal::text || ' 16:00:00+07')::timestamptz);

    INSERT INTO public.trx_retur_jual_detail
      (cabang_id, no_retur, kode_obat, nama_obat, kode_batch, qty, harga_satuan, subtotal, kondisi)
    VALUES
      ('DEV', v_no, v_d.kode_obat, v_d.nama_obat, v_d.kode_batch, 1, v_d.harga_satuan, v_d.harga_satuan, 'Baik');

    UPDATE public.stok_batch SET stok_real = stok_real + 1
    WHERE cabang_id = 'DEV' AND kode_obat = v_d.kode_obat AND kode_batch = v_d.kode_batch;
  END LOOP;
END $$;

COMMIT;

-- -----------------------------------------------------------------------------
-- Ringkasan (pakai angka ini untuk menentukan target omset uji coba)
-- -----------------------------------------------------------------------------
SELECT
  (SELECT count(*)         FROM public.trx_penjualan   WHERE cabang_id = 'DEV') AS jumlah_nota,
  (SELECT sum(harga_akhir) FROM public.trx_penjualan   WHERE cabang_id = 'DEV') AS omset_sebelum_retur,
  (SELECT sum(total_hpp)   FROM public.trx_penjualan   WHERE cabang_id = 'DEV') AS total_hpp,
  (SELECT sum(nominal)     FROM public.biaya_operasional WHERE cabang_id = 'DEV') AS total_biaya,
  (SELECT sum(total_refund) FROM public.trx_retur_jual WHERE cabang_id = 'DEV') AS total_retur;
