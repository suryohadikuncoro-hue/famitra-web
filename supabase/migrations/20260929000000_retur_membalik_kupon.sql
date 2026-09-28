-- Retur penuh membatalkan pemakaian kupon.
-- Aturan: bila SEMUA barang pada nota asal sudah diretur penuh (qty retur >= qty jual
-- per kode_obat + kode_batch), promo_redemptions nota itu diubah APPLIED -> REVERSED
-- sehingga kuota total dan jatah per pelanggan kembali. Retur sebagian tidak
-- mengubah apa pun (kupon tetap dianggap terpakai).

CREATE OR REPLACE FUNCTION public.promo_reverse_on_full_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_nota text; v_cabang text; v_open integer;
BEGIN
  SELECT r.no_nota_asal, r.cabang_id INTO v_nota, v_cabang
  FROM public.trx_retur_jual r
  WHERE r.no_retur = NEW.no_retur AND r.cabang_id = NEW.cabang_id;
  IF v_nota IS NULL THEN RETURN NEW; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.promo_redemptions
                 WHERE invoice_no = v_nota AND cabang_id = v_cabang AND status = 'APPLIED') THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.trx_penjualan_detail
                 WHERE no_nota = v_nota AND cabang_id = v_cabang) THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_open
  FROM (
    SELECT d.kode_obat, d.kode_batch, sum(d.qty) AS sold
    FROM public.trx_penjualan_detail d
    WHERE d.no_nota = v_nota AND d.cabang_id = v_cabang
    GROUP BY d.kode_obat, d.kode_batch
  ) s
  WHERE s.sold > COALESCE((
    SELECT sum(rd.qty)
    FROM public.trx_retur_jual_detail rd
    JOIN public.trx_retur_jual rj ON rj.no_retur = rd.no_retur AND rj.cabang_id = rd.cabang_id
    WHERE rj.no_nota_asal = v_nota AND rj.cabang_id = v_cabang
      AND rd.kode_obat = s.kode_obat AND rd.kode_batch = s.kode_batch
  ), 0);

  IF v_open = 0 THEN
    UPDATE public.promo_redemptions
    SET status = 'REVERSED'
    WHERE invoice_no = v_nota AND cabang_id = v_cabang AND status = 'APPLIED';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_promo_reverse_on_full_return ON public.trx_retur_jual_detail;
CREATE TRIGGER trg_promo_reverse_on_full_return
AFTER INSERT ON public.trx_retur_jual_detail
FOR EACH ROW EXECUTE FUNCTION public.promo_reverse_on_full_return();

-- Backfill: nota berkupon yang sudah pernah diretur penuh sebelum migrasi ini.
UPDATE public.promo_redemptions pr
SET status = 'REVERSED'
WHERE pr.status = 'APPLIED'
  AND EXISTS (SELECT 1 FROM public.trx_penjualan_detail d
              WHERE d.no_nota = pr.invoice_no AND d.cabang_id = pr.cabang_id)
  AND NOT EXISTS (
    SELECT 1
    FROM (
      SELECT d.kode_obat, d.kode_batch, sum(d.qty) AS sold
      FROM public.trx_penjualan_detail d
      WHERE d.no_nota = pr.invoice_no AND d.cabang_id = pr.cabang_id
      GROUP BY d.kode_obat, d.kode_batch
    ) s
    WHERE s.sold > COALESCE((
      SELECT sum(rd.qty)
      FROM public.trx_retur_jual_detail rd
      JOIN public.trx_retur_jual rj ON rj.no_retur = rd.no_retur AND rj.cabang_id = rd.cabang_id
      WHERE rj.no_nota_asal = pr.invoice_no AND rj.cabang_id = pr.cabang_id
        AND rd.kode_obat = s.kode_obat AND rd.kode_batch = s.kode_batch
    ), 0)
  );
