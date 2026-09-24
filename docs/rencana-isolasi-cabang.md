# Rencana Isolasi Cabang SI-FaMitra

Status: **rencana saja — belum ada kode, migrasi, atau database yang diubah.**
Branch: `plan/isolasi-cabang`
Tanggal: 25 September 2026

Dokumen ini menjelaskan cara membuat setiap cabang (KARLA, KENDAL, PUCUK, PULE)
sepenuhnya mandiri: master barang dan supplier sendiri, stok dan transaksi
sendiri, user sendiri, dan Owner yang hanya mengelola cabangnya sendiri.

> Catatan alur kerja: prefix branch `plan/` tidak ada di daftar AGENTS.md
> (`feat/`, `fix/`, `refactor/`, `chore/`). Dipakai karena diminta eksplisit.
> Tidak ada `db push`, tidak ada deploy Edge Function, tidak ada merge ke `main`.

---

## 0. Ringkasan

Kondisi sekarang: **sebagian sudah per cabang, sebagian masih global, dan
sebagian lagi bocor karena bug.**

| Lapisan | Keadaan sekarang |
|---|---|
| Tabel transaksi & stok (`trx_*`, `stok_batch`, `master_customer`, `biaya_operasional`, `promo_*`) | Sudah punya `cabang_id` |
| `master_barang` (barang + harga jual) | **Global** — 1 baris dipakai semua cabang |
| `master_supplier` | **Global** — tidak punya `cabang_id` sama sekali |
| Nomor nota penjualan | Sudah berprefix cabang (`INV-<CABANG>-...`), tapi fungsi lama masih bisa membuat nomor global |
| Nomor faktur pembelian | **Belum** per cabang (PK `trx_pembelian.no_faktur` global) |
| Kode batch stok | **Belum** per cabang (`UNIQUE (kode_obat, kode_batch)` global) |
| Otorisasi cabang | 100% di kode Edge Function — RLS tidak efektif (lihat 4.5) |
| Manajemen user | Owner lintas cabang, dan `cabang_id` user baru diambil dari **form**, bukan sesi |

Kesimpulan singkat: isolasi cabang sekarang bergantung pada **kode Edge Function
saja**, bukan pada database. Itu sebabnya satu bug salah tulis string filter
(temuan 8) bisa merusak data cabang lain.

---

## 1. Fakta yang diverifikasi

### 1.1 Sumber data dan keterbatasannya

Semua fakta struktur di dokumen ini diambil dari lima CSV snapshot di
`schema/` (bukan `supabase/schema/` — lihat catatan di bagian 12):

| File | Isi | Keterbatasan |
|---|---|---|
| `schema/kolom.csv` | 100 baris kolom | **Terpotong** — urut alfabetis, berhenti di `master_customer.tier`. Tabel `master_supplier`, `stok_batch`, `promo_*`, `refill_*`, `trx_*`, `notification_log` tidak ada isinya |
| `schema/constraint.csv` | 100 baris constraint | **Terpotong** — berhenti di `trx_retur_beli`. Hanya PK/UNIQUE/CHECK/FK, **tidak memuat unique index** |
| `schema/fungsi.csv` | 18 definisi fungsi | Lengkap untuk fungsi yang ada, termasuk 2 pasang overload lama/baru |
| `schema/policy.csv` | 33 policy RLS | Hanya tabel lama berbahasa Inggris |
| `schema/trigger.csv` | 4 trigger | Lengkap |

Bukti bahwa snapshot tidak memuat unique index: `master_cabang` **tidak muncul
sama sekali** di `constraint.csv`, padahal 13 FK di file yang sama mengacu ke
`master_cabang(kode_cabang)`. Artinya `kode_cabang` dijamin unik lewat *unique
index* yang tidak tertangkap query snapshot. Konsekuensinya: setiap daftar kunci
di dokumen ini harus **diverifikasi ulang dari baseline lengkap** sebelum migrasi
dibuat.

Fakta lain yang perlu diingat: **tidak ada akses database dari sesi ini** (REST
anon ditolak 401, tidak ada key di repo). Semua angka "sekarang" di bawah berasal
dari kode repo dan snapshot, bukan dari query langsung.

### 1.2 Yang sudah per cabang (aman)

- Tabel dengan FK ke `master_cabang(kode_cabang)`: `app_users`, `app_sessions`,
  `stok_batch`, `master_customer`, `trx_pembelian`, `trx_pembelian_detail`,
  `trx_penjualan`, `trx_penjualan_detail`, `biaya_operasional`, `stok_opname`,
  `trx_retur_jual`, `trx_retur_jual_detail`, `trx_retur_beli`.
- `promo_campaigns`, `promo_coupons`, `promo_redemptions` — per cabang, dengan
  `UNIQUE (cabang_id, code)`. **Ini pola yang benar dan dipakai sebagai acuan.**
- `promo_bundles` — punya `cabang_id` (tapi `text NOT NULL` tanpa FK).
- Login mengambil cabang dari baris `app_users`, bukan dari form login
  (`supabase/functions/api/index.ts:100`), lalu menyimpannya ke `app_sessions`
  (`api:101`).

### 1.3 Yang masih global

**`master_barang`** — 14 kolom, tanpa `cabang_id`:

```
kode_obat (PK), nama_obat, kategori, golongan, satuan, barcode, harga_modal,
harga_jual_umum, harga_khusus, harga_jual_mutasi, ppn, stok_min, aktif, updated_at
```

Dipakai lintas cabang oleh: `api:137` (cari barang), `api:213/264` (`barang.list`,
`beli.supplier`), `pos_checkout` (2 tempat), `purchase_save`, `pos_checkout_promo`,
`pos_checkout_bundle`, `promo_bundle_items`.

**`master_supplier`** — PK `kode_supplier`, `UNIQUE (nama_supplier)`, tanpa
`cabang_id` dan tanpa FK cabang (`api:264` baca, `api:270` tulis).

Konsekuensi nyata hari ini: **harga jual dan harga modal satu cabang mengubah
harga semua cabang.** `purchase_save` menutup dengan

```sql
update master_barang set harga_modal = ..., harga_jual_umum = ...
where kode_obat = v_product.kode_obat;   -- tanpa cabang_id
```

jadi pembelian di KENDAL langsung mengubah harga jual di KARLA, PUCUK, dan PULE.

### 1.4 Penomoran, kunci, dan stok

- **Nota penjualan**: `pos_checkout` versi baru sudah memakai
  `INV-<cabang>-<YYYYMMDD>-####`. Versi lama (7 parameter, masih ada di database)
  memakai `INV<YYYYMMDD>-####` dengan `count(*)` lintas cabang → **nomor tabrakan
  antar cabang**.
- **Faktur pembelian**: `trx_pembelian_pkey PRIMARY KEY (no_faktur)` global.
  `purchase_save` memeriksa duplikat per cabang (`no_faktur AND cabang_id`), tapi
  PK-nya global → dua cabang **tidak boleh** memakai nomor faktur yang sama.
- **Kode batch**: `stok_batch_kode_obat_kode_batch_key UNIQUE (kode_obat, kode_batch)`
  — **tanpa `cabang_id`**. Dua cabang tidak boleh punya kombinasi obat+batch yang
  sama, padahal barang dari supplier yang sama wajar punya nomor batch yang sama.
  Ini penghalang teknis paling keras untuk isolasi stok.
- **Pelanggan**: `master_customer` PK `id` (uuid) + `cabang_id`. Trigger
  `loyalty_after_sale` memakai `ON CONFLICT (cabang_id, nomor_wa)`, jadi harus ada
  unique index `(cabang_id, nomor_wa)` — **tidak terlihat di snapshot**, wajib
  diverifikasi. Kalau index itu tidak ada, trigger tersebut gagal saat dijalankan.
- **Detail transaksi tidak punya FK ke barang**: `trx_penjualan_detail` hanya punya
  3 constraint (`cabang_fk`, `no_nota_fkey`, `pkey`) — tidak ada FK ke
  `master_barang`. Sama untuk `trx_pembelian_detail`. Jadi `kode_obat` di detail
  transaksi tidak dijaga database; hanya dijaga kode Edge Function.

### 1.5 Hasil pemeriksaan secret (diminta sebelum commit)

Diperiksa: kelima CSV, ketiga Edge Function (`api`, `promo`, `hutang`),
`supabase/backup/api-loader-manus.ts`, seluruh `public/*.js`, `*.html`,
migrations, `config.toml`, dan file `.md`.

