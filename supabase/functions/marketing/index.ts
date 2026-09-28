// supabase/functions/marketing/index.ts
// Edge Function: Target Omset & Dashboard Laba Bersih Marketing
//
// Akses:
//   - Owner       : boleh CRUD target omset + baca dashboard (cabang sendiri)
//   - Apoteker    : baca target omset + baca dashboard (cabang sendiri)
//   - Kasir       : baca target omset + baca dashboard (cabang sendiri)
//
// Isolasi cabang: SEMUA role (termasuk Owner) dikunci ke cabang_id sesi,
// mengikuti docs/rencana-isolasi-cabang.md ("Owner hanya mengelola cabangnya
// sendiri"). kode_cabang dari payload tidak pernah dipercaya; kalau berbeda
// dengan cabang sesi, request ditolak.
//
// Actions:
//   targetOmsetList            - daftar target (semua role; Kasir/Apoteker dikunci ke cabang sendiri)
//   targetOmsetSave            - buat/update target (Owner only)
//   targetOmsetDelete          - hapus target (Owner only)
//   targetOmsetStatus          - aktif/non-aktif target (Owner only)
//   dashboardLaba              - ringkasan 1 target: progress omset, HPP, biaya_op, laba
//   dashboardProgressPerCabang - ringkasan semua cabang (semua role, tanpa raw transaksi)
//
// Perhitungan laba bersih = omset (harga_akhir) - total_hpp - SUM(biaya_operasional.nominal)
// Biaya operasional dibaca dari tabel biaya_operasional yang sudah ada di sistem.
//
// Aturan visibilitas laba (sesuai permintaan Owner):
//   - Sebelum target tercapai: laba TIDAK ditampilkan ke user (null)
//   - Setelah target tercapai: laba ditampilkan
//   - Progress omset selalu ditampilkan (semua role, semua kondisi)
//   - HPP tetap disembunyikan dari semua role (Owner tidak minta ekspos)

// @ts-nocheck — Deno runtime, jalankan via Dashboard paste manual

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error("SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib di-set di environment Edge Function");
}

