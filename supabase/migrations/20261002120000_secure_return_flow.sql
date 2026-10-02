-- Harden all return writes and approvals in one database transaction.
-- The Edge Function remains responsible for session/role authorization; these RPCs
-- enforce branch ownership, source-document integrity, quantities and stock effects.

BEGIN;

CREATE OR REPLACE FUNCTION public.retur_jual_simpan(
  p_username text,
  p_cabang_id text,
  p_no_nota text,
  p_alasan text,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user_cabang text;
  v_orig record;
  v_item jsonb;
  v_code text;
  v_batch text;
  v_condition text;
  v_qty numeric;
  v_sold numeric;
  v_returned numeric;
  v_price numeric;
  v_subtotal numeric;
  v_total numeric := 0;
  v_no text;
BEGIN
  IF nullif(trim(p_username), '') IS NULL OR nullif(trim(p_cabang_id), '') IS NULL THEN
    RAISE EXCEPTION 'Petugas dan cabang wajib diisi.';
  END IF;
  SELECT cabang_id INTO v_user_cabang FROM app_users
    WHERE username = p_username AND aktif = 'YA';
  IF v_user_cabang IS NULL OR v_user_cabang <> p_cabang_id THEN
    RAISE EXCEPTION 'Petugas tidak berwenang pada cabang ini.';
  END IF;
  IF nullif(trim(p_no_nota), '') IS NULL THEN RAISE EXCEPTION 'Nota asal wajib diisi.'; END IF;
  IF nullif(trim(p_alasan), '') IS NULL THEN RAISE EXCEPTION 'Alasan retur wajib diisi.'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Detail retur kosong.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('retur_jual:' || p_cabang_id || ':' || p_no_nota));
  SELECT * INTO v_orig FROM trx_penjualan
    WHERE no_nota = p_no_nota AND cabang_id = p_cabang_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nota asal tidak ditemukan pada cabang aktif.'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items)
      AS x(kode_obat text, kode_batch text, qty numeric, kondisi text)
    WHERE nullif(trim(kode_obat), '') IS NULL OR nullif(trim(kode_batch), '') IS NULL
       OR qty IS NULL OR qty <= 0 OR coalesce(kondisi, 'Baik') NOT IN ('Baik','Rusak','Kedaluwarsa')
  ) THEN RAISE EXCEPTION 'Detail retur penjualan tidak valid.'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items)
      AS x(kode_obat text, kode_batch text, qty numeric, kondisi text)
    GROUP BY kode_obat, kode_batch HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Item retur yang sama tidak boleh dikirim lebih dari sekali.'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_code := upper(v_item->>'kode_obat');
    v_batch := v_item->>'kode_batch';
    v_qty := (v_item->>'qty')::numeric;
    SELECT coalesce(sum(d.qty), 0), max(d.harga_satuan)
      INTO v_sold, v_price
      FROM trx_penjualan_detail d
      WHERE d.no_nota = p_no_nota AND d.cabang_id = p_cabang_id
        AND d.kode_obat = v_code AND d.kode_batch = v_batch;
    IF v_sold <= 0 THEN RAISE EXCEPTION 'Item retur tidak ada pada nota asal: % / %.', v_code, v_batch; END IF;
    SELECT coalesce(sum(rd.qty), 0) INTO v_returned
      FROM trx_retur_jual rj
      JOIN trx_retur_jual_detail rd ON rd.no_retur = rj.no_retur AND rd.cabang_id = rj.cabang_id
      WHERE rj.no_nota_asal = p_no_nota AND rj.cabang_id = p_cabang_id
        AND rd.kode_obat = v_code AND rd.kode_batch = v_batch;
    IF v_qty > v_sold - v_returned THEN
      RAISE EXCEPTION 'Qty retur % / % melebihi sisa yang dapat diretur (%).', v_code, v_batch, v_sold - v_returned;
    END IF;
    v_subtotal := round(v_qty * coalesce(v_price, 0) *
      CASE WHEN coalesce(v_orig.subtotal, 0) > 0
        THEN coalesce(v_orig.harga_akhir, 0) / v_orig.subtotal ELSE 1 END);
    v_total := v_total + v_subtotal;
  END LOOP;

  v_no := 'RJ' || to_char((now() AT TIME ZONE 'Asia/Jakarta')::date, 'YYYYMMDD') || '-' ||
    substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  INSERT INTO trx_retur_jual
    (cabang_id, no_retur, no_nota_asal, tanggal, jam, nomor_wa, nama_pelanggan, petugas, shift, alasan, total_refund)
  VALUES
    (p_cabang_id, v_no, p_no_nota, (now() AT TIME ZONE 'Asia/Jakarta')::date,
     to_char(now() AT TIME ZONE 'Asia/Jakarta', 'HH24:MI'), v_orig.nomor_wa, v_orig.nama_pelanggan,
     p_username, CASE WHEN extract(hour FROM now() AT TIME ZONE 'Asia/Jakarta') >= 7
       AND extract(hour FROM now() AT TIME ZONE 'Asia/Jakarta') < 14 THEN 'Pagi'
       WHEN extract(hour FROM now() AT TIME ZONE 'Asia/Jakarta') >= 14
       AND extract(hour FROM now() AT TIME ZONE 'Asia/Jakarta') < 21 THEN 'Sore' ELSE 'Luar Jam' END,
     trim(p_alasan), v_total);

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_code := upper(v_item->>'kode_obat'); v_batch := v_item->>'kode_batch'; v_qty := (v_item->>'qty')::numeric;
    SELECT max(d.harga_satuan) INTO v_price FROM trx_penjualan_detail d
      WHERE d.no_nota = p_no_nota AND d.cabang_id = p_cabang_id
        AND d.kode_obat = v_code AND d.kode_batch = v_batch;
    v_subtotal := round(v_qty * coalesce(v_price, 0) *
      CASE WHEN coalesce(v_orig.subtotal, 0) > 0
        THEN coalesce(v_orig.harga_akhir, 0) / v_orig.subtotal ELSE 1 END);
    INSERT INTO trx_retur_jual_detail
      (cabang_id, no_retur, kode_obat, nama_obat, kode_batch, qty, harga_satuan, subtotal, kondisi)
    SELECT p_cabang_id, v_no, v_code, max(d.nama_obat), v_batch, v_qty, v_price, v_subtotal,
      coalesce(v_item->>'kondisi', 'Baik')
    FROM trx_penjualan_detail d
    WHERE d.no_nota = p_no_nota AND d.cabang_id = p_cabang_id
      AND d.kode_obat = v_code AND d.kode_batch = v_batch;
    UPDATE stok_batch SET stok_real = stok_real + v_qty, updated_at = now()
      WHERE cabang_id = p_cabang_id AND kode_obat = v_code AND kode_batch = v_batch;
    IF NOT FOUND THEN RAISE EXCEPTION 'Batch stok retur tidak ditemukan: % / %.', v_code, v_batch; END IF;
  END LOOP;
  RETURN jsonb_build_object('No_Retur', v_no, 'Total_Refund', v_total);
