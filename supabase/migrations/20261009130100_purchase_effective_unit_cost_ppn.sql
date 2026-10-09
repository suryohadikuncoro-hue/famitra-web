CREATE OR REPLACE FUNCTION public.purchase_effective_unit_cost(
  p_harga_netto numeric, p_qty numeric, p_ppn numeric, p_diskon numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN coalesce(p_qty, 0) <= 0 OR (1 + coalesce(p_ppn, 0) / 100) <= 0 THEN NULL
    ELSE round(
      (coalesce(p_harga_netto, 0) * p_qty * (1 + coalesce(p_ppn, 0) / 100)
       * (1 - least(greatest(coalesce(p_diskon, 0), 0), 100) / 100)
       / p_qty),
      2
    )
  END
$function$;
