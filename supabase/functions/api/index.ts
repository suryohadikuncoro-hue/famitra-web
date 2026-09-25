// api_batch_fixed_index.ts

var SUPABASE_URL = Deno.env.get("SUPABASE_URL");
var SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_KEY");
var headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
var json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" } });
var db = async (table, query = "", init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, { ...init, headers: { ...headers, ...init.headers || {} } });
var sha256 = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))).map((x) => x.toString(16).padStart(2, "0")).join("");
var today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(/* @__PURE__ */ new Date());
var clock = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }).format(/* @__PURE__ */ new Date());
var shift = () => {
  const h = Number(clock().slice(0, 2));
  return h >= 8 && h < 15 ? "Pagi" : h >= 15 && h < 21 ? "Sore" : "Luar Jam";
};
var normWA = (v) => {
  let s = String(v || "").replace(/\D/g, "");
  if (s.startsWith("0")) s = "62" + s.slice(1);
  if (!s.startsWith("62") && s) s = "62" + s;
  return s;
};
var daysUntil = (s) => Math.ceil(((/* @__PURE__ */ new Date(`${s}T00:00:00+07:00`)).getTime() - (/* @__PURE__ */ new Date()).getTime()) / 864e5);
var rangeOf = (f) => {
  const now = /* @__PURE__ */ new Date();
  const d = today();
  const mode = f?.mode || "hari_ini";
  if (mode === "custom" && f?.dari && f?.sampai) return { from: f.dari, to: f.sampai, label: `${f.dari} \u2013 ${f.sampai}` };
  if (mode === "mingguan") {
    const end = /* @__PURE__ */ new Date(`${d}T00:00:00+07:00`);
    const start = new Date(end.getTime() - 6 * 864e5);
    return { from: start.toISOString().slice(0, 10), to: d, label: "7 hari terakhir" };
  }
  if (mode === "bulanan") {
    const y = f?.tahun || d.slice(0, 4), m = f?.bulan || d.slice(5, 7);
    const start = `${y}-${m}-01`;
    const next = /* @__PURE__ */ new Date(`${start}T00:00:00+07:00`);
    next.setMonth(next.getMonth() + 1);
    return { from: start, to: new Date(next.getTime() - 864e5).toISOString().slice(0, 10), label: `Bulan ${m}/${y}` };
  }
  if (mode === "tahunan") return { from: `${f?.tahun || d.slice(0, 4)}-01-01`, to: `${f?.tahun || d.slice(0, 4)}-12-31`, label: `Tahun ${f?.tahun || d.slice(0, 4)}` };
  return { from: d, to: d, label: "Hari ini" };
};
var qsRange = (r, dateField) => `?${dateField}=gte.${r.from}&${dateField}=lte.${r.to}`;
var PERM = {
  "pos.cariBarang": ["Owner", "Apoteker", "Kasir"],
  "pos.cariCustomer": ["Owner", "Apoteker", "Kasir"],
  "pos.daftarCustomer": ["Owner", "Apoteker", "Kasir"],
  "pos.notaTerakhir": ["Owner", "Apoteker", "Kasir"],
  "pos.simpanTransaksi": ["Owner", "Apoteker", "Kasir"],
  "barang.list": ["Owner", "Apoteker"],
  "barang.simpan": ["Owner", "Apoteker"],
  "barang.hapus": ["Owner", "Apoteker"],
  "stok.list": ["Owner", "Apoteker"],
  "stok.simpanBatch": ["Owner", "Apoteker"],
  "opname.list": ["Owner", "Apoteker"],
  "opname.simpan": ["Owner", "Apoteker"],
  "crm.list": ["Owner", "Apoteker"],
  "crm.simpan": ["Owner", "Apoteker"],
  "refill.list": ["Owner", "Apoteker"],
  "refill.generate": ["Owner", "Apoteker"],
  "notification.pending": ["Owner", "Apoteker"],
  "reward.list": ["Owner", "Apoteker", "Kasir"],
  "refill.simpan": ["Owner", "Apoteker"],
  "refill.status": ["Owner", "Apoteker"],
  "dashboard.ringkasan": ["Owner", "Apoteker"],
  "beli.list": ["Owner", "Apoteker"],
  "beli.simpan": ["Owner", "Apoteker"],
  "beli.supplier": ["Owner", "Apoteker"],
  "beli.simpanSupplier": ["Owner", "Apoteker"],
  "biaya.list": ["Owner", "Kasir"],
  "biaya.simpan": ["Owner", "Kasir"],
  "biaya.hapus": ["Owner"],
  "laporan.labaRugi": ["Owner"],
  "user.list": ["Owner"],
  "user.simpan": ["Owner"],
  "user.hapus": ["Owner"],
  "retur.jualList": ["Owner", "Apoteker", "Kasir"],
  "retur.jualSimpan": ["Owner", "Apoteker", "Kasir"],
  "retur.beliList": ["Owner"],
  "retur.beliSimpan": ["Owner"],
  "retur.beliApprove": ["Owner"]
};
// Cabang WAJIB datang dari sesi. Tidak ada lagi fallback "KARLA": kalau cabang
// tidak bisa ditentukan, permintaan GAGAL (bagian 2 dokumen rencana).
var cabangSesi = (s) => {
  const c = s && s.cabang_id ? String(s.cabang_id).trim() : "";
  if (!c) throw new Error("Sesi ini tidak punya cabang. Hubungi Owner untuk melengkapi data akun.");
  return c;
};
async function one(table, query) {
  const r = await db(table, query);
  const x = await r.json();
  return Array.isArray(x) ? x[0] : null;
}
async function session(token) {
  if (!token) return null;
  const s = await one("app_sessions", `?token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent((/* @__PURE__ */ new Date()).toISOString())}&select=*`);
  if (!s) return null;
  await db("app_sessions", `?token=eq.${encodeURIComponent(token)}`, { method: "PATCH", body: JSON.stringify({ expires_at: new Date(Date.now() + 6 * 36e5).toISOString() }) });
  return s;
}
async function login(username, password, roleDipilih) {
  const u = await one("app_users", `?username=ilike.${encodeURIComponent(username.trim())}&select=*`);
  if (!u || u.password_hash !== await sha256(password)) return { ok: false, error: "Username atau password salah." };
  if (u.aktif !== "YA") return { ok: false, error: "Akun ini dinonaktifkan. Hubungi Owner." };
  if (roleDipilih && u.role !== roleDipilih) return { ok: false, error: `Akun ini terdaftar sebagai ${u.role}, bukan ${roleDipilih}.` };
  // User tanpa cabang GAGAL login dengan pesan jelas (bagian 6 dokumen).
  if (!u.cabang_id || !String(u.cabang_id).trim()) return { ok: false, error: "Akun ini belum punya cabang. Hubungi Owner untuk melengkapi data akun." };
  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const user = { username: u.username, nama: u.nama, role: u.role, cabang_id: String(u.cabang_id).trim(), login_at: (/* @__PURE__ */ new Date()).toISOString(), shift: shift() };
  const r = await db("app_sessions", "", { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ token, username: u.username, nama: u.nama, role: u.role, cabang_id: user.cabang_id, shift: user.shift, expires_at: new Date(Date.now() + 6 * 36e5).toISOString() }) });
  if (!r.ok) throw new Error(await r.text());
  return { ok: true, data: { token, user } };
}
var menus = {
  Owner: [{ id: "dashboard", label: "Dashboard" }, { id: "pos", label: "Kasir / POS" }, { id: "barang", label: "Master Barang" }, { id: "stok", label: "Stok & Batch" }, { id: "beli", label: "Pembelian" }, { id: "crm", label: "Pelanggan" }, { id: "biaya", label: "Biaya Operasional" }, { id: "opname", label: "Stokopname" }, { id: "laporan", label: "Laporan Laba Rugi" }, { id: "retur", label: "Retur" }, { id: "user", label: "Manajemen User" }],
  Apoteker: [{ id: "dashboard", label: "Dashboard" }, { id: "pos", label: "Kasir / POS" }, { id: "barang", label: "Master Barang" }, { id: "stok", label: "Stok & Batch" }, { id: "beli", label: "Pembelian" }, { id: "crm", label: "Pelanggan" }, { id: "opname", label: "Stokopname" }, { id: "retur", label: "Retur" }],
  Kasir: [{ id: "pos", label: "Kasir / POS" }, { id: "biaya", label: "Biaya Operasional" }, { id: "retur", label: "Retur" }]
};
function menuSaya(s) {
  return { menu: menus[s.role] || [], user: { username: s.username, nama: s.nama, role: s.role, cabang_id: cabangSesi(s), login_at: s.login_at, shift: s.shift }, apotek: "Apotek Fa-Mitra", halamanAwal: s.role === "Kasir" ? "pos" : "dashboard" };
}
async function stokDashboard(cabangId) {
  const [br, sb] = await Promise.all([
    db("master_barang", `?cabang_id=eq.${encodeURIComponent(cabangId)}&aktif=eq.YA&select=kode_obat,nama_obat,stok_min&limit=5000`),
    db("stok_batch", `?cabang_id=eq.${encodeURIComponent(cabangId)}&select=kode_obat,kode_batch,expired_date,stok_real,harga_modal_batch&order=expired_date&limit=5000`)
  ]);
  if (!br.ok) throw new Error(await br.text());
  if (!sb.ok) throw new Error(await sb.text());
  const barang = await br.json();
  const batch = await sb.json();
  const nama = Object.fromEntries(barang.map((x) => [x.kode_obat, x.nama_obat]));
  const min = Object.fromEntries(barang.map((x) => [x.kode_obat, Number(x.stok_min || 0)]));
  const total = {};
  batch.forEach((x) => {
    total[x.kode_obat] = (total[x.kode_obat] || 0) + Number(x.stok_real || 0);
  });
  const expiring = batch.filter((x) => Number(x.stok_real || 0) > 0 && daysUntil(x.expired_date) <= 90).map((x) => ({ Kode_Obat: x.kode_obat, Nama_Obat: nama[x.kode_obat] || x.kode_obat, Kode_Batch: x.kode_batch, Expired_Date: x.expired_date, Stok_Real: x.stok_real, sisa_hari: daysUntil(x.expired_date) }));
  const stok_menipis = barang.filter((x) => (total[x.kode_obat] || 0) <= Number(x.stok_min || 0)).map((x) => ({ Kode_Obat: x.kode_obat, Nama_Obat: x.nama_obat, stok: total[x.kode_obat] || 0, minimal: Number(x.stok_min || 0) }));
  return { expiring_total: expiring.length, expiring_nilai: expiring.reduce((n, x) => n + Number(x.Stok_Real || 0), 0), expiring_kritis: expiring.filter((x) => x.sisa_hari <= 30).length, expiring, stok_menipis_total: stok_menipis.length, stok_menipis };
}
async function action(name, data, s) {
  if (name === "pos.cariBarang") {
    const q = String(data.q || "").trim();
    const tipe = data.tipe || "Umum";
    const cab = cabangSesi(s);
    const price = tipe === "Tenaga Kesehatan" ? "harga_khusus" : tipe === "Apotek Lain" ? "harga_jual_mutasi" : "harga_jual_umum";
    const r = await db("master_barang", `?cabang_id=eq.${encodeURIComponent(cab)}&aktif=eq.YA&or=(kode_obat.ilike.*${encodeURIComponent(q)}*,nama_obat.ilike.*${encodeURIComponent(q)}*,barcode.ilike.*${encodeURIComponent(q)}*)&select=*%2Cstok_batch(stok_real%2Ckode_batch%2Cexpired_date%2Ccabang_id)&limit=25`);
    const rows = await r.json();
    return rows.map((b) => {
      const bs = (b.stok_batch || []).filter((x) => x.cabang_id === cab && Number(x.stok_real) > 0).sort((a, z) => String(a.expired_date).localeCompare(String(z.expired_date)));
      const first = bs[0];
      return { Kode_Obat: b.kode_obat, Nama_Obat: b.nama_obat, Satuan: b.satuan, Barcode: b.barcode, harga: Number(b[price] || b.harga_jual_umum || 0), stok: bs.reduce((n, x) => n + Number(x.stok_real || 0), 0), batch_terdekat: first?.kode_batch || "", expired: first?.expired_date || "", sisa_hari: first ? daysUntil(first.expired_date) : null, exact: b.kode_obat.toLowerCase() === q.toLowerCase() || b.barcode === q };
    });
  }
  if (name === "refill.list") {
    const r = await db("refill_programs", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&status=eq.ACTIVE&select=*,master_customer(nama,nomor_wa)&order=next_reminder_date.asc&limit=200`);
    if (!r.ok) throw new Error(await r.text());
    return (await r.json()).map((x) => ({ ID: x.id, Customer_ID: x.customer_id, Nama: x.master_customer?.nama, Nomor_WA: x.master_customer?.nomor_wa, Kode_Obat: x.kode_obat, Cycle_Days: x.cycle_days, Last_Purchase: x.last_purchase_date, Next_Reminder: x.next_reminder_date, Status: x.status }));
  }
  if (name === "refill.simpan") {
    const cabang = cabangSesi(s);
    const p = { cabang_id: cabang, customer_id: data.customer_id, kode_obat: String(data.kode_obat || "").trim(), cycle_days: Math.max(1, Number(data.cycle_days || 30)), last_purchase_date: data.last_purchase_date || today(), next_reminder_date: data.next_reminder_date || data.last_purchase_date || today(), stamp_count: 0, status: "ACTIVE" };
    if (!p.customer_id || !p.kode_obat) throw new Error("Pelanggan dan kode obat wajib diisi.");
    // Pelanggan harus milik cabang sesi (temuan 11); siklus hanya 30/60/90
    // (refill_programs_cycle_days_check) supaya pesannya jelas, bukan check_violation.
    const cust = await one("master_customer", `?id=eq.${encodeURIComponent(p.customer_id)}&cabang_id=eq.${encodeURIComponent(cabang)}&select=id`);
    if (!cust) throw new Error("Pelanggan tersebut bukan milik cabang Anda.");
    if (![30, 60, 90].includes(Number(p.cycle_days))) throw new Error("Siklus hari hanya boleh 30, 60, atau 90.");
    const r = await db("refill_programs", "", { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(p) });
    if (!r.ok) throw new Error(await r.text());
    return true;
  }
  if (name === "refill.status") {
    const r = await db("refill_programs", `?id=eq.${encodeURIComponent(data.id)}&cabang_id=eq.${encodeURIComponent(cabangSesi(s))}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ status: data.status === "ACTIVE" ? "PAUSED" : "ACTIVE" }) });
    if (!r.ok) throw new Error(await r.text());
    return true;
  }
  if (name === "refill.generate") {
    const r = await db("rpc/generate_refill_reminders", "", { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify({ p_cabang_id: cabangSesi(s) }) });
    if (!r.ok) throw new Error(await r.text());
    return { queued: Number(await r.json()) || 0 };
  }
  if (name === "notification.pending") {
    const r = await db("notification_log", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&status=eq.PENDING&select=*&order=created_at.asc&limit=200`);
    if (!r.ok) throw new Error(await r.text());
    return await r.json();
  }
  if (name === "crm.list") {
    const q = String(data.q || "").trim();
    const tipe = String(data.tipe || "Semua");
    const parts = [`select=*`, `order=nama.asc`, `limit=500`];
    if (q) parts.push(`or=(nama.ilike.*${encodeURIComponent(q)}*,nomor_wa.ilike.*${encodeURIComponent(q)}*)`);
    if (tipe && tipe !== "Semua") parts.push(`tipe_customer=eq.${encodeURIComponent(tipe)}`);
    const r = await db("master_customer", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&${parts.join("&")}`);
    if (!r.ok) throw new Error(await r.text());
    const rows = await r.json();
    return rows.map((c) => ({ ID: c.id, Nomor_WA: c.nomor_wa, Nama: c.nama, Tipe_Customer: c.tipe_customer, Alamat: c.alamat, Nomor_Izin: c.nomor_izin, Total_Belanja: c.total_belanja, Jumlah_Transaksi: c.jumlah_transaksi, Tanggal_Terakhir_Beli: c.tanggal_terakhir_beli, Segment_CRM: c.segment_crm, Tier: c.tier, Total_Points: c.total_points, Total_Spend_MTD: c.total_spend_mtd, Consent_Marketing: c.consent_marketing }));
  }
  if (name === "pos.cariCustomer") {
    const wa = normWA(data.wa);
    const c = await one("master_customer", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&nomor_wa=eq.${encodeURIComponent(wa)}&select=*`);
    return c ? { found: true, Nomor_WA: c.nomor_wa, Nama: c.nama, Tipe_Customer: c.tipe_customer, Alamat: c.alamat, Total_Belanja: c.total_belanja, Jumlah_Transaksi: c.jumlah_transaksi, Tanggal_Terakhir_Beli: c.tanggal_terakhir_beli, Segment_CRM: c.segment_crm, Tier: c.tier, Total_Points: c.total_points, Total_Spend_MTD: c.total_spend_mtd, Consent_Marketing: c.consent_marketing } : { found: false, Nomor_WA: wa };
  }
  if (name === "pos.daftarCustomer" || name === "crm.simpan") {
    const wa = normWA(data.wa || data.Nomor_WA);
    const payload = { cabang_id: cabangSesi(s), nomor_wa: wa, nama: data.nama || data.Nama, tipe_customer: data.tipe || data.Tipe_Customer || "Umum", alamat: data.alamat || data.Alamat || "", nomor_izin: data.izin || data.Nomor_Izin || "" };
    const r = await db("master_customer", "", { method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error(await r.text());
    return true;
  }
  if (name === "barang.list") {
    const q = String(data.q || "");
    const r = await db("master_barang", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&or=(kode_obat.ilike.*${encodeURIComponent(q)}*,nama_obat.ilike.*${encodeURIComponent(q)}*,kategori.ilike.*${encodeURIComponent(q)}*)&select=*&order=nama_obat&limit=100`);
    const rows = await r.json();
    return rows.map((b) => ({ ...b, Kode_Obat: b.kode_obat, Nama_Obat: b.nama_obat, Kategori: b.kategori, Satuan: b.satuan, Barcode: b.barcode, Harga_Modal: b.harga_modal, Harga_Jual_Umum: b.harga_jual_umum, Harga_Khusus: b.harga_khusus, Harga_Jual_Mutasi: b.harga_jual_mutasi, PPN: b.ppn, Stok_Min: b.stok_min, Aktif: b.aktif, stok: 0 }));
  }
  if (name === "stok.list") {
    const q = String(data.q || "");
    const r = await db("stok_batch", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=*,master_barang!inner(nama_obat)&or=(kode_obat.ilike.*${encodeURIComponent(q)}*,kode_batch.ilike.*${encodeURIComponent(q)}*)&order=expired_date&limit=200`);
    const rows = await r.json();
    return rows.filter((x) => !data.kritis || Number(x.stok_real) > 0 && daysUntil(x.expired_date) <= 90).map((x) => ({ Kode_Obat: x.kode_obat, Nama_Obat: x.master_barang?.nama_obat, Kode_Batch: x.kode_batch, Expired_Date: x.expired_date, sisa_hari: daysUntil(x.expired_date), Stok_Real: x.stok_real, Harga_Modal_Batch: x.harga_modal_batch, ID_Batch: x.id_batch }));
  }
  if (name === "stok.simpanBatch") {
    const cabang = String(cabangSesi(s)).trim().toUpperCase(), kodeObat = String(data.Kode_Obat || "").trim().toUpperCase(), kodeBatch = String(data.Kode_Batch || "").trim();
    const expired = String(data.Expired_Date || "").trim();
    const stok = Number(data.Stok_Real), modal = Number(data.Harga_Modal_Batch);
    if (!kodeObat || !kodeBatch || !expired) throw new Error("Kode obat, kode batch, dan tanggal kedaluwarsa wajib diisi.");
    if (!Number.isFinite(stok) || stok < 0 || !Number.isFinite(modal) || modal < 0) throw new Error("Stok dan harga modal harus berupa angka nol atau lebih.");
    const master = await one("master_barang", `?cabang_id=eq.${encodeURIComponent(cabang)}&kode_obat=eq.${encodeURIComponent(kodeObat)}&select=kode_obat,nama_obat,aktif`);
    if (!master) throw new Error("Kode obat tidak ditemukan di Master Barang. Gunakan kode obat yang terdaftar.");
    const cab = await one("master_cabang", `?kode_cabang=eq.${encodeURIComponent(cabang)}&select=kode_cabang`);
    if (!cab) throw new Error("Kode cabang sesi tidak ditemukan.");
    const existing = data.ID_Batch ? await one("stok_batch", `?id_batch=eq.${encodeURIComponent(data.ID_Batch)}&cabang_id=eq.${encodeURIComponent(cabang)}&select=id_batch,kode_obat,kode_batch`) : null;
    if (data.ID_Batch && !existing) throw new Error("Batch yang akan diubah tidak ditemukan atau bukan milik cabang ini.");
    const duplicate = await one("stok_batch", `?cabang_id=eq.${encodeURIComponent(cabang)}&kode_obat=eq.${encodeURIComponent(kodeObat)}&kode_batch=eq.${encodeURIComponent(kodeBatch)}&select=id_batch,cabang_id`);
    if (duplicate && duplicate.id_batch !== data.ID_Batch) throw new Error("Kode obat dan kode batch tersebut sudah digunakan.");
    const p = { cabang_id: cabang, id_batch: data.ID_Batch || `BT-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`, kode_obat: kodeObat, kode_batch: kodeBatch, expired_date: expired, stok_real: stok, harga_modal_batch: modal };
    const r = await db("stok_batch", "", { method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(p) });
    if (!r.ok) {
      const detail = await r.text();
      throw new Error(`Gagal menyimpan batch: ${detail}`);
    }
    return true;
  }
  if (name === "barang.simpan") {
    // Harga per cabang (keputusan 2): cabang_id SELALU dari sesi, tidak dari payload.
    const cabang = cabangSesi(s);
    const p = { cabang_id: cabang, kode_obat: String(data.Kode_Obat).toUpperCase(), nama_obat: data.Nama_Obat, kategori: data.Kategori || "", satuan: data.Satuan || "Pcs", barcode: data.Barcode || null, stok_min: data.Stok_Min || 10, harga_modal: data.Harga_Modal || 0, harga_jual_umum: data.Harga_Jual_Umum || 0, harga_khusus: data.Harga_Khusus || 0, harga_jual_mutasi: data.Harga_Jual_Mutasi || 0, ppn: data.PPN || 0, aktif: "YA" };
    const r = await db("master_barang", data.mode === "edit" ? `?kode_obat=eq.${encodeURIComponent(p.kode_obat)}&cabang_id=eq.${encodeURIComponent(cabang)}` : "", { method: data.mode === "edit" ? "PATCH" : "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(p) });
    if (!r.ok) throw new Error(await r.text());
    return true;
  }
  if (name === "barang.hapus") {
    const r = await db("master_barang", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&kode_obat=eq.${encodeURIComponent(data.Kode_Obat)}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ aktif: "TIDAK", updated_at: (/* @__PURE__ */ new Date()).toISOString() }) });
    if (!r.ok) throw new Error(await r.text());
    return true;
  }
  if (name === "pos.notaTerakhir") {
    const r = await db("trx_penjualan", `?tanggal=eq.${today()}&cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=no_nota,tanggal,jam,nama_pelanggan,harga_akhir&order=timestamp.desc&limit=15`);
    if (!r.ok) throw new Error(await r.text());
    const rows = await r.json();
    return rows.map((x) => ({ No_Nota: x.no_nota, Tanggal: x.tanggal, Jam: x.jam, Nama_Pelanggan: x.nama_pelanggan, Harga_Akhir: x.harga_akhir }));
  }
  if (name === "reward.list") {
    const wa = normWA(data.wa || "");
    const c = wa ? await one("master_customer", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&nomor_wa=eq.${encodeURIComponent(wa)}&select=total_points,tier`) : null;
    const pts = Number(c?.total_points || 0);
    const tier = c?.tier || "reguler";
    const r = await db("loyalty_rewards", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&is_active=eq.true&select=*&order=points_required.asc&limit=100`);
    if (!r.ok) throw new Error(await r.text());
    return (await r.json()).map((x) => ({ ...x, eligible: pts >= Number(x.points_required || 0) && (x.min_tier === "gold" ? 3 : x.min_tier === "silver" ? 2 : 1) <= (tier === "gold" ? 3 : tier === "silver" ? 2 : 1), customer_points: pts }));
  }
  if (name === "pos.simpanTransaksi") {
    const r = await db("rpc/pos_checkout", "", { method: "POST", headers: { ...headers }, body: JSON.stringify({ p_username: s.username, p_nomor_wa: data.nomor_wa || "", p_nama_pelanggan: data.nama_pelanggan || "Umum", p_tipe_customer: data.tipe_customer || "Umum", p_items: data.items || [], p_cabang_id: cabangSesi(s), p_diskon: data.diskon || 0, p_bayar: data.bayar || 0, p_reward_id: data.reward_id || null }) });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(text || "Checkout gagal.");
    }
    return await r.json();
  }
  if (name === "beli.supplier") {
    // Daftar supplier = yang terdaftar untuk cabang sesi (tabel relasi supplier_cabang).
    const r = await db("supplier_cabang", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=kode_supplier,master_supplier(nama_supplier,telepon,alamat)&limit=500`);
    if (!r.ok) throw new Error(await r.text());
    const rows = await r.json();
    return rows
      .map((x) => ({ Kode_Supplier: x.kode_supplier, Nama_Supplier: x.master_supplier && x.master_supplier.nama_supplier, Telepon: x.master_supplier && x.master_supplier.telepon, Alamat: x.master_supplier && x.master_supplier.alamat }))
      .filter((x) => x.Nama_Supplier)
      .sort((a, b) => String(a.Nama_Supplier).localeCompare(String(b.Nama_Supplier)));
  }
  if (name === "beli.simpanSupplier") {
    const cabang = cabangSesi(s);
    const nama = String(data.Nama_Supplier || "").trim();
    if (!nama) throw new Error("Nama supplier wajib diisi.");
    // Cari dulu di master global (keputusan 3 / 10.2 B): satu supplier global boleh
    // dipakai beberapa cabang, dan nama_supplier UNIQUE global — POST langsung ditolak.
    let master = await one("master_supplier", `?nama_supplier=eq.${encodeURIComponent(nama)}&select=kode_supplier,nama_supplier`);
    if (!master) {
      const kode = "SUP-" + Date.now().toString(36).toUpperCase();
      const r = await db("master_supplier", "", { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify({ kode_supplier: kode, nama_supplier: nama, telepon: data.Telepon || "", alamat: data.Alamat || "" }) });
      if (!r.ok) throw new Error(await r.text());
      master = (await r.json())[0];
    }
    const rel = await db("supplier_cabang", "", { method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ cabang_id: cabang, kode_supplier: master.kode_supplier }) });
    if (!rel.ok) throw new Error(await rel.text());
    return { Kode_Supplier: master.kode_supplier, Nama_Supplier: master.nama_supplier };
  }
  if (name === "beli.simpan") {
    const r = await db("rpc/purchase_save", "", { method: "POST", headers: { ...headers }, body: JSON.stringify({ p_username: s.username, p_no_faktur_supplier: data.No_Faktur, p_supplier: data.Supplier, p_kategori: data.Kategori, p_tanggal: data.Tanggal_Faktur, p_jatuh_tempo: data.Jatuh_Tempo || null, p_items: data.items || [], p_cabang_id: cabangSesi(s) }) });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(text || "Pembelian gagal.");
    }
    return await r.json();
  }
  if (name === "beli.list") {
    const r = await db("trx_pembelian", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=no_faktur,no_faktur_supplier,supplier,kategori,tanggal_faktur,jatuh_tempo,total_item,total_tagihan&order=timestamp.desc&limit=200`);
    const rows = await r.json();
    return rows.map((x) => ({ No_Faktur: x.no_faktur, No_Faktur_Supplier: x.no_faktur_supplier, Supplier: x.supplier, Kategori: x.kategori, Tanggal_Faktur: x.tanggal_faktur, Jatuh_Tempo: x.jatuh_tempo, Total_Item: x.total_item, Total_Tagihan: x.total_tagihan, jatuh_tempo_hari: x.jatuh_tempo ? daysUntil(x.jatuh_tempo) : null }));
  }
  if (name === "biaya.simpan") {
    const p = { cabang_id: cabangSesi(s), id: `BY-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`, tanggal: data.Tanggal || today(), keterangan: data.Keterangan, nominal: data.Nominal || 0, shift: shift(), petugas: s.username };
    const r = await db("biaya_operasional", "", { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(p) });
    if (!r.ok) throw new Error(await r.text());
    return true;
  }
  if (name === "biaya.hapus") {
    const r = await db("biaya_operasional", `?id=eq.${encodeURIComponent(data.ID)}&cabang_id=eq.${encodeURIComponent(cabangSesi(s))}`, { method: "DELETE" });
    if (!r.ok) throw new Error(await r.text());
    return true;
  }
  if (name === "biaya.list") {
    const r0 = rangeOf(data.filter || {});
    const r = await db("biaya_operasional", `${qsRange(r0, "tanggal")}&cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&order=timestamp.desc&limit=200`);
    const rows = await r.json();
    const out = rows.map((x) => ({ ID: x.id, Tanggal: x.tanggal, Keterangan: x.keterangan, Nominal: x.nominal, Shift: x.shift, Petugas: x.petugas }));
    return { rentang: { label: r0.label }, total: out.reduce((n, x) => n + Number(x.Nominal || 0), 0), rows: out };
  }
  if (name === "dashboard.ringkasan") {
    const f = data.filter || {};
    const r0 = rangeOf(f);
    const sales = await (await db("trx_penjualan", `${qsRange(r0, "tanggal")}&cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=no_nota,tanggal,jam,nama_pelanggan,nomor_wa,tipe_customer,petugas_transaksi,shift,subtotal,diskon,harga_akhir,total_hpp&order=timestamp.desc&limit=500`)).json();
    const expenses = await (await db("biaya_operasional", `${qsRange(r0, "tanggal")}&cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=id,tanggal,keterangan,nominal,shift,petugas&order=timestamp.desc&limit=500`)).json();
    const omzet = sales.reduce((n, x) => n + Number(x.harga_akhir || 0), 0), hpp = sales.reduce((n, x) => n + Number(x.total_hpp || 0), 0), biaya = expenses.reduce((n, x) => n + Number(x.nominal || 0), 0);
    const shiftOk = (x) => !f.shift || f.shift === "Semua" || x.shift === f.shift;
    const ss = sales.filter(shiftOk);
    const ee = expenses.filter(shiftOk);
    const omzet2 = ss.reduce((n, x) => n + Number(x.harga_akhir || 0), 0), hpp2 = ss.reduce((n, x) => n + Number(x.total_hpp || 0), 0), biaya2 = ee.reduce((n, x) => n + Number(x.nominal || 0), 0);
    const liveSales = ss.slice(0, 10).map((x) => ({ No_Nota: x.no_nota, Nama_Pelanggan: x.nama_pelanggan, Harga_Akhir: x.harga_akhir, Jam: x.jam, Shift: x.shift }));
    const liveExpense = ee.slice(0, 10).map((x) => ({ Keterangan: x.keterangan, Nominal: x.nominal, Tanggal: x.tanggal }));
    const ids = ss.map((x) => x.no_nota).filter(Boolean);
    let details = [];
    if (ids.length) {
      const dr = await db("trx_penjualan_detail", `?no_nota=in.(${ids.map((x) => encodeURIComponent(x)).join(",")})&select=no_nota,kode_obat,nama_obat,qty,subtotal&limit=5000`);
      if (dr.ok) details = await dr.json();
    }
    const prod = {};
    details.forEach((x) => {
      const k = x.kode_obat || x.nama_obat || "Tanpa kode";
      prod[k] ||= { Kode_Obat: x.kode_obat, Nama_Obat: x.nama_obat || x.kode_obat, Qty: 0, Omzet: 0 };
      prod[k].Qty += Number(x.qty || 0);
      prod[k].Omzet += Number(x.subtotal || 0);
    });
    const topProduk = Object.values(prod).sort((a, b) => b.Qty - a.Qty || b.Omzet - a.Omzet).slice(0, 5).map((x) => ({ kode: x.Kode_Obat, nama: x.Nama_Obat, qty: x.Qty, omzet: x.Omzet }));
    const cust = {};
    ss.forEach((x) => {
      const k = x.nomor_wa || x.nama_pelanggan || "Umum";
      cust[k] ||= { Nomor_WA: x.nomor_wa || "", Nama: x.nama_pelanggan || "Umum", Tipe_Customer: x.tipe_customer || "Umum", Total_Belanja: 0, Jumlah_Transaksi: 0 };
      cust[k].Total_Belanja += Number(x.harga_akhir || 0);
      cust[k].Jumlah_Transaksi++;
    });
    const topPelanggan = Object.values(cust).sort((a, b) => b.Total_Belanja - a.Total_Belanja).slice(0, 5);
    const cr = await db("master_customer", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=segment_crm,total_belanja,jumlah_transaksi,tanggal_terakhir_beli&limit=5000`);
    const customers = cr.ok ? await cr.json() : [];
    const segmen = { VIP: 0, "Active Routine": 0, "At-Risk": 0, Baru: 0 };
    customers.forEach((c) => {
      const raw = String(c.segment_crm || "").trim().toLowerCase();
      const key = raw === "vip" ? "VIP" : raw === "active routine" || raw === "rutin" ? "Active Routine" : raw === "at-risk" || raw === "at risk" || raw === "risiko" ? "At-Risk" : "Baru";
      segmen[key]++;
    });
    const trend = {};
    ss.forEach((x) => {
      const d = String(x.tanggal);
      trend[d] ||= { tanggal: d, omzet: 0, nota: 0 };
      trend[d].omzet += Number(x.harga_akhir || 0);
      trend[d].nota++;
    });
    const sparkline = Object.values(trend).sort((a, b) => a.tanggal.localeCompare(b.tanggal)).slice(-7);
    const shiftChart = { Pagi: 0, Sore: 0, "Luar Jam": 0 };
    ss.forEach((x) => {
      const k = x.shift || "Luar Jam";
      shiftChart[k] = (shiftChart[k] || 0) + Number(x.harga_akhir || 0);
    });
    return { rentang: { label: r0.label }, shift_filter: f.shift || "Semua", kpi: { omzet: omzet2, laba_kotor: omzet2 - hpp2, laba_bersih: omzet2 - hpp2 - biaya2, nota: ss.length, rata_nota: ss.length ? omzet2 / ss.length : 0, delta_omzet: null, delta_nota: null, delta_rata: null }, sparkline, ...await stokDashboard(cabangSesi(s)), pj_shift: { role: s.role, petugas: s.nama, shift: shift(), jam: clock(), login_at: s.login_at, di_luar_jam: shift() === "Luar Jam", petugas_jaga: null }, segmen_pelanggan: segmen, live_sales: liveSales, live_expense: liveExpense, shift_chart: shiftChart, top_produk: topProduk, top_pelanggan: topPelanggan, at_risk: [], ai_enabled: false };
  }
  if (name === "laporan.labaRugi") {
    const r0 = rangeOf(data.filter || {});
    const sales = await (await db("trx_penjualan", `${qsRange(r0, "tanggal")}&cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=no_nota,tipe_customer,harga_akhir,diskon,total_hpp&limit=5000`)).json();
    const expenses = await (await db("biaya_operasional", `${qsRange(r0, "tanggal")}&cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=keterangan,nominal&limit=5000`)).json();
    const omzet = sales.reduce((n, x) => n + Number(x.harga_akhir || 0) + Number(x.diskon || 0), 0);
    const diskon = sales.reduce((n, x) => n + Number(x.diskon || 0), 0);
    const hpp = sales.reduce((n, x) => n + Number(x.total_hpp || 0), 0);
    const biaya = expenses.reduce((n, x) => n + Number(x.nominal || 0), 0);
    const tipe = {};
    sales.forEach((x) => {
      const k = x.tipe_customer || "Umum";
      tipe[k] ||= { tipe: k, nota: 0, omzet: 0, laba: 0 };
      tipe[k].nota++;
      tipe[k].omzet += Number(x.harga_akhir || 0);
      tipe[k].laba += Number(x.harga_akhir || 0) - Number(x.total_hpp || 0);
    });
    return { rentang: { label: r0.label }, omzet_kotor: omzet, total_diskon: diskon, total_hpp: hpp, laba_kotor: omzet - diskon - hpp, total_biaya: biaya, laba_bersih: omzet - diskon - hpp - biaya, jumlah_nota: sales.length, rata_nota: sales.length ? omzet / sales.length : 0, margin: omzet ? (omzet - diskon - hpp) / omzet * 100 : 0, per_tipe: Object.values(tipe), rincian_biaya: expenses.map((x) => ({ keterangan: x.keterangan, nominal: x.nominal })) };
  }
  if (name === "retur.jualList") {
    if (data.mode === "riwayat") {
      const r2 = await db("trx_retur_jual", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=*&order=timestamp.desc&limit=200`);
      if (!r2.ok) throw new Error(await r2.text());
      return (await r2.json()).map((x) => ({ No_Retur: x.no_retur, No_Nota_Asal: x.no_nota_asal, Tanggal: x.tanggal, Jam: x.jam, Nama_Pelanggan: x.nama_pelanggan, Petugas: x.petugas, Total_Refund: x.total_refund, Alasan: x.alasan }));
    }
    const r = await db("trx_penjualan", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=no_nota,tanggal,jam,nama_pelanggan,nomor_wa,subtotal,harga_akhir&order=timestamp.desc&limit=${Math.min(Number(data.limit) || 60, 365)}`);
    if (!r.ok) throw new Error(await r.text());
    const rows = await r.json();
    const out = [];
    for (const x of rows) {
      if (data.q && !(String(x.no_nota).toLowerCase().includes(String(data.q).toLowerCase()) || String(x.nama_pelanggan || "").toLowerCase().includes(String(data.q).toLowerCase()))) continue;
      const d = await db("trx_penjualan_detail", `?no_nota=eq.${encodeURIComponent(x.no_nota)}&select=*`);
      const items = (await d.json()).map((i) => ({ Kode_Obat: i.kode_obat, Nama_Obat: i.nama_obat, Kode_Batch: i.kode_batch, Qty: i.qty, Harga_Satuan: i.harga_satuan }));
      out.push({ ...x, No_Nota: x.no_nota, Tanggal: x.tanggal, Jam: x.jam, Nama_Pelanggan: x.nama_pelanggan, sudah_retur: 0, items });
    }
    return out;
  }
  if (name === "retur.jualSimpan") {
    const orig = await one("trx_penjualan", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&no_nota=eq.${encodeURIComponent(data.No_Nota_Asal)}&select=*`);
    if (!orig) throw new Error("Nota asal tidak ditemukan.");
    const ds = await db("trx_penjualan_detail", `?no_nota=eq.${encodeURIComponent(data.No_Nota_Asal)}&select=*`);
    const refs = await ds.json();
    const items = (data.items || []).map((i) => {
      const ref = refs.find((x) => x.kode_obat === i.Kode_Obat && x.kode_batch === i.Kode_Batch);
      if (!ref) throw new Error("Item retur tidak ada pada nota asal.");
      return { ...i, ref, subtotal: Number(i.Qty || 0) * Number(ref.harga_satuan || 0) };
    });
    const no = `RJ${today().replaceAll("-", "")}-${Date.now().toString().slice(-4)}`, total = items.reduce((n, i) => n + i.subtotal, 0);
    let r = await db("trx_retur_jual", "", { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ cabang_id: cabangSesi(s), no_retur: no, no_nota_asal: data.No_Nota_Asal, tanggal: today(), jam: clock(), nomor_wa: orig.nomor_wa, nama_pelanggan: orig.nama_pelanggan, petugas: s.username, shift: shift(), alasan: data.Alasan, total_refund: total }) });
    if (!r.ok) throw new Error(await r.text());
    for (const i of items) {
      r = await db("trx_retur_jual_detail", "", { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ cabang_id: cabangSesi(s), no_retur: no, kode_obat: i.ref.kode_obat, nama_obat: i.ref.nama_obat, kode_batch: i.ref.kode_batch, qty: i.Qty, harga_satuan: i.ref.harga_satuan, subtotal: i.subtotal, kondisi: i.Kondisi || "Baik" }) });
      if (!r.ok) throw new Error(await r.text());
      const b = await one("stok_batch", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&kode_obat=eq.${encodeURIComponent(i.ref.kode_obat)}&kode_batch=eq.${encodeURIComponent(i.ref.kode_batch)}&select=stok_real`);
      if (b) await db("stok_batch", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&kode_obat=eq.${encodeURIComponent(i.ref.kode_obat)}&kode_batch=eq.${encodeURIComponent(i.ref.kode_batch)}`, { method: "PATCH", body: JSON.stringify({ stok_real: Number(b.stok_real) + Number(i.Qty) }) });
    }
    return { No_Retur: no, Total_Refund: total };
  }
  if (name === "retur.beliList") {
    const r = await db("trx_pembelian", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=no_faktur,no_faktur_supplier,supplier,tanggal_faktur,total_tagihan&order=timestamp.desc&limit=200`);
    if (!r.ok) throw new Error(await r.text());
    const faktur = [];
    for (const x of await r.json()) {
      const d = await db("trx_pembelian_detail", `?no_faktur=eq.${encodeURIComponent(x.no_faktur)}&select=*`);
      faktur.push({ No_Faktur: x.no_faktur, No_Faktur_Supplier: x.no_faktur_supplier, Supplier: x.supplier, Tanggal_Faktur: x.tanggal_faktur, Total_Tagihan: x.total_tagihan, sudah_retur: 0, items: (await d.json()).map((i) => ({ Kode_Obat: i.kode_obat, Nama_Obat: i.nama_obat, Kode_Batch: i.kode_batch, Qty: i.qty, Harga_Netto: i.harga_netto })) });
    }
    const q = `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}` + (data.status ? `&status=eq.${encodeURIComponent(data.status)}` : "") + "&order=timestamp.desc&limit=200";
    const rr = await db("trx_retur_beli", q);
    return { faktur, retur: rr.ok ? (await rr.json()).map((x) => ({ No_Retur: x.no_retur, No_Faktur: x.no_faktur_asal, Supplier: x.supplier, Tanggal: x.tanggal, Status: x.status, Created_By: x.created_by, Approved_By: x.approved_by, Total_Refund: x.total_refund, Alasan: x.alasan })) : [] };
  }
  if (name === "retur.beliSimpan") {
    const f = await one("trx_pembelian", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&no_faktur=eq.${encodeURIComponent(data.No_Faktur_Asal)}&select=*`);
    if (!f) throw new Error("Faktur asal tidak ditemukan.");
    const items = (data.items || []).map((i) => ({ ...i, subtotal: Number(i.Qty || 0) * Number(i.Harga_Netto || 0) })), no = `RB${today().replaceAll("-", "")}-${Date.now().toString().slice(-4)}`, total = items.reduce((n, i) => n + i.subtotal, 0);
    let r = await db("trx_retur_beli", "", { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ cabang_id: cabangSesi(s), no_retur: no, no_faktur_asal: f.no_faktur, supplier: f.supplier, tanggal: today(), created_by: s.username, status: "PENDING_APPROVAL", alasan: data.Alasan, total_refund: total }) });
    if (!r.ok) throw new Error(await r.text());
    for (const i of items) {
      r = await db("trx_retur_beli_detail", "", { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ cabang_id: cabangSesi(s), no_retur: no, kode_obat: i.Kode_Obat, nama_obat: i.Nama_Obat || "", kode_batch: i.Kode_Batch, qty: i.Qty, harga_netto: i.Harga_Netto, subtotal: i.subtotal, kondisi: i.Kondisi || "Baik" }) });
      if (!r.ok) throw new Error(await r.text());
    }
    return { No_Retur: no, Total_Refund: total, Status: "PENDING_APPROVAL" };
  }
  if (name === "retur.beliApprove") {
    if (s.role !== "Owner") throw new Error("Hanya Owner yang dapat menyetujui retur beli.");
    const r = await db("trx_retur_beli", `?no_retur=eq.${encodeURIComponent(data.No_Retur)}&cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&status=eq.PENDING_APPROVAL`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ status: data.keputusan === "APPROVE" ? "APPROVED" : "REJECTED", approved_by: s.username, tanggal_approval: today() }) });
    if (!r.ok) throw new Error(await r.text());
    return true;
  }
  if (name === "opname.list") {
    const r = await db("stok_opname", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=*&order=tanggal.desc&limit=200`);
    if (!r.ok) throw new Error(await r.text());
    return (await r.json()).map((x) => ({ ID: x.id, Tanggal: x.tanggal, Kode_Obat: x.kode_obat, Kode_Batch: x.kode_batch, Stok_Sistem: x.stok_sistem, Stok_Fisik: x.stok_fisik, Selisih: x.selisih, Keterangan: x.keterangan, Petugas: x.petugas }));
  }
  if (name === "opname.simpan") {
    const b = await one("stok_batch", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&kode_obat=eq.${encodeURIComponent(data.Kode_Obat)}&kode_batch=eq.${encodeURIComponent(data.Kode_Batch)}&select=stok_real`);
    if (!b) throw new Error("Batch stok tidak ditemukan.");
    const fisik = Number(data.Stok_Fisik || 0), sistem = Number(b.stok_real || 0), id = `OP-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
    const r = await db("stok_opname", "", { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ id, tanggal: today(), cabang_id: cabangSesi(s), kode_obat: data.Kode_Obat, kode_batch: data.Kode_Batch, stok_sistem: sistem, stok_fisik: fisik, selisih: fisik - sistem, keterangan: data.Keterangan || "", petugas: s.username }) });
    if (!r.ok) throw new Error(await r.text());
    const u = await db("stok_batch", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&kode_obat=eq.${encodeURIComponent(data.Kode_Obat)}&kode_batch=eq.${encodeURIComponent(data.Kode_Batch)}`, { method: "PATCH", body: JSON.stringify({ stok_real: fisik }) });
    if (!u.ok) throw new Error(await u.text());
    return { ID: id, Selisih: fisik - sistem };
  }
  if (name === "user.list") {
    const r = await db("app_users", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=username,nama,role,aktif,cabang_id,created_at&order=nama.asc&limit=200`);
    if (!r.ok) throw new Error(await r.text());
    return (await r.json()).map((x) => ({ Username: x.username, Nama: x.nama, Role: x.role, Aktif: x.aktif, Cabang_ID: x.cabang_id, Dibuat: x.created_at }));
  }
  if (name === "user.simpan") {
    // Cabang user SELALU dari sesi. Field Cabang_ID dari form diabaikan (bagian 6).
    const cabang = cabangSesi(s);
    const p = { username: String(data.Username || data.username || "").trim(), nama: data.Nama || data.nama, role: data.Role || data.role, aktif: data.Aktif || "YA", cabang_id: cabang };
    if (!p.username || !p.nama || !p.role) throw new Error("Username, nama, dan role wajib diisi.");
    if (data.mode === "edit") {
      const target = await one("app_users", `?username=eq.${encodeURIComponent(p.username)}&select=username,cabang_id`);
      if (!target) throw new Error("User tidak ditemukan.");
      if (String(target.cabang_id || "") !== cabang) throw new Error("User ini bukan milik cabang Anda.");
    }
    if (data.Password || data.password) p.password_hash = await sha256(data.Password || data.password);
    const r = await db("app_users", data.mode === "edit" ? `?username=eq.${encodeURIComponent(p.username)}` : "", { method: data.mode === "edit" ? "PATCH" : "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(p) });
    if (!r.ok) throw new Error(await r.text());
    return true;
  }
  if (name === "user.hapus") {
    const r = await db("app_users", `?username=eq.${encodeURIComponent(data.Username)}&cabang_id=eq.${encodeURIComponent(cabangSesi(s))}`, { method: "PATCH", body: JSON.stringify({ aktif: "TIDAK" }) });
    if (!r.ok) throw new Error(await r.text());
    return true;
  }
  throw new Error(`Aksi ${name} belum diimplementasikan pada versi backend ini.`);
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  try {
    const body = await req.json();
    const fn = body.fn;
    const args = body.args || [];
    if (fn === "login") return json(await login(args[0], args[1], args[2]));
    if (fn === "logout") {
      await db("app_sessions", `?token=eq.${encodeURIComponent(args[0] || "")}`, { method: "DELETE" });
      return json({ ok: true });
    }
    if (fn === "pulihkanSesi" || fn === "menuSaya") {
      const s2 = await session(args[0]);
      if (!s2) return json({ ok: false, error: "Sesi berakhir. Silakan login kembali.", code: "NO_SESSION" });
      return json({ ok: true, data: fn === "menuSaya" ? menuSaya(s2) : { token: args[0], user: { username: s2.username, nama: s2.nama, role: s2.role, cabang_id: cabangSesi(s2), login_at: s2.login_at, shift: s2.shift } } });
    }
    if (fn !== "api") return json({ ok: false, error: `Fungsi tidak dikenal: ${fn}` }, 400);
    const [name, data, token] = args;
    const s = await session(token);
    if (!s) return json({ ok: false, error: "Sesi berakhir. Silakan login kembali.", code: "NO_SESSION" });
    if (!PERM[name] || !PERM[name].includes(s.role)) return json({ ok: false, error: `Akses ditolak untuk role ${s.role}.`, code: "DENIED" });
    return json({ ok: true, data: await action(name, data || {}, s) });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
