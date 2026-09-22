# Rencana Pengembangan Kupon dan Promo Berbasis Segmen Pelanggan

**Proyek:** SI-FaMitra  
**Versi dokumen:** 1.0  
**Tanggal:** 23 September 2026  
**Penulis:** Manus AI

## 1. Ringkasan dan keputusan utama

Fitur kupon dan promo akan menghubungkan segmentasi pelanggan dengan proses penjualan di POS. Sistem akan memilih pelanggan berdasarkan segmen CRM, menampilkan kupon yang memenuhi syarat, memvalidasi kupon kembali di server, dan mencatat penggunaan untuk mencegah penyalahgunaan.

Implementasi sebaiknya dimulai dengan **MVP kupon terarah**, bukan mesin promosi yang terlalu umum. MVP tersebut mencakup kupon berdasarkan segmen `Baru`, `Active Routine`, `VIP`, `At-Risk`, dan `Dormant`; batas masa berlaku; batas penggunaan; minimum belanja; diskon nominal atau persentase; serta pembatasan satu penggunaan per pelanggan. Setelah alur ini stabil, sistem dapat diperluas dengan promo produk, bundling, jadwal kampanye, dan analitik efektivitas.

Rencana ini mengikuti arsitektur yang sudah digunakan SI-FaMitra: halaman statis di Cloudflare Pages, pemanggilan aksi melalui Edge Function `api`, dan penyimpanan transaksi serta pelanggan di Supabase. Validasi bisnis wajib berada di backend karena validasi di browser dapat dimodifikasi oleh pengguna.

## 2. Tujuan bisnis

Fitur ini ditujukan untuk meningkatkan pembelian ulang dengan penawaran yang relevan. Pelanggan baru dapat memperoleh insentif transaksi pertama, pelanggan aktif dapat menerima penghargaan pembelian rutin, pelanggan VIP dapat menerima manfaat eksklusif, dan pelanggan berisiko tidak aktif dapat menerima penawaran reaktivasi.

Sistem juga harus membantu Owner mengevaluasi apakah suatu kampanye menghasilkan transaksi tambahan. Karena itu, setiap kupon perlu menyimpan sumber kampanye, segmen sasaran, jumlah penukaran, nilai diskon, dan omzet transaksi yang menggunakan kupon.

Fitur ini **tidak boleh menyimpulkan diagnosis medis** dari segmen atau histori pembelian. Segmen CRM hanya digunakan untuk tujuan komersial dan operasional. Nama kampanye, kupon, dan pesan kepada pelanggan harus menghindari klaim kesehatan yang tidak diverifikasi.

## 3. Kondisi awal dan batasan arsitektur

Saat ini modul CRM telah memiliki segmen pelanggan berikut:

| Segmen | Makna operasional saat ini |
|---|---|
| `Baru` | Belum memiliki transaksi atau belum memiliki tanggal pembelian terakhir |
| `Active Routine` | Memiliki transaksi dan tidak masuk kategori berisiko, dormant, atau VIP |
| `VIP` | Total belanja minimal Rp2.000.000 atau minimal 8 transaksi |
| `At-Risk` | Tidak bertransaksi lebih dari 60 hari dan tidak lebih dari 180 hari |
| `Dormant` | Tidak bertransaksi lebih dari 180 hari |

Data pelanggan berada pada `master_customer`. Transaksi berada pada `trx_penjualan` dan rincian produk pada `trx_penjualan_detail`. Proses POS menggunakan fungsi database `pos_checkout`, sedangkan frontend memanggil backend melalui Edge Function `api`.

Kondisi tersebut mengandung dua implikasi. Pertama, kupon harus merujuk pada `customer_id` atau nomor pelanggan yang telah dinormalisasi, bukan hanya nama. Kedua, harga akhir dan kelayakan kupon harus dihitung ulang ketika checkout di server agar diskon tidak dapat dimanipulasi dari browser.

## 4. Ruang lingkup MVP

MVP akan mencakup empat area utama.

### 4.1 Manajemen kampanye dan kupon

Owner dapat membuat, mengubah, mengaktifkan, menjeda, dan mengarsipkan kampanye. Setiap kampanye dapat memiliki satu atau lebih kupon. Untuk tahap pertama, kode kupon dapat dibuat otomatis oleh sistem atau dimasukkan oleh Owner.

Field minimum kampanye meliputi nama, deskripsi internal, periode aktif, cabang, segmen sasaran, status, dan pembuat. Field minimum kupon meliputi kode, jenis diskon, nilai diskon, minimum belanja, maksimum diskon untuk promo persentase, batas total penggunaan, batas penggunaan per pelanggan, dan syarat tipe customer jika diperlukan.

