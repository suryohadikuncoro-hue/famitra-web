-- 20260925070000_loyalty_tk_zero_expiry.sql
-- Perubahan sistem poin: TK dapat 0 poin (strategi terpisah bukan poin),
-- poin kadaluarsa setelah 12 bulan.

------------------------------------------------------------------------------
-- 1. Tambah kolom 'expired' untuk tracking poin yang sudah kadaluarsa
------------------------------------------------------------------------------
ALTER TABLE public.loyalty_transactions
  ADD COLUMN IF NOT EXISTS expired boolean DEFAULT false;
COMMENT ON COLUMN public.loyalty_transactions.expired IS
  'TRUE ketika poin sudah kadaluarsa (lebih dari 12 bulan).';

------------------------------------------------------------------------------
-- 2. Recreate loyalty_after_sale:
--    - Tenaga Kesehatan → 0 poin (strategi terpisah)
--    - Insert expired=false di loyalty_transactions
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_after_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_customer public.master_customer%ROWTYPE; v_points integer;
BEGIN
  IF NULLIF(TRIM(NEW.nomor_wa),'') IS NULL THEN RETURN NEW; END IF;
  -- Apotek Lain dan Tenaga Kesehatan: 0 poin (strategi terpisah, bukan poin)
  v_points := CASE
    WHEN NEW.tipe_customer IN ('Apotek Lain','Tenaga Kesehatan') THEN 0
    ELSE FLOOR(GREATEST(0, NEW.harga_akhir) / 1000)::integer
  END;
  INSERT INTO public.master_customer (cabang_id, nomor_wa, nama, tipe_customer, total_belanja, jumlah_transaksi, tanggal_terakhir_beli, total_points, total_spend_mtd)
  VALUES (NEW.cabang_id, NEW.nomor_wa, COALESCE(NULLIF(NEW.nama_pelanggan,''),'Umum'), NEW.tipe_customer, GREATEST(0,NEW.harga_akhir), 1, NEW.tanggal, v_points, GREATEST(0,NEW.harga_akhir))
  ON CONFLICT (cabang_id, nomor_wa) DO UPDATE SET
    nama=EXCLUDED.nama, tipe_customer=EXCLUDED.tipe_customer,
    total_belanja=public.master_customer.total_belanja+GREATEST(0,NEW.harga_akhir),
    jumlah_transaksi=public.master_customer.jumlah_transaksi+1,
    tanggal_terakhir_beli=NEW.tanggal,
    total_points=GREATEST(0,public.master_customer.total_points+v_points),
    total_spend_mtd=public.master_customer.total_spend_mtd+GREATEST(0,NEW.harga_akhir);
  SELECT * INTO v_customer FROM public.master_customer WHERE cabang_id=NEW.cabang_id AND nomor_wa=NEW.nomor_wa;
  INSERT INTO public.loyalty_transactions(cabang_id,customer_id,no_nota,points_change,reason,expired)
  VALUES (NEW.cabang_id,v_customer.id,NEW.no_nota,v_points,'purchase',false);
  RETURN NEW;
END;
$function$;

------------------------------------------------------------------------------
-- 3. Recreate loyalty_after_return:
--    - Tenaga Kesehatan → 0 poin
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.loyalty_after_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_customer public.master_customer%ROWTYPE; v_points integer;
BEGIN
  IF NULLIF(TRIM(NEW.nomor_wa),'') IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_customer FROM public.master_customer WHERE cabang_id=NEW.cabang_id AND nomor_wa=NEW.nomor_wa FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_points := CASE
    WHEN v_customer.tipe_customer IN ('Apotek Lain','Tenaga Kesehatan') THEN 0
    ELSE FLOOR(GREATEST(0, NEW.total_refund) / 1000)::integer
  END;
  UPDATE public.master_customer
  SET total_belanja=GREATEST(0,total_belanja-GREATEST(0,NEW.total_refund)),
      total_spend_mtd=GREATEST(0,total_spend_mtd-GREATEST(0,NEW.total_refund)),
      total_points=GREATEST(0,total_points-v_points)
  WHERE id=v_customer.id;
  INSERT INTO public.loyalty_transactions(cabang_id,customer_id,no_nota,points_change,reason)
  VALUES (NEW.cabang_id,v_customer.id,NEW.no_retur,-v_points,'return_adjustment');
  RETURN NEW;
END;
$function$;

------------------------------------------------------------------------------
-- 4. Buat fungsi expire_loyalty_points() — poin kadaluarsa 12 bulan
--    Dipanggil otomatis via API ketika CRM dibuka, atau via n8n cron harian
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_loyalty_points()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  -- Kurangi poin yang kadaluarsa dari master_customer
  UPDATE public.master_customer c
  SET total_points = GREATEST(0, c.total_points - COALESCE(sub.expired_points, 0))
  FROM (
    SELECT l.cabang_id, l.customer_id, SUM(l.points_change) AS expired_points
    FROM public.loyalty_transactions l
    WHERE l.created_at < NOW() - INTERVAL '12 months'
      AND l.points_change > 0
      AND l.expired = false
    GROUP BY l.cabang_id, l.customer_id
  ) sub
  WHERE c.cabang_id = sub.cabang_id AND c.id = sub.customer_id;

  -- Tandai transaksi yang kadaluarsa
  UPDATE public.loyalty_transactions
  SET expired = true
  WHERE created_at < NOW() - INTERVAL '12 months'
    AND points_change > 0
    AND expired = false;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.expire_loyalty_points() TO service_role;

COMMENT ON FUNCTION public.expire_loyalty_points() IS
  'Kadalkan poin loyalty yang lebih tua dari 12 bulan. Dipanggil otomatis via crm.list API.';

------------------------------------------------------------------------------
-- 5. Grant akses tambahan
------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO service_role;