END;
$function$;

CREATE OR REPLACE FUNCTION public.retur_beli_simpan(
  p_username text, p_cabang_id text, p_no_faktur text, p_alasan text, p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user_cabang text; v_factur record; v_item jsonb; v_code text; v_batch text;
  v_qty numeric; v_bought numeric; v_returned numeric; v_price numeric; v_total numeric := 0; v_no text;
BEGIN
  SELECT cabang_id INTO v_user_cabang FROM app_users WHERE username=p_username AND aktif='YA';
  IF v_user_cabang IS NULL OR v_user_cabang <> p_cabang_id THEN RAISE EXCEPTION 'Petugas tidak berwenang pada cabang ini.'; END IF;
  IF nullif(trim(p_no_faktur),'') IS NULL OR nullif(trim(p_alasan),'') IS NULL THEN RAISE EXCEPTION 'Faktur dan alasan retur wajib diisi.'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Detail retur kosong.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('retur_beli:'||p_cabang_id||':'||p_no_faktur));
  SELECT * INTO v_factur FROM trx_pembelian WHERE no_faktur=p_no_faktur AND cabang_id=p_cabang_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Faktur asal tidak ditemukan pada cabang aktif.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) AS x(kode_obat text,kode_batch text,qty numeric,harga_netto numeric,kondisi text)
    WHERE nullif(trim(kode_obat),'') IS NULL OR nullif(trim(kode_batch),'') IS NULL OR qty IS NULL OR qty<=0
      OR coalesce(kondisi,'Baik') NOT IN ('Baik','Rusak','Kedaluwarsa')) THEN RAISE EXCEPTION 'Detail retur pembelian tidak valid.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) AS x(kode_obat text,kode_batch text,qty numeric,harga_netto numeric,kondisi text)
    GROUP BY kode_obat,kode_batch HAVING count(*)>1) THEN RAISE EXCEPTION 'Item retur yang sama tidak boleh dikirim lebih dari sekali.'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_code := upper(v_item->>'kode_obat'); v_batch := v_item->>'kode_batch'; v_qty := (v_item->>'qty')::numeric;
    SELECT coalesce(sum(d.qty),0), max(d.harga_netto) INTO v_bought,v_price FROM trx_pembelian_detail d
      WHERE d.no_faktur=p_no_faktur AND d.cabang_id=p_cabang_id AND d.kode_obat=v_code AND d.kode_batch=v_batch;
    IF v_bought<=0 THEN RAISE EXCEPTION 'Item tidak ada pada faktur asal: % / %.',v_code,v_batch; END IF;
    SELECT coalesce(sum(rd.qty),0) INTO v_returned FROM trx_retur_beli r
      JOIN trx_retur_beli_detail rd ON rd.no_retur=r.no_retur AND rd.cabang_id=r.cabang_id
      WHERE r.no_faktur_asal=p_no_faktur AND r.cabang_id=p_cabang_id AND r.status IN ('PENDING_APPROVAL','APPROVED')
        AND rd.kode_obat=v_code AND rd.kode_batch=v_batch;
    IF v_qty > v_bought-v_returned THEN RAISE EXCEPTION 'Qty retur % / % melebihi sisa (%).',v_code,v_batch,v_bought-v_returned; END IF;
    v_total := v_total + v_qty*v_price;
  END LOOP;
  v_no := 'RB'||to_char((now() AT TIME ZONE 'Asia/Jakarta')::date,'YYYYMMDD')||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,8);
  INSERT INTO trx_retur_beli(cabang_id,no_retur,no_faktur_asal,supplier,tanggal,created_by,status,alasan,total_refund)
    VALUES(p_cabang_id,v_no,p_no_faktur,v_factur.supplier,(now() AT TIME ZONE 'Asia/Jakarta')::date,p_username,'PENDING_APPROVAL',trim(p_alasan),v_total);
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_code:=upper(v_item->>'kode_obat'); v_batch:=v_item->>'kode_batch'; v_qty:=(v_item->>'qty')::numeric;
    SELECT max(d.harga_netto) INTO v_price FROM trx_pembelian_detail d WHERE d.no_faktur=p_no_faktur AND d.cabang_id=p_cabang_id AND d.kode_obat=v_code AND d.kode_batch=v_batch;
    INSERT INTO trx_retur_beli_detail(cabang_id,no_retur,kode_obat,nama_obat,kode_batch,qty,harga_netto,subtotal,kondisi)
      SELECT p_cabang_id,v_no,v_code,max(d.nama_obat),v_batch,v_qty,v_price,v_qty*v_price,coalesce(v_item->>'kondisi','Baik')
      FROM trx_pembelian_detail d WHERE d.no_faktur=p_no_faktur AND d.cabang_id=p_cabang_id AND d.kode_obat=v_code AND d.kode_batch=v_batch;
  END LOOP;
  RETURN jsonb_build_object('No_Retur',v_no,'Total_Refund',v_total,'Status','PENDING_APPROVAL');
