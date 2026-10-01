-- Kanal akses baca analitik: rincian item nota pembelian.
--
-- Latar belakang:
--   v_analitik_hutang hanya memuat HEADER nota pembelian, sehingga pertanyaan
--   "nota pembelian mana yang menyebabkan laba kotor minus" tidak bisa dijawab
--   dari kanal read-only. Padahal rantainya pendek dan pasti:
--
--     Harga_Netto faktur --(purchase_save)--> stok_batch.harga_modal_batch
--                        --(pos_checkout)--> trx_penjualan_detail.harga_modal
--                        --> trx_penjualan.total_hpp --> laba kotor nota
--
--   purchase_save (lihat 20260925050000_pos_fungsi_cabang.sql baris 364-393)
--   menulis harga_modal_batch = Harga_Netto pada batch, dan hanya menimpa
--   master_barang.harga_jual_umum bila kolom "Harga Jual Umum Baru" faktur diisi.
--   Harga khusus (nakes) dan harga mutasi TIDAK pernah ditimpa faktur pembelian.
--
-- Isi view:
--   Satu baris per item faktur pembelian, dilengkapi modal batch saat ini dan
--   harga jual master saat ini, supaya selisihnya terlihat langsung.
--
--   harga_netto                  = harga beli per unit menurut faktur (sumber modal batch)
--   harga_modal_batch            = modal batch yang sekarang dipakai kasir untuk HPP
--   harga_jual_umum_baru         = harga jual yang DIMINTA faktur (0 = tidak mengubah)
--   margin_umum_per_unit         = harga_jual_umum - harga_netto   (minus = tiap jual rugi)
--   margin_nakes_per_unit        = harga khusus/jual - harga_netto
--   modal_di_atas_harga_umum     = true bila modal faktur di atas harga jual umum
--   modal_di_atas_harga_nakes    = true bila modal faktur di atas harga nakes
--   mengubah_harga_jual          = true bila faktur ini menimpa harga_jual_umum
--   batch_beda_dari_faktur       = true bila modal batch sekarang <> harga_netto faktur
--                                  (batch sudah diisi/diubah lewat jalur lain)
--
-- Batasan (penting saat membaca hasil):
--   * Harga jual di view ini adalah harga master SAAT INI, bukan saat nota penjualan
--     dibuat. Untuk nota yang sudah terjadi, pakai v_analitik_nota_minus.
--   * stok_batch tidak menyimpan no_faktur, jadi baris faktur lama yang batch-nya
--     sudah dipakai/diubah tetap muncul dengan modal batch terakhir.
--   * Tidak ada nama maupun nomor WhatsApp pelanggan di tabel ini.
--
-- Verifikasi setelah dijalankan (read-only):
--   select count(*) from public.v_analitik_pembelian_detail;
--   select count(*) from public.trx_pembelian_detail;
--   -> jumlahnya harus SAMA. Bila view lebih banyak, ada (cabang_id, kode_obat,
--      kode_batch) ganda di stok_batch yang membuat join menggandakan baris.
--
-- Rollback:
--   drop view if exists public.v_analitik_pembelian_detail;

create or replace view public.v_analitik_pembelian_detail as
select
  d.cabang_id,
  d.no_faktur,
  p.tanggal_faktur,
  p.jatuh_tempo,
  p.no_faktur_supplier,
  p.supplier,
  p.kategori,
  p.petugas,
  d.kode_obat,
  d.nama_obat,
  d.kode_batch,
  d.expired_date,
  d.qty::numeric                                              as qty,
  d.harga_netto::numeric                                      as harga_netto,
  coalesce(d.ppn, 0)::numeric                                 as ppn,
  coalesce(d.diskon, 0)::numeric                              as diskon,
  coalesce(d.harga_jual_umum_baru, 0)::numeric                as harga_jual_umum_baru,
  d.subtotal::numeric                                         as subtotal,
  s.harga_modal_batch::numeric                                as harga_modal_batch,
  s.stok_real::numeric                                        as stok_sekarang,
  m.harga_jual_umum::numeric                                  as harga_jual_umum,
  m.harga_khusus::numeric                                     as harga_khusus,
  m.harga_jual_mutasi::numeric                                as harga_jual_mutasi,
  m.aktif                                                     as barang_aktif,
  (coalesce(m.harga_jual_umum, 0) - d.harga_netto)::numeric    as margin_umum_per_unit,
  (coalesce(nullif(m.harga_khusus, 0), m.harga_jual_umum, 0)
     - d.harga_netto)::numeric                                as margin_nakes_per_unit,
  (d.harga_netto > coalesce(m.harga_jual_umum, 0))             as modal_di_atas_harga_umum,
  (d.harga_netto > coalesce(nullif(m.harga_khusus, 0), m.harga_jual_umum, 0))
                                                              as modal_di_atas_harga_nakes,
  (coalesce(d.harga_jual_umum_baru, 0) > 0)                    as mengubah_harga_jual,
  (s.harga_modal_batch is distinct from d.harga_netto)         as batch_beda_dari_faktur
from public.trx_pembelian_detail d
-- no_faktur hanya unik per cabang, jadi cabang_id wajib ikut dicocokkan.
left join public.trx_pembelian p
  on p.cabang_id = d.cabang_id and p.no_faktur = d.no_faktur
-- Unik per (cabang_id, kode_obat, kode_batch); kode_batch bisa kosong, jadi
-- kedua sisi dinormalkan agar batch berkode kosong tetap ketemu.
left join public.stok_batch s
  on s.cabang_id = d.cabang_id
 and s.kode_obat = d.kode_obat
 and coalesce(s.kode_batch, '') = coalesce(d.kode_batch, '')
left join public.master_barang m
  on m.cabang_id = d.cabang_id and m.kode_obat = d.kode_obat;

-- Hak akses: HANYA role `authenticated` (user auth khusus analitik), hanya SELECT.
-- `anon` tidak diberi akses apa pun — sesuai AGENTS.md.
grant usage on schema public to authenticated;

grant select on public.v_analitik_pembelian_detail to authenticated;
