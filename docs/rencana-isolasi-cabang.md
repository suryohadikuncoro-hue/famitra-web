# Rencana Isolasi Cabang SI-FaMitra

Status: **rencana saja — belum ada kode, migrasi, atau database yang diubah.**
Branch: `plan/isolasi-cabang`
Tanggal: 25 September 2026

**Revisi 2** — dokumen ini diperbarui setelah snapshot skema diekspor ulang tanpa
batas 100 baris dan dilengkapi `index.csv` (unique index). Yang berubah:
`kolom.csv` 100 → **455** baris, `constraint.csv` 100 → **184** baris, `index.csv`
**104** baris (baru). Semua daftar kunci, relasi, dan unique index di dokumen ini
sudah diverifikasi ulang terhadap data lengkap itu. Enam koreksi dan satu temuan
baru (temuan 15) dirinci di bagian 0.

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
| Tabel transaksi & stok (`trx_*`, `stok_batch`, `master_customer`, `biaya_operasional`, `promo_*`) | Sudah punya `cabang_id` (25 tabel, semua `NOT NULL`) |
| `master_barang` (barang + harga jual) | **Global** — 1 baris dipakai semua cabang |
| `master_supplier` | **Global** — tidak punya `cabang_id` sama sekali |
| Nomor nota penjualan | Sudah berprefix cabang (`INV-<CABANG>-...`), tapi fungsi lama masih bisa membuat nomor global |
| Nomor faktur pembelian | **Belum** per cabang (PK `trx_pembelian.no_faktur` global) |
| Kode batch stok | **Belum** per cabang (`UNIQUE (kode_obat, kode_batch)` global) |
| Default `cabang_id` | **14 kolom** punya `DEFAULT 'KARLA'` → insert yang lupa mengisi `cabang_id` **tidak gagal**, tapi mendarat di KARLA (lihat 4.3) |
| Otorisasi cabang | 100% di kode Edge Function — RLS tidak efektif (lihat 4.5) |
| Manajemen user | Owner lintas cabang, dan `cabang_id` user baru diambil dari **form**, bukan sesi |
| Fitur refill & notifikasi | **Rusak total** karena salah besar/kecil huruf (temuan 15) — tidak terkait isolasi cabang, tapi ditemukan saat verifikasi ini |

Kesimpulan singkat: isolasi cabang sekarang bergantung pada **kode Edge Function
saja**, bukan pada database. Itu sebabnya satu bug salah tulis string filter
(temuan 8) bisa merusak data cabang lain.

### Koreksi dari Revisi 1

Enam hal di dokumen versi pertama ternyata **salah** karena berasal dari snapshot
yang terpotong di 100 baris. Semuanya sudah dikoreksi di tempatnya:

| # | Klaim Revisi 1 | Fakta setelah data lengkap | Letak koreksi |
|---|---|---|---|
| 1 | 4 kolom punya `DEFAULT 'KARLA'` | **14 kolom** | 4.3 |
| 2 | `cabang_id` di `trx_retur_jual` "perlu diputuskan wajib diisi?" | Sudah `NOT NULL` — yang salah nilainya, bukan kosongnya | 4.3, temuan 4 & 6 |
| 3 | `trx_pembelian.supplier` adalah FK ke `master_supplier` | **Tidak ada FK** ke `master_supplier` sama sekali | 3.2, 4.2 |
| 4 | `trx_pembayaran_hutang.no_faktur` adalah FK | **Bukan FK** | 4.2 |
| 5 | `promo_bundles` punya `cabang_id` "tanpa FK" | **Punya FK** ke `master_cabang` | 1.2 |
| 6 | Unique `(cabang_id, nomor_wa)` di `master_customer` "belum terlihat, wajib diverifikasi" | **Sudah ada** (`uq_master_customer_cabang_wa`); `master_cabang` juga punya `kode_cabang` unik | 1.4, 4.1 |

Ditambah **satu temuan baru**: temuan 15 (fitur refill & notifikasi rusak karena
salah besar/kecil huruf — 3 tabrakan CHECK constraint).

---

## 1. Fakta yang diverifikasi

### 1.1 Sumber data

Semua fakta struktur di dokumen ini diambil dari enam CSV snapshot di
`supabase/schema/`. Snapshot ini sudah **lengkap** (diekspor ulang tanpa batas
100 baris):

| File | Baris data | Isi |
|---|---|---|
| `supabase/schema/kolom.csv` | 455 | 47 tabel, seluruh kolom + tipe + NOT NULL + default |
| `supabase/schema/constraint.csv` | 184 | PK, UNIQUE, CHECK, dan FK (`pg_constraint`) |
| `supabase/schema/index.csv` | 104 | seluruh index termasuk **unique index** (`pg_indexes`) |
| `supabase/schema/fungsi.csv` | 18 | definisi fungsi, termasuk 2 pasang overload lama/baru |
| `supabase/schema/policy.csv` | 33 | policy RLS (15 tabel lama berbahasa Inggris) |
| `supabase/schema/trigger.csv` | 4 | trigger loyalty |

`supabase/schema/baseline.sql` masih placeholder kosong (0 byte) menunggu
`pg_dump` setelah Docker terpasang.

Catatan penting soal metode: `constraint.csv` dan `index.csv` **saling
melengkapi dan tidak bisa dipertukarkan**. Sebagian jaminan keunikan di database
ini dibuat sebagai *unique index* (`CREATE UNIQUE INDEX`), bukan sebagai
*constraint*, sehingga **tidak muncul** di `constraint.csv`. Contoh nyata:
`uq_master_customer_cabang_wa` ada di `index.csv` tapi tidak ada di
`constraint.csv`. Sebaliknya, PK dan UNIQUE constraint muncul di kedua file.
Karena itu setiap daftar kunci di dokumen ini diperiksa dari **kedua** file.

Fakta lain yang perlu diingat: **tidak ada akses database dari sesi ini** (REST
anon ditolak 401, tidak ada key di repo). Semua angka "sekarang" di bawah berasal
dari kode repo dan snapshot, bukan dari query langsung. Yang masih perlu dihitung
langsung dari database hanya **jumlah baris data** (mis. 137 barang, jumlah
supplier, jumlah pelanggan) — struktur sudah lengkap.

