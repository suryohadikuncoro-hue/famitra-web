-- Shift aktif diambil dari definisi PostgreSQL, bukan ditulis dari ingatan.
DO $$
DECLARE
  r record;
  d text;
  n text;
BEGIN
  -- Ambil definisi aktif dari katalog PostgreSQL, lalu ubah hanya CASE shift.
  FOR r IN
    SELECT p.oid, n.nspname, p.proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'pos_checkout'
  LOOP
    d := r.def;
    d := regexp_replace(d,
      'CASE\s+WHEN\s+extract\(hour\s+from\s+\(now\(\)\s+at\s+time\s+zone\s+''Asia/Jakarta''\)\)\s+between\s+8\s+and\s+14\s+THEN\s+''Pagi''\s+WHEN\s+extract\(hour\s+from\s+\(now\(\)\s+at\s+time\s+zone\s+''Asia/Jakarta''\)\)\s+between\s+15\s+and\s+20\s+THEN\s+''Sore''\s+ELSE\s+''Luar Jam''\s+END',
      'CASE WHEN extract(hour from (now() at time zone ''Asia/Jakarta'')) >= 7 AND extract(hour from (now() at time zone ''Asia/Jakarta'')) < 14 THEN ''Pagi'' WHEN extract(hour from (now() at time zone ''Asia/Jakarta'')) >= 14 AND extract(hour from (now() at time zone ''Asia/Jakarta'')) < 21 THEN ''Sore'' ELSE ''Luar Jam'' END',
      1, 'n');
    IF d = r.def THEN
      d := replace(d, 'between 8 and 14', '>= 7 AND extract(hour from (now() at time zone ''Asia/Jakarta'')) < 14');
      d := replace(d, 'between 15 and 20', '>= 14 AND extract(hour from (now() at time zone ''Asia/Jakarta'')) < 21');
    END IF;
    IF d <> r.def THEN EXECUTE d; END IF;
  END LOOP;
END $$;

