# Audit Migration Production SI-FaMitra

**Tanggal audit:** 2026-09-29  
**Project:** `xixhazawndmgqzstfjnq`  
**Mode:** read-only; tidak ada DDL, DML, deploy, atau migration yang dijalankan.

## Tujuan

Mencocokkan migration yang ada di repository dengan migration history dan schema production sebelum melakukan perubahan database. Audit ini dibuat sebagai gate review; dokumen ini **bukan persetujuan untuk menjalankan migration**.

## Temuan

### Migration history production

Migration history production berhenti pada:

```text
20260928040000 laba_setelah_target
```

Dua migration terbaru yang ada di `origin/main` tetapi tidak tercatat pada migration history production:

```text
20260929000000_retur_membalik_kupon.sql
20260929010000_lottery_min_transaksi.sql
```

### Kondisi schema production

Read-only schema inspection menunjukkan:

- `public.lottery_campaigns` **sudah memiliki** kolom:
  - `min_jumlah_transaksi`
  - `min_belanja_per_transaksi_idr`
- RPC berikut **sudah ada**:
  - `lottery_save_campaign`
  - `lottery_record_winner`
- Function `promo_reverse_on_full_return` **belum ditemukan**.
- Trigger yang terlihat pada tabel retur hanya:
  - `trg_loyalty_after_return` pada `trx_retur_jual`.
  - Tidak ditemukan trigger `trg_promo_reverse_on_full_return` pada `trx_retur_jual_detail`.
- `public.promo_redemptions` memiliki 4 baris, seluruhnya berstatus `APPLIED` pada saat audit.
- `public.trx_penjualan_detail` memiliki 228 baris.
- `public.trx_retur_jual` memiliki 5 baris.
- `public.trx_retur_jual_detail` memiliki 5 baris.
- `public.lottery_campaigns` memiliki 2 baris dan `public.lottery_winners` memiliki 0 baris.

## Interpretasi risiko

### Migration `20260929000000_retur_membalik_kupon.sql`

Migration ini memiliki dua bagian berbeda:

1. Membuat atau mengganti function dan trigger untuk membalik status kupon setelah retur penuh.
2. Menjalankan backfill `UPDATE public.promo_redemptions` dari `APPLIED` menjadi `REVERSED` apabila nota sudah diretur penuh.

Karena ada operasi `UPDATE` terhadap data production, migration ini **tidak boleh dijalankan blind**. Backfill dapat mengubah kuota kupon dan laporan promo. Sebelum eksekusi perlu dibuat preview read-only yang menghitung kandidat baris, ditinjau pemilik project, dan disepakati prosedur rollback/mitigasi.

Kondisi saat audit menunjukkan function dan trigger promo-retur belum ada, sehingga fitur pembalikan kupon untuk retur penuh belum aktif secara database. Namun jumlah kandidat backfill belum dihitung per invoice dalam audit ini; hanya agregat status yang dibaca.

### Migration `20260929010000_lottery_min_transaksi.sql`

Migration ini secara tekstual bersifat additive untuk kolom baru, tetapi production sudah memiliki kedua kolom dan kedua RPC target meskipun migration belum tercatat. Menjalankan file secara langsung berisiko:

- gagal pada `ALTER TABLE ... ADD COLUMN` karena kolom sudah ada;
- mengganti RPC yang mungkin sudah berbeda dari source repository;
- menciptakan ketidaksesuaian baru pada migration history.

Kesimpulan: **jangan menjalankan migration ini melalui `db push` sebelum schema drift dan asal perubahan production direkonsiliasi**. Perlu dipastikan apakah schema/RPC tersebut berasal dari deployment manual, migration yang tidak tercatat, atau sumber lain.

## Checklist sebelum perubahan production

1. Simpan/export metadata schema dan definisi function production melalui jalur backup resmi.
2. Hitung kandidat backfill secara read-only untuk `20260929000000`; jangan mengubah data.
3. Bandingkan definisi production `lottery_save_campaign` dan `lottery_record_winner` dengan file repository.
4. Pastikan signature, grant `service_role`, security mode, dan search path RPC cocok.
5. Tentukan apakah migration `20260929010000` perlu diubah menjadi reconciliation migration yang idempotent atau cukup dicatat sebagai applied secara resmi.
6. Untuk `20260929000000`, review kandidat perubahan kupon satu per satu/berdasarkan query hasil agregat sebelum menyetujui backfill.
7. Uji seluruh perubahan pada project staging atau clone database terlebih dahulu.
8. Siapkan verifikasi sesudah perubahan:
   - function dan trigger promo-retur ada;
   - jumlah `APPLIED`/`REVERSED` sesuai hasil yang disetujui;
   - kolom dan RPC lottery tetap tersedia;
   - tidak ada perubahan pada pemenang lottery lama;
   - fungsi checkout/promo dan retur tetap dapat dipanggil.
9. Minta persetujuan eksplisit sebelum menjalankan DDL, DML, `db push`, atau deploy apa pun.

## Query preview read-only yang disarankan

Query berikut hanya contoh untuk review. Query ini **belum dijalankan sebagai bagian dari perubahan** dan harus disesuaikan/ditinjau sebelum dipakai:

```sql
-- Kandidat redemption yang mungkin sudah diretur penuh.
-- Hanya SELECT; tidak mengubah data.
select
  pr.invoice_no,
  pr.cabang_id,
  pr.status
from public.promo_redemptions pr
where pr.status = 'APPLIED'
  and exists (
    select 1
    from public.trx_penjualan_detail d
    where d.no_nota = pr.invoice_no
      and d.cabang_id = pr.cabang_id
  )
limit 100;
```

Query kandidat final harus mereplikasi logika perbandingan `qty` per `kode_obat` + `kode_batch` dari migration, kemudian hasilnya disimpan sebagai bukti review sebelum ada backfill.

## Keputusan audit

- **Tidak menyetujui eksekusi migration production pada PR ini.**
- Migration `20260929000000` membutuhkan preview backfill dan persetujuan data.
- Migration `20260929010000` membutuhkan rekonsiliasi schema drift karena sebagian objeknya sudah ada di production.
- PR ini hanya menambahkan dokumentasi dan guardrail review; tidak mengubah runtime atau database.