### 1.2 Yang sudah per cabang (aman)

- **25 tabel** punya FK ke `master_cabang(kode_cabang)`: `app_sessions`,
  `app_users`, `biaya_operasional`, `loyalty_redemptions`, `loyalty_rewards`,
  `loyalty_transactions`, `master_customer`, `notification_log`, `promo_bundles`,
  `promo_campaigns`, `promo_coupons`, `promo_redemptions`, `referrals`,
  `refill_programs`, `stok_batch`, `stok_opname`, `trx_pembayaran_hutang`,
  `trx_pembelian`, `trx_pembelian_detail`, `trx_penjualan`, `trx_penjualan_detail`,
  `trx_retur_beli`, `trx_retur_beli_detail`, `trx_retur_jual`, `trx_retur_jual_detail`.
- **`cabang_id` selalu `NOT NULL`** di semua 25 tabel itu (tidak ada satu pun yang
  nullable).
- `promo_campaigns`, `promo_coupons`, `promo_redemptions`, `promo_bundles` — per
  cabang, dengan `UNIQUE (cabang_id, code)` pada bundle dan kupon. **Ini pola yang
  benar dan dipakai sebagai acuan.** (Koreksi dari versi sebelumnya: `promo_bundles`
  **punya** FK cabang, bukan hanya kolom lepas.)
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

**`master_supplier`** — 4 kolom: `kode_supplier` (PK), `nama_supplier`
(`UNIQUE`), `telepon`, `alamat`. Tanpa `cabang_id`, tanpa FK cabang (`api:264`
baca, `api:270` tulis).

Kedua tabel ini adalah **satu-satunya tabel hidup** yang tidak punya `cabang_id`.
Tabel lain yang juga tidak punya `cabang_id` semuanya bukan bagian alur aplikasi:
tabel lama berbahasa Inggris (`products`, `sales`, `sale_items`, `purchases`,
`purchase_items`, `purchase_returns`, `purchase_return_items`, `sales_returns`,
`sales_return_items`, `stock_batches`, `stock_counts`, `customers`, `suppliers`,
`profiles`, `operating_expenses`), tabel turunan yang cabangnya mengikuti induk
(`promo_bundle_items`, `promo_segment_targets`), dan tabel non-cabang
(`master_cabang`, `activity_log`, `n8n_chat_histories`).

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
- **Tidak ada unique index di `(cabang_id, no_nota)`.** Satu-satunya jaminan
  keunikan `trx_penjualan` adalah `trx_penjualan_pkey UNIQUE (no_nota)`. Jadi
  keunikan nomor per cabang bergantung sepenuhnya pada format string di
  `pos_checkout`, bukan pada database.
- **Faktur pembelian**: `trx_pembelian_pkey PRIMARY KEY (no_faktur)` global.
  `purchase_save` memeriksa duplikat per cabang (`no_faktur AND cabang_id`), tapi
  PK-nya global → dua cabang **tidak boleh** memakai nomor faktur yang sama.
- **Kode batch**: `stok_batch_kode_obat_kode_batch_key UNIQUE (kode_obat, kode_batch)`
  — **tanpa `cabang_id`**. Dua cabang tidak boleh punya kombinasi obat+batch yang
  sama, padahal barang dari supplier yang sama wajar punya nomor batch yang sama.
  Ini penghalang teknis paling keras untuk isolasi stok.
- **Pelanggan**: `master_customer` PK `id` (uuid). Trigger `loyalty_after_sale`
  memakai `ON CONFLICT (cabang_id, nomor_wa)`, dan unique index yang dibutuhkannya
  **terbukti ada**: `uq_master_customer_cabang_wa UNIQUE (cabang_id, nomor_wa)`.
  Perlu dicatat bahwa ini *unique index*, bukan *constraint* — itulah sebabnya dia
  tidak muncul di `constraint.csv`.
- **Detail transaksi tidak punya FK ke barang**: `trx_penjualan_detail` hanya punya
  3 constraint (`cabang_fk`, `no_nota_fkey`, `pkey`) — tidak ada FK ke
  `master_barang`. Sama untuk `trx_pembelian_detail`. Jadi `kode_obat` di detail
  transaksi tidak dijaga database; hanya dijaga kode Edge Function.
- **FK yang mengarah ke `trx_penjualan(no_nota)`** (relevan kalau PK dijadikan
  komposit): `trx_penjualan_detail.no_nota`, `trx_retur_jual.no_nota_asal`,
  `promo_redemptions.invoice_no`. Untuk `trx_pembelian(no_faktur)`:
  `trx_pembelian_detail.no_faktur`, `trx_retur_beli.no_faktur_asal`.

### 1.5 Hasil pemeriksaan secret (diminta sebelum commit)

Diperiksa: **keenam** CSV di `supabase/schema/`, ketiga Edge Function (`api`,
`promo`, `hutang`), `supabase/backup/api-loader-manus.ts`, seluruh `public/*.js`,
`*.html`, migrations, `config.toml`, dan file `.md`.

**Hasil: bersih. Tidak ada password, API key, atau secret di dalam definisi fungsi.**
Tidak ada literal kredensial sama sekali. Pola yang dicari dan hasilnya 0 kecocokan:
`eyJ...` (JWT), `sbp_` (Supabase PAT), `sk-` (OpenAI), `ghp_`/`gho_` (GitHub),
`AIza...` (Google), `xox...` (Slack), `AKIA...` (AWS),
`postgresql://user:pass@`, blok `-----BEGIN ... PRIVATE KEY-----`,
`Bearer <token>`, dan pola penugasan seperti `password = "..."` /
`api_key = "..."` / `secret = "..."` / `token = "..."`.

Pemeriksaan ulang setelah ekspor baru juga bersih: `constraint.csv`,
`fungsi.csv`, `index.csv`, `kolom.csv`, `policy.csv`, `trigger.csv` → 0 kecocokan
di keenamnya.

