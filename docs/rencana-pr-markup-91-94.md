# Rencana PR #91–#94: Penyempurnaan Markup, Pricing, dan Stok & Batch

Dokumen ini menjadi acuan lanjutan setelah PR #90 (`Add bulk markup selection and batch margins`) selesai di-merge dan Edge Function `api` berhasil di-deploy.

## Status awal

- PR #90 sudah di-merge ke `main`.
- Perubahan PR #90 mencakup:
  - pemilihan beberapa SKU pada modal markup Master Barang;
  - pilihan semua hasil pencarian;
  - harga jual SKU pada Stok & Batch;
  - margin per batch terhadap modal efektif batch;
  - perluasan response endpoint `stok.list`.
- Model harga saat ini:

```text
Modal efektif → per batch
Harga jual → per SKU/master barang
Margin → dihitung per batch
```

- PR #90 tidak menambahkan migration SQL.
- Perubahan Edge Function pada PR #90 memerlukan deploy function `api`, tetapi tidak memerlukan `db push`.
- PR #91 sudah diimplementasikan pada branch `feat/markup-ux-improvement` dan siap dibuat menjadi pull request.
- PR #91 hanya mengubah frontend dan test; tidak mengubah Edge Function atau database.

---

## Urutan implementasi

```text
PR #91 — Penyempurnaan UX markup
        ↓
PR #92 — Pengujian backend dan kontrak API pricing
        ↓
PR #93 — Perbaikan tampilan Stok & Batch
        ↓
PR #94 — Harga jual per batch, hanya jika kebutuhan bisnis dikonfirmasi
```

PR #94 adalah opsi pengembangan lanjutan, bukan kewajiban. Fitur tersebut hanya dikerjakan jika satu SKU memang perlu memiliki harga jual yang berbeda antar-batch.

---

# PR #91 — Penyempurnaan UX Markup Master Barang

## Tujuan

Membuat proses markup lebih cepat, mudah dipahami, dan tidak mengharuskan pengguna berulang kali menekan tombol pratinjau.

## Scope

### 1. Handler input nama atau kode obat

- Tambahkan pencarian otomatis ketika pengguna mengetik.
- Gunakan debounce sekitar 300–400 ms.
- Tampilkan indikator loading saat request berlangsung.
- Jangan mengirim request untuk input yang terlalu pendek, misalnya kurang dari 2 karakter, kecuali kode lengkap.
- Batalkan atau abaikan response request lama jika pengguna sudah mengetik pencarian baru.
- Tampilkan pesan yang jelas ketika hasil kosong.

### 2. Selection beberapa item

Pertahankan dan sempurnakan kemampuan dari PR #90:

- checkbox per item;
- jumlah item terpilih;
- pilih semua hasil pencarian;
- hapus semua pilihan;
- pilihan tetap konsisten ketika daftar diperbarui.

Bedakan secara eksplisit tiga konsep berikut:

1. **Pilih item pada halaman ini**;
2. **Pilih semua hasil pencarian**;
3. **Pilih semua item pada cabang**.

Jika mode pilih semua hasil digunakan, UI harus memberi tahu bahwa item di halaman berikutnya juga akan ikut diproses.

### 3. Preview stale guard

- Jika konfigurasi markup berubah, preview lama harus dianggap tidak berlaku.
- Jika lingkup pencarian berubah, preview lama harus dianggap tidak berlaku.
- Tombol penerapan harus disabled sampai preview dibuat ulang.
- Response request lama tidak boleh menimpa hasil terbaru.
- Tampilkan pesan, misalnya:

```text
Konfigurasi berubah. Buat pratinjau ulang sebelum menerapkan.
```

### 4. Konfirmasi yang lebih informatif

Konfirmasi harus menampilkan ringkasan aktual, misalnya:

```text
Anda akan mengubah harga 12 item.

Umum: rasio 1,32
Nakes: rasio 1,21
Apotek lain: tidak diubah
Pembulatan: tanpa pembulatan

Lanjutkan?
```

### 5. Hasil penerapan

