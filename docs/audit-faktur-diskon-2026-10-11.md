# Audit faktur pembelian yang berpotensi terdampak salah tafsir diskon

Tanggal audit: 2026-10-11
Project: Supabase Apotek Famitra
Metode: SELECT read-only terhadap `trx_pembelian` dan `trx_pembelian_detail`.

## Ringkasan

- 437 faktur memiliki detail pembelian.
- 15 faktur memiliki setidaknya satu baris dengan `diskon > 0`.
- 9 faktur memiliki detail subtotal yang tidak cocok dengan perhitungan diskon persentase saat ini, sementara subtotal detail cocok dengan pola pengurangan angka diskon sebagai nominal rupiah.
- Tidak ditemukan perbedaan antara `trx_pembelian.total_tagihan` dan jumlah `trx_pembelian_detail.subtotal` pada faktur yang diperiksa.
- Audit ini tidak mengubah data. Jangan koreksi faktur historis otomatis tanpa memeriksa faktur PBF asli, pembayaran, dan modal.

## Faktur untuk pemeriksaan manual

| Cabang | No faktur | Supplier | Tanggal | Total tersimpan | Total jika diskon ditafsirkan sebagai persen | Potensi selisih* |
|---|---|---|---|---:|---:|---:|
| KARLA | FK-KARLA-20261008-0001 | PT. ACACIA MITRA ABADI | 2026-10-06 | Rp2.831.210,12 | Rp2.487.547,86 | -Rp343.662,26 |
| KARLA | FK-KARLA-20260610-0001 | PT. ACACIA MITRA ABADI | 2026-10-06 | Rp2.072.713,03 | Rp1.820.938,78 | -Rp251.774,25 |
| KARLA | FK-KARLA-20261005-0001 | PT. ACACIA MITRA ABADI | 2026-10-06 | Rp782.865,39 | Rp710.424,60 | -Rp72.440,79 |
| KENDAL | FK-KENDAL-20261010-0003 | owner | 2026-10-10 | Rp546.688,00 | Rp502.960,32 | -Rp43.727,68 |
| DEV | FK-DEV-20261009-0003 | PT SENTRAL MANDIRI LESTARI | 2026-10-09 | Rp22.175,00 | Rp16.650,00 | -Rp5.525,00 |
| KARLA | FK-KARLA-20261001-0004 | PT. Bina Mitra Jaya Bersama | 2026-10-01 | Rp694.167,23 | Rp690.836,50 | -Rp3.330,74 |
| DEV | FK-DEV-20261009-0004 | PT SENTRAL MANDIRI LESTARI | 2026-10-09 | Rp22.190,00 | Rp19.980,00 | -Rp2.210,00 |
| DEV | FK-DEV-20260928-0001 | PT SENTRAL MANDIRI LESTARI | 2026-09-28 | Rp58.214,50 | Rp58.213,68 | -Rp0,82 |
| KENDAL | FK-KENDAL-20261001-0003 | Apotek Kendal | 2026-10-01 | Rp1.878.075,00 | Rp1.878.074,90 | -Rp0,10 |

*Potensi selisih adalah hasil hitung ulang hipotetis dengan diskon persentase, bukan rekomendasi untuk langsung mengubah tagihan. Validasi faktur PBF asli dahulu.

## Catatan penting

- Faktur yang sama bisa saja sudah diedit; kolom tanggal faktur adalah tanggal dokumen, bukan waktu edit.
- Dua faktur pada daftar memiliki nomor yang berbeda tetapi supplier/total serupa; periksa identitas faktur dan data PBF sebelum mengambil tindakan.
- Rumus audit persentase belum meniru pembulatan diskon per item secara persis pada semua desimal; selisih kecil dapat terjadi.
- Perbaikan rumus ke depan tidak mengubah data historis. Faktur lama perlu keputusan terpisah setelah diverifikasi.
- Sebelum koreksi historis, cek pembayaran aktif, sisa hutang, stok batch, harga modal master/batch, dan transaksi penjualan yang sudah memakai modal tersebut.

## Query verifikasi pasca-perbaikan

Jalankan hanya setelah migration disetujui dan dideploy:

```sql
SELECT p.cabang_id, p.no_faktur, p.total_tagihan,
       sum(d.subtotal) AS total_detail,
       p.total_tagihan - sum(d.subtotal) AS selisih
FROM public.trx_pembelian p
JOIN public.trx_pembelian_detail d
  ON d.cabang_id = p.cabang_id AND d.no_faktur = p.no_faktur
GROUP BY p.cabang_id, p.no_faktur, p.total_tagihan
HAVING abs(p.total_tagihan - sum(d.subtotal)) > 0.02;
```

Query terakhir hanya memeriksa konsistensi header-detail; hasil kosong tidak membuktikan semantik diskon historis sudah benar.