`fungsi.csv` tidak memuat kata `password`, `password_hash`, `token`, `apikey`,
`api_key`, `secret`, `service_role`, `bearer`, `http://`, `https://`, atau
`deno.env` sama sekali. Satu-satunya kata teknis yang muncul adalah `n8n` — dan itu
**nilai data, bukan kredensial**: string literal `'n8n'` yang di-insert sebagai
`notification_log.channel` di `generate_refill_reminders` (lihat temuan 15).

Ketiga Edge Function mengambil kredensial dari environment:

```ts
var SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_KEY");
```

`fungsi.csv` tidak memuat kata `password`, `token`, `apikey`, `secret`, atau URL.
Satu-satunya penyebutan kredensial di definisi fungsi adalah
`public.current_app_role()` yang membaca `profiles.role` lewat `auth.uid()` — itu
referensi kolom, bukan nilai.

Karena aman, keenam CSV **boleh** di-commit sebagai backup struktur sementara
(sudah dilakukan di commit `chore: backup struktur skema sementara ...`, lalu
diperbarui dengan ekspor lengkap + `index.csv`).

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
   dari database; struktur sudah lengkap tapi jumlah baris belum).
5. **Tidak ada FK yang perlu diubah**, karena memang belum ada. Hari ini
   `trx_pembelian.supplier` dan `trx_retur_beli.supplier` hanyalah kolom `text`
   **tanpa referential integrity sama sekali** — bukan FK ke `master_supplier`.
   (Koreksi dari versi sebelumnya: dokumen ini sempat menyebut
   `trx_pembelian.supplier` sebagai FK. Hasil verifikasi lengkap: tidak ada satu
   pun FK ke `master_supplier` di seluruh database. Yang ada hanya
   `purchases.supplier_code → suppliers(code)` dan
   `purchase_returns.supplier_code → suppliers(code)`, keduanya di tabel lama
   berbahasa Inggris.)
   Konsekuensinya ini justru **peluang perbaikan**: setelah `master_supplier` per
   cabang, tambahkan FK komposit `trx_pembelian (cabang_id, supplier) →
   master_supplier (cabang_id, kode_supplier)` dan hal yang sama untuk
   `trx_retur_beli`. Itu menutup celah yang sekarang tidak dijaga siapa pun.

Yang perlu keputusan: apakah supplier memang harus dipisah per cabang? Hari ini
`api:264` membaca seluruh `master_supplier` tanpa filter, dan `api:270` menulis
tanpa `cabang_id`. Kalau supplier bersama (satu perusahaan melayani 4 cabang),
alternatifnya adalah membiarkannya global sebagai master bersama dan hanya
menambahkan **daftar supplier per cabang** sebagai tabel penghubung. Rencana ini
mengikuti permintaan: **supplier per cabang**.

Catatan tambahan: `master_supplier.nama_supplier` sekarang unik **global**, jadi
kalau supplier per cabang dijalankan, constraint itu wajib diganti lebih dulu —
kalau tidak, migrasi penyalinan data akan langsung gagal saat cabang kedua
mendaftarkan supplier dengan nama yang sama.

### 3.3 Penyalinan 137 barang ke KARLA, KENDAL, PUCUK, PULE

Angka 137 berasal dari pemilik project dan **belum diverifikasi** — struktur
database sudah lengkap di snapshot, tapi jumlah baris belum. Verifikasi jumlah dulu
sebelum menjalankan migrasi:

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

**Index yang harus ikut berubah.** `master_barang` sekarang punya 4 index
(terverifikasi di `index.csv`), dan ketiganya yang bukan PK tidak memuat
`cabang_id`:

| Index sekarang | Definisi | Harus jadi |
|---|---|---|
| `master_barang_pkey` | `UNIQUE (kode_obat)` | `PRIMARY KEY (cabang_id, kode_obat)` |
| `idx_barang_aktif` | `btree (aktif)` | `btree (cabang_id, aktif, nama_obat)` |
| `idx_barang_barcode` | `btree (barcode)` — **bukan unique** | `btree (cabang_id, barcode)` |
| `idx_barang_nama` | `gin (to_tsvector('simple', nama_obat))` | biarkan, atau buat index parsial per cabang |

Catatan: `idx_barang_nama` adalah GIN pada `to_tsvector` sehingga tidak bisa
dijadikan komposit dengan `cabang_id` secara langsung. Cara yang paling praktis:
biarkan index itu apa adanya (Postgres tetap memakainya lalu menyaring
`cabang_id`), atau buat index parsial `... WHERE cabang_id = 'KARLA'` per cabang
kalau nanti pencarian terasa lambat. Perlu diperhatikan juga bahwa `barcode`
**tidak unik** hari ini, jadi setelah dipisah per cabang pun tidak otomatis unik —
kalau memang barcode harus unik per cabang, itu keputusan tersendiri.

---

## 4. Kunci, relasi, trigger, dan policy yang harus berubah

### 4.1 Kunci primer dan unik

Diverifikasi dari `constraint.csv` **dan** `index.csv` (keduanya perlu, karena
sebagian keunikan berbentuk unique index, bukan constraint).

| Tabel | Sekarang (terverifikasi) | Harus jadi | Alasan |
|---|---|---|---|
| `master_barang` | PK `(kode_obat)` | PK `(cabang_id, kode_obat)` | 1 kode obat per cabang |
| `master_supplier` | PK `(kode_supplier)`, UNIQUE `(nama_supplier)` | PK `(cabang_id, kode_supplier)`, UNIQUE `(cabang_id, nama_supplier)` | supplier per cabang |
| `stok_batch` | UNIQUE `(kode_obat, kode_batch)` | UNIQUE `(cabang_id, kode_obat, kode_batch)` | **penghalang utama** — batch sama harus boleh ada di 2 cabang |
| `trx_penjualan` | PK `(no_nota)`, **tidak ada** unique `(cabang_id, no_nota)` | PK `(no_nota)` **atau** `(cabang_id, no_nota)` | perlu keputusan (4.2) |
| `trx_pembelian` | PK `(no_faktur)`, **tidak ada** unique `(cabang_id, no_faktur)` | PK `(no_faktur)` **atau** `(cabang_id, no_faktur)` | perlu keputusan (4.2) |
| `app_users` | PK `(username)` | PK `(username)` **atau** `(cabang_id, username)` | perlu keputusan (bagian 6) |
| `master_customer` | PK `(id)`, unique index `uq_master_customer_cabang_wa (cabang_id, nomor_wa)` **sudah ada** | **tidak berubah** | dipakai `ON CONFLICT` di `loyalty_after_sale` |
| `master_cabang` | PK `(kode_cabang)`, UNIQUE `(nama_cabang)` | **tidak berubah** | 13 FK mengacu ke sini |

