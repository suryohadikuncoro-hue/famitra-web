-- Migrasi: Isolasi cabang untuk RPC marketing_save_target_omset
-- Tanggal: 2026-09-28
--
-- Lapis kedua (keputusan 7 di docs/rencana-isolasi-cabang.md): selain dicek di
-- Edge Function `marketing`, RPC ini sekarang menolak kode_cabang yang tidak sama
-- dengan cabang_id sesi, termasuk untuk Owner. Isi fungsi lainnya sama persis
-- dengan 20260928020000_fix_marketing_save_target_omset_ambiguous_id.sql.

create or replace function public.marketing_save_target_omset(
  p_token text,
  p_data jsonb
)
returns table(id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.app_sessions;
  v_id uuid;
  v_kode_cabang text;
  v_nama text;
  v_periode_mulai date;
  v_periode_selesai date;
  v_target_omset_idr numeric(14,2);
  v_aktif boolean;
  v_catatan text;
  v_existing_id uuid;
begin
  s := public.marketing_require_session(p_token);

  if s.role <> 'Owner' then
    raise exception 'Akses ditolak untuk role % pada target omset', s.role using errcode = '42501';
  end if;

  v_kode_cabang := p_data->>'kode_cabang';
  v_nama := p_data->>'nama';
  v_periode_mulai := (p_data->>'periode_mulai')::date;
  v_periode_selesai := (p_data->>'periode_selesai')::date;
  v_target_omset_idr := (p_data->>'target_omset_idr')::numeric;
  v_aktif := coalesce((p_data->>'aktif')::boolean, true);
  v_catatan := p_data->>'catatan';

  if v_kode_cabang is null or length(trim(v_kode_cabang)) = 0 then
    raise exception 'kode_cabang wajib diisi' using errcode = '22023';
  end if;
  -- Isolasi cabang: Owner pun hanya boleh mengelola target cabang sesinya.
  if trim(v_kode_cabang) <> trim(coalesce(s.cabang_id, '')) then
    raise exception 'Akses cabang ditolak: target hanya boleh untuk cabang sesi' using errcode = '42501';
  end if;
  if v_nama is null or length(trim(v_nama)) = 0 then
    raise exception 'nama target wajib diisi' using errcode = '22023';
  end if;
  if v_periode_mulai is null or v_periode_selesai is null then
    raise exception 'periode_mulai dan periode_selesai wajib diisi' using errcode = '22023';
  end if;
  if v_periode_selesai < v_periode_mulai then
    raise exception 'periode_selesai tidak boleh sebelum periode_mulai' using errcode = '22023';
  end if;
  if v_target_omset_idr is null or v_target_omset_idr < 0 then
    raise exception 'target_omset_idr tidak valid' using errcode = '22023';
  end if;

  v_id := (p_data->>'id')::uuid;

  if v_id is not null then
    select mto.id into v_existing_id
    from public.marketing_target_omsets mto
    where mto.id = v_id and mto.kode_cabang = v_kode_cabang
    limit 1;

    if not found then
      raise exception 'Target omset tidak ditemukan atau bukan milik cabang ini' using errcode = 'P0002';
    end if;

    update public.marketing_target_omsets as mto
    set
      nama_target = v_nama,
      periode_mulai = v_periode_mulai,
      periode_selesai = v_periode_selesai,
      target_omset_idr = v_target_omset_idr,
      aktif = v_aktif,
      catatan = v_catatan,
      updated_at = now()
    where mto.id = v_id
    returning mto.id into v_id;
  else
    insert into public.marketing_target_omsets as mto (
      kode_cabang, nama_target, periode_mulai, periode_selesai,
      target_omset_idr, aktif, catatan, created_by
    ) values (
      v_kode_cabang, v_nama, v_periode_mulai, v_periode_selesai,
      v_target_omset_idr, v_aktif, v_catatan, s.username
    )
    returning mto.id into v_id;
  end if;

  return query select v_id;
end;
$$;

revoke all on function public.marketing_save_target_omset(text, jsonb) from public, anon, authenticated;
grant execute on function public.marketing_save_target_omset(text, jsonb) to service_role;
