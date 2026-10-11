# Perhitungan Ulang Modal oleh Sistem — Penjelasan & Pengaman

**Tanggal:** 2026-10-10 · **Sifat:** dokumen teknis (tanpa data production)
**Pertanyaan yang dijawab:** mengapa sistem menghitung ulang modal barang, dan bagaimana supaya perbaikan manual di Stok & Batch tidak hilang lagi.

> ⚠️ Baca juga [`PERINGATAN-DATA-PRODUCTION.md`](../PERINGATAN-DATA-PRODUCTION.md).
> Dokumen ini menjelaskan **mengapa** data modal bisa berubah sendiri — penting sebelum menyimpulkan
> ada data yang "rusak" lalu memperbaikinya secara manual.

---

## 1. Jawaban singkat

Sistem memang **menghitung ulang modal batch secara otomatis** setiap kali ada faktur pembelian yang **disimpan, diubah, atau dibatalkan** — dan perhitungan itu mengambil angka dari **baris faktur**, bukan dari nilai yang kita isi manual di Stok & Batch.

Artinya: **nilai yang diisi manual di Stok & Batch tidak dilindungi.** Nilai itu akan ditimpa oleh faktur, tanpa pemberitahuan dan tanpa riwayat.

Cakupannya juga lebih luas dari yang terlihat: menyimpan **satu** faktur untuk barang X akan menghitung ulang modal **semua batch barang X** di cabang itu.

---

## 2. Di mana tepatnya perhitungan ulang itu terjadi

Fungsinya bernama `purchase_refresh_costs` (berkas `supabase/migrations/20261009130000_pembelian_diskon_hutang_atomik.sql`, baris 159–264). Isinya:

```sql
-- ambil harga efektif dari setiap baris faktur AKTIF, per (barang, batch)
WITH per_invoice_batch AS ( ... sum(purchase_effective_unit_cost(...) * qty) / sum(qty) ... ),
     latest_batch AS ( SELECT DISTINCT ON (cabang_id, kode_obat, batch_key) ... ORDER BY timestamp DESC, no_faktur DESC )
UPDATE public.stok_batch s
   SET harga_modal_batch = latest_batch.modal,
       harga_modal_batch_terakhir = latest_batch.modal,   -- ikut ditimpa (lihat bagian 5)
       updated_at = now()
  FROM latest_batch
 WHERE s.cabang_id = latest_batch.cabang_id
   AND s.kode_obat = latest_batch.kode_obat
   AND coalesce(s.kode_batch,'') = latest_batch.batch_key;

-- faktur yang tidak lagi aktif → modal dikosongkan
UPDATE public.stok_batch s
   SET harga_modal_batch_terakhir = coalesce(s.harga_modal_batch_terakhir, s.harga_modal_batch),
       harga_modal_batch = NULL
 WHERE ... AND NOT EXISTS ( ... p.status = 'AKTIF' ... );
```

Fungsi ini dipanggil di **tiga tempat**, semuanya di dalam transaksi Pembelian:

| # | Pemicu (pekerjaan petugas) | Baris kode |
|---|---|---|
| 1 | **Simpan faktur baru** (`purchase_save`) | baris 355 |
| 2 | **Ubah faktur** (`purchase_update`) | baris 403 |
| 3 | **Batalkan faktur** (`purchase_cancel`) | baris 450 |

Ditambah **satu perhitungan ulang massal sekali jalan** saat migrasi 9 Oktober 2026 diterapkan (baris 588–676 berkas yang sama, dan baris 232–247 di `20261009150000_purchase_discount_percent_repair.sql`). Inilah yang menghapus perbaikan manual 5 Oktober.

**Penulis lain yang juga mengubah modal batch** (perlu diketahui):

