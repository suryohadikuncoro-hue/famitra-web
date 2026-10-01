-- Kanal akses baca untuk analitik (meja INS/OPS/MKT).
--
-- Konsep:
--   * Hanya VIEW yang dibuat di sini yang bisa dibaca lewat kanal analitik.
--     Tabel dasar tidak di-grant, jadi kanal ini tidak bisa membaca tabel mentah.
--   * Grant hanya ke role `authenticated` (user Supabase Auth khusus analitik).
--     Role `anon` TIDAK diberi akses apa pun — sesuai AGENTS.md.
--   * View dimiliki pemilik skema (security definer secara default), sehingga role
--     `authenticated` cukup punya SELECT pada view tanpa akses ke tabel dasarnya.
--   * Hanya SELECT. Tidak ada INSERT/UPDATE/DELETE, baik di view maupun tabel.
--
-- Catatan: view TIDAK menggantikan aturan RLS untuk tabel baru. Aturan AGENTS.md
-- tentang tabel baru (GRANT + enable RLS + policy) tidak berubah; berkas ini tidak
-- membuat tabel.
--
-- Verifikasi setelah dijalankan (read-only):
--   select table_name, privilege_type
--   from information_schema.role_table_grants
--   where grantee = 'authenticated' and table_schema = 'public' and table_name like 'v_analitik%'
--   order by table_name;
--   -> diharapkan hanya SELECT, dan hanya untuk view v_analitik_*
--
-- Rollback (urutkan dari view yang bergantung pada view lain):
--   drop view if exists public.v_analitik_nota_minus, public.v_analitik_nota,
--     public.v_analitik_target, public.v_analitik_hutang,
--     public.v_analitik_retur, public.v_analitik_biaya, public.v_analitik_promo,
--     public.v_analitik_pelanggan, public.v_analitik_stok, public.v_analitik_produk,
--     public.v_analitik_penjualan_harian, public.v_analitik_cabang;

-- ---------------------------------------------------------------- Penjualan
-- Omzet, HPP, dan laba kotor per cabang/tanggal/shift. Nota tanpa HPP (total_hpp
-- null) tetap dihitung omzetnya, tetapi tidak menyumbang laba — jumlahnya bisa
-- dilihat lewat kolom nota_tanpa_hpp.
create or replace view public.v_analitik_penjualan_harian as
select
  p.cabang_id,
  p.tanggal,
  p.shift,
  count(*)::numeric                                             as nota,
  count(*) filter (where p.total_hpp is null)::numeric           as nota_tanpa_hpp,
  sum(p.harga_akhir)::numeric                                    as omzet,
  coalesce(sum(p.total_hpp), 0)::numeric                         as hpp,
  (sum(p.harga_akhir) - coalesce(sum(p.total_hpp), 0))::numeric   as laba_kotor,
  coalesce(sum(p.diskon), 0)::numeric                            as diskon,
  round(sum(p.harga_akhir) / nullif(count(*), 0), 2)             as rata_nota
from public.trx_penjualan p
group by p.cabang_id, p.tanggal, p.shift;

-- ---------------------------------------------------------------- Nota
-- Baris per nota penjualan: cukup untuk menilai margin satu nota tanpa membuka
-- tabel dasar. Identitas pelanggan (nomor WA dan nama) SENGAJA tidak diambil.
--
-- Laba kotor:
--   kotor  = harga_akhir - total_hpp           (seperti yang dihitung aplikasi)
--   bersih = (harga_akhir - refund) - (total_hpp - HPP barang yang diretur)
--            HPP retur dihitung dengan pola yang sama seperti migrasi
--            20260928040000_laba_setelah_target.sql (qty retur x modal batch asal).
--            Nota yang sudah diretur penuh bisa tetap muncul minus kalau HPP-nya
--            tidak sepenuhnya kembali, dan kolom diretur_penuh menandai kasus itu.
create or replace view public.v_analitik_nota as
select
  p.cabang_id,
  p.tanggal,
  p.jam,
  p.shift,
  p.no_nota,
  p.tipe_customer,
  p.petugas_transaksi,
  p.subtotal::numeric                                       as subtotal,
  coalesce(p.diskon, 0)::numeric                            as diskon,
  p.harga_akhir::numeric                                    as harga_akhir,
  p.total_hpp::numeric                                      as total_hpp,
  (p.total_hpp is null)                                     as hpp_kosong,
  (p.harga_akhir - coalesce(p.total_hpp, 0))::numeric        as laba_kotor,
  coalesce(rt.refund, 0)::numeric                           as refund_retur,
  (coalesce(rt.refund, 0) >= p.harga_akhir)                 as diretur_penuh,
  (greatest(0, p.harga_akhir - coalesce(rt.refund, 0))
     - greatest(0, coalesce(p.total_hpp, 0) - coalesce(rh.hpp, 0)))::numeric as laba_kotor_bersih