**Hasil: bersih. Tidak ada password, API key, atau secret di dalam definisi fungsi.**
Tidak ada literal kredensial sama sekali (pola `eyJ...`, `sk-`, `sbp_`, `ghp_`,
`postgresql://user:pass@`, `AIza...` → 0 kecocokan).

Ketiga Edge Function mengambil kredensial dari environment:

```ts
var SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_KEY");
```

`fungsi.csv` tidak memuat kata `password`, `token`, `apikey`, `secret`, atau URL.
Satu-satunya penyebutan kredensial di definisi fungsi adalah
`public.current_app_role()` yang membaca `profiles.role` lewat `auth.uid()` — itu
referensi kolom, bukan nilai.

Karena aman, kelima CSV **boleh** di-commit sebagai backup struktur sementara
(sudah dilakukan di commit `chore: backup struktur skema sementara ...`).

Satu catatan keamanan yang bukan secret, tapi perlu ditindak: `app_users.password_hash`
adalah **SHA-256 tanpa salt** (`api:96` → `sha256(password)`), dan `sha256()`
didefinisikan di Edge Function. Ini lemah untuk penyimpanan password jangka
panjang. Perbaikannya (bcrypt/argon2) adalah perubahan kode tersendiri, di luar
lingkup PR ini.

---

## 2. Target akhir

1. Setiap cabang punya **barang, harga, supplier, stok, transaksi, pelanggan, dan
   user sendiri**.
2. **Tidak ada satu pun query** di Edge Function yang membaca/menulis tabel
   bercabang tanpa filter `cabang_id` dari sesi.
3. **Tidak ada fallback `|| 'KARLA'`** di jalur tulis. Kalau cabang tidak bisa
   ditentukan, transaksi harus **gagal**, bukan diam-diam masuk KARLA.
4. Owner cabang X hanya melihat dan mengubah data cabang X, termasuk user.
5. Isolasi dijaga **dua lapis**: kode Edge Function **dan** constraint database
   (PK/FK/unique komposit). Bug di kode tidak boleh cukup untuk merusak cabang lain.
6. Tidak ada fungsi lama (overload) yang masih bisa dipanggil untuk menembus isolasi.

---

## 3. `master_barang` dan `master_supplier` per cabang

### 3.1 `master_barang`

Perubahan struktur:

1. Tambah `cabang_id text`, backfill `'KARLA'` untuk 137 baris yang ada
   (asumsi: data sekarang milik KARLA — **perlu konfirmasi pemilik project**),
   lalu `SET NOT NULL` dan tambah FK ke `master_cabang(kode_cabang)`.
2. Ganti PK `kode_obat` → **`PRIMARY KEY (cabang_id, kode_obat)`**.
3. Salin 137 baris KARLA ke KENDAL, PUCUK, PULE (bagian 3.3).
4. Tambah index `(cabang_id, aktif, nama_obat)` untuk pencarian `api:137`, dan
   `(cabang_id, barcode)`.

Yang **tidak** berubah: `kode_obat` tetap sama di semua cabang. Ini penting supaya
laporan, resep, dan riwayat transaksi tetap bisa dibandingkan antar cabang, dan
supaya migrasi salinan tidak perlu memetakan ulang kode.

Yang perlu keputusan pemilik project: apakah harga jual boleh **berbeda** antar
cabang? Kalau ya, skema ini mendukungnya (harga ikut tersalin per cabang lalu
diubah lokal). Kalau tidak, tambahkan trigger/validasi agar harga tidak
menyimpang tanpa sengaja.

### 3.2 `master_supplier`

Perubahan struktur:

1. Tambah `cabang_id text NOT NULL` + FK ke `master_cabang(kode_cabang)`.
2. PK `kode_supplier` → **`PRIMARY KEY (cabang_id, kode_supplier)`**.
3. `UNIQUE (nama_supplier)` → **`UNIQUE (cabang_id, nama_supplier)`**. Tanpa ini,
   cabang lain tidak bisa mendaftarkan supplier dengan nama yang sama.
4. Salin daftar supplier KARLA ke tiga cabang lain (jumlah baris perlu dihitung
   dari database; tidak ada di snapshot).
5. `trx_pembelian.supplier` dan `trx_retur_beli.supplier_code` (kalau ada) harus
   jadi FK komposit `(cabang_id, kode_supplier)`.

Yang perlu keputusan: apakah supplier memang harus dipisah per cabang? Hari ini
`api:264` membaca seluruh `master_supplier` tanpa filter, dan `api:270` menulis
tanpa `cabang_id`. Kalau supplier bersama (satu perusahaan melayani 4 cabang),
alternatifnya adalah membiarkannya global sebagai master bersama dan hanya
menambahkan **daftar supplier per cabang** sebagai tabel penghubung. Rencana ini
mengikuti permintaan: **supplier per cabang**.

### 3.3 Penyalinan 137 barang ke KARLA, KENDAL, PUCUK, PULE

Angka 137 berasal dari pemilik project dan **belum diverifikasi** (tidak ada akses
DB). Verifikasi jumlah dulu sebelum menjalankan migrasi:

```sql
select cabang_id, count(*) from public.master_barang group by 1 order by 1;
select count(*) from public.master_cabang where aktif = 'YA';
```

Migrasi (sketsa — belum dibuat sebagai file, sesuai permintaan "tanpa mengubah kode"):

```sql
-- 1. kolom cabang
alter table public.master_barang add column if not exists cabang_id text;
update public.master_barang set cabang_id = 'KARLA' where cabang_id is null;
alter table public.master_barang alter column cabang_id set not null;
alter table public.master_barang
  add constraint master_barang_cabang_fk
  foreign key (cabang_id) references public.master_cabang(kode_cabang);

-- 2. PK komposit (ganti PK lama; ini bukan DROP TABLE)
alter table public.master_barang drop constraint master_barang_pkey;
alter table public.master_barang
  add constraint master_barang_pkey primary key (cabang_id, kode_obat);

-- 3. salin 137 baris KARLA ke tiga cabang lain
insert into public.master_barang
  (cabang_id, kode_obat, nama_obat, kategori, golongan, satuan, barcode,
   harga_modal, harga_jual_umum, harga_khusus, harga_jual_mutasi, ppn,
   stok_min, aktif, updated_at)
select c.kode_cabang, b.kode_obat, b.nama_obat, b.kategori, b.golongan,
       b.satuan, b.barcode, b.harga_modal, b.harga_jual_umum, b.harga_khusus,
       b.harga_jual_mutasi, b.ppn, b.stok_min, b.aktif, now()
from public.master_barang b
cross join (values ('KENDAL'), ('PUCUK'), ('PULE')) as c(kode_cabang)
where b.cabang_id = 'KARLA'
on conflict (cabang_id, kode_obat) do nothing;

-- 4. index pencarian
create index if not exists master_barang_cabang_aktif_idx
  on public.master_barang (cabang_id, aktif, nama_obat);
```

Hasil yang diharapkan: `137 × 4 = 548` baris, dengan `kode_obat` identik di
keempat cabang dan `cabang_id` terisi semua.

Catatan penting: **stok tidak ikut disalin.** Yang disalin hanya kartu barang
(nama, satuan, harga). Stok tetap milik `stok_batch` per cabang. Cabang baru mulai
dengan stok kosong sampai ada penerimaan barang.

---

## 4. Kunci, relasi, trigger, dan policy yang harus berubah

### 4.1 Kunci primer dan unik

| Tabel | Sekarang | Harus jadi | Alasan |
|---|---|---|---|
| `master_barang` | PK `(kode_obat)` | PK `(cabang_id, kode_obat)` | 1 kode obat per cabang |
| `master_supplier` | PK `(kode_supplier)`, UNIQUE `(nama_supplier)` | PK `(cabang_id, kode_supplier)`, UNIQUE `(cabang_id, nama_supplier)` | supplier per cabang |
| `stok_batch` | UNIQUE `(kode_obat, kode_batch)` | UNIQUE `(cabang_id, kode_obat, kode_batch)` | **penghalang utama** — batch sama harus boleh ada di 2 cabang |
| `trx_penjualan` | PK `(no_nota)` | PK `(no_nota)` **atau** `(cabang_id, no_nota)` | perlu keputusan (4.2) |
| `trx_pembelian` | PK `(no_faktur)` | PK `(no_faktur)` **atau** `(cabang_id, no_faktur)` | perlu keputusan (4.2) |
| `app_users` | PK `(username)` | PK `(username)` **atau** `(cabang_id, username)` | perlu keputusan (bagian 6) |
| `master_customer` | PK `(id)`, unique `(cabang_id, nomor_wa)` **belum terlihat** | pastikan unique `(cabang_id, nomor_wa)` ada | dipakai `ON CONFLICT` di `loyalty_after_sale` |
| `master_cabang` | tidak ada di snapshot | pastikan `kode_cabang` unik | 13 FK mengacu ke sini |