**Sudah benar dan tidak perlu diubah** (jadikan acuan pola): `app_sessions` PK
`(token)`; `biaya_operasional`, `stok_opname`, `trx_penjualan_detail`,
`trx_pembelian_detail`, `trx_retur_jual_detail`, `trx_retur_beli_detail` PK `(id)`;
`promo_bundles` UNIQUE `(cabang_id, code)`; `promo_coupons` UNIQUE
`(cabang_id, code)`; `promo_redemptions` UNIQUE `(coupon_id, invoice_no)`;
`promo_segment_targets` unique index `(campaign_id, segment, COALESCE(customer_type,''))`;
`stok_opname` PK `(id)`.

Satu temuan kecil yang tidak berbahaya: `trx_pembayaran_hutang` punya
`UNIQUE (id, cabang_id)` padahal `id` sudah PK. Redundan, tapi tidak mengganggu —
boleh dibiarkan atau dibersihkan sekalian.

### 4.2 Relasi (foreign key) yang harus berubah

**FK yang mengacu ke `master_barang(kode_obat)` — tepat 3, semuanya komposit
setelah migrasi:**

| Tabel | Constraint | Sekarang | Harus jadi |
|---|---|---|---|
| `stok_batch` | `stok_batch_kode_obat_fkey` | `FOREIGN KEY (kode_obat)` | `FOREIGN KEY (cabang_id, kode_obat)` |
| `refill_programs` | `refill_programs_kode_obat_fkey` | `FOREIGN KEY (kode_obat)` | `FOREIGN KEY (cabang_id, kode_obat)` |
| `promo_bundle_items` | `promo_bundle_items_kode_obat_fkey` | `FOREIGN KEY (kode_obat)` | **tidak bisa langsung** — lihat catatan |

- `stok_batch` sudah punya `cabang_id text NOT NULL`, jadi FK komposit bisa
  langsung dibuat tanpa perubahan lain.
- `refill_programs` juga sudah punya `cabang_id text NOT NULL` — aman.
- **`promo_bundle_items` tidak punya `cabang_id`** (dia anak dari `promo_bundles`,
  dan PK-nya `(bundle_id, kode_obat)`). FK komposit tidak bisa dibuat tanpa
  menambahkan `cabang_id` ke tabel itu (lalu menjaganya konsisten dengan
  `promo_bundles.cabang_id` lewat trigger), atau memindahkan validasinya ke
  trigger tanpa mengubah FK. Ini pekerjaan yang paling mudah terlewat.
- **`trx_penjualan_detail` dan `trx_pembelian_detail` tidak punya FK ke
  `master_barang`** — terverifikasi di daftar constraint lengkap. Jadi tidak ada
  yang perlu diubah, tapi juga berarti integritas `kode_obat` di detail transaksi
  hanya dijaga kode aplikasi. Kalau mau ditutup, tambahkan FK komposit di sini
  sekalian.

**FK yang mengacu ke `app_users(username)` — 3, relevan kalau PK `app_users`
dijadikan komposit:**

- `app_sessions.username`
- `trx_retur_beli.created_by`
- `trx_retur_beli.approved_by`

Ketiganya harus ikut berubah kalau `app_users` PK diubah jadi
`(cabang_id, username)`. Ini alasan tambahan untuk memilih tetap
`PK (username)` global (lihat bagian 6).

**FK yang mengacu ke `trx_penjualan(no_nota)` dan `trx_pembelian(no_faktur)` —
hanya berubah kalau PK dokumen dijadikan komposit:**

- ke `trx_penjualan(no_nota)`: `trx_penjualan_detail.no_nota`,
  `trx_retur_jual.no_nota_asal`, `promo_redemptions.invoice_no`
- ke `trx_pembelian(no_faktur)`: `trx_pembelian_detail.no_faktur`,
  `trx_retur_beli.no_faktur_asal`

**Koreksi penting: `trx_pembayaran_hutang.no_faktur` BUKAN FK.** Daftar constraint
lengkap menunjukkan tabel itu hanya punya `cabang_id_fkey`, PK `(id)`,
`UNIQUE (id, cabang_id)`, dan 3 CHECK. Tidak ada FK ke `trx_pembelian`. Jadi
integritas hutang ke faktur dijaga kode `hutang/index.ts` (yang memang selalu
memfilter `cabang_id` dari sesi). Dokumen versi sebelumnya menyebut kolom ini
sebagai FK — itu salah.

**Tidak ada FK ke `master_supplier` sama sekali** (lihat 3.2) — jadi kalau supplier
dipisah per cabang, FK-nya perlu **dibuat baru**, bukan diubah.

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

**Empat belas kolom** `cabang_id` punya default `'KARLA'` (bukan empat seperti
tertulis di versi sebelumnya dokumen ini — angka itu berasal dari snapshot yang
terpotong). Daftar lengkapnya, terverifikasi dari `kolom.csv`:

```
app_sessions.cabang_id              DEFAULT 'KARLA'     trx_penjualan.cabang_id             DEFAULT 'KARLA'
app_users.cabang_id                 DEFAULT 'KARLA'     trx_penjualan_detail.cabang_id      DEFAULT 'KARLA'
biaya_operasional.cabang_id         DEFAULT 'KARLA'     trx_retur_beli.cabang_id            DEFAULT 'KARLA'
master_customer.cabang_id           DEFAULT 'KARLA'     trx_retur_beli_detail.cabang_id     DEFAULT 'KARLA'
stok_batch.cabang_id                DEFAULT 'KARLA'     trx_retur_jual.cabang_id            DEFAULT 'KARLA'
stok_opname.cabang_id               DEFAULT 'KARLA'     trx_retur_jual_detail.cabang_id     DEFAULT 'KARLA'
trx_pembelian.cabang_id             DEFAULT 'KARLA'
trx_pembelian_detail.cabang_id      DEFAULT 'KARLA'
```