from public.trx_penjualan p
left join (
  select cabang_id, no_nota_asal, sum(total_refund)::numeric as refund
  from public.trx_retur_jual
  group by cabang_id, no_nota_asal
) rt
  on rt.cabang_id = p.cabang_id and rt.no_nota_asal = p.no_nota
left join (
  select r.cabang_id, r.no_nota_asal,
         sum(d.qty * coalesce((
           select avg(pd.harga_modal)
           from public.trx_penjualan_detail pd
           where pd.no_nota = r.no_nota_asal and pd.cabang_id = r.cabang_id
             and pd.kode_obat = d.kode_obat and pd.kode_batch = d.kode_batch
         ), 0))::numeric as hpp
  from public.trx_retur_jual r
  join public.trx_retur_jual_detail d
    on d.no_retur = r.no_retur and d.cabang_id = r.cabang_id
  group by r.cabang_id, r.no_nota_asal
) rh
  on rh.cabang_id = p.cabang_id and rh.no_nota_asal = p.no_nota;

-- Nota yang laba kotor bersihnya minus (harga akhir di bawah HPP), yaitu daftar
-- yang dicari saat menanyakan "nota mana yang menyebabkan laba minus".
-- Kolom dugaan_sebab memisahkan penyebabnya supaya tindak lanjutnya jelas:
-- harga master di bawah modal, diskon kasir, potongan reward/kupon, atau retur.
create or replace view public.v_analitik_nota_minus as
select
  n.cabang_id,
  n.tanggal,
  n.jam,
  n.shift,
  n.no_nota,
  n.tipe_customer,
  n.petugas_transaksi,
  n.subtotal,
  n.diskon,
  n.harga_akhir,
  n.total_hpp,
  n.hpp_kosong,
  n.laba_kotor,
  n.refund_retur,
  n.diretur_penuh,
  n.laba_kotor_bersih,
  coalesce(rw.reward, 0)::numeric                           as diskon_reward,
  coalesce(kp.kupon, 0)::numeric                            as diskon_kupon,
  case
    when n.diretur_penuh                                        then 'Sudah diretur penuh'
    when coalesce(rw.reward, 0) + coalesce(kp.kupon, 0) > 0      then 'Potongan reward/kupon'
    when n.diskon > 0                                           then 'Diskon kasir'
    else 'Harga jual di bawah modal'
  end                                                       as dugaan_sebab
from public.v_analitik_nota n
left join (
  select cabang_id, no_nota, sum(reward_value)::numeric as reward
  from public.loyalty_redemptions
  group by cabang_id, no_nota
) rw
  on rw.cabang_id = n.cabang_id and rw.no_nota = n.no_nota
left join (
  select cabang_id, invoice_no as no_nota, sum(discount_amount)::numeric as kupon
  from public.promo_redemptions
  group by cabang_id, invoice_no
) kp
  on kp.cabang_id = n.cabang_id and kp.no_nota = n.no_nota
where n.laba_kotor_bersih < 0;

-- ---------------------------------------------------------------- Produk
-- Penjualan per produk per hari, termasuk golongan dan margin.
create or replace view public.v_analitik_produk as
select
  d.cabang_id,
  d.tanggal,
  d.kode_obat,
  d.nama_obat,
  b.golongan,
  sum(d.qty)::numeric                                            as qty,
  sum(d.subtotal)::numeric                                       as omzet,
  sum(coalesce(d.harga_modal, 0) * d.qty)::numeric                as hpp,
  (sum(d.subtotal) - sum(coalesce(d.harga_modal, 0) * d.qty))::numeric as laba_kotor
from public.trx_penjualan_detail d
left join public.master_barang b
  on b.cabang_id = d.cabang_id and b.kode_obat = d.kode_obat
group by d.cabang_id, d.tanggal, d.kode_obat, d.nama_obat, b.golongan;

-- ---------------------------------------------------------------- Stok
-- Stok per batch beserta sisa hari menuju kedaluwarsa dan nilai stok.
create or replace view public.v_analitik_stok as
select
  s.cabang_id,
  s.kode_obat,
  m.nama_obat,
  m.golongan,
  m.aktif,
  m.stok_min,
  s.kode_batch,
  s.expired_date,
  s.stok_real,
  s.harga_modal_batch,
  (s.expired_date - current_date) as sisa_hari_ed,
  (s.stok_real * coalesce(s.harga_modal_batch, 0))::numeric as nilai_stok
