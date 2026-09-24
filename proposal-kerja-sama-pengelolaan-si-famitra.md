# PROPOSAL KERJA SAMA PENGELOLAAN DAN PENGEMBANGAN SISTEM SI-FAMITRA

**Diajukan kepada:** Owner Apotek Fa-Mitra  
**Diajukan oleh:** [Nama Pengusul]  
**Tanggal:** [Tanggal Pengajuan]  
**Versi:** 1.0

> Dokumen ini merupakan proposal bisnis dan bahan pembahasan awal. Nilai imbalan, status hubungan kerja, target layanan, dan ketentuan hukum perlu disepakati serta ditinjau kembali sebelum dituangkan dalam perjanjian final.

## 1. Ringkasan Eksekutif

SI-FaMitra telah dikembangkan sebagai sistem operasional apotek yang mencakup kasir/POS, master barang, stok dan batch, pembelian, pelanggan, loyalty point, promosi, fixed bundle, laporan transaksi, serta analitik promo. Agar sistem memberikan manfaat yang konsisten, diperlukan penanggung jawab yang mengelola pemantauan harian, pemeliharaan sistem, dukungan pengguna, pengendalian data, dan pengembangan bertahap.

Melalui proposal ini, [Nama Pengusul] mengusulkan kerja sama berkelanjutan dengan Owner Apotek Fa-Mitra untuk menjalankan fungsi **pengelolaan sistem, dukungan operasional, analisis data, dan pengembangan fitur SI-FaMitra**. Kerja sama ini bertujuan memastikan sistem tetap tersedia, mudah digunakan, aman, dan selaras dengan kebutuhan operasional apotek.

## 2. Latar Belakang

Operasional apotek membutuhkan ketepatan data stok, batch, tanggal kedaluwarsa, harga, transaksi, pelanggan, dan laporan. Gangguan kecil pada proses kasir atau stok dapat memengaruhi pelayanan pelanggan dan akurasi laporan. Selain itu, data transaksi yang terkumpul dapat digunakan untuk meningkatkan pembelian, loyalty, promosi, dan pengambilan keputusan owner.

Karena itu, pengelolaan SI-FaMitra tidak cukup dilakukan hanya saat terjadi error. Sistem perlu dipantau secara rutin, didukung dengan prosedur pemulihan, dokumentasi perubahan, pengujian, serta evaluasi manfaat bisnis secara berkala.

## 3. Tujuan Kerja Sama

Kerja sama ini memiliki tujuan sebagai berikut:

1. Menjaga SI-FaMitra tetap dapat digunakan oleh kasir, owner, dan pengguna berwenang.
2. Menangani gangguan operasional secara terstruktur dan terdokumentasi.
3. Menjaga akurasi data barang, stok, batch, pelanggan, transaksi, dan promosi.
4. Menyediakan laporan dan analisis yang membantu owner mengambil keputusan.
5. Mengembangkan fitur berdasarkan prioritas bisnis, bukan perubahan spontan yang berisiko.
6. Menyediakan backup, prosedur pemulihan, dan catatan perubahan yang dapat ditelusuri.
7. Meningkatkan efisiensi kerja kasir dan kualitas pelayanan pelanggan.

## 4. Ruang Lingkup Pekerjaan

Ruang lingkup pekerjaan yang diusulkan meliputi pengelolaan aplikasi SI-FaMitra, koordinasi hosting dan backend, dukungan pengguna, pemeliharaan data, analitik, dokumentasi, serta pengembangan fitur yang telah disetujui.

Pekerjaan tidak secara otomatis mencakup pengadaan perangkat keras, perbaikan jaringan lokal, pengadaan printer, biaya layanan pihak ketiga, perubahan kebijakan harga, keputusan pembelian obat, atau pengambilan keputusan manajemen apotek. Hal-hal tersebut dapat dikerjakan atau dikoordinasikan berdasarkan persetujuan dan biaya terpisah.

## 5. Tanggung Jawab Harian

Tanggung jawab harian yang diusulkan adalah sebagai berikut.

### 5.1 Pemantauan operasional

- Memeriksa apakah aplikasi dapat diakses dan fungsi utama berjalan.
- Memantau keluhan kasir atau pengguna terkait POS, stok, batch, pelanggan, dan cetak struk.
- Mencatat error yang muncul, waktu kejadian, pengguna terdampak, dan langkah penanganan.
- Memastikan gangguan kritis diteruskan kepada owner dengan informasi yang cukup.

### 5.2 Dukungan pengguna

- Membantu kasir dan pengguna memahami alur kerja yang benar.
- Memberikan panduan penggunaan yang singkat dan dapat dipraktikkan.
- Membedakan masalah penggunaan, masalah data, masalah jaringan, dan masalah aplikasi.
- Menghindari perubahan data produksi tanpa persetujuan yang sesuai.