END;
$function$;

CREATE OR REPLACE FUNCTION public.retur_beli_approve(
  p_username text, p_cabang_id text, p_no_retur text, p_keputusan text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_user_cabang text; v_head record; v_item record; v_status text;
BEGIN
  SELECT cabang_id INTO v_user_cabang FROM app_users WHERE username=p_username AND aktif='YA';
  IF v_user_cabang IS NULL OR v_user_cabang <> p_cabang_id THEN RAISE EXCEPTION 'Approver tidak berwenang pada cabang ini.'; END IF;
  IF upper(p_keputusan) NOT IN ('APPROVE','REJECT') THEN RAISE EXCEPTION 'Keputusan approval tidak valid.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('retur_beli_approve:'||p_cabang_id||':'||p_no_retur));
  SELECT * INTO v_head FROM trx_retur_beli WHERE no_retur=p_no_retur AND cabang_id=p_cabang_id AND status='PENDING_APPROVAL' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Retur tidak ditemukan atau sudah diproses.'; END IF;
  IF v_head.created_by = p_username THEN RAISE EXCEPTION 'Pembuat retur tidak dapat menyetujui retur yang sama.'; END IF;
  v_status := CASE WHEN upper(p_keputusan)='APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END;
  IF v_status='APPROVED' THEN
    FOR v_item IN SELECT * FROM trx_retur_beli_detail WHERE no_retur=p_no_retur AND cabang_id=p_cabang_id FOR UPDATE LOOP
      UPDATE stok_batch SET stok_real=stok_real-v_item.qty, updated_at=now()
        WHERE cabang_id=p_cabang_id AND kode_obat=v_item.kode_obat AND kode_batch=v_item.kode_batch
          AND stok_real >= v_item.qty;
      IF NOT FOUND THEN RAISE EXCEPTION 'Stok batch % / % tidak mencukupi untuk retur supplier.',v_item.kode_obat,v_item.kode_batch; END IF;
    END LOOP;
  END IF;
  UPDATE trx_retur_beli SET status=v_status, approved_by=p_username,
    tanggal_approval=(now() AT TIME ZONE 'Asia/Jakarta')::date
    WHERE no_retur=p_no_retur AND cabang_id=p_cabang_id;
  RETURN jsonb_build_object('No_Retur',p_no_retur,'Status',v_status);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.retur_jual_simpan(text,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.retur_beli_simpan(text,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.retur_beli_approve(text,text,text,text) TO service_role;

COMMIT;