from public.stok_batch s
left join public.master_barang m
  on m.cabang_id = s.cabang_id and m.kode_obat = s.kode_obat;

-- ---------------------------------------------------------------- Pelanggan
-- Data pelanggan untuk CRM dan analisis retensi. Sesuai keputusan pemilik,
-- nama dan nomor WhatsApp tampil apa adanya; pemakaiannya diatur di AGENTS.md.
create or replace view public.v_analitik_pelanggan as
select
  c.cabang_id,
  c.nomor_wa,
  c.nama,
  c.tipe_customer,
  c.segment_crm,
  c.total_belanja,
  c.jumlah_transaksi,
  c.tanggal_terakhir_beli,
  (current_date - c.tanggal_terakhir_beli) as jeda_hari,
  c.total_points,
  c.total_spend_mtd
from public.master_customer c;

-- ---------------------------------------------------------------- Retur
create or replace view public.v_analitik_retur as
select
  r.cabang_id,
  r.tanggal,
  r.shift,
  r.no_retur,
  r.no_nota_asal,
  r.nomor_wa,
  r.nama_pelanggan,
  r.petugas,
  r.alasan,
  r.total_refund
from public.trx_retur_jual r;

-- ---------------------------------------------------------------- Biaya
create or replace view public.v_analitik_biaya as
select
  b.cabang_id,
  b.tanggal,
  b.keterangan,
  b.nominal,
  b.shift,
  b.petugas
from public.biaya_operasional b;

-- ---------------------------------------------------------------- Hutang
-- Sisa hutang dihitung dari pembayaran berstatus AKTIF (pembatalan tidak dihitung).
create or replace view public.v_analitik_hutang as
select
  p.cabang_id,
  p.no_faktur,
  p.no_faktur_supplier,
  p.supplier,
  p.kategori,
  p.tanggal_faktur,
  p.jatuh_tempo,
  p.total_tagihan,
  coalesce(b.dibayar, 0)::numeric                    as total_dibayar,
  (p.total_tagihan - coalesce(b.dibayar, 0))::numeric as sisa_hutang,
  (p.jatuh_tempo - current_date)                      as sisa_hari
from public.trx_pembelian p
left join (
  select cabang_id, no_faktur, sum(jumlah_bayar) as dibayar
  from public.trx_pembayaran_hutang
  where status = 'AKTIF'
  group by cabang_id, no_faktur
) b on b.cabang_id = p.cabang_id and b.no_faktur = p.no_faktur;

-- ---------------------------------------------------------------- Promo
create or replace view public.v_analitik_promo as
select
  r.cabang_id,
  r.redeemed_at::date        as tanggal,
  k.name                     as kampanye,
  c.code                     as kode_kupon,
  r.invoice_no,
  r.discount_amount,
  r.status                   as status_redemption,
  t.harga_akhir,
  t.total_hpp,
  (t.harga_akhir - coalesce(t.total_hpp, 0))::numeric as laba_kotor_setelah_promo
from public.promo_redemptions r
left join public.promo_campaigns k on k.id = r.campaign_id
left join public.promo_coupons c on c.id = r.coupon_id
-- Cabang WAJIB ikut dicocokkan: no_nota hanya unik per (cabang_id, tanggal, no_nota)
-- pada trx_penjualan, jadi join tanpa cabang bisa menarik nota cabang lain.
left join public.trx_penjualan t on t.no_nota = r.invoice_no and t.cabang_id = r.cabang_id;

-- ---------------------------------------------------------------- Target & cabang
create or replace view public.v_analitik_target as
select
  kode_cabang,
  nama,
  periode_mulai,
  periode_selesai,
  target_omset_idr,
  aktif
from public.marketing_target_omsets;

create or replace view public.v_analitik_cabang as
select kode_cabang, nama_cabang
from public.master_cabang;

-- ---------------------------------------------------------------- Hak akses
-- Hanya role `authenticated` (user auth khusus analitik). `anon` tidak diberi akses.
grant usage on schema public to authenticated;

grant select on
  public.v_analitik_penjualan_harian,
  public.v_analitik_nota,
  public.v_analitik_nota_minus,
  public.v_analitik_produk,
  public.v_analitik_stok,
  public.v_analitik_pelanggan,
  public.v_analitik_retur,
  public.v_analitik_biaya,
  public.v_analitik_hutang,
  public.v_analitik_promo,
  public.v_analitik_target,
  public.v_analitik_cabang
to authenticated;
