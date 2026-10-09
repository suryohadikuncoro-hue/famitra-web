-- Pengaturan markup harga jual per cabang dan penerapan atomik oleh Owner.
CREATE TABLE IF NOT EXISTS public.pengaturan_harga (
  cabang_id text PRIMARY KEY REFERENCES public.master_cabang(kode_cabang),
  mode text NOT NULL DEFAULT 'persen' CHECK (mode IN ('persen','rasio')),
  markup_umum_persen numeric CHECK (markup_umum_persen IS NULL OR markup_umum_persen BETWEEN 0 AND 1000),
  markup_nakes_persen numeric CHECK (markup_nakes_persen IS NULL OR markup_nakes_persen BETWEEN 0 AND 1000),
  markup_mutasi_persen numeric CHECK (markup_mutasi_persen IS NULL OR markup_mutasi_persen BETWEEN 0 AND 1000),
  pembulatan integer NOT NULL DEFAULT 100 CHECK (pembulatan IN (0,100,500,1000)),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.log_perubahan_harga (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cabang_id text NOT NULL REFERENCES public.master_cabang(kode_cabang),
  waktu timestamptz NOT NULL DEFAULT now(),
  oleh text NOT NULL,
  kode_obat text NOT NULL,
  tingkat text NOT NULL CHECK (tingkat IN ('umum','nakes','mutasi')),
  harga_lama numeric,
  harga_baru numeric NOT NULL,
  modal numeric NOT NULL,
  markup_persen numeric NOT NULL,
  pembulatan integer NOT NULL,
  sumber text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_perubahan_harga_cabang_waktu
  ON public.log_perubahan_harga(cabang_id, waktu DESC);

ALTER TABLE public.pengaturan_harga ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.log_perubahan_harga ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pengaturan_harga_service_role ON public.pengaturan_harga;
CREATE POLICY pengaturan_harga_service_role ON public.pengaturan_harga
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS log_perubahan_harga_service_role ON public.log_perubahan_harga;
CREATE POLICY log_perubahan_harga_service_role ON public.log_perubahan_harga
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.pengaturan_harga FROM public, anon, authenticated;
REVOKE ALL ON public.log_perubahan_harga FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.pengaturan_harga TO service_role;
GRANT SELECT, INSERT ON public.log_perubahan_harga TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.log_perubahan_harga_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.harga_dari_markup(
  p_modal numeric, p_persen numeric, p_pembulatan integer
) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN coalesce(p_modal,0) <= 0 OR p_persen IS NULL THEN NULL
    ELSE CASE WHEN p_persen = 0 THEN round(p_modal, 2)
      WHEN coalesce(p_pembulatan,0) > 0 THEN
        ceil(round(p_modal * (1 + p_persen / 100), 2) / p_pembulatan) * p_pembulatan
      ELSE round(p_modal * (1 + p_persen / 100), 2) END
  END
$function$;

CREATE OR REPLACE FUNCTION public.harga_markup_terapkan(
  p_username text, p_cabang_id text, p_kode_obat text[], p_tingkat text[],
  p_markup_umum_persen numeric, p_markup_nakes_persen numeric,
  p_markup_mutasi_persen numeric, p_pembulatan integer, p_sumber text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_cabang text; v_role text; v_kode text; v_tingkat text; v_modal numeric;
  v_persen numeric; v_baru numeric; v_lama numeric; v_ubah integer := 0; v_lewati integer := 0;
  v_col text; v_nilai jsonb := '[]'::jsonb;
BEGIN
  SELECT u.cabang_id, u.role INTO v_cabang, v_role FROM public.app_users u
   WHERE u.username = p_username AND u.aktif = 'YA';
  IF v_cabang IS NULL OR v_role <> 'Owner' THEN RAISE EXCEPTION 'Hanya Owner aktif yang boleh menerapkan markup.'; END IF;
  IF nullif(p_cabang_id,'') IS NOT NULL AND p_cabang_id <> v_cabang THEN RAISE EXCEPTION 'Cabang tidak sesuai sesi.'; END IF;
  IF p_pembulatan NOT IN (0,100,500,1000) THEN RAISE EXCEPTION 'Pembulatan tidak valid.'; END IF;
  IF p_kode_obat IS NULL OR cardinality(p_kode_obat) = 0 THEN RETURN jsonb_build_object('berubah',0,'dilewati',0); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('harga_markup:' || v_cabang));
  FOREACH v_kode IN ARRAY p_kode_obat LOOP
    SELECT m.harga_modal INTO v_modal FROM public.master_barang m
     WHERE m.cabang_id=v_cabang AND m.kode_obat=upper(v_kode) AND m.aktif='YA' FOR UPDATE;
    IF v_modal IS NULL OR v_modal <= 0 THEN v_lewati := v_lewati + 1; CONTINUE; END IF;
    FOREACH v_tingkat IN ARRAY p_tingkat LOOP
      v_persen := CASE v_tingkat WHEN 'umum' THEN p_markup_umum_persen WHEN 'nakes' THEN p_markup_nakes_persen WHEN 'mutasi' THEN p_markup_mutasi_persen ELSE NULL END;
      v_col := CASE v_tingkat WHEN 'umum' THEN 'harga_jual_umum' WHEN 'nakes' THEN 'harga_khusus' WHEN 'mutasi' THEN 'harga_jual_mutasi' ELSE NULL END;
      IF v_persen IS NULL OR v_col IS NULL THEN v_lewati := v_lewati + 1; CONTINUE; END IF;
      v_baru := public.harga_dari_markup(v_modal, v_persen, p_pembulatan);
      EXECUTE format('SELECT %I FROM public.master_barang WHERE cabang_id=$1 AND kode_obat=$2 FOR UPDATE',v_col) INTO v_lama USING v_cabang, upper(v_kode);
      IF v_baru IS NULL OR v_baru <= 0 OR v_baru IS NOT DISTINCT FROM v_lama THEN v_lewati := v_lewati + 1; CONTINUE; END IF;
      EXECUTE format('UPDATE public.master_barang SET %I=$1, updated_at=now() WHERE cabang_id=$2 AND kode_obat=$3',v_col) USING v_baru,v_cabang,upper(v_kode);
      INSERT INTO public.log_perubahan_harga(cabang_id,oleh,kode_obat,tingkat,harga_lama,harga_baru,modal,markup_persen,pembulatan,sumber)
       VALUES(v_cabang,p_username,upper(v_kode),v_tingkat,v_lama,v_baru,v_modal,v_persen,p_pembulatan,coalesce(nullif(p_sumber,''),'markup'));
      v_ubah := v_ubah + 1;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('berubah',v_ubah,'dilewati',v_lewati);
END
$function$;

REVOKE ALL ON FUNCTION public.harga_dari_markup(numeric,numeric,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.harga_markup_terapkan(text,text,text[],text[],numeric,numeric,numeric,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.harga_markup_terapkan(text,text,text[],text[],numeric,numeric,numeric,integer,text) TO service_role;