| Penulis | Berkas | Sifat |
|---|---|---|
| Simpan/ubah faktur (jalur lama) | `20261008010000_...` baris 236–245 & 446–455 | otomatis saat faktur disimpan |
| Ubah faktur — hitung selisih | `20261008120000_...` baris 243–251 (`harga_modal_batch = coalesce(d.harga_netto, s.harga_modal_batch)`) | otomatis saat faktur diubah |
| Form **Stok & Batch → Simpan batch** | `supabase/functions/api/index.ts` baris 592–612 | manual (satu-satunya jalur manual) |

Kolom yang ditulis oleh perhitungan otomatis:
`stok_batch.harga_modal_batch`, `stok_batch.harga_modal_batch_terakhir`, `master_barang.harga_modal`, `master_barang.harga_modal_terakhir`.

Yang **tidak** disentuh: jumlah stok, harga jual (kecuali faktur memang membawa kolom "harga jual baru"), dan seluruh nota penjualan yang sudah terjadi.

---

## 3. Mengapa fitur ini dibuat

Perhitungan ulang itu **tidak muncul begitu saja** — ia dibuat untuk memperbaiki masalah sebelumnya, yaitu: harga beli berubah, tetapi modal batch tidak ikut berubah sehingga HPP dan margin memakai angka basi. Jadi dirancang dengan prinsip:

> **Faktur pembelian adalah sumber kebenaran modal.** Setiap kali faktur berubah, modal barang dan batch harus ikut menyesuaikan — dihitung dari netto + PPN − diskon.

Itu sebabnya muncul juga kolom `harga_modal_batch_terakhir` dan `harga_modal_terakhir` pada migrasi yang sama: maksudnya menyimpan nilai sebelumnya.

**Yang tidak diperhitungkan saat merancang fitur ini:**

1. Bahwa perbaikan harga di apotek banyak dilakukan **manual lewat Stok & Batch** (karena fakturnya sudah lama, atau harga faktur tidak mencerminkan biaya sebenarnya).
2. Bahwa faktur lama bisa tersimpan dengan harga **Rp0** atau salah satuan — sehingga angka salah yang justru "menang".
3. Kebutuhan **menahan** nilai tertentu (mis. memasukkan biaya kirim, pembulatan, atau hasil audit fisik).
4. Kebutuhan **keterlihatan**: tidak ada notifikasi, konfirmasi, atau riwayat ketika nilai lama ditimpa.

---

## 4. Risiko (daftar lengkap)

| # | Risiko | Tingkat |
|---|---|---|
| 1 | **Perbaikan manual hilang tanpa jejak** — nilai yang diisi di Stok & Batch ditimpa faktur, tanpa notifikasi dan tanpa riwayat | 🔴 tinggi |
| 2 | **Cakupan lebih luas dari dugaan** — satu faktur barang X mereset modal **semua batch barang X** di cabang itu, bukan hanya batch yang difakturkan | 🔴 tinggi |
| 3 | **Faktur salah/berharga 0 menang** — perhitungan selalu mengambil dari baris faktur, walaupun angkanya jelas keliru | 🔴 tinggi |
| 4 | **Kolom jejak tidak berfungsi** — pada jalur normal, `harga_modal_batch_terakhir` diisi **nilai baru** (sama dengan `harga_modal_batch`), sehingga tidak dapat dipakai untuk melihat nilai sebelum ditimpa | 🟠 sedang–tinggi |
| 5 | **Modal bisa mengosongkan diri** — bila faktur untuk batch itu tidak lagi AKTIF, modalnya disetel NULL (di layar tampak kosong, dan tersimpan sebagai Rp0 begitu form batch disimpan) | 🟠 sedang–tinggi |
| 6 | **Menular ke harga jual** — bila setelan markup cabang aktif, harga jual ikut dihitung dari modal itu lalu ditulis ke Master Barang saat faktur disimpan | 🟠 sedang |
| 7 | **Laporan terasa berubah sendiri** — nota lama tidak berubah (HPP tersimpan per baris), tetapi penjualan berikutnya memakai modal baru, sehingga margin bisa berubah tanpa ada perubahan data penjualan | 🟡 rendah–sedang |