### 4.2 Relasi (foreign key) yang harus berubah

**FK yang mengacu ke `master_barang(kode_obat)`** — semua harus jadi
`(cabang_id, kode_obat)`. Yang terlihat di snapshot:

- `stok_batch.stok_batch_kode_obat_fkey` → **harus komposit**. `stok_batch` sudah
  punya `cabang_id NOT NULL`, jadi FK komposit bisa langsung dibuat.
- `promo_bundle_items.kode_obat → master_barang(kode_obat)` (migration
  `20260923010000` baris 11). **Tabel ini tidak punya `cabang_id`** (dia anak dari
  `promo_bundles`), jadi FK komposit tidak bisa dibuat tanpa menambahkan
  `cabang_id` ke `promo_bundle_items` atau memindahkan validasinya ke trigger.
  Ini pekerjaan yang mudah terlewat.
- Di bawah titik potong snapshot (`refill_programs`, `stok_opname`,
  `trx_retur_jual_detail`, `trx_retur_beli_detail`, `notification_log`) — **wajib
  dicek dari baseline lengkap**; jangan menganggap tidak ada.
- `trx_penjualan_detail` dan `trx_pembelian_detail` **tidak** punya FK ke
  `master_barang` (terverifikasi lengkap di snapshot), jadi tidak ada yang perlu
  diubah, tapi juga berarti integritas kode obat hanya dijaga aplikasi.

**FK lain yang ikut berubah karena PK di atas:**

- `trx_pembelian.supplier → master_supplier(kode_supplier)` → komposit
  `(cabang_id, kode_supplier)`.
- `promo_redemptions.invoice_no → trx_penjualan(no_nota)`,
  `trx_penjualan_detail.no_nota`, `trx_retur_jual.no_nota_asal`,
  `trx_pembayaran_hutang.no_faktur`, `trx_retur_beli.no_faktur_asal` — hanya
  berubah kalau PK `trx_penjualan` / `trx_pembelian` dijadikan komposit.

**Rekomendasi nomor dokumen**: **pertahankan PK global** untuk `no_nota` dan
`no_faktur` (nomor unik sepanjang masa, semua cabang), karena:

- `pos_checkout` versi baru sudah memberi prefix cabang → unik secara konstruksi;
- nomor nota yang unik global lebih mudah dicari saat pelanggan komplain;
- mengubah PK berarti mengubah 5+ FK dan menambah risiko migrasi tanpa manfaat
  isolasi yang nyata.

Yang tetap perlu diperbaiki: `purchase_save` memeriksa duplikat per cabang
(`no_faktur AND cabang_id`) padahal PK-nya global. Perbaikannya: pemeriksaan
duplikat tetap per cabang (ramah pengguna), tapi pesan error harus jelas bahwa
nomor faktur bentrok dengan cabang lain. Atau: beri prefix cabang pada nomor
faktur seperti nota penjualan.

### 4.3 Default `cabang_id` yang berbahaya

Empat kolom punya default yang menyembunyikan kesalahan:

```
app_users.cabang_id            DEFAULT 'KARLA'
app_sessions.cabang_id         DEFAULT 'KARLA'
biaya_operasional.cabang_id    DEFAULT 'KARLA'
master_customer.cabang_id      DEFAULT 'KARLA'
```

Rencana: **hapus default-nya** (`alter column ... drop default`). Dengan default
terpasang, satu `insert` yang lupa mengirim `cabang_id` akan diam-diam mendarat di
KARLA — persis jenis kesalahan yang sulit ditemukan. Setelah default dihapus,
kesalahan itu langsung jadi error.

### 4.4 Trigger

| Trigger | Tabel | Perlu berubah? |
|---|---|---|
| `trg_loyalty_set_tier` → `loyalty_set_tier()` | `master_customer` BEFORE INSERT/UPDATE | Tidak. Hanya menghitung `tier` dari `total_spend_mtd` |
| `trg_loyalty_after_sale` → `loyalty_after_sale()` | `trx_penjualan` AFTER INSERT | **Ya** — butuh unique `(cabang_id, nomor_wa)` di `master_customer`; `NEW.cabang_id` harus NOT NULL |
| `trg_loyalty_after_return` → `loyalty_after_return()` | `trx_retur_jual` AFTER INSERT | **Ya** — `NEW.cabang_id` harus NOT NULL (hari ini `trx_retur_jual` ditulis tanpa `cabang_id`, lihat temuan 4) |
| `rls_auto_enable` (event trigger) | semua tabel baru di `public` | Tidak. Tetap dipertahankan; dia hanya `enable row level security` |

Trigger tambahan yang perlu **dibuat** (opsional, untuk lapis kedua):

- `BEFORE INSERT OR UPDATE` pada `trx_penjualan`, `trx_pembelian`, `stok_batch`,
  `biaya_operasional`: pastikan `cabang_id` tidak null dan ada di `master_cabang`.
- Trigger validasi silang: `trx_penjualan_detail.cabang_id` harus sama dengan
  `trx_penjualan.cabang_id` (hari ini hanya dijaga kode).

Fungsi lain yang **melanggar isolasi** dan perlu diperbaiki bersamaan:

- `reset_monthly_spend()` — `UPDATE master_customer SET total_spend_mtd = 0;`
  **tanpa filter cabang**. Kalau dijalankan per cabang, harus menerima parameter
  `p_cabang_id`.
- `refresh_customer_segments(p_cabang_id DEFAULT NULL)` — `NULL` berarti semua
  cabang. Sama seperti `generate_refill_reminders`, arti `NULL` harus dipersempit
  ke "job internal", bukan "dipanggil dari aplikasi".
- `redeem_loyalty_reward` — sudah menerima `p_cabang_id` dan memverifikasi
  pelanggan + reward ada di cabang itu. Sudah benar, jadikan acuan.
- `create_sale_with_fefo` — fungsi **warisan** yang bekerja pada skema lama
  (`sales`, `sale_items`, `stock_batches`, `products`) dan memakai
  `has_app_role(...)`. Tidak dipakai aplikasi. Rekomendasi: pensiunkan (butuh izin
  pemilik project), karena dua keluarga tabel paralel membingungkan audit
  isolasi berikutnya.

### 4.5 Policy dan RLS

Ini temuan struktural yang paling penting, dan bukan soal bug:

- `policy.csv` memuat 33 policy, **semuanya di 15 tabel lama berbahasa Inggris**:
  `customers`, `operating_expenses`, `products`, `profiles`, `purchase_items`,
  `purchase_returns`, `purchase_return_items`, `purchases`, `sale_items`, `sales`,
  `sales_return_items`, `sales_returns`, `stock_batches`, `stock_counts`,
  `suppliers`.
- **Tidak ada satu policy pun** untuk tabel yang benar-benar dipakai aplikasi:
  `master_barang`, `master_supplier`, `stok_batch`, `master_customer`,
  `trx_penjualan`, `trx_penjualan_detail`, `trx_pembelian`, `trx_pembelian_detail`,
  `trx_retur_jual`, `trx_retur_beli`, `trx_pembayaran_hutang`, `biaya_operasional`,
  `stok_opname`, `app_users`, `app_sessions`, `refill_programs`, `notification_log`,
  `loyalty_*`, `promo_*`.
- Semua policy yang ada bergantung pada `has_app_role(...)` → `current_app_role()`
  → `select role from profiles where id = auth.uid()`. Tapi aplikasi **tidak
  login lewat Supabase Auth** — dia login lewat `app_users` + `app_sessions`
  dengan token sendiri. Jadi `auth.uid()` selalu `NULL` untuk trafik aplikasi, dan
  `has_app_role()` selalu `false`.
- Trafik aplikasi masuk lewat Edge Function dengan **`service_role`**, yang
  **melewati RLS sepenuhnya**.

Artinya: **seluruh lapisan RLS saat ini tidak berfungsi untuk aplikasi.** Isolasi
cabang hari ini 100% bergantung pada kode Edge Function. Tidak ada policy yang
perlu "diubah" — yang perlu dilakukan adalah **memutuskan model**:

- **Model A (rekomendasi untuk sekarang)**: akui `service_role` sebagai satu-satunya
  jalur data. Pertahankan otorisasi di Edge Function, tambahkan constraint
  database (PK/FK komposit + trigger validasi) sebagai lapis kedua. Untuk setiap
  tabel baru: `GRANT` ke `service_role`, `enable row level security`, dan policy
  eksplisit — sesuai aturan AGENTS.md — meski policy-nya hanya berlaku untuk
  `authenticated`/`anon` yang tidak dipakai aplikasi. RLS tetap "menutup pintu"
  kalau suatu saat ada key anon yang bocor.
- **Model B (jangka menengah)**: migrasi ke Supabase Auth, taruh `cabang_id` di
  JWT claim, dan tulis policy `cabang_id = (auth.jwt() ->> 'cabang_id')`. Ini
  perubahan besar pada alur login (`js_core.js`, `api:94-104`) dan **wajib
  konfirmasi pemilik project** karena menyentuh alur login dan hak akses.

Yang perlu ditambahkan sekarang apa pun modelnya:

1. `GRANT` eksplisit + `enable row level security` + policy untuk tabel yang belum
   punya (termasuk `master_barang`, `master_supplier`, `stok_batch`, `trx_*`,
   `app_users`, `app_sessions`).
2. **`revoke execute ... from anon, authenticated`** untuk semua fungsi
   `SECURITY DEFINER` yang menerima `p_username`/`p_cabang_id` dari pemanggil
   (`pos_checkout`, `pos_checkout_promo`, `pos_checkout_bundle`, `purchase_save`,
   `generate_refill_reminders`, `refresh_customer_segments`, `reset_monthly_spend`,
   `redeem_loyalty_reward`). Sekarang siapa pun yang bisa memanggil RPC bisa
   mengirim `p_username` milik cabang lain — dan `pos_checkout` akan **memakai
   cabang milik username itu**. Otorisasi harus di Edge Function, dan hak
   `EXECUTE` di database harus dicabut dari `anon`/`authenticated`.
3. Perhatikan gap: dua migrasi yang sudah ada
   (`20260923000000_create_segment_coupon_promotions.sql`,
   `20260923010000_create_fixed_nonprescription_bundles.sql`) membuat tabel **tanpa**
   `GRANT`, `enable row level security`, dan policy. Sesuai AGENTS.md, migrasi
   isolasi cabang nanti **harus** menyertakan ketiganya.

### 4.6 Ringkasan file migrasi yang akan dibuat

Belum dibuat di PR ini. Urutan yang direncanakan:

| # | File | Isi |
|---|---|---|
| 1 | `..._master_barang_per_cabang.sql` | kolom + FK cabang, PK komposit, salin 137×3, index |
| 2 | `..._master_supplier_per_cabang.sql` | kolom + FK cabang, PK & unique komposit, FK dari `trx_pembelian` |
| 3 | `..._stok_batch_unik_per_cabang.sql` | unique `(cabang_id, kode_obat, kode_batch)`, FK komposit ke `master_barang`, `promo_bundle_items` |
| 4 | `..._cabang_id_wajib.sql` | hapus default `'KARLA'`; `NOT NULL` untuk `cabang_id` di `trx_retur_jual`/`trx_retur_beli`; unique `(cabang_id, nomor_wa)` di `master_customer` |
| 5 | `..._pos_fungsi_cabang.sql` | kelima fungsi kasir + `drop function` overload lama |
| 6 | `..._rls_dan_hak_akses.sql` | `GRANT` + RLS + policy untuk tabel yang belum punya; `revoke execute` untuk fungsi `SECURITY DEFINER` |

Setiap file wajib memuat blok rollback sebagai komentar di akhir file.

---

## 5. Perubahan kelima fungsi kasir

Kelimanya `SECURITY DEFINER` dengan `SET search_path TO 'public'`, dan **tidak ada
yang memeriksa hak akses pemanggil** (kecuali `create_sale_with_fefo` yang
warisan). Pola `v_cabang_id := coalesce(nullif(p_cabang_id,''), (select cabang_id
from app_users where username=p_username), 'KARLA')` muncul di tiga fungsi dan
punya tiga masalah: (a) `p_username` datang dari pemanggil, jadi pemanggil
menentukan cabang; (b) fallback `'KARLA'` menyembunyikan kesalahan; (c) kalau
`app_users.cabang_id` kosong, transaksi mendarat di KARLA.

Selain itu ada **overload ganda** yang harus dihapus: `pos_checkout` ada 2 versi
(7 parameter dan 9 parameter) dan `purchase_save` ada 2 versi (7 dan 8 parameter).
Keduanya ada di database (`schema/fungsi.csv`). Versi lama **masih bisa dipanggil**
dan merusak isolasi.

### 5.1 `pos_checkout` (versi 9 parameter)

Yang berubah:

1. **Cabang**: hapus fallback `'KARLA'`. Kalau `p_cabang_id` kosong, ambil dari
   `app_users` lewat `p_username`; kalau tetap kosong → `RAISE EXCEPTION`.
   Tambahkan verifikasi silang: kalau `p_cabang_id` diisi **dan** berbeda dari
   `app_users.cabang_id`, tolak.
2. **Barang**: `select * into v_product from master_barang where kode_obat = ...`
   → tambah `and cabang_id = v_cabang_id` (ada di **dua** tempat: hitung subtotal
   dan potong stok). Tanpa ini, keranjang bisa memakai harga barang cabang lain.
3. **Stok**: sudah benar (`stok_batch ... and cabang_id = v_cabang_id`). Tidak berubah.
4. **Nomor nota**: sudah per cabang. Catat dua hal: `count(*)+1` rawan balapan, dan
   `pg_advisory_xact_lock(hashtext('pos_checkout'))` mengunci **semua** cabang
   sekaligus (satu lock global). Rekomendasi: ubah lock jadi
   `hashtext('pos_checkout:'||v_cabang_id)` supaya cabang tidak saling menunggu,
   lalu pastikan penomoran tetap unik (unique index `(cabang_id, tanggal, no_nota)`
   atau sequence per cabang).
5. **Pelanggan**: sudah memakai `(cabang_id, nomor_wa)` — pertahankan, dan
   pastikan unique index-nya ada (bagian 4.1).
6. **Reward**: sudah memverifikasi `loyalty_rewards.cabang_id = v_cabang_id`. Benar.
7. **Otorisasi**: tambahkan pemeriksaan bahwa `p_username` adalah user aktif, dan
   cabut `EXECUTE` dari `anon`/`authenticated`.
8. **Hapus overload 7 parameter.** Versi lama ini memakai `count(*)` lintas cabang
   untuk nomor nota (`INV<YYYYMMDD>-####` → tabrakan antar cabang), membaca stok
   tanpa `cabang_id`, dan meng-`upsert` `master_customer` hanya dengan
   `nomor_wa` (tanpa cabang).

### 5.2 `purchase_save` (versi 8 parameter)

Yang berubah:

1. **Cabang**: pola sama dengan 5.1 poin 1 — hapus fallback `'KARLA'`.
2. **Harga**: ini yang paling penting. Baris terakhir loop saat ini:

   ```sql
   update master_barang set harga_modal = ..., harga_jual_umum = ...
   where kode_obat = v_product.kode_obat;
   ```

   **tanpa `cabang_id`**. Setelah `master_barang` dipisah per cabang, tambahkan
   `and cabang_id = v_cabang_id`. Tanpa itu, satu penerimaan barang di KENDAL
   mengubah harga jual di semua cabang — persis kebocoran yang mau dihilangkan.
3. **Barang**: `select * into v_product from master_barang ... and aktif='YA'`
   → tambah `and cabang_id = v_cabang_id`.
4. **Batch**: sudah memakai `and cabang_id = v_cabang_id` untuk SELECT/UPDATE,
   tapi `stok_batch` unique-nya masih global (`kode_obat, kode_batch`). Kalau
   batch yang sama sudah ada di cabang lain, `INSERT` akan gagal karena unique
   global. **Migrasi 3 wajib jalan sebelum migrasi 5.**
5. **Nomor faktur**: pemeriksaan duplikat sudah per cabang; PK tetap global
   (lihat rekomendasi 4.2). Pertimbangkan memberi prefix cabang pada nomor faktur.
6. **Supplier**: setelah `master_supplier` per cabang, validasi bahwa `p_supplier`
   benar-benar milik `v_cabang_id` (sekarang tidak diperiksa sama sekali).
7. **Hapus overload 7 parameter** (versi lama: cek faktur tanpa cabang, tidak
   menulis `cabang_id` ke `trx_pembelian`/`trx_pembelian_detail`/`stok_batch`).

### 5.3 `generate_refill_reminders(p_cabang_id DEFAULT NULL)`