const REST = `${SUPABASE_URL}/rest/v1`;
const headers = {
  "Content-Type": "application/json",
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

async function rest(path: string, init: RequestInit & { prefer?: string } = {}) {
  const h: Record<string, string> = { ...headers };
  if (init.prefer) h.Prefer = init.prefer;
  const res = await fetch(`${REST}${path}`, { ...init, headers: h });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    throw new Error(`REST ${path} -> ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

async function allRows(path: string, max = 200000) {
  const rows: any[] = [];
  for (;;) {
    const page = await rest(`${path}&limit=500&offset=${rows.length}`);
    if (!Array.isArray(page)) return rows;
    if (!page.length) return rows;
    rows.push(...page);
    if (rows.length > max) throw new Error("Data terlalu besar. Gunakan periode lebih pendek.");
  }
}

// -------------------- helpers --------------------

async function session(token: string | null) {
  if (!token) return null;
  const rows = await rest(
    `/app_sessions?token=eq.${encodeURIComponent(token)}&select=token,username,nama,role,cabang_id`,
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrThrow(v: any, label: string) {
  if (!v || typeof v !== "string" || !UUID_RE.test(v)) throw new Error(`${label} tidak valid (uuid)`);
  return v;
}
function dateStrOrThrow(v: any, label: string) {
  if (!v || typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${label} tidak valid (YYYY-MM-DD)`);
  return v;
}
function num(v: any, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function decimalAmount(v: any): { units: bigint; scale: number } {
  if (v === null || v === undefined) return { units: 0n, scale: 0 };
  const m = /^(-?)(\d+)(?:\.(\d+))?$/i.exec(String(v).trim());
  if (!m) return { units: 0n, scale: 0 };
  const scale = (m[3] || "").length;
  const units = BigInt(m[2] + (m[3] || "")) * (m[1] ? -1n : 1n);
  return { units, scale };
}
function decimalNumber(a: { units: bigint; scale: number }) {
  if (a.scale === 0) return Number(a.units);
  // up to 14.2 expected — keep precision by string conversion
  const sign = a.units < 0n ? "-" : "";
  const u = a.units < 0n ? -a.units : a.units;
  const s = u.toString().padStart(a.scale + 1, "0");
  return Number(`${sign}${s.slice(0, s.length - a.scale)}.${s.slice(s.length - a.scale)}`);
}
function addDecimal(a: { units: bigint; scale: number }, b: { units: bigint; scale: number }) {
  const scale = Math.max(a.scale, b.scale);
  return {
    units:
      a.units * 10n ** BigInt(scale - a.scale) +
      b.units * 10n ** BigInt(scale - b.scale),
    scale,
  };
}

// Cabang SELALU dari sesi, untuk semua role (termasuk Owner).
function cabangSesi(s: any, requested?: string | null) {
  const branch = String(s.cabang_id || "").trim();
  if (!branch) throw new Error("Sesi ini tidak punya cabang. Hubungi Owner.");
  if (requested && String(requested).trim() !== branch) throw new Error("Akses cabang ditolak");
  return branch;
}

// -------------------- actions --------------------

async function targetOmsetList(data: any, s: any) {
  const filterCabang = cabangSesi(s, data?.kode_cabang);
  const onlyAktif = data?.only_aktif === true;

  let path = `/marketing_target_omsets?order=updated_at.desc&kode_cabang=eq.${encodeURIComponent(filterCabang)}`;
  if (onlyAktif) path += `&aktif=eq.true`;

  const rows = await rest(path);

  // Halaman "Kelola Target Omset" hanya bisa diakses Owner (dienforce juga di sini,
  // bukan cuma di frontend) dan hanya berisi target cabang sesi. Untuk Owner, laba bersih SELALU ditampilkan di sini,
  // terlepas dari status tercapai — beda dengan dashboard "Progress per Cabang"
  // (dashboardProgressPerCabang) yang tetap menyembunyikan laba sebelum target tercapai.
  if (s.role === "Owner" && Array.isArray(rows) && rows.length) {
    for (const t of rows) {
      const agg = await aggregateTarget(t);
      const omset = num(agg.omset_idr, 0);
      const hpp = agg.hpp_available ? num(agg.total_hpp_idr, 0) : null;
      const biaya = num(agg.biaya_operasional_idr, 0);
      t.omset_idr = omset;
      t.total_hpp_idr = hpp;
      t.biaya_operasional_idr = biaya;
      t.laba_bersih_idr = hpp !== null ? omset - hpp - biaya : null;
      t.hpp_available = agg.hpp_available;
      t.transaksi_count = agg.transaksi_count;
    }
  }

  return rows;
}

async function targetOmsetSave(data: any, s: any) {
  if (s.role !== "Owner") throw new Error("Hanya Owner yang boleh menyimpan target omset");
  // Target hanya boleh dibuat/diubah untuk cabang sesi.
  const kode_cabang = cabangSesi(s, data?.kode_cabang || null);

  // Validasi via RPC (server-side enforcement: role check + unique active per branch)
  const payload = {
    id: data?.id || null,
    kode_cabang,
    nama: String(data?.nama || "").trim(),
    periode_mulai: dateStrOrThrow(data?.periode_mulai, "periode_mulai"),
    periode_selesai: dateStrOrThrow(data?.periode_selesai, "periode_selesai"),
    target_omset_idr: num(data?.target_omset_idr, 0),
    aktif: data?.aktif === false ? false : true,
    catatan: data?.catatan ?? null,
  };
  if (!payload.nama) throw new Error("nama target wajib diisi");

  const rows = await rest(`/rpc/marketing_save_target_omset`, {
    method: "POST",
    body: JSON.stringify({ p_token: s.token, p_data: payload }),
  });
  return { id: rows?.[0]?.id || null };
}

async function targetOmsetDelete(data: any, s: any) {
  if (s.role !== "Owner") throw new Error("Hanya Owner yang boleh menghapus target omset");
  const id = uuidOrThrow(data?.id, "id target");
  // Pastikan milik cabang yang sesuai
  const cur = await rest(`/marketing_target_omsets?id=eq.${id}&limit=1&select=id,kode_cabang`);
  const row = cur?.[0];
  if (!row) throw new Error("Target tidak ditemukan");
  cabangSesi(s, row.kode_cabang);
  await rest(`/marketing_target_omsets?id=eq.${id}`, { method: "DELETE" });
  return { id };
}

async function targetOmsetStatus(data: any, s: any) {
  if (s.role !== "Owner") throw new Error("Hanya Owner yang boleh mengubah status target");
  const id = uuidOrThrow(data?.id, "id target");
  const aktif = data?.aktif === true;
  const cur = await rest(`/marketing_target_omsets?id=eq.${id}&limit=1&select=id,kode_cabang`);
  const row = cur?.[0];
  if (!row) throw new Error("Target tidak ditemukan");
  cabangSesi(s, row.kode_cabang);
  await rest(`/marketing_target_omsets?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ aktif, updated_at: new Date().toISOString() }),
  });
  return { id, aktif };
}

// Ambil data agregat: omset & total_hpp (dari trx_penjualan), biaya_op (dari biaya_operasional)
// untuk 1 target di cabang & periode-nya.
async function aggregateTarget(t: any) {
  const kode_cabang = String(t.kode_cabang || "").trim();
  const periode_mulai = String(t.periode_mulai);
  const periode_selesai = String(t.periode_selesai);

  const trxPath =
    `/trx_penjualan?select=harga_akhir,total_hpp&cabang_id=eq.${encodeURIComponent(kode_cabang)}` +
    `&tanggal=gte.${periode_mulai}&tanggal=lte.${periode_selesai}&limit=100000`;

  const trx = await allRows(trxPath);

  let omsetDec = { units: 0n, scale: 0 };
  let hppDec = { units: 0n, scale: 0 };
  let hppAvailable = true;
  let hppMissing = 0;

  for (const r of trx) {
    omsetDec = addDecimal(omsetDec, decimalAmount(r.harga_akhir));
    if (r.total_hpp === null || r.total_hpp === undefined || r.total_hpp === "") {
      hppMissing += 1;
      continue;
    }
    hppDec = addDecimal(hppDec, decimalAmount(r.total_hpp));
  }
  if (hppMissing > 0 && hppMissing === trx.length) hppAvailable = false;

  const biayaPath =
    `/biaya_operasional?select=nominal&cabang_id=eq.${encodeURIComponent(kode_cabang)}` +
    `&tanggal=gte.${periode_mulai}&tanggal=lte.${periode_selesai}&limit=100000`;
  const biaya = await allRows(biayaPath);

  let biayaDec = { units: 0n, scale: 0 };
  for (const b of biaya) biayaDec = addDecimal(biayaDec, decimalAmount(b.nominal));

  const omset = decimalNumber(omsetDec);
  const hpp = hppAvailable ? decimalNumber(hppDec) : null;
  const biayaOp = decimalNumber(biayaDec);

  return {
    omset_idr: omset,
    total_hpp_idr: hpp,
    biaya_operasional_idr: biayaOp,
    hpp_available: hppAvailable,
    transaksi_count: trx.length,
    biaya_count: biaya.length,
  };
}

// Hitung laba dengan aturan visibilitas:
//   - progress & omset selalu tampil
//   - laba tampil HANYA jika omset >= target_omset_idr
function withVisibility(agg: any, t: any) {
  const target = num(t.target_omset_idr, 0);
  const omset = num(agg.omset_idr, 0);
  const tercapai = omset >= target;

  const result: any = {
    target_omset_idr: target,
    omset_idr: omset,
    tercapai,
    progress_persen: target > 0 ? Math.min(100, (omset / target) * 100) : 0,
    transaksi_count: agg.transaksi_count,
    biaya_operasional_count: agg.biaya_count,
  };

  if (tercapai && agg.hpp_available) {
    const hpp = num(agg.total_hpp_idr, 0);
    const biaya = num(agg.biaya_operasional_idr, 0);
    const laba = omset - hpp - biaya;
    result.total_hpp_idr = hpp;
    result.biaya_operasional_idr = biaya;
    result.laba_bersih_idr = laba;
  } else if (tercapai && !agg.hpp_available) {
    result.total_hpp_idr = null;
    result.biaya_operasional_idr = num(agg.biaya_operasional_idr, 0);
    result.laba_bersih_idr = null;
    result.catatan = "HPP tidak tersedia/lengkap; laba tidak dapat dihitung.";
  } else {
    // sebelum tercapai: HPP & biaya_op & laba disembunyikan
    result.total_hpp_idr = null;
    result.biaya_operasional_idr = null;
    result.laba_bersih_idr = null;
  }

  return result;
}

async function dashboardLaba(data: any, s: any) {
  const id = uuidOrThrow(data?.id, "id target");
  const rows = await rest(`/marketing_target_omsets?id=eq.${id}&limit=1`);
  const t = rows?.[0];
  if (!t) throw new Error("Target tidak ditemukan");
  cabangSesi(s, t.kode_cabang);

  const agg = await aggregateTarget(t);
  return { target: t, ringkasan: withVisibility(agg, t) };
}

async function dashboardProgressPerCabang(_data: any, s: any) {
  // Hanya cabang sesi — omset & laba cabang lain tidak pernah dikirim.
  const cab = encodeURIComponent(cabangSesi(s));
  const cabangs = await rest(`/master_cabang?kode_cabang=eq.${cab}&select=kode_cabang,nama_cabang`);

  // Target aktif cabang sesi (maks. 1 row by unique index).
  const targets = await allRows(`/marketing_target_omsets?aktif=eq.true&kode_cabang=eq.${cab}&select=id,kode_cabang,nama_target,periode_mulai,periode_selesai,target_omset_idr`);

  const byCab = new Map<string, any>();
  for (const t of targets) byCab.set(String(t.kode_cabang), t);

  const out: any[] = [];
  for (const c of cabangs || []) {
    const kode = String(c.kode_cabang);
    const t = byCab.get(kode);
    if (!t) {
      out.push({
        kode_cabang: kode,
        nama_cabang: c.nama_cabang,
        target: null,
        ringkasan: null,
      });
      continue;
    }
    const agg = await aggregateTarget(t);
    out.push({
      kode_cabang: kode,
      nama_cabang: c.nama_cabang,
      target: { id: t.id, nama: t.nama_target, periode_mulai: t.periode_mulai, periode_selesai: t.periode_selesai, target_omset_idr: num(t.target_omset_idr, 0) },
      ringkasan: withVisibility(agg, t),
    });
  }
  return out;
}

const handlers: Record<string, (data: any, s: any) => Promise<any>> = {
  targetOmsetList,
  targetOmsetSave,
  targetOmsetDelete,
  targetOmsetStatus,
  dashboardLaba,
  dashboardProgressPerCabang,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const [name, data, token] = body.args || [];
    const s = await session(token);
    if (!s) return json({ ok: false, error: "Sesi berakhir. Silakan login ulang.", code: "NO_SESSION" }, 401);

    // Role allowlist
    const allowedRoles = ["Owner", "Apoteker", "Kasir"];
    if (!allowedRoles.includes(s.role)) {
      return json({ ok: false, error: `Akses ditolak untuk role ${s.role}` }, 403);
    }

    const fn = handlers[name];
    if (!fn) return json({ ok: false, error: `Aksi tidak dikenal: ${name}` }, 400);

    // Lock-branch untuk semua role (termasuk Owner)
    try { cabangSesi(s, data?.kode_cabang); } catch (e: any) {
      return json({ ok: false, error: e?.message || "Akses cabang ditolak" }, 403);
    }

    const result = await fn(data || {}, s);
    return json({ ok: true, data: result });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
});