Setelah proses selesai, tampilkan:

- jumlah item yang berhasil diubah;
- jumlah item yang dilewati;
- jumlah item yang gagal;
- alasan item dilewati atau gagal jika API sudah menyediakannya;
- tombol untuk menutup hasil atau kembali ke daftar.

## Acceptance criteria PR #91

- [x] Pengguna dapat mencari obat dengan mengetik nama atau kode.
- [x] Request pencarian memakai debounce 350 ms.
- [x] Response request lama tidak dapat menimpa hasil baru.
- [x] Pengguna dapat memilih satu atau banyak item.
- [x] Pengguna dapat memilih semua hasil pencarian.
- [x] Jumlah item terpilih selalu akurat.
- [x] Perubahan konfigurasi menonaktifkan penerapan sampai preview dibuat ulang.
- [x] Dialog konfirmasi menampilkan jumlah item dan konfigurasi markup.
- [x] Hasil penerapan tetap menampilkan ringkasan berhasil/dilewati dari RPC.
- [x] Tidak ada perubahan pada rumus bisnis markup.
- [x] Regression test frontend ditambahkan.

### Implementasi PR #91

Perubahan yang sudah dikerjakan:

- input nama/kode obat melakukan pencarian otomatis setelah pengguna berhenti mengetik selama 350 ms;
- input kurang dari dua karakter tidak mengirim request pencarian;
- pencarian otomatis mengubah lingkup menjadi hasil pencarian;
- response request lama diabaikan melalui request counter yang sudah ada;
- tombol penerapan diberi guard `mkApply` dan disabled ketika preview stale atau belum ada item yang dipilih;
- konfirmasi menampilkan jumlah item, mode, nilai Umum/Nakes/Apotek lain, dan pembulatan;
- test `master-markup.test.cjs` diperluas.

Validasi lokal PR #91:

```text
node --test tests/*.test.cjs      → 114 lulus
node tools/test-pembelian.cjs     → lulus
node --check public/js_master.js  → lulus
node --check public/js_trx.js     → lulus
git diff --check                  → lulus
```

Deployment PR #91 setelah merge hanya memerlukan deploy frontend Cloudflare Pages. Edge Function dan `db push` tidak diperlukan.

## Deployment PR #91

Jika hanya mengubah frontend:

- deploy Cloudflare Pages diperlukan;
- deploy Edge Function tidak diperlukan;
- `db push` tidak diperlukan.

Jika handler memerlukan perubahan endpoint API, deploy Edge Function `api` juga diperlukan.

---

# PR #92 — Pengujian Backend dan Kontrak API Pricing

## Tujuan

Memastikan endpoint pricing dan `stok.list` stabil, dapat dipercaya, serta tidak mengalami regresi ketika dipakai oleh Master Barang, Stok & Batch, form batch, dan modul lain.

## Scope

### 1. Kontrak response `stok.list`

Dokumentasikan dan uji field berikut:

- `Kode_Obat`;
- `Nama_Obat`;
- `Kode_Batch`;
- `Stok_Real`;
- `Harga_Modal_Batch`;
- `Harga_Jual_Umum`;
- `Harga_Jual_Nakes`;
- `Harga_Jual_Mutasi`;
- `Margin_Umum`;
- `Margin_Nakes`;
- `Margin_Mutasi`;
- `Belum_Ada_Batch`.

### 2. Pengujian rumus margin

Rumus yang harus dipertahankan:

```text
margin = (harga jual SKU - modal efektif batch)
         / harga jual SKU × 100
```

Kasus yang wajib diuji:

- harga jual lebih besar dari modal;
- harga jual sama dengan modal, hasil 0%;
- harga jual lebih kecil dari modal, hasil negatif;
- modal batch `NULL`, hasil `NULL`;
- harga jual `NULL`, hasil `NULL`;
- harga jual 0 atau negatif, hasil `NULL`;
- nilai desimal;
- beberapa batch dari SKU yang sama dengan modal berbeda.

### 3. Pengujian sumber data

Pastikan:

- modal berasal dari `stok_batch.harga_modal_batch`;
- harga jual berasal dari `master_barang`;
- harga jual tidak diambil dari batch;
- margin dihitung per batch, bukan sekali per SKU;
- barang tanpa batch tetap dapat ditampilkan sebagai stok 0 bila mode UI memerlukannya.

### 4. Pengujian filter dan pagination

Uji kombinasi:

- pencarian nama obat;
- pencarian kode obat;
- pencarian kode batch;
- status tersedia/habis/semua;
- stok kritis;
- sorting stok naik/turun;
- sorting kedaluwarsa;
- pagination halaman pertama dan halaman berikutnya;
- SKU tanpa batch;
- SKU dengan banyak batch.

### 5. Pengujian otorisasi dan isolasi cabang

Pastikan endpoint:

- hanya mengembalikan data cabang dari sesi aktif;
- tidak mempercayai `cabang_id` dari client jika endpoint mengambilnya dari session;
- tidak membocorkan data SKU atau batch cabang lain;
- tetap menerapkan otorisasi untuk aksi penerapan markup.

## Acceptance criteria PR #92

- [ ] Kontrak response `stok.list` terdokumentasi dalam test.
- [ ] Semua kasus rumus margin utama memiliki test.
- [ ] Nilai tidak diketahui tetap `NULL`/`—`, bukan 0 palsu.
- [ ] Harga jual terbukti berasal dari `master_barang`.
- [ ] Modal terbukti berasal dari batch yang sedang ditampilkan.
- [ ] Filter dan pagination memiliki coverage.
- [ ] Isolasi cabang memiliki coverage.
- [ ] Test lama seluruh repository tetap lulus.

## Deployment PR #92

Jika PR hanya menambah test atau dokumentasi:

- tidak ada deployment production;
- tidak perlu deploy Edge Function;
- tidak perlu `db push`.

Jika ditemukan dan diperbaiki bug pada `supabase/functions/api/index.ts`:

- deploy Edge Function `api` diperlukan setelah merge;
- `db push` hanya diperlukan jika ada migration SQL baru.

---

# PR #93 — Penyempurnaan Tampilan Stok & Batch

## Tujuan

Membuat informasi harga jual dan margin tetap terbaca pada desktop, tablet, dan layar sempit tanpa membuat tabel terlalu padat.

## Scope

### 1. Tampilan ringkas dan detail

Pertimbangkan salah satu pendekatan:

- tampilan ringkas pada tabel utama;
- detail harga/margin melalui expandable row;
- modal detail batch;
- kombinasi label dan tooltip.

Contoh tampilan ringkas:

```text
Jual Umum  Rp2.081   Margin 20,0%
Jual Nakes Rp1.832   Margin  9,1%
Mutasi     Rp1.665   Margin  0,0%
```

### 2. Penanda margin

- margin positif: tampilan normal atau indikator positif;
- margin 0%: jangan dianggap error;
- margin negatif: tampilkan warning yang jelas;
- margin `—`: tampilkan sebagai data belum tersedia, bukan margin nol.

### 3. Filter dan sorting

Pertimbangkan filter berikut:

- margin di bawah batas tertentu;
- margin negatif;
- harga jual belum diisi;
- modal batch belum tersedia;
- hanya batch yang memiliki stok.

Pertimbangkan sorting berdasarkan:

- margin Umum;
- margin Nakes;
- margin Mutasi;
- modal batch;
- harga jual.

### 4. Responsivitas

Uji minimal pada:

- desktop lebar;
- laptop;
- tablet landscape;
- tablet portrait jika digunakan;
- zoom browser 125% dan 150%.

### 5. Penjelasan istilah

Tambahkan tooltip atau teks bantuan untuk menjelaskan:

- modal efektif batch;
- harga jual SKU;
- margin terhadap harga jual;
- alasan margin dapat berbeda antar-batch.

## Acceptance criteria PR #93