Fungsi ini relatif bersih: `JOIN master_customer c ON c.id = p.customer_id AND
c.cabang_id = p.cabang_id`, dan `WHERE (p_cabang_id IS NULL OR p.cabang_id = p_cabang_id)`.

Yang berubah:

1. **Arti `NULL`**: sekarang `NULL` = semua cabang. Untuk isolasi, `NULL` hanya
   boleh dipakai oleh job internal (`service_role`). Pemanggilan dari aplikasi
   (`api:refill.generate`) harus **selalu** mengirim cabang sesi — dan sebaiknya
   parameter dijadikan wajib, bukan punya default.
2. **Pesan**: teksnya `'...Silakan hubungi Apotek Fa-Mitra...'` tanpa nama cabang.
   Tambahkan nama cabang (join ke `master_cabang`) supaya pelanggan Pucuk tidak
   diarahkan ke Karla.
3. **Barang**: kalau nanti `refill_programs.kode_obat` divalidasi ke
   `master_barang`, validasinya harus `(cabang_id, kode_obat)`.
4. **Otorisasi**: cabut `EXECUTE` dari `anon`/`authenticated`; panggil hanya dari
   Edge Function dengan `service_role`.
5. **Ketergantungan**: `ON CONFLICT DO NOTHING` memerlukan unique constraint di
   `notification_log` — pastikan ada di baseline lengkap, kalau tidak, `DO NOTHING`
   tidak berfungsi seperti yang diharapkan.

### 5.4 `pos_checkout_promo`

1. **Cabang**: pola sama — hapus fallback `'KARLA'`.
2. **Harga**: subtotal dihitung dari `master_barang` **tanpa** `cabang_id`
   (`select ... into v_unit_price from master_barang where kode_obat = ... and
   aktif='YA'`). Tambahkan `and cabang_id = v_cabang_id`, kalau tidak diskon
   kupon dihitung dari harga cabang lain.
3. **Kupon & kampanye**: sudah per cabang (`cabang_id = v_cabang_id` pada
   `promo_coupons` dan `promo_campaigns`). Benar — pertahankan.
4. **Redemption**: `promo_redemptions.invoice_no` mengacu ke `trx_penjualan(no_nota)`.
   Kalau PK `trx_penjualan` dijadikan komposit (4.2), FK ini harus ikut komposit.
5. **Otorisasi**: cabut `EXECUTE` dari `anon`/`authenticated`.
6. `promo_segment_targets` tidak punya `cabang_id` (dia anak dari campaign) —
   sudah benar karena selalu diakses lewat `campaign_id` yang per cabang.

### 5.5 `pos_checkout_bundle`

1. **Cabang**: pola sama (`v_branch`) — hapus fallback `'KARLA'`.
2. **Barang**: query inti saat ini

   ```sql
   FOR v_item IN SELECT i.*, m.nama_obat, m.harga_jual_umum, ...
   FROM promo_bundle_items i JOIN master_barang m ON m.kode_obat = i.kode_obat
   WHERE i.bundle_id = v_bundle.id
   ```

   → tambahkan `AND m.cabang_id = v_branch`. Tanpa ini, bundle di satu cabang
   memakai harga barang cabang lain.
3. **Anggota bundle**: `promo_bundle_items` tidak punya `cabang_id`, jadi keanggotaan
   lintas cabang hanya terjaga lewat `promo_bundles.cabang_id` (sudah difilter saat
   mengambil bundle). Setelah `master_barang` per cabang, tambahkan validasi bahwa
   setiap `kode_obat` anggota bundle ada di `master_barang` cabang tersebut
   (kalau tidak, bundle berisi barang yang tidak dijual di cabang itu akan lolos).
4. **Harga dasar & diskon**: `v_base` dan `v_discount` dihitung dari harga
   `master_barang` → otomatis berubah setelah poin 2.
5. **Update nota**: `UPDATE trx_penjualan ... WHERE no_nota = ... AND cabang_id =
   v_branch` — sudah benar.
6. **Otorisasi**: cabut `EXECUTE` dari `anon`/`authenticated`.

### 5.6 Ringkasan

| Fungsi | Cabang dari input? | Filter cabang hilang | Overload lama | Tindakan utama |
|---|---|---|---|---|
| `pos_checkout` (9 param) | Ya, dengan fallback KARLA | `master_barang` (2 tempat) | **Ada (7 param)** | hapus fallback, filter barang, hapus overload |
| `purchase_save` (8 param) | Ya, dengan fallback KARLA | `master_barang` (baca **dan** `UPDATE` harga) | **Ada (7 param)** | filter cabang pada `UPDATE master_barang`, hapus overload |
| `generate_refill_reminders` | Param `NULL` = semua cabang | — (sudah join cabang) | Tidak | jadikan cabang wajib dari aplikasi |
| `pos_checkout_promo` | Ya, dengan fallback KARLA | `master_barang` (subtotal) | Tidak | filter cabang pada harga |
| `pos_checkout_bundle` | Ya, dengan fallback KARLA | `master_barang` (join) | Tidak | filter cabang pada join |

---

## 6. Owner hanya mengelola user dan data cabangnya sendiri

Keadaan sekarang (`supabase/functions/api/index.ts`):

| Baris | Kode | Masalah |
|---|---|---|
| `api:465` | `db("app_users", "?select=...&order=nama.asc&limit=200")` | Owner melihat user **semua cabang** |
| `api:470` | `cabang_id: data.Cabang_ID \|\| data.cabang_id ...` | cabang user baru dari **form** — satu-satunya tempat cabang diambil dari input frontend |
| `api:478` | `db("app_users", "?username=eq....", {method:"PATCH", body:{aktif:"TIDAK"}})` | menonaktifkan user **lintas cabang** |
| `api:100`, `api:111` | `cabang_id: u.cabang_id \|\| "KARLA"` | user tanpa cabang diam-diam masuk KARLA |

Perubahan yang direncanakan di Edge Function `api`:

1. `user.list` → tambah `cabang_id=eq.${s.cabang_id}`.
2. `user.simpan` → `cabang_id: s.cabang_id` (dari sesi). **Abaikan** `Cabang_ID`
   dari payload. Untuk mode ubah (edit), tolak kalau user yang diedit bukan milik
   `s.cabang_id` (cek dulu dengan `one("app_users", "?username=eq....")`).
3. `user.hapus` → tambah `&cabang_id=eq.${s.cabang_id}` pada PATCH.
4. `api:100` dan `api:111` → hapus fallback `|| "KARLA"`; user tanpa `cabang_id`
   harus **gagal login** dengan pesan jelas, bukan masuk KARLA.
5. Tambahkan juga filter cabang pada action lain yang masih bocor (lihat bagian 7):
   `laporan.labaRugi`, `dashboard.ringkasan`, `retur.*`, `biaya.hapus`,
   `refill.simpan`, `promo couponSave`, `stok.simpanBatch`, `opname.simpan`.

Perubahan frontend (`public/js_master.js`) — **belum dikerjakan, kode tidak diubah
di PR ini**:

- `js_master.js:470-475` — hapus `<select id="fuCabang">` dari form user; ganti
  dengan teks cabang sesi (read-only) supaya Owner tahu user ini masuk cabang mana.
- `js_master.js:485` — hapus `Cabang_ID: val('fuCabang')` dari payload.
- `js_master.js:435` — kolom "Cabang" di tabel user isinya akan selalu cabang sesi;
  boleh dipertahankan (menegaskan isolasi) atau dihapus.

Catatan: `AI_CABANG_VALID` di `public/js_ai.js:16` (`['KARLA','PUCUK','KENDAL','PULE']`)
adalah daftar cabang yang di-hardcode di frontend. Kalau nanti ada cabang baru
(atau nama berubah), **frontend ini harus diubah juga** — kalau tidak, Asisten AI
menolak jalan (`js_ai.js:107-109`, `290-292`). Lebih baik daftar ini diambil dari
`master_cabang` lewat API.

**Keputusan yang perlu diambil**: `app_users` PK-nya `(username)` global. Artinya
username harus unik lintas cabang (`owner.karla` vs `owner.kendal`). Mengubahnya
jadi `(cabang_id, username)` berarti mengubah `app_sessions.username` FK dan alur
login `api:95`. Rekomendasi: **tetap global** (username unik sepanjang sistem),
karena perubahan alur login berisiko dan tidak menambah isolasi data.

---

## 7. Temuan audit isolasi cabang sebelumnya

Sumber: audit pada sesi 25 September 2026 (`@session:default/20260925_015428_68694f`),
diverifikasi ulang baris per baris terhadap `supabase/functions/api/index.ts` saat
dokumen ini ditulis — **nomor barisnya masih sama persis**.

