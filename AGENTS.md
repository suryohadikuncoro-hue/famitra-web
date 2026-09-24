# AGENTS.md

Panduan untuk AI agent (Hermes) yang bekerja di repository ini.
Baca seluruh file ini sebelum mengubah kode apa pun.

## Tentang Project

- Nama: SI-FaMitra (Sistem Informasi Apotek Fa-Mitra)
- Fungsi: POS/kasir, transaksi & retur, hutang, master data, dashboard, promo/kupon, asisten AI untuk Owner
- Frontend: HTML + CSS + JavaScript murni (vanilla), TANPA framework dan TANPA build step
- Package manager: tidak ada (tidak ada package.json). Jangan menambahkan framework, bundler, atau npm dependency tanpa izin.
- Backend: Supabase Edge Functions (`api`, `promo`, `hutang`) + Postgres
- Asisten AI: webhook n8n (`window.AI_CFG` di `index.html`)
- Hosting: Cloudflare Pages (situs statis)
- Repository: GitHub, branch utama `main`

## Struktur File

- `index.html` - halaman utama, layar login, dan konfigurasi `window.AI_CFG`
- `style.css` - seluruh styling
- `js_core.js` - inti: URL Edge Function, pemanggil API, sesi login, modal, utilitas
- `js_pos.js` - kasir / point of sale
- `js_trx.js` - transaksi, retur, hutang
- `js_master.js` - master data (obat, pelanggan, dll.)
- `js_dashboard.js` - dashboard dan ringkasan AI
- `js_ai.js` - chat asisten AI (khusus Owner)
- `supabase/` - Edge Functions dan migrasi database
  - Catatan: saat ini hanya function `promo` yang ada di repo. Function `api` dan `hutang` sudah ter-deploy di Supabase tapi kodenya belum ada di repo.
  - `supabase/.temp/` adalah cache CLI, jangan di-commit (masukkan ke .gitignore).

## Cara Menjalankan & Mengetes

Tidak ada proses build. Untuk tes lokal cukup jalankan server statis dari root repo:

```bash
python3 -m http.server 8080
# lalu buka http://localhost:8080
```

- Setelah edit, buka halaman di browser dan pastikan tidak ada error di console.
- Tes alur yang terdampak (login, kasir, transaksi, dsb.) secara manual.
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
7. Jangan merge PR sendiri. Tunggu review pemilik project.

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

## Aturan Deploy (Cloudflare Pages)

- Situs statis: build command kosong, output directory = root repo.
- Deploy production otomatis saat PR di-merge ke `main`.
- Cek preview deployment setiap PR sebelum menyatakan pekerjaan selesai.
- Jangan deploy manual ke production tanpa izin.

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