Sebelas tabel sisanya (`loyalty_*`, `notification_log`, `promo_*`, `referrals`,
`refill_programs`, `trx_pembayaran_hutang`) sudah `NOT NULL` **tanpa** default —
itu pola yang benar.

**Ini bukan sekadar masalah gaya — ini mekanisme di balik temuan 4 dan 6.**
Karena `cabang_id` selalu `NOT NULL` dan punya default `'KARLA'`, `retur.jualSimpan`
(`api:409`) dan `retur.beliSimpan` (`api:435`) yang menulis `trx_retur_jual` /
`trx_retur_beli` **tanpa** `cabang_id` tidak gagal — barisnya **berhasil disimpan
dan diam-diam masuk KARLA**, meskipun retur itu dilakukan di KENDAL. Versi
sebelumnya dokumen ini menulis "perlu diputuskan: apakah kolom `cabang_id` di
`trx_retur_jual` wajib diisi" — pertanyaan itu salah, karena kolomnya **sudah**
`NOT NULL`. Masalahnya adalah nilainya salah, bukan kosong.

Rencana: **hapus default-nya di keempat belas kolom itu** (`alter column ...
drop default`). Dengan default terpasang, satu `insert` yang lupa mengirim
`cabang_id` akan diam-diam mendarat di KARLA — persis jenis kesalahan yang sulit
ditemukan. Setelah default dihapus, `INSERT` yang lupa mengisi `cabang_id` akan
**langsung gagal** karena melanggar `NOT NULL`, sehingga bug-nya kelihatan pada
percobaan pertama, bukan setelah berbulan-bulan data salah.

Tambahan yang perlu dipertimbangkan: belum ada jaminan database bahwa
`trx_penjualan_detail.cabang_id` sama dengan `trx_penjualan.cabang_id` milik
`no_nota`-nya. Kolomnya ada di kedua tabel dan keduanya bisa diisi berbeda. Ini
kandidat trigger validasi (lihat 4.4).

### 4.4 Trigger

Isi `trigger.csv` (4 baris) sudah lengkap dan terverifikasi:

| Trigger | Tabel | Perlu berubah? |
|---|---|---|
| `trg_loyalty_set_tier` → `loyalty_set_tier()` | `master_customer` BEFORE INSERT/UPDATE | Tidak. Hanya menghitung `tier` dari `total_spend_mtd` |
| `trg_loyalty_after_sale` → `loyalty_after_sale()` | `trx_penjualan` AFTER INSERT | Tidak perlu diubah — **prasyaratnya sudah terbukti ada** (`uq_master_customer_cabang_wa UNIQUE (cabang_id, nomor_wa)`) |
| `trg_loyalty_after_return` → `loyalty_after_return()` | `trx_retur_jual` AFTER INSERT | Tidak perlu diubah. `NEW.cabang_id` sudah `NOT NULL` — tapi nilainya bisa salah karena default `'KARLA'` (lihat 4.3 + temuan 4) |
| `rls_auto_enable` (event trigger) | semua tabel baru di `public` | Tidak. Tetap dipertahankan; dia hanya `enable row level security` |

Catatan koreksi: versi sebelumnya dokumen ini menulis bahwa `trg_loyalty_after_sale`
"butuh unique `(cabang_id, nomor_wa)`" dan `trg_loyalty_after_return` "butuh
`NEW.cabang_id` NOT NULL". Keduanya **sudah terpenuhi** — index dan `NOT NULL`-nya
sudah ada di database. Yang jadi masalah bukan keberadaannya, melainkan **default
`'KARLA'`** yang membuat nilainya salah tanpa error.

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

- `policy.csv` memuat 33 policy, **semuanya di 15 tabel lama berbahasa Inggris**
  (terverifikasi lengkap — tidak ada policy tersembunyi di luar 33 baris itu):
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

**Keterbatasan yang jujur:** snapshot ini **tidak memuat status RLS** (kolom
`pg_class.relrowsecurity` tidak ikut diekspor). Jadi dari CSV kita bisa memastikan
"tidak ada policy untuk tabel aplikasi", tapi **tidak bisa memastikan** apakah RLS
sudah di-`enable` di tabel-tabel itu. Adanya event trigger `rls_auto_enable` (yang
otomatis menjalankan `alter table ... enable row level security` untuk setiap
`CREATE TABLE` baru di `public`) menunjukkan tabel baru kemungkinan besar sudah
RLS-aktif tapi tanpa policy — dan RLS aktif tanpa policy berarti **tidak ada
`authenticated`/`anon` yang bisa membaca**. Itu justru aman untuk aplikasi, karena
aplikasi lewat `service_role`. Tetap perlu dikonfirmasi dengan query langsung
sebelum migrasi:

```sql
select relname, relrowsecurity
from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
order by relrowsecurity, relname;
```

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
| 1 | `..._master_barang_per_cabang.sql` | kolom + FK cabang, PK komposit, salin 137×3, ganti 3 index lama |
| 2 | `..._master_supplier_per_cabang.sql` | kolom + FK cabang, PK & unique `(cabang_id, nama_supplier)` komposit, **buat** FK komposit baru dari `trx_pembelian` dan `trx_retur_beli` |
| 3 | `..._stok_batch_unik_per_cabang.sql` | unique `(cabang_id, kode_obat, kode_batch)`, FK komposit ke `master_barang`; `refill_programs`; penanganan `promo_bundle_items` |
| 4 | `..._cabang_id_wajib.sql` | hapus default `'KARLA'` di **14 kolom**; tambah unique `(cabang_id, no_nota)`/`(cabang_id, no_faktur)` kalau diputuskan |
| 5 | `..._pos_fungsi_cabang.sql` | kelima fungsi kasir + `drop function` overload lama |
| 6 | `..._rls_dan_hak_akses.sql` | `GRANT` + RLS + policy untuk tabel yang belum punya; `revoke execute` untuk fungsi `SECURITY DEFINER` |