- [x] Tabel tetap terbaca pada desktop dan berubah menjadi kartu berlabel pada layar kecil.
- [x] Harga jual, margin, dan modal memakai kolom serta label yang berbeda.
- [x] Margin negatif terlihat jelas dengan indikator merah.
- [x] Margin 0% ditampilkan sebagai nilai valid dengan indikator positif, bukan warning.
- [x] Nilai `—` dibedakan dari 0% sebagai data belum tersedia.
- [x] Tidak ada kolom yang hilang pada mode desktop.
- [x] Tombol Ubah/Tambah batch tetap dapat digunakan melalui keyboard; tidak ada accordion khusus yang menambah interaksi baru.
- [x] Label dan tooltip menggunakan istilah bisnis yang konsisten.
- [x] Regression test UI ditambahkan; screenshot visual belum tersedia di sandbox.

### Implementasi PR #93

- tabel Stok & Batch diberi kontrak kartu mobile menggunakan `data-tk="1"` dan `data-label`;
- harga jual SKU ditampilkan sebagai tiga baris ringkas: Umum, Nakes, dan Mutasi;
- margin ditampilkan sebagai chip per tingkat harga dengan state positif, negatif, dan belum tersedia;
- legenda margin ditambahkan agar arti warna tidak bergantung pada tebakan pengguna;
- header Modal efektif batch, Harga jual SKU, dan Margin batch diberi tooltip istilah bisnis;
- aksi `Tambah batch` dan `Ubah` dipertahankan.

Validasi lokal PR #93:

```text
node --test tests/*.test.cjs      → 118 lulus
node tools/test-pembelian.cjs     → lulus
node --check public/js_master.js  → lulus
node --check public/js_trx.js     → lulus
git diff --check                  → lulus
```

PR #93 mengubah frontend dan test saja. Setelah merge cukup tunggu deploy Cloudflare Pages; Edge Function dan `db push` tidak diperlukan.

## Deployment PR #93

Jika hanya mengubah frontend:

- deploy Cloudflare Pages diperlukan;
- Edge Function tidak perlu di-deploy ulang;
- `db push` tidak diperlukan.

---

# PR #94 — Harga Jual Per Batch (Opsional)

## Prasyarat keputusan bisnis

PR ini hanya dikerjakan jika bisnis mengonfirmasi bahwa satu SKU dapat memiliki harga jual berbeda antar-batch.

Contoh kebutuhan yang membenarkan PR ini:

- batch lama dan batch baru dijual dengan harga berbeda;
- batch mendekati kedaluwarsa diberi harga khusus;
- promosi hanya berlaku pada batch tertentu;
- harga jual mengikuti biaya perolehan batch tertentu.

Jika harga jual selalu sama untuk satu SKU, PR #94 tidak diperlukan. Model PR #90 sudah cukup:

```text
Modal berbeda per batch
Harga jual sama per SKU
Margin berbeda per batch
```

## Scope potensial

### 1. Database

- desain kolom atau tabel harga jual per batch;
- migration SQL;
- histori perubahan harga;
- audit actor dan waktu perubahan;
- constraint agar harga valid;
- kebijakan RLS dan grant;
- aturan fallback ke harga SKU jika harga batch tidak tersedia.

### 2. Prioritas harga

Definisikan aturan yang eksplisit, misalnya:

```text
Harga jual batch aktif
    ↓ jika NULL
Harga jual SKU/master
    ↓ jika NULL
Harga default cabang
```

Aturan ini harus sama pada:

- POS/kasir;
- pembelian jika menampilkan harga jual;
- Master Barang;
- Stok & Batch;
- laporan laba rugi;
- retur;
- transaksi mutasi.

### 3. Backend

- update endpoint stok;
- update endpoint POS;
- update endpoint markup;
- update endpoint penyimpanan harga batch;
- validasi hak akses;
- locking jika perubahan harga harus atomik.

### 4. Frontend

- form ubah harga jual batch;
- preview harga batch;
- indikator apakah harga berasal dari batch atau SKU;
- bulk update harga batch jika dibutuhkan;
- riwayat perubahan harga.

### 5. Laporan dan histori transaksi

