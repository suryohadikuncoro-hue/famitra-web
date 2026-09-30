# AGENTS.md

Panduan untuk AI agent (Hermes) yang bekerja di repository ini.
Baca seluruh file ini sebelum mengubah kode apa pun.

## Tentang Project

- Nama: SI-FaMitra (Sistem Informasi Apotek Fa-Mitra)
- Fungsi: POS/kasir, transaksi & retur, hutang, master data, dashboard, promo/kupon, loyalty, lottery, target marketing, dan asisten AI untuk Owner
- Frontend: HTML + CSS + JavaScript murni (vanilla), TANPA framework dan TANPA build step
- Package manager: tidak ada (tidak ada package.json). Jangan menambahkan framework, bundler, atau npm dependency tanpa izin.
- Backend: lima Supabase Edge Functions (`api`, `promo`, `lottery`, `marketing`, `hutang`) + Postgres
- Asisten AI: webhook n8n (`window.AI_CFG` di `public/index.html`)
- Hosting: Cloudflare Pages, project `famitra-web`, alamat production: https://famitra-web.pages.dev (tanpa custom domain)
- Repository: GitHub, branch utama `main`

## Struktur File

- `public/` - SELURUH file website (hanya folder ini yang dipublikasikan oleh Cloudflare Pages):
  - `index.html` - halaman utama, layar login, dan konfigurasi `window.AI_CFG`
  - `style.css` - seluruh styling
  - `js_core.js` - inti: URL Edge Function, pemanggil API, sesi login, modal, utilitas
  - `js_pos.js` - kasir / point of sale
  - `js_trx.js` - transaksi, retur, hutang
  - `js_master.js` - master data (obat, pelanggan, dll.)
  - `js_dashboard.js` - dashboard dan ringkasan AI
  - `js_ai.js` - chat asisten AI (khusus Owner)
  - `js_marketing_target.js` - target omset marketing
  - `js_marketing_lottery.js` - campaign, peserta, dan pemenang lottery
  - `js_marketing_poin.js` - Poin & Reward untuk Owner
  - `js_mobile.js` - perilaku/responsiveness mobile
- File di luar `public/` (AGENTS.md dan `supabase/`) tidak dipublikasikan sebagai frontend. Jangan pernah mengubah build output directory ke root repo.
- `supabase/functions/` - source lima Edge Functions: `api`, `promo`, `lottery`, `marketing`, dan `hutang`
- `supabase/migrations/` - seluruh perubahan schema/database; migration lama tetap dipertahankan setelah diterapkan
- `supabase/config.toml` - konfigurasi Supabase CLI project
- `supabase/.temp/` adalah cache CLI, jangan di-commit (masukkan ke .gitignore).

## Cara Menjalankan & Mengetes

Tidak ada proses build. Untuk tes lokal jalankan server statis dari folder public:

```bash
python -m http.server 8080 --directory public
# lalu buka http://localhost:8080
```
(Di laptop ini perintahnya `python`, bukan `python3`.)
- Setelah edit frontend, buka halaman di browser dan pastikan tidak ada error di console.
- Tes alur yang terdampak secara manual: login, kasir, transaksi, retur, marketing, dan hak akses role.
- Sebelum menghapus atau mengganti automated test, pastikan coverage yang hilang dicatat di PR dan disetujui reviewer.

- Supabase CLI dan Wrangler TIDAK terinstall global. Selalu pakai lewat npx:
  - `npx supabase ...` (contoh: `npx supabase projects list`, `npx supabase functions serve`)
  - `npx wrangler ...` (contoh: `npx wrangler whoami`)
- Deploy Edge Function: `npx supabase functions deploy <nama>` (butuh izin eksplisit).

## Alur Kerja Wajib

1. Jangan pernah commit atau push langsung ke `main`.
2. Selalu buat branch baru: `git checkout -b <jenis>/<deskripsi-singkat>` (`feat/`, `fix/`, `refactor/`, `chore/`)
3. Perubahan kecil dan fokus. Jangan refactor atau memindahkan kode yang tidak diminta.
4. Pertahankan gaya kode yang ada (fungsi global, `var`, nama fungsi berbahasa Indonesia seperti `prosesLogin`, `modalTutup`).
5. Commit dengan pesan jelas, contoh: `fix: perbaiki perhitungan diskon di kasir`
6. Buka Pull Request dengan `gh pr create`, sertakan ringkasan dan cara mengetes.
7. Jangan merge PR sendiri. Tunggu review dan persetujuan pemilik project.
8. Sebelum menyatakan pekerjaan selesai, verifikasi working tree, branch remote, dan status checks PR.

