-- Fix pembelian: Diskon di API adalah persentase 0..100, bukan nominal rupiah.
-- Perbaikan ini hanya mengubah rumus untuk transaksi baru/edit berikutnya.
-- Tidak mengubah faktur historis, stok, utang, atau modal saat migration berjalan.
DO $fix_discount_formula$
DECLARE
  v_name text;
  v_def text;
  v_old text := '- coalesce((v_item->>''Diskon'')::numeric,0)';
  v_new text := '- round((((v_item->>''Harga_Netto'')::numeric * (v_item->>''Qty'')::numeric) * (1 + coalesce((v_item->>''PPN'')::numeric,0)/100) * least(greatest(coalesce((v_item->>''Diskon'')::numeric,0),0),100)/100),2)';
  v_changed integer := 0;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['purchase_save_before_discount_fix', 'purchase_update_before_discount_fix']
  LOOP
    SELECT pg_get_functiondef(p.oid)
      INTO v_def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = v_name
     LIMIT 1;

    IF v_def IS NULL THEN
      RAISE EXCEPTION 'Fungsi public.% tidak ditemukan; migration dibatalkan.', v_name;
    END IF;

    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'Rumus diskon yang diharapkan tidak ditemukan di public.%; periksa versi fungsi sebelum melanjutkan.', v_name;
    END IF;

    v_def := replace(v_def, v_old, v_new);
    EXECUTE v_def;
    v_changed := v_changed + 1;
  END LOOP;

  IF v_changed <> 2 THEN
    RAISE EXCEPTION 'Hanya % dari 2 fungsi yang diperbaiki.', v_changed;
  END IF;
END;
$fix_discount_formula$;

-- Verifikasi manual setelah deploy:
-- 1) Bandingkan total form dan header faktur untuk faktur baru/edit dengan diskon.
-- 2) Pastikan stok_batch.stok_real tidak berubah hanya karena rumus diskon diperbaiki.
-- 3) Pastikan pembayaran hutang aktif tetap sama dan saldo = total_tagihan - pembayaran aktif.
-- 4) Pastikan purchase_refresh_costs menghitung modal dari persentase diskon yang benar.