Setiap file wajib memuat blok rollback sebagai komentar di akhir file.

### 4.7 Inventaris unique index (dari `index.csv`)

Semua unique index yang **bukan** PK, lengkap — ini yang harus diperiksa satu per
satu karena tidak muncul di `constraint.csv`:

| Tabel | Index | Kolom | Perlu berubah? |
|---|---|---|---|
| `master_customer` | `uq_master_customer_cabang_wa` | `(cabang_id, nomor_wa)` | **Tidak** — sudah per cabang |
| `master_cabang` | `master_cabang_nama_cabang_key` | `(nama_cabang)` | Tidak |
| `master_supplier` | `master_supplier_nama_supplier_key` | `(nama_supplier)` | **Ya** → `(cabang_id, nama_supplier)` |
| `stok_batch` | `stok_batch_kode_obat_kode_batch_key` | `(kode_obat, kode_batch)` | **Ya** → tambah `cabang_id` |
| `promo_bundles` | `promo_bundles_cabang_id_code_key` | `(cabang_id, code)` | Tidak — sudah per cabang |
| `promo_coupons` | `promo_coupons_cabang_id_code_key` | `(cabang_id, code)` | Tidak — sudah per cabang |
| `promo_redemptions` | `promo_redemptions_coupon_id_invoice_no_key` | `(coupon_id, invoice_no)` | Tidak |
| `promo_segment_targets` | `promo_segment_targets_unique_idx` | `(campaign_id, segment, COALESCE(customer_type,''))` | Tidak |
| `loyalty_redemptions` | `uq_loyalty_redemption_nota_reward` | `(no_nota, reward_id)` **parsial** `WHERE status='redeemed' AND no_nota IS NOT NULL` | Tidak |
| `trx_pembayaran_hutang` | `trx_pembayaran_hutang_faktur_cabang_key` | `(id, cabang_id)` | Tidak (redundan dengan PK) |
| `stock_batches` | `stock_batches_product_code_batch_code_key` | `(product_code, batch_code)` | Tidak (tabel lama, tidak dipakai) |
| `products` | `products_barcode_key` | `(barcode)` | Tidak (tabel lama) |
| `profiles` | `profiles_username_key` | `(username)` | Tidak (tabel lama) |

Index non-unique yang juga perlu perhatian karena dipakai jalur panas:

| Tabel | Index | Kondisi | Catatan |
|---|---|---|---|
| `stok_batch` | `idx_batch_fefo` | `(kode_obat, expired_date) WHERE stok_real > 0` | **Tidak memuat `cabang_id`**, padahal `pos_checkout` selalu memfilter `cabang_id`. Setelah isolasi, ubah jadi `(cabang_id, kode_obat, expired_date)` |
| `master_barang` | `idx_barang_aktif`, `idx_barang_barcode`, `idx_barang_nama` | lihat 3.3 | Perlu `cabang_id` |
| `master_supplier` | — | **tidak punya index selain PK & unique nama** | Setelah per cabang, tambahkan `(cabang_id, nama_supplier)` untuk `api:264` |

Catatan: `stok_batch` **sudah** punya `idx_stok_batch_cabang_obat (cabang_id, kode_obat)`
— jadi separuh jalan sudah benar. Yang perlu diperbaiki hanya index FEFO-nya.

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
Keduanya ada di database (`supabase/schema/fungsi.csv`). Versi lama **masih bisa dipanggil**
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

Fungsi ini relatif bersih dari sisi isolasi cabang: `JOIN master_customer c ON
c.id = p.customer_id AND c.cabang_id = p.cabang_id`, dan
`WHERE (p_cabang_id IS NULL OR p.cabang_id = p_cabang_id)`.

**Tapi fungsi ini sekarang tidak pernah bisa bekerja** — bukan karena isolasi
cabang, tapi karena dua tabrakan dengan CHECK constraint. Ini temuan baru dari
snapshot lengkap (temuan 15):

1. **Filter status tidak pernah cocok.** Fungsi memakai
   `WHERE p.status = 'ACTIVE'` (huruf besar), sedangkan
   `refill_programs_status_check` hanya mengizinkan `'active'`, `'paused'`,
   `'stopped'` (huruf kecil), kolomnya default `'active'`, dan index parsialnya
   pun `WHERE (status = 'active')`. Jadi `SELECT`-nya selalu mengembalikan **0
   baris** dan fungsi mengembalikan 0 tanpa error — gagal senyap.
2. **Nilai yang di-insert melanggar CHECK.** Bahkan kalau filter di poin 1
   diperbaiki, `INSERT`-nya menulis `channel = 'n8n'` dan `status = 'PENDING'`,
   sedangkan `notification_log_channel_check` hanya mengizinkan
   `'whatsapp'`, `'sms'`, `'email'` dan `notification_log_status_check` hanya
   mengizinkan `'sent'`, `'failed'`, `'delivered'`. Keduanya melanggar → fungsi
   akan melempar `check_violation`.
3. **`ON CONFLICT DO NOTHING` tidak berfungsi sebagai deduplikasi.**
   `notification_log` hanya punya PK `(id)` dengan default `gen_random_uuid()`,
   **tidak ada** unique constraint lain. Jadi `ON CONFLICT DO NOTHING` praktis
   tidak pernah aktif. Deduplikasi sebenarnya dilakukan klausa `NOT EXISTS ... 
   l.created_at >= date_trunc('day', now())` — itu sudah benar, dan setelah poin
   1–2 diperbaiki, klausa itulah yang mencegah pengiriman ganda dalam satu hari.

**Fitur refill secara keseluruhan sedang rusak** (semua karena salah besar/kecil
huruf yang sama), dan ini perlu diperbaiki bersamaan karena berada di satu alur:

| Lokasi | Kode sekarang | Akibat |
|---|---|---|
| `api:146` `refill.list` | `&status=eq.ACTIVE` | Daftar program refill **selalu kosong** (data tersimpan sebagai `'active'`) |
| `api:158` `refill.status` | PATCH `status: 'PAUSED'` / `'ACTIVE'` | **Gagal 400** — melanggar `refill_programs_status_check` |
| `api:168` `notification.pending` | `&status=eq.PENDING` | Selalu kosong (constraint hanya izinkan sent/failed/delivered) |
| `js_master.js:375` | menampilkan `r.Status==='ACTIVE'` | Frontend mengharapkan huruf besar, jadi frontend dan constraint DB **saling bertentangan** |
| `generate_refill_reminders` | `'ACTIVE'`, `'n8n'`, `'PENDING'` | Poin 1 dan 2 di atas |

Keputusan yang harus diambil: **mana yang jadi sumber kebenaran** — constraint DB
(huruf kecil) atau kode (huruf besar)? Rekomendasi: **ikuti constraint DB** karena
sudah ada data tersimpan (`default 'active'`) dan index parsial yang bergantung
padanya; artinya perbaiki kode (Edge Function + `generate_refill_reminders` +
`js_master.js`) menjadi huruf kecil. Alternatifnya mengubah 3 CHECK constraint —
lebih berisiko karena ada data lama yang harus dimigrasikan.

Yang berubah untuk isolasi cabang:

1. **Arti `NULL`**: sekarang `NULL` = semua cabang. Untuk isolasi, `NULL` hanya
   boleh dipakai oleh job internal (`service_role`). Pemanggilan dari aplikasi
   (`api:refill.generate`) harus **selalu** mengirim cabang sesi — dan sebaiknya
   parameter dijadikan wajib, bukan punya default.
2. **Pesan**: teksnya `'...Silakan hubungi Apotek Fa-Mitra...'` tanpa nama cabang.
   Tambahkan nama cabang (join ke `master_cabang`) supaya pelanggan Pucuk tidak
   diarahkan ke Karla.
3. **Barang**: `refill_programs.kode_obat` sudah punya FK ke `master_barang`
   (`refill_programs_kode_obat_fkey`) — FK itu harus jadi komposit
   `(cabang_id, kode_obat)` (lihat 4.2).
4. **Otorisasi**: cabut `EXECUTE` dari `anon`/`authenticated`; panggil hanya dari
   Edge Function dengan `service_role`.
5. **Validasi tambahan**: `refill_programs_cycle_days_check` hanya mengizinkan
   `30`, `60`, `90`, sedangkan `api:151` mengirim
   `cycle_days: Math.max(1, Number(data.cycle_days || 30))` — nilai seperti 45 akan
   ditolak database. Batasi pilihan di form (`js_master.js:325` memakai
   `<input type="number" min="1">`) menjadi dropdown 30/60/90.

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
| `generate_refill_reminders` | Param `NULL` = semua cabang | — (sudah join cabang) | Tidak | jadikan cabang wajib dari aplikasi; **perbaiki 2 tabrakan CHECK + 1 filter status (temuan 15)** |
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

### 7.2 Lima belas temuan (urut keparahan)

Temuan 1–14 berasal dari audit sebelumnya dan **diverifikasi ulang** saat dokumen
ini ditulis — nomor barisnya masih sama persis, dan kini diperiksa terhadap snapshot
**lengkap** (bukan lagi snapshot terpotong). Temuan 15 baru ditemukan pada
verifikasi lengkap ini.

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
   rusak (lihat temuan 8). Karena `trx_retur_jual.cabang_id` sudah `NOT NULL`
   dengan **default `'KARLA'`**, penulisan itu tidak gagal — retur yang dilakukan
   di KENDAL **tersimpan sebagai milik KARLA**, dan trigger
   `loyalty_after_return` lalu menyesuaikan poin pelanggan di KARLA, bukan di
   KENDAL. Ini kerusakan data lintas cabang yang senyap.
5. **`api:420/428/445` `retur.beli*`** — faktur, retur beli, dan approve tanpa
   filter cabang. Role: Owner.
6. **`api:432/435` `retur.beliSimpan`** — faktur cabang lain bisa diretur, dan
   `trx_retur_beli` ditulis **tanpa `cabang_id`** → karena default `'KARLA'`,
   retur beli itu diam-diam tercatat milik KARLA (mekanisme sama seperti temuan 4).
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
15. **Fitur refill & notifikasi rusak total karena salah besar/kecil huruf** (baru,
    dari snapshot lengkap). `generate_refill_reminders` memakai `status='ACTIVE'`
    padahal constraint-nya `'active'` → 0 baris terpilih; dan menulis
    `channel='n8n'`, `status='PENDING'` yang keduanya melanggar CHECK constraint
    `notification_log` → `check_violation`. Di sisi Edge Function, `api:146`
    `refill.list` memfilter `status=eq.ACTIVE` (selalu kosong), `api:158`
    `refill.status` menulis `'PAUSED'`/`'ACTIVE'` (ditolak constraint), dan
    `api:168` `notification.pending` memfilter `status=eq.PENDING` (selalu kosong).
    Rincian dan rekomendasi arah perbaikan ada di bagian 5.3.
    **Temuan ini tidak berkaitan dengan isolasi cabang**, tapi ditemukan saat
    verifikasi ulang karena satu-satunya cara menemukannya adalah membandingkan
    definisi fungsi dengan constraint lengkap.

Catatan metode: temuan 8–10 bergantung pada string filter yang salah tulis. Itu
diverifikasi tiga cara (ordinal karakter, pencarian literal, dump byte) karena
pembacaan pertama sempat tidak konsisten. File memang berisi `id_batq.` (1×) dan
`kode_batq.` (5×). **Temuan ini masih ada di kode saat ini dan belum diperbaiki.**

Temuan 15 diverifikasi dengan membandingkan tiga sumber: definisi fungsi di
`fungsi.csv`, nilai CHECK constraint di `constraint.csv`, dan nilai `DEFAULT` di
`kolom.csv`. Ketiganya konsisten menunjukkan tabrakan huruf besar/kecil.

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
  Ini tetap perlu meski `index.csv` sudah ada, karena snapshot CSV tidak memuat
  definisi policy lengkap, hak `GRANT`, status RLS, dan urutan dependensi objek.
