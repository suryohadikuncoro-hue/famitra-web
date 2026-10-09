# Modal PPN dan Markup Harga Jual

## Perubahan

- Modal efektif pembelian memakai netto × qty × (1 + PPN/100) − diskon nominal, lalu dibagi qty.
- PPN dihitung setelah diskon dialokasikan ke dasar PPN, sehingga contoh netto Rp1.000, PPN 11%, diskon Rp111 menghasilkan modal efektif Rp999 dan PPN Rp99.
- Shift POS dibaca dari definisi `public.pos_checkout` saat migrasi, lalu batasnya menjadi `07:00 ≤ pagi < 14:00`, `14:00 ≤ sore < 21:00`, selain itu `Luar Jam`.
- Pengaturan markup tersimpan per cabang; transaksi Pembelian dapat memakai pengaturan bawaan atau draf lokal.
- Harga jual umum, nakes, dan apotek lain dihitung terpisah. Nilai `0%` tidak terkena pembulatan; markup positif dapat dibulatkan ke atas Rp100/Rp500/Rp1.000.
- Owner dapat mempratinjau dan menerapkan harga ke semua barang aktif atau hasil pencarian. Penerapan memvalidasi ulang cabang dan role dari `app_users`, memakai advisory lock, serta mencatat setiap perubahan.

## Urutan migrasi

1. `20261009130100_purchase_effective_unit_cost_ppn.sql`
2. `20261009130200_pos_checkout_shift_boundaries.sql`
3. `20261009140000_markup_harga.sql`

Jalankan melalui mekanisme migrasi Supabase yang biasa digunakan repository. Tidak ada migrasi yang menghapus tabel atau mengubah transaksi historis.

## Backfill dan dampak data lama

Tidak ada backfill harga atau transaksi otomatis. Harga master lama tetap dipertahankan sampai Owner menjalankan **Master Barang → Terapkan markup**. Faktur lama tetap memiliki nilai yang tersimpan; fungsi baru hanya dipakai pada alur pembelian dan perhitungan berikutnya.

Setelah migrasi, Owner dapat memeriksa beberapa SKU dengan **Pratinjau** terlebih dahulu. Untuk pembulatan, contoh modal Rp999 dengan markup 200% menghasilkan Rp3.000; markup 0% menghasilkan Rp999 tanpa pembulatan.

## Rollback

Rollback aplikasi: deploy kembali commit aplikasi sebelumnya. Rollback database sebaiknya dilakukan hanya oleh operator database setelah memastikan tidak ada request aktif yang memakai fungsi baru. Karena migrasi tidak destruktif, opsi aman adalah membiarkan tabel pengaturan/log tetap ada dan menonaktifkan fitur melalui deploy aplikasi. Jangan menghapus tabel markup atau log jika sudah ada perubahan harga tercatat.

Jika perlu mengembalikan harga master yang telah diterapkan, gunakan `log_perubahan_harga` untuk membuat daftar `(kode_obat, tingkat, harga_lama)` per cabang dan lakukan pemulihan terkontrol melalui prosedur admin; jangan menghapus log audit.

## Verifikasi pascadeploy

1. Jalankan `node --test tests/modal-markup.test.cjs tests/poin-kedaluwarsa.test.cjs tests/poin-penukaran.test.cjs tests/poin.test.cjs`.
2. Login sebagai Apoteker: pengaturan markup dapat dipakai pada Pembelian, tetapi tombol simpan bawaan dan penerapan Master Barang tidak tersedia.
3. Login sebagai Owner: simpan pengaturan bawaan, buka kembali Pembelian, dan pastikan draf mengisi harga baru hanya pada kolom yang tidak pernah diketik manual.
4. Uji PPN 11% + diskon 11,1% dari Rp1.000: total PPN harus Rp99 dan modal efektif Rp999.
5. Uji SKU dengan harga jual nakes/mutasi berbeda; pastikan margin ditampilkan tiga baris dan peringatan negatif memeriksa ketiganya.
6. Pada Master Barang, pratinjau hasil pencarian lalu terapkan; periksa `log_perubahan_harga` dan pastikan cabang lain tidak ikut berubah.
7. Uji batas waktu POS pukul 06:59, 07:00, 13:59, 14:00, 20:59, 21:00 WIB.

## Risiko yang diketahui

- Penerapan massal dibatasi 200 SKU per panggilan RPC dan dilakukan dalam beberapa chunk agar payload tetap kecil.
- SKU tanpa modal valid atau markup kosong dilewati dan dihitung pada respons `dilewati`.
- Jika migrasi markup belum diterapkan, UI menampilkan pesan yang jelas dan alur pembelian lama tetap dapat digunakan.
- Harga yang diketik manual pada faktur tidak ditimpa oleh perubahan draf markup.