Ringkasan pola: cabang diambil dari sesi (`s.cabang_id || "KARLA"`) dan dipakai
konsisten 26 kali di `api`. Tidak ada mekanisme "lihat semua cabang". Tapi **12
action tidak memfilter cabang sama sekali** dan **2 action menulis tanpa
`cabang_id`** — pola "lupa", bukan desain.

### 7.1 Peta per fungsi

**`supabase/functions/api` (37 action)** — kolom: baca per cabang / `cabang_id` saat tulis.

| Action | Role | Baca | Tulis | Catatan |
|---|---|---|---|---|
| `pos.cariBarang` | OAK | YA (disaring di JS `api:140`) | n/a | `master_barang` global |
| `pos.cariCustomer` | OAK | YA | n/a | |
| `pos.daftarCustomer` | OAK | — | SESI (`api:190`) | |
| `pos.notaTerakhir` | OAK | YA | n/a | |
| `pos.simpanTransaksi` | OAK | n/a | SESI | rpc `pos_checkout` |
| `barang.list` | OA | GLOBAL | n/a | |
| `barang.simpan` | OA | GLOBAL | n/a | `master_barang`, tidak ada `cabang_id` di payload |
| `barang.hapus` | OA | GLOBAL | n/a | soft delete |
| `stok.list` | OA | YA | n/a | |
| `stok.simpanBatch` | OA | YA + **2 TIDAK** | SESI | `api:217/219` rusak → temuan 8 |
| `opname.list` | OA | YA | n/a | |
| `opname.simpan` | OA | **TIDAK** (query rusak) | SESI | `api:455` selalu gagal → temuan 9 |
| `crm.list` | OA | YA | n/a | |
| `crm.simpan` | OA | — | SESI (`api:190`) | |
| `refill.list` | OA | YA | n/a | |
| `refill.simpan` | OA | — | SESI | `customer_id` dari input tanpa verifikasi cabang → temuan 11 |
| `refill.status` | OA | YA (id + cabang) | n/a | |
| `refill.generate` | OA | n/a | SESI | rpc `generate_refill_reminders` |
| `notification.pending` | OA | YA | n/a | aksi mati (tidak dipanggil frontend) |
| `reward.list` | OAK | YA (2 dari 2) | n/a | |
| `dashboard.ringkasan` | OA | 2 YA, **1 TIDAK** | n/a | `api:339` bocor → temuan 2 |
| `beli.supplier` | OA | GLOBAL | n/a | `api:264` |
| `beli.simpanSupplier` | OA | — | **TIDAK ADA** | `api:270`, `master_supplier` tanpa `cabang_id` → temuan 14 |
| `beli.simpan` | OA | n/a | SESI | rpc `purchase_save` |
| `beli.list` | OA | YA | n/a | aksi mati |
| `biaya.list` | OK | YA | n/a | |
| `biaya.simpan` | OK | — | SESI (`api:288`) | |
| `biaya.hapus` | O | — | n/a (DELETE) | `api:294` tanpa cek cabang → temuan 7 |
| `laporan.labaRugi` | O | penjualan YA, **biaya TIDAK** | n/a | `api:365` bocor → temuan 1 |
| `user.list` | O | **TIDAK** | n/a | lintas cabang → temuan 13 |
| `user.simpan` | O | — | **INPUT-FE** (`api:470`) | satu-satunya cabang dari input |
| `user.hapus` | O | **TIDAK** (by username) | n/a | lintas cabang → temuan 13 |
| `retur.jualList` | OAK | **TIDAK** (2 dari 2) | n/a | temuan 3 |
| `retur.jualSimpan` | OAK | **TIDAK** (nota asal) | **TIDAK ADA** | temuan 4 |
| `retur.beliList` | O | **TIDAK** (2 dari 2) | n/a | temuan 5 |
| `retur.beliSimpan` | O | **TIDAK** (faktur asal) | **TIDAK ADA** | temuan 6 |
| `retur.beliApprove` | O | **TIDAK** (by `no_retur`) | n/a | temuan 5 |

**`supabase/functions/promo` (13 action)**

| Action | Role | Baca | Tulis | Catatan |
|---|---|---|---|---|
| `bundleList` | O | YA | n/a | |
| `bundleSave` | O | GLOBAL (`master_barang`) | SESI | item anak dari bundle |
| `bundleStatus` | O | YA (id + cabang) | n/a | |
| `bundleValidate` | OAK | YA | n/a | |
| `bundleCheckout` | OAK | n/a | SESI | rpc `pos_checkout_bundle` |
| `campaignList` | O | YA | n/a | |
| `campaignSave` | O | — | SESI | |
| `campaignStatus` | O | YA (id + cabang) | n/a | |
| `couponList` | O | YA | n/a | aksi mati |
| `couponSave` | O | — | SESI | `campaign_id` dari input tanpa verifikasi cabang → temuan 12 |
| `validate` | OAK | YA (2 dari 2) | n/a | |
| `report` | O | YA (2 dari 3) | n/a | baca ke-3 lewat `no_nota` hasil query cabang |
| `checkout` | OAK | n/a | SESI | rpc `pos_checkout_promo` |

Role di `promo`: `allowed()` membatasi 9 action admin (campaign*, coupon*, report,
bundleList/Save/Status) hanya Owner. `validate`/`checkout`/`bundleValidate`/
`bundleCheckout` terbuka untuk O, A, K — memang untuk layar POS.

**`supabase/functions/hutang` (4 action)** — **satu-satunya fungsi yang bersih**:
keempat action menulis dan membaca dengan cabang dari sesi, tanpa input cabang dari
frontend sama sekali.

| Action | Role | Baca | Tulis |
|---|---|---|---|
| `list` | OAK | YA (2 dari 2) | n/a |
| `history` | OAK | YA (2 dari 2) | n/a |
| `pay` | O, A | YA (lewat `list(c)`) | SESI |
| `cancel` | O, A | YA (id + cabang + `AKTIF`) | n/a |

### 7.2 Empat belas temuan (urut keparahan)

1. **`api:365` `laporan.labaRugi`** — `biaya_operasional` dibaca **tanpa `cabang_id`**,
   padahal penjualan difilter (`api:364`). Biaya semua cabang dikurangkan dari
   penjualan cabang sendiri → laba bersih salah **dan** data biaya cabang lain
   terbaca. Role: Owner.
2. **`api:339` `dashboard.ringkasan`** — `master_customer` dibaca tanpa `cabang_id`
   → hitungan segmen pelanggan mencakup semua cabang. Role: Owner + Apoteker.
3. **`api:382` dan `api:386` `retur.jualList`** — `trx_retur_jual` dan
   `trx_penjualan` tanpa `cabang_id` → **Kasir** melihat riwayat retur dan nota
   cabang lain.
4. **`api:399/409/414` `retur.jualSimpan`** — nota asal diambil tanpa cek cabang;
   `trx_retur_jual` ditulis **tanpa `cabang_id`**; koreksi stok gagal karena query
   rusak (lihat temuan 8). Perlu diputuskan: kolom `cabang_id` di `trx_retur_jual`
   wajib diisi?
5. **`api:420/428/445` `retur.beli*`** — faktur, retur beli, dan approve tanpa
   filter cabang. Role: Owner.
6. **`api:432/435` `retur.beliSimpan`** — faktur cabang lain bisa diretur, dan
   `trx_retur_beli` ditulis **tanpa `cabang_id`**.
7. **`api:294` `biaya.hapus`** — `DELETE` berdasarkan `id` dari input **tanpa cek
   cabang** → bisa menghapus biaya cabang lain. Role: Owner.
8. **`api:217` dan `api:219` `stok.simpanBatch`** — filter salah tulis:
   `?id_batq.${...}` dan `&kode_batq.${...}` (seharusnya `id=eq.` dan `kode_batch=eq.`).
   PostgREST menolak, `one()` mengembalikan `null`, jadi:
   - `api:218` guard "bukan milik cabang ini" **tidak pernah aktif**;
   - `api:220` guard duplikat **tidak pernah aktif** → `POST` dengan
     `resolution=merge-duplicates` dan `id_batch` dari input bisa **menimpa baris
     batch milik cabang lain**, dan `cabang_id`-nya ikut ditimpa jadi cabang
     penyerang.

   **Ini satu-satunya temuan yang bisa merusak data cabang lain, bukan sekadar
   membaca.** Prioritas tertinggi.