## Aturan Database (Supabase)

- Project ref: `xixhazawndmgqzstfjnq`
- Semua perubahan skema lewat file migrasi di `supabase/migrations/`, bukan edit langsung di dashboard.
- Jangan jalankan `npx supabase db push` atau deploy Edge Function ke production tanpa izin eksplisit.
- Dilarang `DROP TABLE`, `TRUNCATE`, atau `DELETE` tanpa `WHERE`.
- Mulai 30 Oktober 2026, tabel baru di schema `public` tidak otomatis bisa diakses. Setiap migrasi yang membuat tabel baru WAJIB menyertakan dalam migrasi yang sama:
  1. `GRANT` eksplisit (minimal ke `service_role`, karena Edge Functions memakainya; `anon`/`authenticated` hanya jika memang dibutuhkan)
  2. `alter table ... enable row level security;`
  3. Policy yang jelas
- Jangan pernah memberi akses `anon` ke data pasien, pelanggan, transaksi, atau hutang.
- Sebelum migrasi production, bandingkan migration history dengan repository dan siapkan query verifikasi/rollback.

## Aturan Deploy (Cloudflare Pages)

- Pengaturan build ada di dashboard Cloudflare Pages (bukan di repo): build command KOSONG, build output directory `public`.
- Jangan menambahkan `wrangler.jsonc`/`wrangler.toml`, `package.json`, atau file build lain tanpa izin, karena bisa mengubah cara Pages melakukan build.
- Setiap push ke branch selain `main` membuat preview; preview tidak mengubah production.
- Merge ke `main` = deploy ke PRODUCTION (https://famitra-web.pages.dev) yang dipakai apotek. Jangan merge sendiri.
- Check "Cloudflare Pages" di setiap PR harus sukses sebelum menyatakan pekerjaan selesai.
- Preview memakai database Supabase yang SAMA dengan production. Saat mengetes preview, jangan membuat/mengubah/menghapus data sungguhan.
- Jangan jalankan `npx wrangler pages deploy` secara manual tanpa izin eksplisit.
- Jangan membaca file kredensial/token (misalnya config wrangler) atau menampilkan environment variables. Jika butuh info dari dashboard Cloudflare, minta pemilik project.

## Keamanan

- Kode frontend bersifat publik. Jangan pernah menaruh `service_role key`, token, atau password di file HTML/JS.
- Secret hanya disimpan di environment Supabase Edge Functions atau n8n.
- Otorisasi (siapa boleh melakukan apa) harus dicek di Edge Function, bukan hanya disembunyikan di frontend.
- Jika menemukan secret yang ter-commit, berhenti dan laporkan ke pemilik project.

## Kapan Harus Bertanya Dulu

Berhenti dan minta konfirmasi sebelum:
- Menghapus file atau fitur
- Menambah library, framework, atau build tool
- Mengubah skema database, policy RLS, atau Edge Function
- Mengubah alur login, hak akses role, atau URL di `js_core.js` / `window.AI_CFG`
- Melakukan apa pun yang menyentuh production

## Panduan Penggunaan DeepSeek Harness

DeepSeek Harness dapat digunakan untuk meninjau dan mengubah kode dalam repository ini. Semua aturan di `AGENTS.md` tetap berlaku saat pekerjaan dilakukan melalui Harness.

### Memilih workspace dan menyiapkan repo

- Pilih folder utama repository `famitra-web` sebagai workspace—folder yang berisi `AGENTS.md`, `public/`, dan `supabase/`. Jangan memilih hanya subfolder `public/` atau folder lain di dalam repo.
- Sebelum mulai, periksa branch aktif dan kondisi perubahan lokal dengan `git status --short --branch`.
- Jika repo perlu disinkronkan dengan GitHub, periksa dan amankan perubahan lokal terlebih dahulu. Jangan gunakan `git reset --hard`, `git clean`, atau perintah lain yang dapat membuang perubahan lokal tanpa persetujuan eksplisit.
- Jangan bekerja langsung di `main`. Ikuti alur kerja branch dan Pull Request yang ditetapkan di bagian **Alur Kerja Wajib**.

### Cara memberikan tugas kepada Harness

- Mulai dengan permintaan baca-saja untuk memahami struktur repo, alur terkait, dan aturan dalam `AGENTS.md`.
- Minta Harness mengerjakan satu perubahan atau lingkup fitur yang jelas dalam satu tugas. Sertakan tujuan dan kriteria penerimaan yang dapat diuji.
- Minta Harness menjelaskan file yang akan diubah, risiko, dan rencana pengujian sebelum perubahan yang melibatkan alur penting.
- Setelah perubahan, tinjau `git diff` dan `git status`; pastikan hanya file yang relevan berubah. Jalankan pengujian yang sesuai dan ikuti alur branch/PR yang berlaku.
- Jangan menganggap ringkasan atau hasil dari Harness sebagai pengganti review kode dan verifikasi hasil.

### Protokol tugas agar efisien (wajib)

Tujuannya: satu tugas selesai dengan sesedikit mungkin putaran bolak-balik, tanpa
mengorbankan aturan keselamatan di bagian atas. Pemilik project hanya perlu
meninjau dan merge.

1. **Rekon dulu, baru menyimpulkan.** Periksa kenyataan di repo dan di
   production/preview (isi berkas yang benar-benar disajikan, isi `menus`/`PERM`,
   daftar PR dan branch). Jangan menyampaikan dugaan atau ingatan sebagai temuan.
2. **Periksa PR dan branch terbuka sebelum menulis kode** (`gh pr list --state open`),
   supaya tidak menduplikasi pekerjaan yang sudah jalan di PR lain.
3. **Satu ronde keputusan.** Semua yang butuh persetujuan pemilik (lingkup, hak
   akses role, Edge Function, migrasi, deploy) ditanyakan sekaligus di awal,
   bukan menyusul di tengah pekerjaan.
4. **Harness menyelesaikan sendiri sampai PR terbuka.** Edit, uji, verifikasi,
   commit, `git push`, lalu `gh pr create`. Jangan menyerahkan perintah git/gh
   kepada pemilik project. Bila push gagal karena batasan sandbox, coba sekali
   dengan izin lebih luas; hanya jika masih gagal, serahkan satu perintah siap tempel.
5. **Pastikan branch berada di atas `main` terbaru sebelum push.** Perhatikan
   metode merge PR sebelumnya: squash-merge membuat commit lama tidak lagi menjadi
   leluhur `main`, sehingga `git fetch origin` + rebase wajib dilakukan sebelum
   membuat branch baru.
6. **Satu blok perintah untuk pemilik, dalam sintaks cmd.exe.** Pemilik memakai
   Command Prompt: satu perintah per baris, tanpa penyambung baris `\`, tanpa
   backtick. Urutannya sudah benar dan lengkap (mis. merge dulu, deploy kemudian).
7. **Sebutkan langkah lanjutan tanpa diminta.** Setelah PR dibuat dan setelah PR
   di-merge, sampaikan apakah perlu `npx supabase functions deploy <nama>`,
   `npx supabase db push`, atau tidak perlu apa pun. Bila tidak perlu, nyatakan
   bahwa perubahan sudah live di production, atau bahwa berkas di luar `public/`
   tidak dipublikasikan sehingga perilaku aplikasi tidak berubah.
8. **Verifikasi sendiri yang bisa diperiksa sendiri** ke aset live (production,
   preview, respons Edge Function); jangan membebankan pengecekan itu kepada pemilik.
9. **Tetap dilarang tanpa persetujuan eksplisit:** merge PR, deploy Edge Function,
   `db push`, deploy Cloudflare Pages, atau tindakan lain yang menyentuh production.

### Keamanan dan lingkungan produksi

- Jangan menempelkan API key, `service_role` key, token, password, atau kredensial lain ke prompt, percakapan, atau file frontend.
- Jangan memasukkan data pelanggan, transaksi, atau data sensitif production ke prompt maupun lingkungan pengujian.
- Preview Cloudflare Pages menggunakan database Supabase yang sama dengan production. Jangan menguji dengan membuat, mengubah, atau menghapus data sungguhan melalui preview.
- Jangan meminta atau mengizinkan Harness menjalankan migrasi, mengubah database, deploy Edge Function, deploy Cloudflare Pages, merge ke `main`, atau melakukan tindakan lain yang menyentuh production tanpa persetujuan eksplisit.
- Untuk perubahan database atau production, ikuti seluruh prosedur pemeriksaan, pengujian, persetujuan, dan verifikasi yang ditetapkan dalam `AGENTS.md`.