### 4.2 Penggunaan kupon di POS

Kasir memilih pelanggan terlebih dahulu, kemudian memasukkan kode kupon. Sistem menampilkan hasil validasi yang jelas, misalnya kupon valid, sudah kedaluwarsa, minimum belanja belum tercapai, pelanggan tidak termasuk segmen sasaran, atau kuota telah habis.

Kupon yang lolos validasi diterapkan sebagai komponen diskon terpisah. POS harus menampilkan subtotal, diskon umum, diskon kupon, reward poin, dan harga akhir secara terpisah agar audit transaksi mudah dilakukan.

### 4.3 Pencatatan dan pencegahan penyalahgunaan

Setiap penggunaan kupon harus dicatat dalam transaksi atomik bersama transaksi penjualan. Sistem harus mencegah dua kasir menggunakan kuota terakhir secara bersamaan. Pembatasan satu penggunaan per pelanggan harus dijamin dengan indeks unik atau pemeriksaan transaksi yang berada di dalam transaksi database.

### 4.4 Pelaporan kampanye

Owner dapat melihat jumlah kupon diterbitkan, jumlah kupon digunakan, pelanggan unik, nilai diskon, omzet dari transaksi berkode kupon, dan rasio penggunaan. Laporan MVP tidak perlu langsung menghitung incremental revenue secara kausal; istilah yang tepat pada tahap awal adalah omzet transaksi yang menggunakan kupon.

## 5. Aturan bisnis yang direkomendasikan

Aturan berikut menjadi dasar MVP:

1. Kupon hanya dapat digunakan pada cabang tempat kupon diterbitkan.
2. Kupon hanya dapat digunakan selama `starts_at <= waktu_server <= expires_at`.
3. Kupon aktif harus memiliki kuota total yang belum habis.
4. Pelanggan harus terdaftar agar promo berbasis segmen dapat divalidasi.
5. Segmen dihitung dari data pelanggan saat kupon divalidasi, bukan dari segmen lama yang dikirim browser.
6. Kupon dengan batas per pelanggan hanya dapat digunakan sebanyak batas tersebut pada transaksi yang berhasil.
7. Kupon persentase memiliki batas maksimum nominal diskon.
8. Nilai diskon tidak boleh membuat harga akhir kurang dari nol.
9. Satu transaksi hanya menggunakan satu kupon pada MVP. Kombinasi kupon dapat ditambahkan setelah aturan prioritas dan konflik disepakati.
10. Kupon tidak berlaku untuk pelanggan bertipe `Apotek Lain` kecuali Owner secara eksplisit membuat promo yang mengizinkannya.
11. Nilai kupon tidak dihitung sebagai omzet untuk tujuan poin loyalti apabila kebijakan bisnis menetapkan poin dihitung dari nilai setelah diskon. Kebijakan ini harus diputuskan dan diterapkan konsisten pada fungsi checkout.
12. Transaksi yang dibatalkan atau diretur harus memiliki aturan pengembalian kuota dan koreksi nilai promo yang terdokumentasi.

### Jenis promo pada MVP

| Jenis | Contoh | Prioritas |
|---|---|---:|
| Diskon nominal | Potongan Rp10.000 dengan minimum belanja Rp100.000 | MVP |
| Diskon persentase | Potongan 10% maksimal Rp25.000 | MVP |
| Gratis ongkir | Tidak relevan untuk POS fisik saat ini | Ditunda |
| Harga khusus produk | Produk tertentu dengan harga promo | Fase 2 |
| Bundling atau beli X gratis Y | Membutuhkan mesin aturan produk | Fase 2 |

## 6. Desain data yang diusulkan

Nama tabel dapat disesuaikan dengan konvensi database yang sudah ada. Struktur berikut cukup untuk MVP.

### 6.1 `promo_campaigns`

Tabel ini menyimpan identitas dan periode kampanye.

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid | Primary key |
| `cabang_id` | text | Cabang pemilik kampanye |
| `name` | text | Nama kampanye |
| `description` | text | Deskripsi internal |
| `starts_at` | timestamptz | Awal masa berlaku |
| `ends_at` | timestamptz | Akhir masa berlaku |
| `status` | text | `DRAFT`, `ACTIVE`, `PAUSED`, `ARCHIVED` |
| `created_by` | text | Username pembuat |
| `created_at` | timestamptz | Waktu pembuatan |
| `updated_at` | timestamptz | Waktu perubahan |

### 6.2 `promo_segment_targets`

Tabel ini memungkinkan satu kampanye menyasar beberapa segmen.