9. **`api:455` `opname.simpan`** — filter rusak yang sama → selalu melempar "Batch
   stok tidak ditemukan", jadi stokopname **tidak pernah tersimpan**; `api:460`
   PATCH stok juga tidak jalan.
10. **`api:414` `retur.jualSimpan`** — filter rusak yang sama → stok retur **tidak
    pernah dikembalikan** (gagal senyap, karena dibungkus `if (b)`).
11. **`api:150` `refill.simpan`** — `customer_id` dari input tanpa diverifikasi
    milik cabang sesi → bisa membuat program refill cabang A untuk pelanggan
    cabang B, dan nama/nomor WA-nya ikut tampil di `refill.list`.
12. **`promo` `couponSave`** — `campaign_id` dari input tanpa verifikasi cabang →
    kupon cabang A bisa ditempel ke kampanye cabang B.
13. **`user.list` / `user.hapus` (`api:465`, `api:478`)** — lintas cabang.
    Kemungkinan disengaja, tapi **dikonfirmasi sebagai bug** oleh permintaan di
    bagian 6 (Owner hanya mengelola cabangnya sendiri).
14. **`beli.supplier` / `beli.simpanSupplier` (`api:264`, `api:270`)** —
    `master_supplier` tanpa `cabang_id` sama sekali. Snapshot `constraint.csv`
    memastikan tabel itu hanya punya PK `kode_supplier` dan `UNIQUE (nama_supplier)`
    tanpa FK cabang → **memang master global**, dan sekarang akan diubah jadi per
    cabang (bagian 3.2).

Catatan metode: temuan 8–10 bergantung pada string filter yang salah tulis. Itu
diverifikasi tiga cara (ordinal karakter, pencarian literal, dump byte) karena
pembacaan pertama sempat tidak konsisten. File memang berisi `id_batq.` (1×) dan
`kode_batq.` (5×). **Temuan ini masih ada di kode saat ini dan belum diperbaiki.**

Temuan 1–7, 9, 11, 12, 13 akan hilang sebagai *efek samping* migrasi isolasi cabang
(karena `master_barang`/`master_supplier` jadi per cabang dan semua query bercabang
ditambahi filter), **kecuali** kalau tidak sengaja dilewatkan. Karena itu bagian 9
memuat satu test case per temuan.

---

## 8. Membuat Owner pertama untuk cabang baru lewat SQL

Urutan: pastikan cabang ada di `master_cabang` → buat user Owner → verifikasi.

### 8.1 Pastikan cabang terdaftar

```sql
insert into public.master_cabang (kode_cabang, nama_cabang, aktif)
values ('PULE', 'Apotek Fa-Mitra Pule', 'YA')
on conflict (kode_cabang) do nothing;

select kode_cabang, nama_cabang, aktif from public.master_cabang order by kode_cabang;
```

Kalau `on conflict (kode_cabang)` menolak dengan error "no unique or exclusion
constraint", berarti `kode_cabang` tidak punya unique index — hentikan dan
laporkan, karena 13 FK mengandalkannya (bagian 4.1).

### 8.2 Hitung hash password

`api:96` memverifikasi `u.password_hash !== await sha256(password)`, dan `sha256()`
di Edge Function menghasilkan **hex huruf kecil dari SHA-256 tanpa salt**. Jadi
hash harus dihitung dengan cara yang sama. Pilih salah satu:

```bash
# git-bash / Linux (perhatikan: pakai printf, bukan echo, supaya tidak ada newline)
printf '%s' 'GantiPasswordIni' | sha256sum

# Node.js
node -e "console.log(require('crypto').createHash('sha256').update('GantiPasswordIni').digest('hex'))"
```

Atau lewat Postgres (kalau `pgcrypto` tersedia di schema `extensions`):

```sql
select encode(extensions.digest('GantiPasswordIni', 'sha256'), 'hex');
```

### 8.3 Buat user Owner

```sql
insert into public.app_users (username, nama, password_hash, role, aktif, cabang_id)
values (
  'owner.pule',
  'Nama Owner Pule',
  '<HASIL_SHA256_HEX_DARI_8.2>',
  'Owner',
  'YA',
  'PULE'
)
on conflict (username) do update
  set nama          = excluded.nama,
      password_hash = excluded.password_hash,
      role          = excluded.role,
      aktif         = 'YA',
      cabang_id     = excluded.cabang_id;
```

### 8.4 Verifikasi

```sql
-- 1. user Owner dan cabangnya
select username, nama, role, aktif, cabang_id
from public.app_users
where role = 'Owner'
order by cabang_id, username;

-- 2. tidak ada user aktif dengan cabang yang tidak terdaftar
select u.username, u.cabang_id
from public.app_users u
left join public.master_cabang c on c.kode_cabang = u.cabang_id
where c.kode_cabang is null;

-- 3. tidak ada user aktif tanpa cabang (setelah default 'KARLA' dihapus)
select username, cabang_id from public.app_users where cabang_id is null;
```

Lalu uji login lewat aplikasi (`pos` / `login`), dan pastikan sidebar menampilkan
"Apotek Fa-Mitra Pule" (`js_core.js:290-295` memetakan `cabang_id` → nama cabang;
kalau kode cabang baru tidak ada di peta itu, yang muncul adalah teks `apotek`
default dari `api:111`, yaitu "Apotek Fa-Mitra" — **tambahkan kode cabang baru ke
peta di `js_core.js:290-295` dan ke `AI_CABANG_VALID` di `js_ai.js:16`**).

Peringatan operasional:

- Password yang ditulis langsung di SQL akan tercatat di riwayat shell/psql dan
  log query. Untuk produksi, jalankan lewat `psql` dengan variabel, atau ganti
  password segera setelah login pertama.
- `password_hash` SHA-256 tanpa salt berarti siapa pun yang bisa membaca
  `app_users` bisa menguji password secara offline dengan cepat. Perbaikan ke
  bcrypt/argon2 adalah perubahan kode tersendiri (butuh izin pemilik project).
- Owner pertama per cabang **wajib** dibuat lewat SQL karena form "Tambah user"
  hanya bisa diakses Owner yang sudah login — dan setelah bagian 6 diterapkan,
  Owner cabang X tidak bisa lagi membuat user untuk cabang Y.

---

## 9. Rencana pengujian sebelum diterapkan ke database utama

### 9.1 Aturan dasar

- **Jangan menguji di database produksi.** Preview Cloudflare Pages memakai
  database Supabase yang **sama** dengan production (AGENTS.md), jadi preview
  bukan tempat uji yang aman: jangan membuat, mengubah, atau menghapus data
  sungguhan dari sana.
- Lingkungan uji, pilih salah satu:
  1. **Lokal dengan Docker** (sesuai rencana pemilik project): `npx supabase start`,
     restore baseline, jalankan migrasi, jalankan seluruh suite. Paling aman dan
     gratis.
  2. **Project Supabase kedua** (gratis) sebagai staging: restore baseline di sana.
  3. Supabase branching (berbayar) — tidak direkomendasikan untuk sekarang.
- Semua pengujian SQL dijalankan di dalam transaksi (`begin; ... rollback;`) supaya
  tidak meninggalkan data uji.
- Bukti hasil (output query) disimpan sebagai file, bukan hanya "sudah dicek".

### 9.2 Urutan pengujian

**Tahap 0 — baseline & inventaris (sebelum migrasi apa pun)**

- `pg_dump --schema-only` → `supabase/schema/baseline.sql` (setelah Docker terpasang).
- Dari baseline, lengkapi: daftar **unique index** yang tidak tertangkap snapshot,
  semua FK ke `master_barang` dan `master_supplier` (terutama yang di bawah titik
  potong `constraint.csv`), dan unique constraint di `notification_log`.
- Verifikasi jumlah awal: `select count(*) from master_barang` (harus 137),
  `select count(*) from master_supplier`, `select kode_cabang from master_cabang`.

**Tahap 1 — struktur (setelah migrasi 1–4)**

| # | Uji | Hasil yang diharapkan |
|---|---|---|
| T1 | `select cabang_id, count(*) from master_barang group by 1` | 4 baris × 137 = 548 total |
| T2 | `select count(*) from master_barang where cabang_id is null` | 0 |
| T3 | Insert `stok_batch` dengan `(kode_obat, kode_batch)` sama di KENDAL dan KARLA | keduanya berhasil (bukti unique sudah per cabang) |
| T4 | Insert `master_supplier` nama sama di dua cabang | berhasil |
| T5 | Insert `master_barang` dengan `cabang_id` yang tidak ada di `master_cabang` | ditolak FK |
| T6 | Insert baris tanpa `cabang_id` di `app_users`/`biaya_operasional`/`master_customer` | ditolak (default `'KARLA'` sudah dihapus) |
| T7 | `insert into master_customer (nomor_wa, ...)` dua cabang dengan nomor WA sama | keduanya berhasil, unique-nya `(cabang_id, nomor_wa)` |
| T8 | `select * from master_customer where cabang_id='KENDAL'` + jalankan `loyalty_after_sale` lewat insert `trx_penjualan` | tier/poin hanya berubah di KENDAL |