---

## 5. Usulan pengaman (untuk diputuskan pemilik)

### A. Penanda "modal manual" — **rekomendasi utama**

Tambahkan pada `stok_batch`: `modal_manual` (boolean), `modal_manual_oleh`, `modal_manual_at`, `modal_manual_alasan`.

- Perhitungan ulang **melewati** batch yang bertanda manual.
- Di Stok & Batch tampil lencana "manual" agar semua tahu angkanya bukan dari faktur.
- Bila faktur baru datang dengan harga berbeda, sistem **menampilkan usulan** ("faktur terbaru Rp X, modal manual Rp Y — pakai yang mana?"), bukan menimpa diam-diam.

Ini menyelesaikan risiko 1–3 sekaligus, dan sesuai kenyataan bahwa modal kadang bukan sekadar harga di faktur.

### B. Riwayat perubahan modal — **wajib, murah**

Tabel `stok_batch_modal_log` (id, cabang, kode_obat, kode_batch, modal_lama, modal_baru, sumber: `faktur` / `manual` / `backfill`, no_faktur, oleh, waktu).
Tampilkan di halaman batch. Dengan ini, kejadian seperti 9 Oktober tidak lagi tidak terlihat.

### C. Peringatan di form Pembelian

- Tolak simpan faktur bila ada baris **berharga Rp0** (untuk supplier PBF; "STOK AWAL" boleh dengan konfirmasi eksplisit).
- Tampilkan peringatan sebelum simpan: *"Faktur ini akan menghitung ulang modal 5 batch: …"*.

### D. Perbaiki semantik kolom jejak — **perbaikan kecil**

Pada jalur normal, `harga_modal_batch_terakhir` seharusnya diisi **nilai lama**, bukan salinan nilai baru (bandingkan baris 186–187 dengan baris 241).

### E. Pisahkan "modal dari faktur" dan "modal final"

Alternatif jangka panjang: simpan `modal_faktur` (hasil hitung sistem) dan `modal_final` (yang dipakai HPP, boleh diisi manual). Dengan begitu sistem tetap punya angka aslinya, tetapi HPP memakai angka yang sudah diverifikasi.

**Urutan pengerjaan usulan:** B (riwayat) → A (penanda manual) → C (peringatan) → D (kecil) → E (bila diperlukan).

---

## 6. Yang bisa dilakukan sekarang, sebelum ada perubahan aplikasi

1. **Utamakan perbaikan di faktur** (Pembelian → Ubah faktur → isi harga satuan → Simpan). Setelah faktur benar, perhitungan ulang justru menguntungkan: modal semua batch ikut rapi.
2. **Perbaiki Modal di Master Barang** untuk barang yang masih 0 — ini yang dipakai mengisi otomatis faktur berikutnya.
3. Bila tetap perlu mengisi manual di Stok & Batch, **catat nilainya di luar sistem** (buku/catatan) — karena nilai itu dapat hilang saat faktur berikutnya untuk barang yang sama disimpan.
4. **Jangan menyimpan faktur dengan baris berharga Rp0.**
5. Setelah setiap input faktur, periksa ulang 3–5 barang prioritas di Stok & Batch; bila modalnya berubah sendiri, laporkan ke Owner — itu tanda perhitungan ulang bekerja dengan sumber yang masih salah.

---

## 7. Keterbatasan

1. Seluruh temuan berasal dari kode di repositori dan data kanal analitik read-only. Tidak ada perubahan data.
2. Status faktur (`AKTIF`/`DIBATALKAN`) dan riwayat edit tidak tersedia di kanal analitik, sehingga tidak dapat dipastikan faktur mana yang dibatalkan/diedit pada 9–10 Oktober. Perlu dibuka di menu Pembelian.
3. Kolom `harga_modal_batch_terakhir` tidak ada di view analitik, sehingga nilai sebelum penimpaan tidak dapat dibaca dari luar.