### 5.3 Pengendalian data transaksi

- Membantu memeriksa transaksi yang gagal, tertunda, atau berpotensi ganda.
- Memeriksa anomali stok atau batch yang dilaporkan pengguna.
- Menjaga agar koreksi data memiliki alasan dan catatan.
- Tidak menghapus transaksi atau data penting tanpa persetujuan owner dan catatan pemulihan.

### 5.4 Monitoring teknis

- Memantau deployment aplikasi dan status layanan hosting/backend.
- Memeriksa perubahan yang baru dipasang sebelum digunakan penuh.
- Melakukan pengecekan ringan setelah perubahan fitur atau konfigurasi.
- Menyimpan catatan versi, commit, atau perubahan konfigurasi yang relevan.

## 6. Tanggung Jawab Bulanan

Tanggung jawab bulanan yang diusulkan adalah sebagai berikut.

### 6.1 Laporan operasional sistem

Menyampaikan ringkasan yang mencakup ketersediaan aplikasi, jumlah gangguan, waktu penanganan, isu yang masih terbuka, perubahan yang dilakukan, dan rekomendasi perbaikan.

### 6.2 Backup dan pemulihan

- Memastikan backup source code, konfigurasi penting, dan data yang diperbolehkan telah tersedia.
- Memeriksa bahwa backup dapat dibaca dan memiliki tanggal serta checksum atau identitas versi.
- Meninjau kesiapan pemulihan apabila terjadi kerusakan, salah konfigurasi, atau kegagalan layanan.
- Tidak menjadikan backup sebagai pengganti kontrol akses dan keamanan akun.

### 6.3 Analisis bisnis

Menyusun ringkasan yang dapat mencakup penjualan, produk bergerak cepat, stok berisiko kedaluwarsa, pelanggan aktif, penggunaan promo, redemption, ROI/ROAS kampanye, serta anomali transaksi. Analisis disampaikan sebagai bahan pertimbangan; keputusan bisnis tetap berada pada owner.

### 6.4 Evaluasi keamanan dan akses

- Meninjau pengguna aktif dan hak aksesnya.
- Merekomendasikan penghapusan atau penonaktifan akses yang tidak lagi diperlukan.
- Meninjau penggunaan password, MFA bila tersedia, dan akses pihak ketiga.
- Melaporkan dugaan akses tidak sah kepada owner sesegera mungkin.

### 6.5 Perencanaan pengembangan

Menyusun backlog fitur, prioritas, estimasi pekerjaan, risiko, dan rencana pengujian untuk bulan berikutnya. Pengembangan baru dilakukan setelah lingkup dan prioritas disepakati.

## 7. Target Layanan Awal

Target layanan berikut merupakan usulan dan dapat disesuaikan dengan jam operasional apotek.

| Tingkat | Contoh kejadian | Respons awal yang diusulkan | Target penanganan awal |
|---|---|---:|---:|
| Kritis | Kasir tidak dapat bertransaksi sama sekali atau data transaksi berisiko ganda | Maksimal 30 menit setelah laporan diterima pada jam kerja | Mitigasi atau workaround maksimal 4 jam |
| Tinggi | Modul stok, batch, atau cetak struk terganggu untuk sebagian pengguna | Maksimal 2 jam pada jam kerja | Solusi atau rencana pemulihan maksimal 1 hari kerja |
| Sedang | Fitur tertentu bermasalah tetapi operasional masih dapat berjalan | Maksimal 1 hari kerja | Rencana perbaikan pada laporan mingguan/bulanan |
| Rendah | Permintaan perubahan tampilan, laporan, atau fitur baru | Maksimal 3 hari kerja | Masuk backlog dan dijadwalkan berdasarkan prioritas |

Target tersebut bukan jaminan tanpa pengecualian. Waktu dapat dipengaruhi oleh akses pihak ketiga, koneksi internet, kerusakan perangkat, ketersediaan informasi, dan kebutuhan persetujuan owner.

## 8. Bentuk Laporan kepada Owner

Laporan bulanan sekurang-kurangnya memuat:

- Ringkasan kondisi sistem.
- Daftar gangguan dan penyelesaiannya.
- Perubahan atau fitur yang dirilis.
- Status backup dan pengujian pemulihan.
- Ringkasan isu keamanan dan hak akses.
- Analisis operasional yang disepakati.
- Risiko yang perlu keputusan owner.
- Rencana kerja bulan berikutnya.
- Biaya pihak ketiga atau kebutuhan infrastruktur.

## 9. Model Imbalan yang Dapat Dibahas

Nilai imbalan belum ditetapkan dalam proposal ini. Para pihak dapat memilih salah satu model berikut:

| Model | Penjelasan | Cocok apabila |
|---|---|---|
| Retainer bulanan | Nilai tetap untuk dukungan, monitoring, laporan, dan kuota pengembangan yang disepakati | Owner menginginkan biaya yang mudah diprediksi |
| Fee per proyek | Pembayaran berdasarkan fitur atau proyek yang disetujui | Pengembangan dilakukan secara bertahap |
| Kombinasi | Retainer untuk operasional dan fee terpisah untuk fitur besar | Kebutuhan dukungan rutin dan pengembangan sama-sama tinggi |
| Per jam/per hari | Pembayaran berdasarkan waktu kerja yang tercatat | Lingkup pekerjaan sangat berubah-ubah |

Biaya hosting, database, domain, printer, perangkat kasir, layanan pesan, dan layanan pihak ketiga sebaiknya dinyatakan terpisah dari imbalan kerja apabila dibayar langsung oleh owner atau membutuhkan anggaran khusus.

## 10. Hak dan Tanggung Jawab Owner

Owner menyediakan akses, informasi, keputusan bisnis, dan persetujuan yang diperlukan. Owner juga menentukan kebijakan harga, promo, penghapusan data, hak akses pengguna, pengadaan perangkat, dan prioritas pengembangan.

Owner berhak menerima laporan, meminta penjelasan perubahan, menolak perubahan yang belum disetujui, dan meminta serah terima data serta dokumentasi sesuai ketentuan kerja sama.

## 11. Asumsi dan Batasan

Proposal ini mengasumsikan bahwa sistem, akun hosting, database, repository, dan perangkat yang digunakan dapat diakses secara sah oleh pihak yang ditunjuk. Keberhasilan pekerjaan dapat dipengaruhi oleh kualitas koneksi internet, perangkat kasir, printer, perubahan kebijakan penyedia layanan, serta kedisiplinan pengguna dalam memasukkan data.

Sistem tidak menggantikan tanggung jawab apoteker, kasir, owner, atau pihak lain dalam keputusan klinis, kepatuhan kefarmasian, keuangan, pajak, ketenagakerjaan, dan perlindungan data. Validasi hukum dan regulasi perlu dilakukan oleh pihak yang berwenang.

## 12. Tahapan Pelaksanaan

Tahap pertama adalah finalisasi ruang lingkup, peran, target layanan, dan nilai imbalan. Tahap kedua adalah inventarisasi akun, aset, data, perangkat, dan risiko. Tahap ketiga adalah penetapan prosedur tiket atau pelaporan gangguan. Tahap keempat adalah pelaksanaan dukungan harian dan laporan bulanan. Tahap kelima adalah evaluasi setelah satu sampai tiga bulan untuk menilai beban kerja dan penyesuaian kerja sama.

## 13. Keputusan yang Dimohon dari Owner

Owner dimohon memberikan keputusan atas hal-hal berikut:

1. Menyetujui prinsip kerja sama pengelolaan SI-FaMitra.
2. Menyetujui ruang lingkup tanggung jawab harian dan bulanan.
3. Menentukan model imbalan yang akan dinegosiasikan.
4. Menentukan jam dukungan dan kanal pelaporan.
5. Menentukan pihak yang berwenang menyetujui perubahan produksi.
6. Menentukan periode evaluasi dan tanggal mulai kerja sama.
7. Menunjuk pihak untuk meninjau dan menandatangani MoU final.

## 14. Penutup

SI-FaMitra merupakan aset operasional yang perlu dikelola secara berkelanjutan, bukan hanya diperbaiki ketika terjadi gangguan. Dengan pembagian tanggung jawab yang jelas, owner memperoleh transparansi atas kondisi sistem, sedangkan pengelola sistem memiliki ruang kerja, prioritas, dan ukuran keberhasilan yang dapat dipertanggungjawabkan.

Demikian proposal ini disampaikan sebagai bahan pembahasan. Rincian final mengenai status hubungan kerja, nilai imbalan, pajak, kerahasiaan, kepemilikan hasil kerja, dan penghentian kerja sama perlu dituangkan dalam dokumen perjanjian yang ditinjau oleh para pihak.

**[Nama Pengusul]**  
Tanda tangan: ____________________  
Tanggal: ____________________

**Owner Apotek Fa-Mitra**  
Nama: ____________________  
Tanda tangan: ____________________  
Tanggal: ____________________

## Referensi

[1]: https://supabase.com/pricing "Supabase Pricing"
[2]: https://developers.cloudflare.com/pages/platform/limits/ "Cloudflare Pages Limits"
[3]: https://developers.cloudflare.com/workers/platform/limits/ "Cloudflare Workers Limits"
# "Proposal Pengelolaan dan Pengembangan SI-FaMitra"

**Lampiran:** Draft MoU Pengelolaan dan Pengembangan SI-FaMitra.