| Kolom | Tipe | Keterangan |
|---|---|---|
| `campaign_id` | uuid | Referensi kampanye |
| `segment` | text | Salah satu nilai segmen CRM |
| `customer_type` | text nullable | Opsional, misalnya `Umum` atau `Tenaga Kesehatan` |

Kombinasi `campaign_id`, `segment`, dan `customer_type` harus unik. Jika tidak ada target yang disimpan, kampanye tidak boleh otomatis dianggap berlaku untuk semua pelanggan; Owner harus memilih target secara eksplisit.

### 6.3 `promo_coupons`

Tabel ini menyimpan aturan kupon yang dapat dipakai di POS.

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid | Primary key |
| `campaign_id` | uuid | Referensi kampanye |
| `code` | text | Kode yang dimasukkan kasir |
| `discount_type` | text | `FIXED` atau `PERCENT` |
| `discount_value` | numeric | Nominal rupiah atau persentase |
| `max_discount` | numeric nullable | Batas diskon untuk persentase |
| `min_purchase` | numeric | Minimum subtotal yang memenuhi syarat |
| `usage_limit_total` | integer nullable | Kuota total; null berarti tanpa batas |
| `usage_limit_per_customer` | integer | Batas per pelanggan |
| `is_active` | boolean | Status aktif |
| `created_at` | timestamptz | Waktu pembuatan |

Kode harus unik dalam satu cabang. Untuk menghindari masalah huruf besar-kecil, sistem sebaiknya menyimpan kode dalam bentuk uppercase dan melakukan normalisasi `trim + uppercase` di backend.

### 6.4 `promo_redemptions`

Tabel ini menjadi ledger penggunaan kupon.

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid | Primary key |
| `coupon_id` | uuid | Kupon yang digunakan |
| `campaign_id` | uuid | Disalin untuk pelaporan cepat |
| `customer_id` | uuid | Pelanggan yang memakai |
| `cabang_id` | text | Cabang transaksi |
| `invoice_no` | text | Nomor nota |
| `discount_amount` | numeric | Nilai diskon aktual |
| `redeemed_at` | timestamptz | Waktu penggunaan |
| `status` | text | `APPLIED`, `REVERSED` |

Indeks yang disarankan adalah pada `coupon_id`, `customer_id`, `campaign_id`, dan `invoice_no`. Constraint unik bersyarat dapat digunakan jika `usage_limit_per_customer = 1` atau sistem dapat menegakkannya melalui fungsi database.

### 6.5 Perubahan pada `trx_penjualan`

Tambahkan `coupon_id`, `coupon_code`, `campaign_id`, dan `coupon_discount` ke `trx_penjualan`. Nilai tersebut perlu dicetak pada struk atau setidaknya tersedia pada detail nota dan laporan audit.

## 7. API dan alur proses

### 7.1 Endpoint yang diperlukan

Edge Function `api` dapat menambahkan aksi berikut:

| Aksi | Role | Fungsi |
|---|---|---|
| `promo.campaignList` | Owner | Daftar kampanye dengan filter status dan periode |
| `promo.campaignSave` | Owner | Membuat atau mengubah kampanye |
| `promo.campaignStatus` | Owner | Mengaktifkan, menjeda, atau mengarsipkan kampanye |
| `promo.couponList` | Owner | Daftar kupon dan penggunaan |
| `promo.couponSave` | Owner | Membuat atau mengubah aturan kupon |
| `promo.validate` | Owner, Apoteker, Kasir | Memvalidasi kupon untuk pelanggan dan keranjang |
| `promo.report` | Owner | Ringkasan performa kampanye |

`promo.validate` hanya bersifat pratinjau. Fungsi `pos_checkout` harus melakukan validasi yang sama di dalam transaksi database dan tidak boleh mempercayai nilai diskon dari browser.

### 7.2 Urutan checkout

1. Kasir mencari nomor WhatsApp pelanggan.
2. POS memperoleh `customer_id`, tipe customer, dan segmen terkini dari server.
3. Kasir memasukkan kode kupon.
4. Frontend memanggil `promo.validate` untuk menampilkan hasil awal.
5. Kasir menekan simpan transaksi.
6. `pos_checkout` mengunci kupon dan data penggunaan yang relevan.
7. Backend menghitung ulang subtotal dari item dan harga yang sah.
8. Backend menghitung diskon kupon berdasarkan aturan kampanye.
9. Backend memeriksa masa berlaku, cabang, segmen, tipe customer, minimum belanja, dan kuota.
10. Backend menyimpan nota, detail nota, dan `promo_redemptions` dalam satu transaksi.
11. Backend menghitung poin loyalti berdasarkan kebijakan nilai transaksi yang telah ditetapkan.
12. Frontend menampilkan nota dengan rincian promo.