**Tahap 2 — fungsi kasir (setelah migrasi 5)**

| # | Uji | Hasil yang diharapkan |
|---|---|---|
| T9 | `pos_checkout` di KENDAL; bandingkan `stok_batch.stok_real` KARLA sebelum/sesudah | stok KARLA **tidak berubah** |
| T10 | Dua sesi paralel `pos_checkout` di KENDAL dan PUCUK (uji balapan) | dua nomor nota berbeda, tidak ada tabrakan; tidak ada deadlock |
| T11 | `purchase_save` di KENDAL; cek `master_barang.harga_modal`/`harga_jual_umum` KARLA | **tidak berubah** (temuan paling penting) |
| T12 | `purchase_save` di KENDAL dengan batch yang sudah ada di KARLA | berhasil (unique batch sudah per cabang) |
| T13 | `pos_checkout_promo` dengan kupon KARLA di sesi KENDAL | **ditolak** |
| T14 | `pos_checkout_bundle` dengan bundle KARLA di sesi KENDAL | **ditolak** |
| T15 | `pos_checkout_bundle` di KENDAL untuk bundle berisi barang yang tidak ada di KENDAL | ditolak / barang tidak terpakai |
| T16 | `generate_refill_reminders('KENDAL')` | hanya membuat `notification_log` pelanggan KENDAL |
| T17 | Panggil `pos_checkout` dengan `p_username` milik cabang lain | ditolak / cabang tidak bisa ditentukan |
| T18 | `revoke execute` terverifikasi: panggil RPC langsung sebagai `authenticated` | **ditolak** (permission denied) |

**Tahap 3 — Edge Function & temuan audit (satu test per temuan)**

| # | Uji | Temuan |
|---|---|---|
| T19 | `laporan.labaRugi` di KENDAL vs KARLA; bandingkan biaya yang dipakai | 1 |
| T20 | `dashboard.ringkasan` di KENDAL; bandingkan jumlah pelanggan segmen dengan data KENDAL | 2 |
| T21 | `retur.jualList` sebagai Kasir KENDAL | hanya nota/retur KENDAL | 3 |
| T22 | `retur.jualSimpan` dengan nota asal cabang lain | ditolak | 4 |
| T23 | `retur.beliList` / `retur.beliApprove` lintas cabang | ditolak | 5 |
| T24 | `retur.beliSimpan` dengan faktur cabang lain | ditolak | 6 |
| T25 | `biaya.hapus` dengan `id` biaya cabang lain | ditolak | 7 |
| T26 | `stok.simpanBatch` dengan `id_batch` milik cabang lain | ditolak, **tidak menimpa** baris cabang lain | 8 |
| T27 | `opname.simpan` di KENDAL | benar-benar tersimpan (bukan "Batch stok tidak ditemukan") | 9 |
| T28 | `retur.jualSimpan` di KENDAL | stok benar-benar dikembalikan | 10 |
| T29 | `refill.simpan` dengan `customer_id` cabang lain | ditolak | 11 |
| T30 | `couponSave` dengan `campaign_id` cabang lain | ditolak | 12 |
| T31 | `user.list` sebagai Owner KENDAL | hanya user KENDAL | 13 |
| T32 | `user.simpan` dengan `Cabang_ID` palsu (mis. 'KARLA') di sesi KENDAL | tersimpan sebagai KENDAL | bagian 6 |
| T33 | `user.hapus` username cabang lain | ditolak | 13 |
| T34 | Login user dengan `cabang_id` kosong | gagal login dengan pesan jelas (bukan masuk KARLA) | bagian 6 |
| T35 | `beli.supplier` sebagai Owner KENDAL | hanya supplier KENDAL | 14 |

**Tahap 4 — regresi data (wajib, sebelum menyentuh production)**

Migrasi ini **memindahkan dimensi cabang**, bukan mengubah angka. Jadi:

- Bandingkan total per cabang **sebelum vs sesudah**: jumlah nota, omzet
  (`sum(harga_akhir)`), `sum(total_hpp)`, jumlah baris `trx_penjualan_detail`,
  `stok_batch.stok_real` per cabang. **Harus identik.**
- Bandingkan `count(*)` seluruh tabel transaksi sebelum vs sesudah. Harus identik.
- Uji UI manual di lingkungan uji: login 4 cabang (Owner, Apoteker, Kasir), kasir
  satu transaksi per cabang, satu pembelian, satu retur jual, satu retur beli, satu
  stokopname, satu biaya, buka dashboard + laporan + Asisten AI.
- Cek konsol browser tanpa error (`js_core.js`, `js_pos.js`, `js_master.js`,
  `js_trx.js`, `js_dashboard.js`, `js_ai.js`).

### 9.3 Kriteria lulus

Semua uji T1–T35 lulus, regresi Tahap 4 identik, tidak ada error konsol, dan check
"Cloudflare Pages" di PR hijau. Kalau salah satu gagal, migrasi **tidak** dijalankan
ke production.

### 9.4 Urutan penerapan ke production (setelah semua lulus)

1. Backup: `pg_dump` penuh (data + skema) sebelum apa pun.
2. Jalankan migrasi 1–4 (perubahan struktur; masih kompatibel dengan kode lama
   karena `pos_checkout` versi lama tetap ada dan `cabang_id` sudah ada defaultnya
   saat itu — **jangan** hapus default sebelum kode baru siap).
3. Deploy Edge Function `api`, `promo`, `hutang` (kode sudah memakai cabang sesi).
4. Deploy frontend (hapus field Cabang di form user).
5. Jalankan migrasi 5 (fungsi baru + `drop function` overload lama) dan migrasi 6
   (RLS/GRANT/revoke).
6. Ulangi Tahap 4 regresi di production pada hari yang sama, di luar jam sibuk.
7. Rollback: setiap migrasi punya blok rollback; kalau ada masalah, kembalikan
   fungsi lama (overload lama disimpan sebagai komentar di file migrasi) dan
   `alter column ... set default 'KARLA'` untuk membatalkan poin 4.3.

Semua langkah 2–6 **butuh izin eksplisit pemilik project** (`db push` dan deploy
dilarang tanpa izin).

---

## 10. Pertanyaan yang perlu keputusan pemilik project

1. **137 barang milik siapa?** Rencana ini mengasumsikan semua baris `master_barang`
   sekarang milik KARLA. Benar?
2. **Harga boleh berbeda antar cabang?** (kalau ya: siapa yang boleh mengubah harga
   per cabang? Apoteker atau hanya Owner?)
3. **Supplier benar-benar per cabang**, atau global dengan daftar per cabang?
4. **Nomor faktur pembelian**: tetap unik global, atau diberi prefix cabang seperti
   nota penjualan?
5. **Username**: tetap unik global (`owner.karla`, `owner.kendal`), atau per cabang?
6. **Tabel lama berbahasa Inggris** (`products`, `sales`, `stock_batches`,
   `customers`, `suppliers`, `profiles`) dan fungsi `create_sale_with_fefo`:
   dipensiunkan atau dibiarkan? Ini butuh izin karena berarti menghapus sesuatu.
7. **RLS**: tetap model `service_role` (Model A), atau mulai migrasi ke Supabase
   Auth + claim `cabang_id` (Model B)?
8. **Cabang baru**: kalau nanti ada cabang kelima, apakah cukup insert ke
   `master_cabang` + salin 137 barang (jalankan ulang migrasi 1 untuk cabang itu)?

---

## 11. Yang tidak dikerjakan di PR ini

- Tidak ada perubahan kode (`public/*.js`, `public/index.html`,
  `supabase/functions/*`).
- Tidak ada file migrasi baru (`supabase/migrations/`) — hanya rencana.
- Tidak ada `db push`, tidak ada deploy Edge Function, tidak ada
  `wrangler pages deploy`.
- Tidak ada perubahan skema, policy RLS, atau hak akses.
- Tidak ada merge ke `main`.

Isi PR: `schema/*.csv` (5 file, backup struktur sementara) +
`supabase/schema/baseline.sql` (placeholder) + dokumen ini.
