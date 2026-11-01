# Backup & Restore Database Apotek

> **Inti singkat**
> 1. Jalankan `tools\backup-famitra.cmd` (klik dua kali). Sekali jalan dalam hitungan menit.
> 2. Hasilnya ada di `C:\Users\User\backup-famitra\<tanggal_jam>\`.
> 3. Sesekali jalankan `tools\restore-drill.cmd` untuk membuktikan backup memang bisa dipulihkan.

---

## 1. Kenapa ini perlu

Project Supabase apotek memakai **paket Free**, dan paket Free **tidak mendapat backup otomatis**
dari Supabase. Artinya, tanpa langkah di dokumen ini:

- satu `DELETE`/`UPDATE` salah, satu tombol yang tertekan, atau satu proyek yang terhapus
  berarti data penjualan, pembelian, stok, hutang, dan pelanggan **hilang permanen**;
- tidak ada undo. Tidak ada "kembali ke kemarin".

Dokumentasi resmi Supabase sendiri menyarankan pemilik paket Free mengekspor database secara
berkala dengan `supabase db dump` dan menyimpan salinannya di luar server.

Backup ini adalah **jaring pengaman**, bukan pengganti kehati-hatian: data production tetap hanya
boleh diubah lewat aplikasi (lihat `PERINGATAN-DATA-PRODUCTION.md`).

## 2. Apa yang dibackup, dan apa yang tidak

| Isi | Ikut dibackup? | Catatan |
|---|---|---|
| Seluruh tabel di schema `public` (barang, batch, nota, pembelian, pelanggan, hutang, promo, poin, lottery, target, log) | Ya | Berkas `data.sql` |
| Struktur tabel, index, fungsi, trigger, policy RLS | Ya | Berkas `schema.sql` |
| Role database | Ya | Berkas `roles.sql` |
| Akun login (schema `auth`, termasuk `auth.users`) | Ya | 4 akun ikut ter-backup; berisi hash password → berkas backup **rahasia** |
| Berkas di Storage (foto/berkas unggahan) | **Tidak** | Yang tersimpan di database hanya metadata; saat ini belum ada objek Storage |

Catatan penting: pada uji restore ke Postgres biasa (Docker), isi schema `auth` dan `storage`
**tidak** dapat dipulihkan karena kedua schema itu milik platform Supabase (butuh role dan
extension khusus). Yang wajib utuh — dan terbukti utuh — adalah seluruh schema `public`.
Pemulihan penuh ke Supabase asli tetap membawa akun login, karena dump-nya memang memuatnya.

### Hasil backup pertama (1 November 2026, 08.44)

Backup pertama sudah dibuat dan diuji:

| Hal | Hasil |
|---|---|
| Folder | `C:\Users\User\backup-famitra\2026-11-01_0844\` |
| `schema.sql` | 309.071 byte |
| `data.sql` | 6.746.168 byte (91 tabel, 46.955 baris) |
| Tabel terbesar | `public.trx_penjualan_detail` 16.588 baris, `public.trx_penjualan` 6.903, `public.trx_pembelian_detail` 5.688, `public.stok_batch` 5.433, `public.master_barang` 5.004 |
| Uji restore ke Docker | **LULUS** — 58 dari 58 tabel `public` cocok jumlah barisnya |
| Lama proses | ± 2 menit (setelah Docker menyala) |

## 3. Cara membuat backup

### Cara termudah (disarankan)

Klik dua kali **`tools\backup-famitra.cmd`**, atau dari Command Prompt di folder repo:

```bat
tools\backup-famitra.cmd
```

Yang dilakukan skrip, berurutan:

1. memastikan Docker Desktop menyala (pg_dump dijalankan di dalam container);
2. menyiapkan Supabase CLI sekali saja — diunduh dari rilis resmi Supabase ke
   `%LOCALAPPDATA%\famitra-cli\supabase.exe` (checksum resmi diverifikasi);
3. membuat tiga dump: `roles.sql`, `schema.sql`, `data.sql`;
4. menghitung jumlah baris per tabel dari hasil dump dan menyimpannya di `manifest.json`;
5. menghapus backup terlama bila jumlah backup melebihi batas simpan.

### Aman dijalankan saat apotek buka

Dump hanya **membaca**. Tidak ada `INSERT`/`UPDATE`/`DELETE`/`DROP`, tidak ada tabel yang dikunci
untuk penulisan, dan kasir tetap bisa melayani. Yang bertambah hanya beban baca sesaat.

### Opsi

| Perintah | Arti |
|---|---|
| `tools\backup-famitra.cmd` | Backup, simpan 14 backup terbaru |
| `tools\backup-famitra.cmd -Simpan 30` | Simpan 30 backup terbaru |
| `tools\backup-famitra.cmd -Kompres` | Tambah arsip `backup.zip` di dalam folder backup |
| `tools\backup-famitra.cmd -Tujuan D:\backup-famitra` | Simpan ke lokasi lain |
| `tools\backup-famitra.cmd -CliPath "C:\...\supabase.exe"` | Pakai CLI yang sudah ada, tanpa mengunduh |

## 4. Isi folder backup

```
C:\Users\User\backup-famitra\2026-11-01_0824\
  roles.sql      -- role database
  schema.sql     -- struktur tabel, index, fungsi, trigger, policy
  data.sql       -- isi seluruh tabel (format COPY)
  manifest.json  -- waktu, ukuran, sha256, jumlah baris per tabel
  ringkasan.txt  -- ringkasan untuk dibaca manusia