Jika salah satu pemeriksaan gagal, seluruh transaksi harus dibatalkan dan kasir menerima pesan yang dapat ditindaklanjuti.

## 8. Desain layar

### 8.1 Halaman Manajemen Promo

Halaman Owner sebaiknya memiliki tiga bagian. Bagian pertama menampilkan ringkasan kampanye aktif. Bagian kedua menampilkan tabel kampanye dengan status, periode, segmen sasaran, jumlah penukaran, dan nilai diskon. Bagian ketiga menyediakan form kampanye dan kupon.

Form harus menampilkan pratinjau aturan dalam bahasa sederhana, misalnya: **“Pelanggan VIP mendapat diskon 10%, maksimal Rp25.000, untuk belanja minimal Rp150.000 sampai 31 Oktober 2026.”** Pratinjau ini mengurangi kesalahan konfigurasi.

### 8.2 Perubahan POS

Tambahkan field kode kupon di area pembayaran. Setelah validasi, tampilkan nama kampanye, nilai diskon, dan alasan jika kupon tidak dapat digunakan. Tombol simpan tidak boleh aktif bila validasi terakhir gagal, tetapi backend tetap wajib memvalidasi ulang.

### 8.3 CRM

Pada tabel pelanggan, tambahkan indikator kupon aktif yang tersedia untuk pelanggan tersebut. Detail pelanggan dapat menampilkan riwayat penggunaan promo, bukan hanya total belanja dan poin.

## 9. Keamanan, audit, dan privasi

Kode kupon, nominal diskon, segmen, dan kuota merupakan aturan bisnis. Semua keputusan final harus dibuat di backend. Frontend hanya menampilkan hasil.

Akses pembuatan dan perubahan kampanye dibatasi untuk Owner. Kasir dan Apoteker hanya dapat memvalidasi serta menggunakan kupon sesuai hak akses. Setiap perubahan aturan perlu menyimpan username, waktu, dan nilai sebelum-sesudah apabila audit trail sudah tersedia.

Nomor WhatsApp dan riwayat pembelian harus diperlakukan sebagai data pelanggan. Broadcast atau reminder pemasaran hanya boleh dikirim kepada pelanggan yang telah memberikan persetujuan pemasaran. Fitur promo harus menghormati `consent_marketing` dan tidak boleh mengubah persetujuan tanpa tindakan eksplisit pelanggan atau petugas berwenang.

Sistem juga perlu membatasi frekuensi kampanye per pelanggan. Batas ini dapat berupa jumlah kupon per hari atau jumlah pesan per periode. Pembatasan tersebut mencegah pelanggan menerima terlalu banyak pesan dan mengurangi risiko kampanye dianggap spam.

## 10. Fase implementasi

### Fase 0 — Klarifikasi kebijakan

Tetapkan apakah poin dihitung dari subtotal sebelum atau sesudah kupon. Tetapkan apakah kupon boleh digabung dengan diskon manual dan reward poin. Tetapkan aturan saat retur. Tetapkan role yang boleh membuat promo. Fase ini harus selesai sebelum perubahan database agar aturan tidak berubah di tengah implementasi.

### Fase 1 — Fondasi data dan validasi server

Buat tabel kampanye, target segmen, kupon, dan redemption. Tambahkan kolom promo pada transaksi. Buat fungsi validasi backend dan ubah `pos_checkout` agar menggunakan satu sumber kebenaran. Tambahkan indeks dan constraint yang diperlukan.

### Fase 2 — POS dan manajemen Owner

Tambahkan form Manajemen Promo, validasi kode kupon di POS, rincian diskon di ringkasan pembayaran, serta pencatatan penggunaan. Uji transaksi normal, transaksi dengan reward, transaksi multi-cabang, dan transaksi tanpa pelanggan.

### Fase 3 — Pelaporan dan kontrol operasional

Tambahkan laporan penggunaan per kampanye, nilai diskon, pelanggan unik, dan omzet transaksi promo. Tambahkan export CSV jika diperlukan. Tambahkan log perubahan konfigurasi dan pesan error yang konsisten.

### Fase 4 — Promo berbasis produk

Setelah MVP stabil, tambahkan target produk atau kategori, harga promo, bundling, dan aturan prioritas. Fase ini harus menggunakan mesin aturan yang terpisah agar aturan kupon segmen tidak menjadi terlalu kompleks.

## 11. Kriteria penerimaan MVP

