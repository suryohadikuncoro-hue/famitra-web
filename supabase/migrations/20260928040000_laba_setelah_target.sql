-- Migrasi: Laba bersih SETELAH target tercapai (laba bonus tim)
-- Tanggal: 2026-09-28
--
-- Keputusan Owner: laba yang terbuka setelah target tercapai adalah laba bersih
-- TERSENDIRI dari omset di atas target (dibagikan ke tim), bukan laba total.
-- Fungsi ini jadi satu-satunya sumber perhitungan, dipakai Edge Function `api`
-- (hero dashboard) dan `marketing` (widget, progress, halaman Target Omset).
--
-- Aturan perhitungan:
--   1. Omset bersih per nota = harga_akhir - total refund retur nota itu.
--      HPP bersih per nota     = total_hpp - (qty retur x harga_modal batch asal).
--      Retur dibebankan ke NOTA ASAL (kapan pun returnya dicatat), supaya
--      penjualan yang dibatalkan tidak ikut mengisi target.
--   2. Nota diurutkan menurut waktu transaksi. Target tercapai pada nota yang
--      membuat omset bersih kumulatif >= target.
--   3. Omset setelah target = bagian omset di atas target. Nota penembus dibagi
--      proporsional: hanya bagian di atas target yang masuk, HPP-nya ikut proporsional.
--   4. Biaya operasional periode dialokasikan proporsional terhadap omset:
--      biaya setelah target = total biaya x (omset setelah target / omset total).
--   5. Laba setelah target = omset setelah target - HPP bagian itu - biaya teralokasi.

create or replace function public.marketing_hitung_target(
  p_target_id uuid,
  p_rincian boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with t as (
  select id, kode_cabang, nama_target, periode_mulai, periode_selesai,
         target_omset_idr::numeric as target
  from public.marketing_target_omsets
  where id = p_target_id
),
nota as (
  select p.no_nota, p."timestamp" as waktu, p.tanggal, p.jam,
         p.harga_akhir::numeric as harga_akhir,
         p.total_hpp::numeric as total_hpp
  from public.trx_penjualan p
  join t on p.cabang_id = t.kode_cabang
        and p.tanggal between t.periode_mulai and t.periode_selesai
),
retur as (
  select r.no_nota_asal, sum(r.total_refund)::numeric as refund
  from public.trx_retur_jual r
  join t on r.cabang_id = t.kode_cabang
  where r.no_nota_asal in (select no_nota from nota)
  group by r.no_nota_asal
),
retur_hpp as (
  select r.no_nota_asal,
         sum(d.qty * coalesce((
           select avg(pd.harga_modal)
           from public.trx_penjualan_detail pd
           where pd.no_nota = r.no_nota_asal and pd.cabang_id = r.cabang_id
             and pd.kode_obat = d.kode_obat and pd.kode_batch = d.kode_batch
         ), 0))::numeric as hpp
  from public.trx_retur_jual r
  join t on r.cabang_id = t.kode_cabang
  join public.trx_retur_jual_detail d on d.no_retur = r.no_retur and d.cabang_id = r.cabang_id
  where r.no_nota_asal in (select no_nota from nota)
  group by r.no_nota_asal
),
bersih as (
  select n.no_nota, n.waktu, n.tanggal, n.jam,
         greatest(0, n.harga_akhir - coalesce(r.refund, 0)) as omset,
         greatest(0, coalesce(n.total_hpp, 0) - coalesce(rh.hpp, 0)) as hpp,
         (n.total_hpp is null) as hpp_kosong
  from nota n
  left join retur r on r.no_nota_asal = n.no_nota
  left join retur_hpp rh on rh.no_nota_asal = n.no_nota
),
kumulatif as (
  select b.*,
         sum(b.omset) over (order by b.waktu, b.no_nota) as kum,
         sum(b.omset) over (order by b.waktu, b.no_nota) - b.omset as kum_sebelum
  from bersih b
),
bagi as (
  select k.*,
         case
           when k.kum <= (select target from t) then 0
           when k.kum_sebelum >= (select target from t) then k.omset
           else k.kum - (select target from t)
         end as omset_bonus
  from kumulatif k
),
bagi2 as (
  select b.*,
         case when b.omset > 0 then b.hpp * b.omset_bonus / b.omset else 0 end as hpp_bonus
  from bagi b
),
biaya as (
  select coalesce(sum(bo.nominal), 0)::numeric as total
  from public.biaya_operasional bo
  join t on bo.cabang_id = t.kode_cabang
        and bo.tanggal between t.periode_mulai and t.periode_selesai
),
total as (
  select coalesce(sum(omset), 0) as omset,
         coalesce(sum(hpp), 0) as hpp,
         coalesce(sum(omset_bonus), 0) as omset_bonus,
         coalesce(sum(hpp_bonus), 0) as hpp_bonus,
         count(*) as nota_count,
         count(*) filter (where hpp_kosong) as hpp_kosong_count,
         count(*) filter (where omset_bonus > 0) as nota_bonus_count
  from bagi2
),
tembus as (
  select no_nota, waktu, tanggal, jam
  from bagi2
  where kum >= (select target from t) and kum_sebelum < (select target from t)
  order by waktu, no_nota
  limit 1
)
select case when not exists (select 1 from t) then null else
  jsonb_build_object(
    'target_id', (select id from t),
    'kode_cabang', (select kode_cabang from t),
    'target_omset_idr', (select target from t),
    'omset_idr', tot.omset,
    'total_hpp_idr', tot.hpp,
    'biaya_operasional_idr', bi.total,
    'laba_bersih_total_idr', tot.omset - tot.hpp - bi.total,
    'tercapai', tot.omset >= (select target from t),
    'progress_persen', case when (select target from t) > 0
                         then least(100, tot.omset / (select target from t) * 100) else 100 end,
    'transaksi_count', tot.nota_count,
    'hpp_kosong_count', tot.hpp_kosong_count,
    'tercapai_pada', (select waktu from tembus),
    'nota_tercapai', (select no_nota from tembus),
    'omset_setelah_target_idr', tot.omset_bonus,
    'hpp_setelah_target_idr', round(tot.hpp_bonus, 2),
    'biaya_setelah_target_idr', case when tot.omset > 0 then round(bi.total * tot.omset_bonus / tot.omset, 2) else 0 end,
    'laba_setelah_target_idr', round(tot.omset_bonus - tot.hpp_bonus
                                 - case when tot.omset > 0 then bi.total * tot.omset_bonus / tot.omset else 0 end, 2),
    'nota_setelah_target_count', tot.nota_bonus_count,
    'rincian', case when p_rincian then coalesce((
        select jsonb_agg(jsonb_build_object(
                 'no_nota', b.no_nota, 'tanggal', b.tanggal, 'jam', b.jam,
                 'omset_nota_idr', b.omset,
                 'omset_setelah_target_idr', b.omset_bonus,
                 'hpp_setelah_target_idr', round(b.hpp_bonus, 2),
                 'laba_kotor_setelah_target_idr', round(b.omset_bonus - b.hpp_bonus, 2),
                 'sebagian', b.omset_bonus < b.omset)
               order by b.waktu, b.no_nota)
        from bagi2 b where b.omset_bonus > 0), '[]'::jsonb)
      else null end
  )
end
from total tot, biaya bi;
$$;

revoke all on function public.marketing_hitung_target(uuid, boolean) from public, anon, authenticated;
grant execute on function public.marketing_hitung_target(uuid, boolean) to service_role;