Pastikan transaksi lama tidak berubah ketika harga batch diubah. Harga yang digunakan pada penjualan harus disimpan sebagai snapshot pada detail transaksi.

## Acceptance criteria PR #94

- [ ] Keputusan model harga disetujui sebelum migration dibuat.
- [ ] Aturan prioritas harga terdokumentasi.
- [ ] Harga transaksi disimpan sebagai snapshot historis.
- [ ] POS dan laporan memakai sumber harga yang konsisten.
- [ ] Perubahan harga tercatat dalam audit log.
- [ ] RLS, grant, dan otorisasi diuji.
- [ ] Migration dapat dijalankan dengan aman pada database production.
- [ ] Rollback atau strategi pemulihan terdokumentasi.
- [ ] Test lintas modul lulus.

## Deployment PR #94

PR ini kemungkinan membutuhkan seluruh rangkaian deployment:

- `db push` atau penerapan migration SQL;
- deploy Edge Function yang berubah;
- deploy Cloudflare Pages;
- smoke test POS;
- smoke test Stok & Batch;
- verifikasi laporan laba rugi.

Migration harus diterapkan sebelum function yang mengandalkan schema baru digunakan di production, kecuali implementasi sengaja dibuat backward-compatible.

---

# Checklist umum setiap PR

## Sebelum membuat branch

```powershell
git fetch origin main
git switch main
git pull --ff-only origin main
git switch -c <nama-branch>
```

Jangan melanjutkan branch PR lama yang sudah di-merge.

## Sebelum push

```powershell
node --test tests/*.test.cjs
node tools/test-pembelian.cjs
node --check public/js_master.js
node --check public/js_trx.js
git diff --check
git status
```

Jika Edge Function berubah dan Deno tersedia:

```powershell
den o check supabase/functions/api/index.ts
```

Perhatikan bahwa perintah yang benar adalah `deno` tanpa spasi jika mengetik langsung di terminal:

```powershell
deno check supabase/functions/api/index.ts
```

## Sebelum merge

- [ ] PR memiliki scope yang jelas.
- [ ] Tidak ada migration yang tertinggal dari PR lain.
- [ ] Test baru mencakup bug atau acceptance criteria.
- [ ] Deployment requirement ditulis di PR.
- [ ] Tidak ada secret di source code atau log.
- [ ] Konflik branch telah diselesaikan dari `origin/main` terbaru.

## Setelah merge

- [ ] Pastikan commit merge sudah ada di `origin/main`.
- [ ] Jika frontend berubah, tunggu deploy Cloudflare Pages.
- [ ] Jika `supabase/functions/**` berubah, deploy atau verifikasi workflow Edge Function.
- [ ] Jika migration SQL berubah, review dan jalankan migration secara terkontrol.
- [ ] Lakukan smoke test production.
- [ ] Catat waktu, commit, hasil deploy, dan hasil smoke test.

---

# Matriks kebutuhan deployment

| PR | Frontend Pages | Edge Function | `db push` | Catatan |
|---|---:|---:|---:|---|
| #91 | Ya, jika frontend berubah | Hanya jika API berubah | Tidak | Fokus UX markup |
| #92 | Tidak, kecuali ada perubahan UI | Hanya jika bug backend diperbaiki | Hanya jika ada migration | Fokus kontrak dan test API |
| #93 | Ya | Tidak, kecuali API berubah | Tidak | Fokus layout dan responsivitas |
| #94 | Ya | Kemungkinan ya | Kemungkinan ya | Fitur harga jual per batch |

---

# Catatan penting

1. Jangan menjalankan `db push` hanya karena Edge Function di-deploy. Keduanya adalah proses berbeda.
2. Jangan menerapkan harga jual per batch sebelum aturan bisnis dan prioritas harga disetujui.
3. Margin harus tetap membedakan nilai `0%`, nilai negatif, dan nilai tidak tersedia (`—`).
4. Perubahan API harus backward-compatible terhadap seluruh pemanggil `stok.list`.
5. Setiap perubahan harga yang memengaruhi transaksi harus mempertahankan histori harga pada detail transaksi.