MVP dapat dianggap selesai apabila seluruh kondisi berikut terpenuhi:

- Owner dapat membuat kampanye yang menargetkan satu atau lebih segmen.
- Owner dapat mengaktifkan dan menjeda kupon tanpa menghapus histori penggunaan.
- Kasir dapat memasukkan kode kupon pada POS.
- Sistem menolak kupon yang tidak aktif, kedaluwarsa, salah cabang, tidak sesuai segmen, belum memenuhi minimum belanja, atau kehabisan kuota.
- Backend menghitung ulang nilai diskon dan tidak mempercayai nominal dari browser.
- Dua checkout bersamaan tidak dapat memakai kuota terakhir secara ganda.
- Penggunaan per pelanggan mengikuti batas yang dikonfigurasi.
- Nota menyimpan kode kampanye dan nilai diskon aktual.
- Retur memiliki aturan koreksi penggunaan kupon yang jelas.
- Pelanggan `Apotek Lain` tidak menerima promo apabila kampanye tidak secara eksplisit mengizinkannya.
- Laporan Owner menampilkan penggunaan dan nilai diskon secara konsisten dengan transaksi.
- Semua file frontend lolos pemeriksaan sintaks dan deployment Cloudflare Pages berhasil.

## 12. Risiko dan mitigasi

**Risiko pertama adalah diskon ganda.** Risiko ini muncul jika diskon manual, reward poin, dan kupon tidak memiliki aturan prioritas. Mitigasinya adalah memakai satu urutan perhitungan di `pos_checkout` dan menampilkan setiap komponen secara terpisah.

**Risiko kedua adalah kuota terpakai ganda.** Mitigasinya adalah melakukan penguncian baris atau operasi atomik pada saat checkout, bukan ketika kupon pertama kali divalidasi di frontend.

**Risiko ketiga adalah segmen berubah setelah kupon diterbitkan.** MVP sebaiknya memvalidasi segmen saat checkout. Jika bisnis memerlukan kupon yang tetap berlaku setelah pelanggan keluar dari segmen, tambahkan mode snapshot pada fase berikutnya.

**Risiko keempat adalah aturan promo sulit diaudit.** Mitigasinya adalah menyimpan kampanye, kupon, dan redemption sebagai entitas terpisah serta menyimpan nilai diskon aktual pada nota.

**Risiko kelima adalah pengiriman pesan pemasaran tanpa persetujuan.** Mitigasinya adalah memeriksa `consent_marketing` di layanan notifikasi dan menyediakan mekanisme penghentian komunikasi.

## 13. Indikator keberhasilan

Pada tahap awal, pantau jumlah kupon aktif, tingkat penukaran, pelanggan unik yang menggunakan kupon, rata-rata nilai transaksi dengan promo, nilai diskon per kampanye, dan proporsi transaksi promo terhadap seluruh transaksi. Angka tersebut menggambarkan adopsi, tetapi belum membuktikan bahwa promo menghasilkan penjualan tambahan.

Pada tahap berikutnya, bandingkan kelompok pelanggan yang menerima promo dengan kelompok serupa yang tidak menerima promo. Perbandingan tersebut dapat memberikan estimasi yang lebih baik tentang pembelian ulang, tetapi harus dirancang secara konsisten dan tidak mencampurkan kampanye yang berbeda.

## 14. Rekomendasi prioritas

Prioritas pertama adalah menyelesaikan kebijakan perhitungan diskon dan poin. Prioritas kedua adalah membangun fondasi data serta validasi atomik di backend. Prioritas ketiga adalah mengintegrasikan input kupon ke POS. Prioritas keempat adalah membuat halaman Manajemen Promo dan laporan Owner. Promo berbasis produk, bundling, dan otomatisasi kampanye sebaiknya ditunda sampai MVP digunakan dalam transaksi nyata dan hasilnya dapat dievaluasi.

Dengan urutan tersebut, SI-FaMitra dapat memiliki fitur marketing yang terintegrasi dengan penjualan tanpa langsung membangun sistem marketing automation yang terlalu besar untuk kebutuhan operasional saat ini.

## Referensi

[1]: https://github.com/suryohadikuncoro-hue/famitra-web "Repository SI-FaMitra"

[2]: https://developers.cloudflare.com/pages/ "Cloudflare Pages Documentation"

[3]: https://supabase.com/docs/guides/database/functions "Supabase Database Functions Documentation"

[4]: https://supabase.com/docs/guides/database/postgres/row-level-security "Supabase Row Level Security Documentation"

[5]: https://supabase.com/docs/guides/database/postgres/transactions "Supabase PostgreSQL Transactions Documentation"