```

`manifest.json` adalah alat pembanding: kalau pada suatu backup tiba-tiba satu tabel berubah dari
12.000 baris menjadi 3 baris, itu tanda ada masalah — bukan tanda backup-nya berhasil.

## 5. Menguji bahwa backup bisa dipulihkan

Backup yang belum pernah diuji belum terbukti apa pun. Jalankan:

```bat
tools\restore-drill.cmd
```

Skrip ini:

1. memakai backup terbaru (atau `-Folder <path>` tertentu);
2. menyalakan Postgres sementara di Docker pada port 55432 — **database production tidak disentuh**;
3. memulihkan `roles.sql`, `schema.sql`, lalu `data.sql` ke database kosong;
4. membandingkan jumlah baris setiap tabel dengan `manifest.json`;
5. menghapus container setelah selesai.

Hasil:

- **`HASIL: LULUS`** — backup terbukti bisa dipulihkan dan jumlah barisnya utuh.
- **`HASIL: PERIKSA`** — restore berjalan tetapi ada galat/selisih. Baca daftar tabel yang tidak
  cocok. Jangan hapus backup tersebut sebelum jelas penyebabnya.

Lakukan uji restore minimal **sebulan sekali**, dan setiap kali setelah ada perubahan skema besar.

## 6. Kalau benar-benar harus memulihkan data production

Ini tindakan **berisiko dan menyentuh production** — jangan dikerjakan sendiri tanpa persetujuan
pemilik, dan jangan pernah dijalankan sebagai "coba-coba".

Urutan aman yang disarankan:

1. **Amankan dulu keadaan sekarang**: jalankan `tools\backup-famitra.cmd` sekali lagi, supaya
   kondisi terbaru (walau bermasalah) tetap tersimpan sebelum ditimpa.
2. Uji restore backup pilihan ke Docker lokal (`tools\restore-drill.cmd -Folder ...`) sampai LULUS.
3. Tentukan cakupan: seluruh database, atau hanya beberapa tabel.
4. Pemulihan penuh sebaiknya lewat **Dashboard Supabase → Database → Backups** atau ke **project
   baru** (restore to a new project), bukan menimpa production langsung.
5. Bila hanya beberapa baris/tabel yang perlu dikembalikan, ambil nilainya dari hasil restore lokal
   (langkah 2), lalu masukkan **lewat aplikasi** oleh petugas berwenang — bukan lewat SQL manual ke
   production.
6. Setelah pulih, jalankan `tools\restore-drill.cmd` pada backup baru untuk memastikan keadaan sudah
   sehat.

## 7. Batasan yang harus disadari

- **Backup hanya sekuat tempat penyimpanannya.** Saat ini backup berada di laptop yang sama dengan
  database yang dipakai. Kalau laptop rusak atau hilang, backup ikut hilang. _Sangat disarankan_
  menyalin folder `C:\Users\User\backup-famitra` ke Google Drive/flashdisk minimal seminggu sekali.
- **Backup menyimpan kondisi apa adanya.** Kalau hari ini ada data yang salah, backup hari ini juga
  memuat data yang salah itu. Backup melindungi dari kehilangan data, bukan dari kesalahan data.
- **Tidak ada backup otomatis.** Saat ini backup dijalankan manual (pilihan pemilik). Risikonya:
  lupa. Kalau nanti ingin otomatis, jadwalkan `tools\backup-famitra.cmd` lewat Windows Task
  Scheduler setiap malam setelah apotek tutup — tidak perlu mengubah kode apa pun.
- **Tidak mencakup berkas Storage** (lihat bagian 2).
- **Berkas backup bersifat rahasia.** `data.sql` memuat data pelanggan dan hash password akun login.
  Jangan di-commit, jangan dikirim lewat WhatsApp/email, jangan disimpan di folder publik. Simpan
  hanya di laptop/apotek atau media milik sendiri.
- **Restore ke Docker tidak menguji akun login.** Uji restore memeriksa schema `public` (data apotek);
  schema `auth`/`storage` hanya bisa dipulihkan oleh platform Supabase (lihat bagian 2).

## 8. Pemeliharaan

| Kapan | Apa |
|---|---|
| Setelah menutup apotek, atau sebelum perubahan besar | Jalankan backup |
| Minimal sebulan sekali | Jalankan uji restore |
| Minimal seminggu sekali | Salin folder backup ke luar laptop |
| Setiap setelah migrasi skema | Backup + uji restore |

---

*Dibuat: 2026-11-01. Terkait: `PERINGATAN-DATA-PRODUCTION.md`, `AGENTS.md`.*
