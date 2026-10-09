# Modal PPN dan Markup Harga Jual

## Perubahan

- Modal efektif pembelian memakai netto × qty × (1 + PPN/100) × (1 − diskon%/100), lalu dibagi qty.
- PPN dihitung setelah diskon persentase diterapkan pada bruto baris, sehingga contoh netto Rp1.000, PPN 11%, diskon 10% menghasilkan modal efektif Rp999 dan PPN Rp99.
- Shift POS dibaca dari definisi `public.pos_checkout` saat migrasi, lalu batasnya menjadi `07:00 ≤ pagi < 14:00`, `14:00 ≤ sore < 21:00`, selain itu `Luar Jam`.
- Pengaturan markup tersimpan per cabang; transaksi Pembelian dapat memakai pengaturan bawaan atau draf lokal.
- Harga jual umum, nakes, dan apotek lain dihitung terpisah. Nilai `0%` tidak terkena pembulatan; markup positif dapat dibulatkan ke atas Rp100/Rp500/Rp1.000.
- Owner dapat mempratinjau dan menerapkan harga ke semua barang aktif atau hasil pencarian. Penerapan memvalidasi ulang cabang dan role dari `app_users`, memakai advisory lock, serta mencatat setiap perubahan.

## Urutan migrasi

1. `20261009130100_purchase_effective_unit_cost_ppn.sql`
2. `20261009130200_pos_checkout_shift_boundaries.sql`
3. `20261009140000_markup_harga.sql`
4. `20261009150000_purchase_discount_percent_repair.sql`

Jalankan berurutan melalui mekanisme migrasi Supabase yang biasa digunakan repository. Migration terakhir memperbaiki representasi diskon legacy yang dapat dibuktikan dari subtotal dan menyegarkan modal aktif terkait; migration tidak mengubah qty stok, subtotal, total faktur, atau detail penjualan.

## Backfill dan dampak data lama

Migration `20261009150000` hanya mengonversi diskon historis yang subtotalnya membuktikan bahwa kolom `diskon` tersimpan sebagai nominal rupiah. Persentase baru dihitung dari `(bruto - subtotal) / bruto`, sehingga nilai subtotal/tagihan tetap. Baris `diskon > 100` yang tidak cocok dengan rumus nominal, atau SKU terdampak dengan baris aktif nonnol yang ambigu, menghentikan migration secara atomik untuk ditinjau manual. Nilai lama dan nilai hasil konversi dicadangkan di `purchase_discount_percent_repair_backup` dengan RLS; tidak diberikan akses ke `anon` atau `authenticated`.

Untuk SKU yang memiliki baris aktif terkonversi, `purchase_refresh_costs` memperbarui hanya `harga_modal`, `harga_modal_terakhir`, `harga_modal_batch`, dan `harga_modal_batch_terakhir` dari pembelian aktif terbaru. Harga jual master lama tetap dipertahankan sampai Owner menjalankan **Master Barang → Terapkan markup**.

Setelah migrasi, Owner dapat memeriksa beberapa SKU dengan **Pratinjau** terlebih dahulu. Untuk pembulatan, contoh modal Rp999 dengan markup 200% menghasilkan Rp3.000; markup 0% menghasilkan Rp999 tanpa pembulatan.

## Rollback

Rollback aplikasi: deploy kembali commit aplikasi sebelumnya. Untuk membatalkan normalisasi diskon, operator database dapat memulihkan hanya baris yang belum diedit sejak migration dengan mencocokkan `detail_id` dan `diskon_persen_baru` pada `purchase_discount_percent_repair_backup`. Tabel tersebut juga menyimpan snapshot `harga_modal`, `harga_modal_terakhir`, `harga_modal_batch`, dan `harga_modal_batch_terakhir` sebelum refresh. Pemulihan modal hanya aman bila tidak ada pembelian/penyesuaian yang lebih baru pada SKU/batch tersebut; periksa dulu, lalu gunakan snapshot yang sesuai. Jangan menjalankan rollback otomatis setelah faktur terdampak diedit atau jika barisnya sudah diganti. Tabel backup dan audit markup tidak dihapus.

Jika perlu mengembalikan harga master yang telah diterapkan, gunakan `log_perubahan_harga` untuk membuat daftar `(kode_obat, tingkat, harga_lama)` per cabang dan lakukan pemulihan terkontrol melalui prosedur admin; jangan menghapus log audit.

## Verifikasi pascadeploy

1. Jalankan `node --test tests/*.test.cjs` dan `node tools/test-pembelian.cjs`.
2. Login sebagai Apoteker: pengaturan markup dapat dipakai pada Pembelian, tetapi tombol simpan bawaan dan penerapan Master Barang tidak tersedia.
3. Login sebagai Owner: simpan pengaturan bawaan, buka kembali Pembelian, dan pastikan draf mengisi harga baru hanya pada kolom yang tidak pernah diketik manual.
4. Uji PPN 11% + diskon 11,1% dari Rp1.000: total PPN harus Rp99 dan modal efektif Rp999.
5. Simpan markup 150% dalam mode persen, muat ulang dalam mode rasio, pastikan tampil `2,5` dan padanan `150%`; ubah kembali ke persen dan pastikan tetap `150%`. Uji batas rasio 1–11 dan persen 0–1000.
6. Tambahkan dua baris barang+batch yang sama dengan diskon berbeda, simpan/edit, lalu pastikan setiap baris tetap memiliki persentase diskonnya sendiri.
7. Uji SKU dengan harga jual nakes/mutasi berbeda; pastikan margin ditampilkan tiga baris, 0% tidak diberi tanda peringatan, dan dialog negatif memeriksa ketiga tingkat.
8. Pada Master Barang, pratinjau hasil pencarian lalu terapkan; periksa `log_perubahan_harga` dan pastikan cabang lain tidak ikut berubah.
9. Uji batas waktu POS pukul 06:59, 07:00, 13:59, 14:00, 20:59, 21:00 WIB.

## Risiko yang diketahui

- Penerapan massal dibatasi 200 SKU per panggilan RPC dan dilakukan dalam beberapa chunk agar payload tetap kecil.
- SKU tanpa modal valid atau markup kosong dilewati dan dihitung pada respons `dilewati`.
- Jika migrasi markup belum diterapkan, UI menampilkan pesan yang jelas dan alur pembelian lama tetap dapat digunakan.
- Harga yang diketik manual pada faktur tidak ditimpa oleh perubahan draf markup.
- Detail pembelian baru selalu mengirim/menyimpan diskon persen 0–100; jembatan ke fungsi legacy hanya internal dan pemulihan diskon dipasangkan per urutan baris dalam grup barang+batch.
- Migration normalisasi bersifat fail-closed untuk nilai historis yang tidak dapat dibuktikan dari subtotal. Baris ambigu tidak ditebak dan dapat memerlukan pemeriksaan operator sebelum migration berhasil.
