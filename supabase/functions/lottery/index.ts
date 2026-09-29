// Kupon Undian: offline winner recording, not an automated draw.
// @ts-nocheck
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_KEY");
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Konfigurasi backend lottery belum lengkap");
const headers = { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, { ...init, headers: { ...headers, ...(init.prefer ? { Prefer: init.prefer } : {}) } });
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) {
    // Never return request URLs (session tokens) or arbitrary DB details to browsers.
    const e = new Error(body?.code === "P0001" ? body.message : "Gagal mengakses data lottery. Coba lagi atau hubungi Owner.");
    e.dbCode = body?.code; e.status = body?.code === "P0001" ? 400 : 500;
    throw e;
  }
  return body;
}
// PostgREST can cap rows below the requested limit. Advance by rows received,
// not by requested size; stop only at an empty page. Never silently truncate.
async function allRows(path) {
  const rows = [];
  for (;;) {
    const page = await rest(`${path}&limit=500&offset=${rows.length}`);
    if (!Array.isArray(page)) fail("Respons data lottery tidak valid", 502);
    if (!page.length) return rows;
    rows.push(...page);
    if (rows.length > 200000) fail("Data terlalu besar. Gunakan periode campaign lebih pendek.", 422);
  }
}
async function session(token) {
  if (typeof token !== "string" || !token.trim()) return null;
  const rows = await rest(`/app_sessions?token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=token,username,nama,role,cabang_id,expires_at&limit=1`);
  const s = rows?.[0];
  return s && Date.parse(s.expires_at) > Date.now() ? s : null;
}
function allowed(role) { return role === "Owner" || role === "Apoteker"; }
function cabangSesi(s, requested) {
  if (s.role === "Owner") return requested ? String(requested).trim() : null;
  const branch = String(s.cabang_id || "").trim();
  if (!branch) fail("Sesi ini tidak punya cabang. Hubungi Owner.", 403);
  if (requested && requested !== branch) fail("Akses cabang ditolak", 403);
  return branch;
}
function authorizeCampaign(s, c) {
  const branch = cabangSesi(s);
  if (!c || !c.kode_cabang) fail("Campaign tidak ditemukan", 404);
  if (branch && c.kode_cabang !== branch) fail("Akses cabang ditolak", 403);
  return c;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(v, label) { if (typeof v !== "string" || !UUID_RE.test(v)) fail(`${label} tidak valid`); return v; }
function date(v, label) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) fail(`${label} tidak valid`);
  return v;
}
// Same numeric(14,2) contract as the campaign column/RPC; never coerce blanks,
// booleans, non-finite values or excess precision into a valid zero threshold.
function minimumSpend(v) {
  if (!["string", "number"].includes(typeof v) || String(v).trim() !== String(v) || !/^\d{1,12}(\.\d{1,2})?$/.test(String(v))) fail("Minimum total belanja harus 0–999999999999.99, maksimal 2 desimal");
  return Number(v);
}
// Syarat transaksi Kupon Undian: jumlah transaksi minimum (bilangan bulat 1-1000)
// dan minimal belanja per transaksi (numeric(14,2), sama seperti minimum total).
function minimumTransaksi(v) {
  if (!["string", "number"].includes(typeof v) || String(v).trim() !== String(v) || !/^\d{1,4}$/.test(String(v)) || Number(v) < 1 || Number(v) > 1000) fail("Minimal jumlah transaksi harus bilangan bulat 1–1000");
  return Number(v);
}
function minimumPerTransaksi(v) {
  if (!["string", "number"].includes(typeof v) || String(v).trim() !== String(v) || !/^\d{1,12}(\.\d{1,2})?$/.test(String(v))) fail("Minimal belanja per transaksi harus 0–999999999999.99, maksimal 2 desimal");
  return Number(v);
}
// Keep the authoritative NUMERIC amount as a decimal while aggregating. Do not
// round each invoice before the eligibility comparison (or use float sums).
function decimalAmount(v) {
  if (!["string", "number"].includes(typeof v)) fail("Nilai transaksi tidak lengkap", 422);
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(v));
  if (!m) fail("Nilai transaksi tidak valid", 422);
  const scale = (m[3] || "").length - Number(m[4] || 0);
  if (Math.abs(scale) > 1000) fail("Nilai transaksi di luar batas", 422);
  let units = BigInt(m[2] + (m[3] || "")) * (m[1] ? -1n : 1n);
  if (scale < 0) units *= 10n ** BigInt(-scale);
  return { units, scale: Math.max(0, scale) };
}
function addDecimal(a, b) {
  const scale = Math.max(a.scale, b.scale);
  return { units: a.units * 10n ** BigInt(scale - a.scale) + b.units * 10n ** BigInt(scale - b.scale), scale };
}
function decimalAtLeast(a, b) {
  return a.units * 10n ** BigInt(b.scale) >= b.units * 10n ** BigInt(a.scale);
}
function decimalNumber(a) { return Number(a.units) / 10 ** a.scale; }
function money(v) { if (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) return null; return Math.round(Number(v) * 100); }
function total(rows, key) { let cents = 0; for (const r of rows) { const n = money(r[key]); if (n === null) return null; cents += n; } return cents / 100; }
async function campaign(id, s) {
  uuid(id, "Campaign");
  const rows = await rest(`/lottery_campaigns?id=eq.${id}&limit=1`);
  return authorizeCampaign(s, rows?.[0]);
}
function period(c) {
  // Schema: trx_penjualan.tanggal is DATE in the business calendar, not timestamp.
  const from = date(c.periode_mulai, "Periode mulai"), to = date(c.periode_selesai, "Periode selesai");
  if (to < from) fail("Periode selesai sebelum periode mulai");
  return `cabang_id=eq.${encodeURIComponent(c.kode_cabang)}&tanggal=gte.${from}&tanggal=lte.${to}`;
}
async function participantData(c, withHpp = false) {
  const customers = await allRows(`/master_customer?cabang_id=eq.${encodeURIComponent(c.kode_cabang)}&tipe_customer=neq.Apotek%20Lain&nomor_wa=not.is.null&select=id,nomor_wa,nama,tipe_customer,segment_crm&order=id.asc`);
  const eligible = customers.filter(x => String(x.nomor_wa || "").trim() && x.tipe_customer !== "Apotek Lain");
  const wa = new Set(eligible.map(x => String(x.nomor_wa).trim()));
  const base = `/trx_penjualan?${period(c)}&nomor_wa=not.is.null&order=no_nota.asc&select=no_nota,nomor_wa,harga_akhir::text`;
  let trx, hppAvailable = withHpp;
  try { trx = await allRows(base + (withHpp ? ",total_hpp" : "")); }
  catch (e) {
    if (!withHpp || !["42703", "PGRST204"].includes(e.dbCode)) throw e;
    trx = await allRows(base); hppAvailable = false;
  }
  const matched = trx.filter(t => wa.has(String(t.nomor_wa || "").trim()));
  const minimum = decimalAmount(minimumSpend(c.min_total_belanja_idr === undefined ? 0 : c.min_total_belanja_idr));
  // Hanya transaksi dengan harga_akhir >= minimal per transaksi yang DIHITUNG (jumlah maupun
  // total belanja). Default 0 / 1 = perilaku lama. Kolom belum ada (migrasi belum diterapkan) = default.
  const perTrx = decimalAmount(minimumPerTransaksi(c.min_belanja_per_transaksi_idr === undefined ? 0 : c.min_belanja_per_transaksi_idr));
  const minTrx = Math.max(1, minimumTransaksi(c.min_jumlah_transaksi === undefined ? 1 : c.min_jumlah_transaksi));
  const stats = new Map();
  for (const t of matched) {
    const key = String(t.nomor_wa).trim(), cur = stats.get(key) || { count: 0, spend: { units: 0n, scale: 0 } };
    const amount = decimalAmount(t.harga_akhir);
    if (decimalAtLeast(amount, perTrx)) { cur.count++; cur.spend = addDecimal(cur.spend, amount); }
    stats.set(key, cur);
  }
  const participants = eligible.filter(customer => {
    const st = stats.get(String(customer.nomor_wa).trim());
    return st && st.count >= minTrx && decimalAtLeast(st.spend, minimum);
  }).map(customer => {
    const st = stats.get(String(customer.nomor_wa).trim());
    return { customer_id: customer.id, nomor_wa: customer.nomor_wa, nama: customer.nama, tipe_customer: customer.tipe_customer, segment_crm: customer.segment_crm, jumlah_transaksi_periode: st.count, total_belanja_periode: decimalNumber(st.spend) };
  }).sort((a, b) => b.jumlah_transaksi_periode - a.jumlah_transaksi_periode || a.customer_id.localeCompare(b.customer_id));
  const participantWa = new Set(participants.map(p => String(p.nomor_wa).trim()));
  // Reports count ONLY transactions of customers meeting the current threshold.
  // Historical winners/costs remain independent of this current eligible set.
  return { participants, trx: matched.filter(t => participantWa.has(String(t.nomor_wa).trim())), total_transaksi: trx.length, hppAvailable };
}
async function lotteryList(data, s) {
  const branch = cabangSesi(s, data.kode_cabang);
  let path = "/lottery_campaigns?order=periode_mulai.desc,id.asc";
  if (branch) path += `&kode_cabang=eq.${encodeURIComponent(branch)}`;
  if (data.only_aktif === true) path += "&aktif=eq.true";
  const rows = await allRows(path);
  // Batched IDs are UUIDs from the DB; no customer data in URL filters.
  const summaries = new Map();
  for (let i = 0; i < rows.length; i += 50) {
    const ids = rows.slice(i, i + 50).map(c => c.id);
    const prizes = await allRows(`/lottery_prizes?campaign_id=in.(${ids.join(",")})&retired=eq.false&select=id,campaign_id,nilai_hadiah_idr&order=id.asc`);
    for (const p of prizes) { const z = summaries.get(p.campaign_id) || { count: 0, total_nilai: 0 }; z.count++; z.total_nilai += Number(p.nilai_hadiah_idr); summaries.set(p.campaign_id, z); }
  }
  return rows.map(c => ({ ...c, prize_summary: summaries.get(c.id) || { count: 0, total_nilai: 0 } }));
}
async function lotteryGet(data, s) {
  const c = await campaign(data.id, s);
  const [prizes, winners] = await Promise.all([
    allRows(`/lottery_prizes?campaign_id=eq.${c.id}&order=id.asc`),
    allRows(`/lottery_winners?campaign_id=eq.${c.id}&order=recorded_at.desc,id.asc`)
  ]);
  return { campaign: c, prizes, winners };
}
async function lotterySave(data, s) {
  if (data.id) await campaign(data.id, s); // authorize stored branch, not just input
  cabangSesi(s, data.kode_cabang);
  date(data.periode_mulai, "Periode mulai"); date(data.periode_selesai, "Periode selesai");
  if (data.periode_selesai < data.periode_mulai) fail("Periode selesai sebelum periode mulai");
  if (!Array.isArray(data.prizes)) fail("Daftar hadiah wajib dikirim");
  if (Object.prototype.hasOwnProperty.call(data, "min_total_belanja_idr")) minimumSpend(data.min_total_belanja_idr);
  const hasTrx = Object.prototype.hasOwnProperty.call(data, "min_jumlah_transaksi"), hasPer = Object.prototype.hasOwnProperty.call(data, "min_belanja_per_transaksi_idr");
  if (hasTrx) minimumTransaksi(data.min_jumlah_transaksi);
  if (hasPer) minimumPerTransaksi(data.min_belanja_per_transaksi_idr);
  if (hasTrx || hasPer) {
    // RPC lama mengabaikan kunci yang tidak dikenal; jangan biarkan pengaturan hilang diam-diam.
    try { await rest("/lottery_campaigns?select=min_jumlah_transaksi,min_belanja_per_transaksi_idr&limit=1"); }
    catch (e) { if (["42703", "PGRST204"].includes(e.dbCode)) fail("Pengaturan syarat transaksi belum aktif: migrasi database belum diterapkan. Hubungi pengelola.", 409); throw e; }
  }
  // Omission on edit preserves the stored threshold inside the locked RPC.
  // A single DB transaction validates, locks, updates, and retires prizes.
  return rest("/rpc/lottery_save_campaign", { method: "POST", body: JSON.stringify({ p_token: s.token, p_data: data }) });
}
async function lotteryStatus(data, s) {
  const c = await campaign(data.id, s);
  if (typeof data.aktif !== "boolean") fail("Status tidak valid");
  await rest(`/lottery_campaigns?id=eq.${c.id}&kode_cabang=eq.${encodeURIComponent(c.kode_cabang)}`, { method: "PATCH", body: JSON.stringify({ aktif: data.aktif }) });
  return { id: c.id, aktif: data.aktif };
}
async function lotteryEligibleParticipants(data, s) {
  const c = await campaign(data.campaign_id, s), d = await participantData(c);
  return { campaign: c, total_peserta: d.participants.length, total_transaksi: d.total_transaksi, participants: d.participants };
}
async function lotteryWinnerSave(data, s) {
  await campaign(data.campaign_id, s);
  uuid(data.customer_id, "Pelanggan"); uuid(data.prize_id, "Hadiah");
  date(data.coupon_expired_at, "Masa berlaku");
  if (data.pickup_date) date(data.pickup_date, "Tanggal ambil");
  if (!["belum_diambil", "sudah_diambil"].includes(data.pickup_status || "belum_diambil")) fail("Status pengambilan tidak valid");
  if (data.pickup_status === "sudah_diambil" && !data.pickup_date) fail("Tanggal ambil wajib diisi");
  // RPC re-checks actual branch, prize and purchase eligibility under the same
  // campaign lock used by editing. No single-coupon/customer restriction.
  return rest("/rpc/lottery_record_winner", { method: "POST", body: JSON.stringify({ p_token: s.token, p_data: data }) });
}
async function lotteryReport(data, s) {
  const c = await campaign(data.campaign_id, s);
  const [d, winners, prizes] = await Promise.all([
    participantData(c, true),
    allRows(`/lottery_winners?campaign_id=eq.${c.id}&select=id,prize_id,pickup_status&order=id.asc`),
    allRows(`/lottery_prizes?campaign_id=eq.${c.id}&select=id,nilai_hadiah_idr&order=id.asc`)
  ]);
  const prizeMap = new Map(prizes.map(p => [p.id, p.nilai_hadiah_idr]));
  const cost = total(winners.map(w => ({ cost: prizeMap.get(w.prize_id) })), "cost");
  const revenue = total(d.trx, "harga_akhir"), hpp = d.hppAvailable ? total(d.trx, "total_hpp") : null;
  const profit = hpp === null || revenue === null ? null : Math.round((revenue - hpp) * 100) / 100;
  return { campaign: c, warning: profit === null ? "HPP tidak tersedia/lengkap; laba dan ROI tidak dapat dihitung." : null,
    basis: "Transaksi hanya dari peserta yang memenuhi minimum akumulasi belanja campaign saat ini, di cabang campaign dan seluruh periode tanggal inklusif, sebelum koreksi retur; bukan uplift. Perubahan minimum dapat mengubah peserta/revenue laporan, tetapi tidak menghapus pemenang historis. Biaya seluruh hadiah tercatat, termasuk belum diambil dan pemenang yang kini tidak eligible. ROI proxy = laba kotor / biaya hadiah × 100.",
    ringkasan: { total_pemenang: winners.length, hadiah_terambil: winners.filter(w => w.pickup_status === "sudah_diambil").length,
      total_biaya_hadiah_idr: cost, total_peserta_eligible: d.participants.length, total_transaksi_peserta: d.trx.length,
      total_revenue_idr: revenue, total_hpp_idr: hpp, total_profit_idr: profit,
      roas: cost > 0 && revenue !== null ? revenue / cost : null,
      roi_direct_percent: cost > 0 && profit !== null ? profit / cost * 100 : null } };
}
const handlers = { lotteryList, lotteryGet, lotterySave, lotteryStatus, lotteryEligibleParticipants, lotteryWinnerSave, lotteryReport };
Deno.serve(async req => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  try {
    let body; try { body = await req.json(); } catch { fail("JSON tidak valid"); }
    // Canonical frontend contract: {fn: action, args: [data, token]}.
    if (!body || !Object.prototype.hasOwnProperty.call(handlers, body.fn) || !Array.isArray(body.args) || body.args.length !== 2) fail("Permintaan lottery tidak valid");
    const [data, token] = body.args;
    if (!data || typeof data !== "object" || Array.isArray(data)) fail("Data lottery tidak valid");
    const s = await session(token);
    if (!s) return json({ ok: false, error: "Sesi berakhir. Silakan login ulang.", code: "NO_SESSION" }, 401);
    if (!allowed(s.role)) fail("Akses lottery ditolak", 403);
    cabangSesi(s); // fail closed even for read-by-id actions
    return json({ ok: true, data: await handlers[body.fn](data, s) });
  } catch (e) { return json({ ok: false, error: e.message || "Permintaan lottery gagal" }, e.status || 500); }
});