- Sudah tersedia dari snapshot lengkap dan **tidak perlu dicari lagi**: seluruh
  unique index (lihat 4.7), seluruh FK ke `master_barang` (3) dan ke
  `master_supplier` (0), serta isi CHECK constraint `notification_log`.
- Yang **masih harus diambil langsung dari database**:
  ```sql
  -- status RLS per tabel (tidak ada di snapshot)
  select relname, relrowsecurity from pg_class
   where relnamespace = 'public'::regnamespace and relkind = 'r'
   order by relrowsecurity, relname;
  -- hak EXECUTE atas fungsi SECURITY DEFINER
  select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE')
    from pg_proc p cross join (values ('anon'),('authenticated'),('service_role')) r(rolname)
   where p.pronamespace = 'public'::regnamespace order by p.proname, r.rolname;
  ```
- Verifikasi jumlah awal: `select count(*) from master_barang` (harus 137),
  `select count(*) from master_supplier`, `select kode_cabang from master_cabang`.
- **Verifikasi temuan 15 sebelum memperbaiki apa pun** (bukti dari data nyata,
  bukan dari pembacaan kode):
  ```sql
  select status, count(*) from public.refill_programs group by 1;   -- semua 'active'?
  select count(*) from public.notification_log;                     -- pernah terisi?
  select count(*) from public.refill_programs
   where status = 'ACTIVE';                                         -- harus 0 (huruf besar)
  ```
  Kalau baris pertama menunjukkan `active` dan baris ketiga 0, temuan 15 terkonfirmasi
  pada data produksi.

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
| T36 | `refill.list` setelah perbaikan huruf | daftar program refill **terisi** (sekarang selalu kosong) | 15 |
| T37 | `refill.status` (jeda/aktifkan) | berhasil, tidak lagi 400 check_violation | 15 |
| T38 | `refill.generate` di KENDAL | baris `notification_log` benar-benar bertambah, `cabang_id` = KENDAL, `channel`/`status` sesuai constraint | 15 |
| T39 | `refill.generate` dijalankan dua kali di hari yang sama | yang kedua menambah 0 baris (bukti dedup `NOT EXISTS` bekerja) | 15 |
| T40 | `select relname, relrowsecurity from pg_class ...` | setiap tabel aplikasi terdaftar status RLS-nya, dan `anon`/`authenticated` tidak punya `EXECUTE` atas fungsi `SECURITY DEFINER` | 4.5 |

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

Semua uji T1–T40 lulus, regresi Tahap 4 identik, tidak ada error konsol, dan check
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
   Catatan baru: hari ini **tidak ada FK sama sekali** dari `trx_pembelian` /
   `trx_retur_beli` ke `master_supplier`, jadi memisahkannya per cabang berarti
   menambah FK baru — bukan sekadar mengubah yang ada.
4. **Nomor faktur pembelian**: tetap unik global, atau diberi prefix cabang seperti
   nota penjualan? Catatan baru: PK `trx_pembelian` tetap `(no_faktur)` global, dan
   **tidak ada** unique index `(cabang_id, no_faktur)` — jadi keunikan per cabang
   harus dijamin kode kalau tidak ditambahkan index.
5. **Username**: tetap unik global (`owner.karla`, `owner.kendal`), atau per cabang?
   Catatan baru: mengubah PK `app_users` jadi `(cabang_id, username)` berarti harus
   mengubah **3 FK** sekaligus (`app_sessions.username`, `trx_retur_beli.created_by`,
   `trx_retur_beli.approved_by`) plus alur login `api:95`. Rekomendasi tetap global.
6. **Tabel lama berbahasa Inggris** (`products`, `sales`, `stock_batches`,
   `customers`, `suppliers`, `profiles`) dan fungsi `create_sale_with_fefo`:
   dipensiunkan atau dibiarkan? Ini butuh izin karena berarti menghapus sesuatu.
   Catatan baru: tabel lama itu masih punya 33 policy RLS dan `profiles` masih
   direferensikan oleh `operating_expenses`, `purchases`, `sales`, dan
   `stock_counts` (FK ke `profiles(id)`), jadi tidak bisa dihapus sembarangan.
7. **RLS**: tetap model `service_role` (Model A), atau mulai migrasi ke Supabase
   Auth + claim `cabang_id` (Model B)?
8. **Cabang baru**: kalau nanti ada cabang kelima, apakah cukup insert ke
   `master_cabang` + salin 137 barang (jalankan ulang migrasi 1 untuk cabang itu)?
9. **Temuan 15 (refill/notifikasi rusak)**: dikerjakan bersamaan dengan migrasi
   isolasi cabang, atau jadi PR terpisah? Rekomendasi: **PR terpisah** — temuan ini
   tidak ada hubungannya dengan isolasi cabang, dan mencampurnya membuat PR isolasi
   sulit ditinjau. Kalau dipisah, cukup dicatat dulu di sini.
10. **Besar/kecil huruf status**: mana yang jadi sumber kebenaran — constraint DB
    (huruf kecil `active`) atau kode (huruf besar `ACTIVE`)? Rekomendasi: ikuti
    constraint DB dan perbaiki kode (lihat 5.3).
11. **`promo_bundle_items`**: tambahkan kolom `cabang_id` (dijaga trigger agar sama
    dengan `promo_bundles.cabang_id`), atau pindahkan validasi barang-bundle ke
    trigger tanpa mengubah FK? Lihat 4.2.

---

## 11. Yang tidak dikerjakan di PR ini

- Tidak ada perubahan kode (`public/*.js`, `public/index.html`,
  `supabase/functions/*`).
- Tidak ada file migrasi baru (`supabase/migrations/`) — hanya rencana.
- Tidak ada `db push`, tidak ada deploy Edge Function, tidak ada
  `wrangler pages deploy`.
- Tidak ada perubahan skema, policy RLS, atau hak akses.
- Tidak ada merge ke `main`.

Isi PR: `supabase/schema/*.csv` (6 file: 5 snapshot + `index.csv`, backup struktur
sementara) + `supabase/schema/baseline.sql` (placeholder) + dokumen ini. Folder
`schema/` yang lama sudah dihapus (isinya dipindahkan ke `supabase/schema/`).
