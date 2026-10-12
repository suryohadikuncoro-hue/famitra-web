-- Correct active POS shift boundaries, require explicit verification for expired batches,
-- and do not silently bypass configured loyalty-redemption rules on function errors.
-- This migration changes only the current pos_checkout function definition.
-- It does NOT rewrite historical sales or stock records.

DO $migration$
DECLARE
  r record;
  d text;
  old_shift_pagi text := $old$extract(hour from (now() at time zone 'Asia/Jakarta')) between 8 and 14$old$;
  new_shift_pagi text := $new$(extract(hour from (now() at time zone 'Asia/Jakarta')) >= 7 AND extract(hour from (now() at time zone 'Asia/Jakarta')) < 14)$new$;
  old_shift_sore text := $old$extract(hour from (now() at time zone 'Asia/Jakarta')) between 15 and 20$old$;
  new_shift_sore text := $new$(extract(hour from (now() at time zone 'Asia/Jakarta')) >= 14 AND extract(hour from (now() at time zone 'Asia/Jakarta')) < 21)$new$;
  old_batch text := $old$      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stok % tidak mencukupi.', v_product.nama_obat;
      END IF;$old$;
  new_batch text := $new$      IF NOT FOUND THEN
        RAISE EXCEPTION 'Stok % tidak mencukupi.', v_product.nama_obat;
      END IF;
      -- FIFO can select an expired batch first. Never silently sell it:
      -- rollback checkout and ask the cashier to verify the physical package/ED.
      IF v_batch.expired_date IS NOT NULL
         AND v_batch.expired_date < v_tanggal
         AND coalesce((v_item->>'confirm_expired')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'EXPIRED_BATCH_CONFIRM_REQUIRED: Batch % untuk barang % tercatat kedaluwarsa pada %.',
          coalesce(nullif(v_batch.kode_batch, ''), v_batch.id_batch),
          v_product.nama_obat, v_batch.expired_date;
      END IF;$new$;
  old_reward text := $old$      BEGIN
        v_hasil_tukar := public.loyalty_tukar_periksa(v_cabang_id, p_reward_id, norm_wa(p_nomor_wa), v_subtotal, greatest(0, coalesce(p_diskon,0)));
      EXCEPTION WHEN others THEN
        v_hasil_tukar := NULL;
      END;$old$;
  new_reward text := $new$      -- A configuration/eligibility error must not fall back to weaker legacy rules.
      v_hasil_tukar := public.loyalty_tukar_periksa(v_cabang_id, p_reward_id, norm_wa(p_nomor_wa), v_subtotal, greatest(0, coalesce(p_diskon,0));$new$;
  found_function boolean := false;
BEGIN
  FOR r IN
    SELECT p.oid, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'pos_checkout'
      AND pg_get_function_arguments(p.oid) LIKE 'p_username text, p_nomor_wa text, p_nama_pelanggan text, p_tipe_customer text, p_items jsonb, p_diskon numeric, p_bayar numeric%'
  LOOP
    found_function := true;
    d := replace(r.def, E'\r\n', E'\n');

    -- Correct boundary times to Pagi 07:00-13:59 and Sore 14:00-20:59.
    IF position(old_shift_pagi IN d) > 0 THEN
      d := replace(d, old_shift_pagi, new_shift_pagi);
    ELSIF position(new_shift_pagi IN d) = 0 THEN
      RAISE EXCEPTION 'Tidak bisa mengenali batas shift Pagi pada pos_checkout; migrasi dibatalkan.';
    END IF;
    IF position(old_shift_sore IN d) > 0 THEN
      d := replace(d, old_shift_sore, new_shift_sore);
    ELSIF position(new_shift_sore IN d) = 0 THEN
      RAISE EXCEPTION 'Tidak bisa mengenali batas shift Sore pada pos_checkout; migrasi dibatalkan.';
    END IF;

    -- Add a safe, explicit confirmation gate after the server selects its actual FIFO batch.
    IF position(old_batch IN d) > 0 THEN
      d := replace(d, old_batch, new_batch);
    ELSIF position('EXPIRED_BATCH_CONFIRM_REQUIRED' IN d) = 0 THEN
      RAISE EXCEPTION 'Tidak bisa mengenali blok pemilihan batch pada pos_checkout; migrasi dibatalkan.';
    END IF;

    -- Never suppress configured reward validation errors and silently use weaker fallback rules.
    IF position(old_reward IN d) > 0 THEN
      d := replace(d, old_reward, new_reward);
    ELSIF position('v_hasil_tukar := public.loyalty_tukar_periksa' IN d) = 0
       OR position('EXCEPTION WHEN others THEN' IN substring(d FROM position('v_hasil_tukar := public.loyalty_tukar_periksa' IN d) FOR 1200)) > 0 THEN
      RAISE EXCEPTION 'Tidak bisa mengenali blok validasi reward pada pos_checkout; migrasi dibatalkan.';
    END IF;

    EXECUTE d;
  END LOOP;

  IF NOT found_function THEN
    RAISE EXCEPTION 'Fungsi public.pos_checkout tidak ditemukan; migrasi dibatalkan.';
  END IF;
END
$migration$;
