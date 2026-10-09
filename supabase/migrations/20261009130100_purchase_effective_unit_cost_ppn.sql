-- Modal efektif termasuk PPN, shift checkout 07:00/14:00/21:00, 
-- Tidak menulis data transaksi/produksi. Penerapan harga dilakukan hanya melalui
-- harga_markup_terapkan yang dipanggil Edge Function setelah preview Owner.

CREATE OR REPLACE FUNCTION public.purchase_effective_unit_cost(
  p_harga_netto numeric, p_qty numeric, p_ppn numeric, p_diskon numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN coalesce(p_qty, 0) <= 0 THEN NULL
    ELSE round((coalesce(p_harga_netto, 0) * p_qty *
      (1 + coalesce(p_ppn, 0) / 100) - coalesce(p_diskon, 0)) / p_qty, 2)
  END
$function$;

