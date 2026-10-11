# ⛔ PERINGATAN KERAS — DATA PRODUCTION

**Wajib dibaca sebelum menjalankan perintah apa pun di repositori ini.**

Repositori ini terhubung ke **database production yang sedang dipakai apotek setiap hari**, dan
**preview Cloudflare Pages memakai database yang SAMA** — tidak ada lingkungan uji terpisah.
Satu perintah yang salah dapat langsung:

- menghapus atau mengubah data penjualan, pembelian, dan stok yang sah;
- mengubah modal barang sehingga HPP, laba, dan margin seluruh cabang menjadi salah;
- membuat laporan keuangan, target marketing, dan insentif karyawan tidak dapat dipercaya;
- merusak riwayat nota yang **tidak dapat dikembalikan** (tidak ada undo untuk data yang sudah tertimpa).

> Kejadian awal Oktober 2026 adalah contoh nyata: perbaikan modal barang yang dikerjakan manual
> hilang tertimpa perhitungan ulang sistem, dan penjualan mencatat laba 100% (palsu) selama beberapa hari.
> Perinciannya ada di `docs/perhitungan-ulang-modal-batch.md`.

---

## 1. DILARANG — tanpa izin eksplisit pemilik

| Dilarang | Contoh |
|---|---|
| Mengubah skema / menjalankan migrasi ke production | `npx supabase db push`, SQL DDL manual di dashboard |
| Deploy Edge Function | `npx supabase functions deploy ...` |
| Deploy frontend ke production | `npx wrangler pages deploy`, **merge PR ke `main`** |
| Menulis / mengubah / menghapus data | `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `DROP`, atau memanggil endpoint tulis (`beli.simpan`, `beli.batal`, `stok.simpanBatch`, `pos.checkout`, `opname.simpan`, dll.) |
| Menguji alur tulis lewat preview | preview memakai database production — membuat nota/faktur uji berarti mengotori data asli |
| Menjalankan skrip atau perkakas yang menulis data | skrip apa pun dengan `service_role`, `curl`/`fetch` ke endpoint tulis |
| Mengubah hak akses / RLS / grant | termasuk menambah grant tulis untuk user analitik |
| Membaca atau menempelkan kredensial | isi `supabase/.temp/**`, token, `service_role key` — jangan dibaca, disalin, atau ditempel ke percakapan |

---

## 2. YANG BOLEH — baca saja

- Kanal baca analitik read-only: `node tools/analitik.cjs ...` (hanya view `v_analitik_*`).
- `git status`, `git fetch`, `git log`, `git diff`, dan membaca berkas.
- Server statis lokal: `python -m http.server 8080 --directory public`.
  **Jangan** mengarahkan `window.API_URL` / `window.AI_CFG` ke production untuk menguji alur tulis.

---

## 3. ATURAN KERAS

1. **Data production hanya boleh diubah lewat aplikasi**, oleh Apoteker/Owner, berdasarkan bukti fisik
   (faktur asli, hasil hitung stok). **Tidak** lewat skrip, SQL, atau "sekalian dibetulkan".
2. **Bila menemukan data yang salah: LAPORKAN, jangan perbaiki sendiri.** Tulis temuan + bukti,
   lalu serahkan kepada pemilik untuk diputuskan.
3. **Perubahan kode hanya lewat Pull Request.** Jangan commit/push langsung ke `main`,
   jangan merge PR sendiri.
4. **Berhenti dan minta izin** sebelum menjalankan perintah apa pun yang menyentuh Supabase
   atau Cloudflare — walaupun hanya "coba-coba" atau "hanya membaca sekilas".
5. **Jangan pernah menyalin data production ke berkas yang di-commit.** Laporan yang memuat data
   production disimpan di `laporan-analitik/` dan `sop/`, yang memang di-exclude dari git.
6. **Setiap `DELETE`/`UPDATE` wajib memakai `WHERE`** dan sudah diverifikasi sasarannya.
   `DROP TABLE` dan `TRUNCATE` dilarang.

---

## 4. AWAS — sistem dapat menimpa nilai yang sudah diperbaiki manual

Modal barang (HPP) dapat **dihitung ulang otomatis oleh sistem** ketika faktur pembelian
disimpan, diubah, atau dibatalkan. Nilai yang diisi manual di **Stok & Batch tidak dilindungi**
dan dapat hilang tanpa notifikasi maupun riwayat.

Konsekuensinya penting:

- Memperbaiki modal **lewat skrip atau langsung ke database bukan hanya berisiko — hasilnya juga
  bisa hilang sendiri** pada input faktur berikutnya untuk barang yang sama.
- Perbaikan harus dilakukan pada **sumbernya**: faktur pembelian dan Modal di Master Barang,
  melalui aplikasi, oleh petugas yang berwenang.

Mekanisme lengkap, daftar risiko, dan usulan pengaman: **`docs/perhitungan-ulang-modal-batch.md`**.

---

## 5. Bila ragu

**Berhenti. Tanya pemilik.** Tidak ada tenggat yang lebih penting daripada menjaga data apotek tetap utuh.

---

*Terakhir diperbarui: 2026-10-10*
