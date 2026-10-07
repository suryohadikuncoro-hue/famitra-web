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
  // Jam operasional 07:00-21:00 (Pagi 07:00-13:59, Sore 14:00-20:59). Batas ini
  // harus sama dengan shiftSekarang_() di public/js_core.js dan v_shift di RPC
  // pos_checkout.
  return h >= 7 && h < 14 ? "Pagi" : h >= 14 && h < 21 ? "Sore" : "Luar Jam";
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
  "pos.suggestCustomer": ["Owner", "Apoteker", "Kasir"],
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
  "dashboard.ringkasan": ["Owner", "Apoteker", "Kasir"],
  "beli.list": ["Owner", "Apoteker"],
  "beli.simpan": ["Owner", "Apoteker"],
  "beli.supplier": ["Owner", "Apoteker"],
  "beli.simpanSupplier": ["Owner", "Apoteker"],
  "beli.detail": ["Owner", "Apoteker"],
  "beli.batal": ["Owner", "Apoteker"],
  "loyalty.expire": ["Owner", "Apoteker"],
  "biaya.list": ["Owner", "Kasir"],
  "biaya.simpan": ["Owner", "Kasir"],
  "biaya.hapus": ["Owner"],
  "laporan.labaRugi": ["Owner"],
  "user.list": ["Owner"],
  "user.simpan": ["Owner"],
  "user.hapus": ["Owner"],
  "cabang.list": ["Owner", "Apoteker"],
  "retur.jualList": ["Owner", "Apoteker", "Kasir"],
  "retur.jualSimpan": ["Owner", "Apoteker", "Kasir"],
  "riwayat.notaList": ["Owner", "Apoteker", "Kasir"],
  "riwayat.notaDetail": ["Owner", "Apoteker", "Kasir"],
  "retur.beliList": ["Owner"],
  "retur.beliSimpan": ["Owner"],
  "retur.beliApprove": ["Owner"]
};
var RIWAYAT_NOTA_ROLE = {
  Owner: ["penjualan", "pembelian", "retur_jual", "retur_beli"],
  Apoteker: ["penjualan", "pembelian", "retur_jual"],
  Kasir: ["penjualan", "retur_jual"]
};
var RIWAYAT_NOTA_CFG = {
  penjualan: {
    label: "Penjualan", table: "trx_penjualan", detailTable: "trx_penjualan_detail", key: "no_nota", tanggal: "tanggal",
    order: "timestamp.desc,no_nota.desc",
    searchFields: ["no_nota"], detailSearchField: "nama_obat",
    listSelect: "no_nota,tanggal,jam,nama_pelanggan,petugas_transaksi,shift,harga_akhir",
    headerSelect: "no_nota,tanggal,jam,nama_pelanggan,petugas_transaksi,shift,subtotal,diskon,harga_akhir",
    detailSelect: "kode_obat,nama_obat,kode_batch,qty,harga_satuan,subtotal",
    row: (x) => ({ No_Dokumen: x.no_nota, No_Asal: "", Tanggal: x.tanggal, Jam: x.jam, Pihak: x.nama_pelanggan || "Umum", Petugas: x.petugas_transaksi || "", Shift: x.shift || "", Total: x.harga_akhir, Status: "" }),
    header: (x) => ({ No_Dokumen: x.no_nota, Tanggal: x.tanggal, Jam: x.jam, Pihak: x.nama_pelanggan || "Umum", Petugas: x.petugas_transaksi || "", Shift: x.shift, Subtotal: x.subtotal, Diskon: x.diskon, Total: x.harga_akhir }),
    item: (x) => ({ Kode_Obat: x.kode_obat, Nama_Obat: x.nama_obat, Kode_Batch: x.kode_batch, Qty: x.qty, Harga_Satuan: x.harga_satuan, Subtotal: x.subtotal })
  },
  pembelian: {
    label: "Pembelian", table: "trx_pembelian", detailTable: "trx_pembelian_detail", key: "no_faktur", tanggal: "tanggal_faktur",
    order: "timestamp.desc,no_faktur.desc",
    searchFields: ["no_faktur", "no_faktur_supplier"], detailSearchField: "nama_obat",
    listSelect: "no_faktur,no_faktur_supplier,supplier,kategori,tanggal_faktur,jatuh_tempo,total_item,total_tagihan,petugas",
    headerSelect: "no_faktur,no_faktur_supplier,supplier,kategori,tanggal_faktur,jatuh_tempo,total_item,total_tagihan,petugas",
    detailSelect: "kode_obat,nama_obat,kode_batch,expired_date,qty,harga_netto,ppn,diskon,subtotal",
    row: (x) => ({ No_Dokumen: x.no_faktur, No_Asal: x.no_faktur_supplier || "", Tanggal: x.tanggal_faktur, Jam: "", Pihak: x.supplier || "", Petugas: x.petugas || "", Total: x.total_tagihan, Status: x.kategori || "", Jumlah_Item: x.total_item }),
    header: (x) => ({ No_Dokumen: x.no_faktur, No_Asal: x.no_faktur_supplier || "", Tanggal: x.tanggal_faktur, Pihak: x.supplier || "", Petugas: x.petugas || "", Kategori: x.kategori, Jatuh_Tempo: x.jatuh_tempo, Jumlah_Item: x.total_item, Total: x.total_tagihan }),
    item: (x) => ({ Kode_Obat: x.kode_obat, Nama_Obat: x.nama_obat, Kode_Batch: x.kode_batch, Expired_Date: x.expired_date, Qty: x.qty, Harga_Satuan: x.harga_netto, PPN: x.ppn, Diskon: x.diskon, Subtotal: x.subtotal })
  },
  retur_jual: {
    label: "Retur Penjualan", table: "trx_retur_jual", detailTable: "trx_retur_jual_detail", key: "no_retur", tanggal: "tanggal",
    order: "timestamp.desc,no_retur.desc",
    searchFields: ["no_retur", "no_nota_asal"], detailSearchField: "nama_obat",
    listSelect: "no_retur,no_nota_asal,tanggal,jam,nama_pelanggan,petugas,shift,total_refund,alasan",
    headerSelect: "no_retur,no_nota_asal,tanggal,jam,nama_pelanggan,petugas,shift,total_refund,alasan",
    detailSelect: "kode_obat,nama_obat,kode_batch,qty,harga_satuan,subtotal,kondisi",
    row: (x) => ({ No_Dokumen: x.no_retur, No_Asal: x.no_nota_asal || "", Tanggal: x.tanggal, Jam: x.jam, Pihak: x.nama_pelanggan || "Umum", Petugas: x.petugas || "", Shift: x.shift || "", Total: x.total_refund, Status: "Retur", Keterangan: x.alasan || "" }),
    header: (x) => ({ No_Dokumen: x.no_retur, No_Asal: x.no_nota_asal || "", Tanggal: x.tanggal, Jam: x.jam, Pihak: x.nama_pelanggan || "Umum", Petugas: x.petugas || "", Shift: x.shift, Total: x.total_refund, Alasan: x.alasan || "" }),
    item: (x) => ({ Kode_Obat: x.kode_obat, Nama_Obat: x.nama_obat, Kode_Batch: x.kode_batch, Qty: x.qty, Harga_Satuan: x.harga_satuan, Subtotal: x.subtotal, Kondisi: x.kondisi })
  },
  retur_beli: {
    label: "Retur Pembelian", table: "trx_retur_beli", detailTable: "trx_retur_beli_detail", key: "no_retur", tanggal: "tanggal",
    order: "timestamp.desc,no_retur.desc",
    searchFields: ["no_retur", "no_faktur_asal"], detailSearchField: "nama_obat",
    listSelect: "no_retur,no_faktur_asal,supplier,tanggal,status,created_by,approved_by,total_refund,alasan",
    headerSelect: "no_retur,no_faktur_asal,supplier,tanggal,status,created_by,approved_by,tanggal_approval,total_refund,alasan",
    detailSelect: "kode_obat,nama_obat,kode_batch,qty,harga_netto,subtotal,kondisi",
    row: (x) => ({ No_Dokumen: x.no_retur, No_Asal: x.no_faktur_asal || "", Tanggal: x.tanggal, Jam: "", Pihak: x.supplier || "", Petugas: x.created_by || "", Total: x.total_refund, Status: x.status || "", Keterangan: x.alasan || "" }),
    header: (x) => ({ No_Dokumen: x.no_retur, No_Asal: x.no_faktur_asal || "", Tanggal: x.tanggal, Pihak: x.supplier || "", Petugas: x.created_by || "", Disetujui_Oleh: x.approved_by || "", Tanggal_Approval: x.tanggal_approval, Status: x.status || "", Total: x.total_refund, Alasan: x.alasan || "" }),
    item: (x) => ({ Kode_Obat: x.kode_obat, Nama_Obat: x.nama_obat, Kode_Batch: x.kode_batch, Qty: x.qty, Harga_Satuan: x.harga_netto, Subtotal: x.subtotal, Kondisi: x.kondisi })
  }
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
  Owner: [{ id: "dashboard", label: "Dashboard" }, { id: "pos", label: "Kasir / POS" }, { id: "barang", label: "Master Barang" }, { id: "stok", label: "Stok & Batch" }, { id: "beli", label: "Pembelian" }, { id: "crm", label: "Pelanggan" }, { id: "marketing", label: "Marketing" }, { id: "biaya", label: "Biaya Operasional" }, { id: "opname", label: "Stokopname" }, { id: "laporan", label: "Laporan Laba Rugi" }, { id: "retur", label: "Retur" }, { id: "user", label: "Manajemen User" }],
  Apoteker: [{ id: "dashboard", label: "Dashboard" }, { id: "pos", label: "Kasir / POS" }, { id: "barang", label: "Master Barang" }, { id: "stok", label: "Stok & Batch" }, { id: "beli", label: "Pembelian" }, { id: "crm", label: "Pelanggan" }, { id: "opname", label: "Stokopname" }, { id: "retur", label: "Retur" }],
  Kasir: [{ id: "dashboard", label: "Dashboard" }, { id: "pos", label: "Kasir / POS" }, { id: "biaya", label: "Biaya Operasional" }, { id: "retur", label: "Retur" }]
};
function menuSaya(s) {
  const menu = (menus[s.role] || []).slice();
  if (RIWAYAT_NOTA_ROLE[s.role]) menu.push({ id: "riwayat", label: "Riwayat Nota" });
  return { menu, user: { username: s.username, nama: s.nama, role: s.role, cabang_id: cabangSesi(s), login_at: s.login_at, shift: s.shift }, apotek: "Apotek Fa-Mitra", halamanAwal: s.role === "Kasir" ? "pos" : "dashboard" };
}
// Ambil SEMUA baris (PostgREST membatasi jumlah baris per request), 1000 per halaman.
async function semua(table, query) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await db(table, `${query}&limit=1000&offset=${offset}`);
    if (!r.ok) throw new Error(await r.text());
    const page = await r.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
    if (rows.length > 200000) throw new Error("Data terlalu besar. Gunakan rentang lebih pendek.");
  }
}
// Retur penjualan dalam rentang (dihitung pada TANGGAL RETUR) beserta HPP barang
// yang kembali (qty retur x harga_modal batch asal di trx_penjualan_detail).
async function returDalamRentang(cabangId, r0) {
  const cab = encodeURIComponent(cabangId);
  const returs = await semua("trx_retur_jual", `${qsRange(r0, "tanggal")}&cabang_id=eq.${cab}&select=no_retur,no_nota_asal,total_refund,shift&order=no_retur`);
  if (!returs.length) return [];
  const hppPer = {};
  for (let i = 0; i < returs.length; i += 100) {
    const potong = returs.slice(i, i + 100);
    const det = await semua("trx_retur_jual_detail", `?cabang_id=eq.${cab}&no_retur=in.(${potong.map((x) => encodeURIComponent(x.no_retur)).join(",")})&select=no_retur,kode_obat,kode_batch,qty&order=id`);
    const asal = await semua("trx_penjualan_detail", `?cabang_id=eq.${cab}&no_nota=in.(${[...new Set(potong.map((x) => encodeURIComponent(x.no_nota_asal)))].join(",")})&select=no_nota,kode_obat,kode_batch,harga_modal&order=id`);
    for (const d of det) {
      const nota = potong.find((x) => x.no_retur === d.no_retur).no_nota_asal;
      const ref = asal.find((x) => x.no_nota === nota && x.kode_obat === d.kode_obat && x.kode_batch === d.kode_batch);
      hppPer[d.no_retur] = (hppPer[d.no_retur] || 0) + Number(d.qty || 0) * Number(ref ? ref.harga_modal : 0);
    }
  }
  return returs.map((x) => ({ ...x, refund: Number(x.total_refund || 0), hpp: hppPer[x.no_retur] || 0 }));
}
// Jumlah yang sudah diretur untuk 1 nota: total refund + qty per obat|batch.
async function sudahDiretur(cabangId, noNota) {
  const cab = encodeURIComponent(cabangId);
  const rs = await semua("trx_retur_jual", `?cabang_id=eq.${cab}&no_nota_asal=eq.${encodeURIComponent(noNota)}&select=no_retur,total_refund&order=no_retur`);
  const qty = {};
  if (rs.length) {
    const det = await semua("trx_retur_jual_detail", `?cabang_id=eq.${cab}&no_retur=in.(${rs.map((x) => encodeURIComponent(x.no_retur)).join(",")})&select=kode_obat,kode_batch,qty&order=id`);
    for (const d of det) qty[`${d.kode_obat}|${d.kode_batch}`] = (qty[`${d.kode_obat}|${d.kode_batch}`] || 0) + Number(d.qty || 0);
  }
  return { refund: rs.reduce((n, x) => n + Number(x.total_refund || 0), 0), qty };
}
async function stokDashboard(cabangId) {
  // Semua baris (paginasi), bukan maks. 5000, supaya hitungan stok akurat.
  const [barang, batch] = await Promise.all([
    semua("master_barang", `?cabang_id=eq.${encodeURIComponent(cabangId)}&aktif=eq.YA&select=kode_obat,nama_obat,stok_min&order=kode_obat`),
    semua("stok_batch", `?cabang_id=eq.${encodeURIComponent(cabangId)}&select=kode_obat,kode_batch,expired_date,stok_real,harga_modal_batch&order=expired_date,id_batch`)
  ]);
  const nama = Object.fromEntries(barang.map((x) => [x.kode_obat, x.nama_obat]));
  const min = Object.fromEntries(barang.map((x) => [x.kode_obat, Number(x.stok_min || 0)]));
  const total = {};
  batch.forEach((x) => {
    total[x.kode_obat] = (total[x.kode_obat] || 0) + Number(x.stok_real || 0);
  });
  const expiring = batch.filter((x) => Number(x.stok_real || 0) > 0 && daysUntil(x.expired_date) <= 90).map((x) => ({ Kode_Obat: x.kode_obat, Nama_Obat: nama[x.kode_obat] || x.kode_obat, Kode_Batch: x.kode_batch, Expired_Date: x.expired_date, Stok_Real: x.stok_real, sisa_hari: daysUntil(x.expired_date) }));
  const stok_menipis = barang.filter((x) => (total[x.kode_obat] || 0) <= Number(x.stok_min || 0)).map((x) => ({ Kode_Obat: x.kode_obat, Nama_Obat: x.nama_obat, stok: total[x.kode_obat] || 0, minimal: Number(x.stok_min || 0) }));
  // Untuk visual "kesehatan stok" di dashboard: aman / menipis / habis dari produk aktif.
  const stok_habis_total = barang.filter((x) => (total[x.kode_obat] || 0) <= 0).length;
  const modal = Object.fromEntries(batch.map((x) => [`${x.kode_obat}|${x.kode_batch}`, Number(x.harga_modal_batch || 0)]));
  return { produk_aktif_total: barang.length, stok_habis_total, expiring_unit: expiring.reduce((n, x) => n + Number(x.Stok_Real || 0), 0),
    // nilai = unit x harga modal batch (sebelumnya berisi jumlah unit)
    expiring_nilai: expiring.reduce((n, x) => n + Number(x.Stok_Real || 0) * (modal[`${x.Kode_Obat}|${x.Kode_Batch}`] || 0), 0), expiring_kritis: expiring.filter((x) => x.sisa_hari <= 30).length, expiring, stok_menipis_total: stok_menipis.length, stok_menipis };
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
    // Auto-expire poin yang lebih tua dari 12 bulan sebelum tampilkan CRM
    await db("rpc/expire_loyalty_points", "", { method: "POST", headers: { ...headers, Prefer: "return=representation" } });
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
  if (name === "loyalty.expire") {
    const r = await db("rpc/expire_loyalty_points", "", { method: "POST", headers: { ...headers, Prefer: "return=representation" } });
    if (!r.ok) throw new Error(await r.text());
    return { expired: Number(await r.json()) || 0 };
  }
  if (name === "pos.cariCustomer") {
    const wa = normWA(data.wa);
    const c = await one("master_customer", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&nomor_wa=eq.${encodeURIComponent(wa)}&select=*`);
    return c ? { found: true, Nomor_WA: c.nomor_wa, Nama: c.nama, Tipe_Customer: c.tipe_customer, Alamat: c.alamat, Total_Belanja: c.total_belanja, Jumlah_Transaksi: c.jumlah_transaksi, Tanggal_Terakhir_Beli: c.tanggal_terakhir_beli, Segment_CRM: c.segment_crm, Tier: c.tier, Total_Points: c.total_points, Total_Spend_MTD: c.total_spend_mtd, Consent_Marketing: c.consent_marketing } : { found: false, Nomor_WA: wa };
  }
  if (name === "pos.suggestCustomer") {
    const q = String(data.q || "").trim().slice(0, 80);
    if (!q) return [];
    const needle = data.mode === "wa" ? normWA(q) : q;
    const filter = `or=(nama.ilike.*${encodeURIComponent(needle)}*,nomor_wa.ilike.*${encodeURIComponent(needle)}*)`;
    const r = await db("master_customer", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&${filter}&select=id,nomor_wa,nama,tipe_customer&order=nama.asc&limit=12`);
    if (!r.ok) throw new Error(await r.text());
    return (await r.json()).map((c) => ({ ID: c.id, Nomor_WA: c.nomor_wa, Nama: c.nama, Tipe_Customer: c.tipe_customer }));
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
    const cab = encodeURIComponent(cabangSesi(s));
    const filterBarang = `?cabang_id=eq.${cab}&or=(kode_obat.ilike.*${encodeURIComponent(q)}*,nama_obat.ilike.*${encodeURIComponent(q)}*,kategori.ilike.*${encodeURIComponent(q)}*)`;
    // Mode halaman (dipakai halaman Master Barang): 100 barang per halaman + total,
    // stok dijumlah dari SEMUA batch barang di halaman itu. Tanpa `halaman`,
    // perilaku lama dipertahankan (dipakai pencarian barang di Pembelian).
    if (data.halaman !== undefined) {
      const per = Math.min(Math.max(Math.floor(Number(data.per_halaman) || 100), 1), 200);
      const hal = Math.max(1, Math.floor(Number(data.halaman) || 1));
      const r = await db("master_barang", `${filterBarang}&select=*&order=nama_obat,kode_obat&limit=${per}&offset=${(hal - 1) * per}`, { headers: { Prefer: "count=exact" } });
      if (!r.ok) throw new Error(await r.text());
      const total = Number(String(r.headers.get("content-range") || "").split("/")[1]) || 0;
      const rows = await r.json();
      const stok = {};
      if (rows.length) {
        const daftar = rows.map((b) => encodeURIComponent(`"${String(b.kode_obat).replace(/"/g, '\\"')}"`)).join(",");
        for (let offset = 0; ; offset += 1000) {
          const br = await db("stok_batch", `?cabang_id=eq.${cab}&kode_obat=in.(${daftar})&select=kode_obat,stok_real&order=id_batch&limit=1000&offset=${offset}`);
          if (!br.ok) throw new Error(await br.text());
          const page = await br.json();
          page.forEach((x) => { stok[x.kode_obat] = (stok[x.kode_obat] || 0) + Number(x.stok_real || 0); });
          if (page.length < 1000) break;
        }
      }
      return {
        rows: rows.map((b) => ({ ...b, Kode_Obat: b.kode_obat, Nama_Obat: b.nama_obat, Kategori: b.kategori, Satuan: b.satuan, Barcode: b.barcode, Harga_Modal: b.harga_modal, Harga_Jual_Umum: b.harga_jual_umum, Harga_Khusus: b.harga_khusus, Harga_Jual_Mutasi: b.harga_jual_mutasi, PPN: b.ppn, Stok_Min: b.stok_min, Aktif: b.aktif, stok: stok[b.kode_obat] || 0 })),
        total, halaman: hal, per_halaman: per, jumlah_halaman: Math.max(1, Math.ceil(total / per))
      };
    }
    const r = await db("master_barang", `${filterBarang}&select=*&order=nama_obat&limit=100`);
    const rows = await r.json();
    // Stok nyata per barang: dipakai pencarian barang di Pembelian supaya apoteker
    // melihat stok yang ada sebelum menambah barang. Sebelumnya selalu 0.
    const stok = {};
    if (rows.length) {
      const daftar = rows.map((b) => encodeURIComponent(`"${String(b.kode_obat).replace(/"/g, '\\"')}"`)).join(",");
      for (let offset = 0; ; offset += 1000) {
        const br = await db("stok_batch", `?cabang_id=eq.${cab}&kode_obat=in.(${daftar})&select=kode_obat,stok_real&order=id_batch&limit=1000&offset=${offset}`);
        if (!br.ok) throw new Error(await br.text());
        const page = await br.json();
        page.forEach((x) => { stok[x.kode_obat] = (stok[x.kode_obat] || 0) + Number(x.stok_real || 0); });
        if (page.length < 1000) break;
      }
    }
    return rows.map((b) => ({ ...b, Kode_Obat: b.kode_obat, Nama_Obat: b.nama_obat, Kategori: b.kategori, Satuan: b.satuan, Barcode: b.barcode, Harga_Modal: b.harga_modal, Harga_Jual_Umum: b.harga_jual_umum, Harga_Khusus: b.harga_khusus, Harga_Jual_Mutasi: b.harga_jual_mutasi, PPN: b.ppn, Stok_Min: b.stok_min, Aktif: b.aktif, stok: stok[b.kode_obat] || 0 }));
  }
  if (name === "stok.list") {
    const cabang = cabangSesi(s), cab = encodeURIComponent(cabang);
    const q = String(data.q || "").trim().toLocaleLowerCase();
    const exactKode = String(data.kode_obat || "").trim().toUpperCase();
    const tampilkanSemuaBatch = data.semua === true;
    if (tampilkanSemuaBatch && !exactKode) throw new Error("Permintaan semua batch harus menyertakan kode obat yang tepat.");
    const nLimit = Math.floor(Number(data.limit)), limit = Number.isFinite(nLimit) ? Math.max(1, Math.min(200, nLimit)) : 50;
    const nOffset = Math.floor(Number(data.offset)), offset = Number.isFinite(nOffset) ? Math.max(0, Math.min(1000000, nOffset)) : 0;
    const kritis = !!data.kritis;
    const sort = ["nama", "stok_asc", "stok_desc", "expired_asc", "terbaru"].includes(data.sort) ? data.sort : "nama";
    const status = ["semua", "tersedia", "habis"].includes(data.status) ? data.status : "semua";
    const cutoffDate = (() => {
      const d = new Date(`${today()}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 90);
      return d.toISOString().slice(0, 10);
    })();
    const batchFields = "id_batch,kode_obat,kode_batch,expired_date,stok_real,harga_modal_batch";
    const rowBatch = (m, b) => ({ Kode_Obat: m.kode_obat || b.kode_obat, Nama_Obat: m.nama_obat, Aktif: m.aktif, Kode_Batch: b.kode_batch, Expired_Date: b.expired_date, sisa_hari: daysUntil(b.expired_date), Stok_Real: b.stok_real, Harga_Modal_Batch: b.harga_modal_batch, ID_Batch: b.id_batch, Belum_Ada_Batch: false });
    const rowTanpaBatch = (m) => ({ Kode_Obat: m.kode_obat, Nama_Obat: m.nama_obat, Aktif: m.aktif, Kode_Batch: "", Expired_Date: "", sisa_hari: null, Stok_Real: 0, Harga_Modal_Batch: null, ID_Batch: null, Belum_Ada_Batch: true });
    const fromMaster = (m) => {
      const batches = Array.isArray(m.stok_batch) ? m.stok_batch : [];
      return batches.length ? batches.map((b) => rowBatch(m, b)) : kritis ? [] : [rowTanpaBatch(m)];
    };
    const totalFrom = (r) => Number(String(r.headers.get("content-range") || "").split("/")[1]) || 0;
    const pageInfo = (rows, total, pageCount, unit) => ({ rows, total, limit, offset, page_count: pageCount, pagination_unit: unit, has_more: offset + pageCount < total, next_offset: offset + pageCount });
    const criticalMasterFilter = kritis ? `&stok_batch.stok_real=gt.0&stok_batch.expired_date=lte.${cutoffDate}` : "";
    const criticalBatchFilter = kritis ? `&stok_real=gt.0&expired_date=lte.${cutoffDate}` : "";
    // Escape ILIKE metacharacters in user text, then quote the whole operand.
    const qLike = q.replace(/[\\%_*]/g, "\\$&");
    const quotedQ = qLike.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const encQ = encodeURIComponent(quotedQ).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    const pattern = `%22%25${encQ}%25%22`;

    // Pemanggil Master Barang hanya perlu seluruh batch untuk satu SKU persis;
    // jangan memindai inventaris seluruh cabang untuk membuka koreksi stok.
    if (tampilkanSemuaBatch) {
      const mr = await db("master_barang", `?cabang_id=eq.${cab}&kode_obat=eq.${encodeURIComponent(exactKode)}&select=kode_obat,nama_obat,aktif&limit=1`);
      if (!mr.ok) throw new Error(await mr.text());
      const master = (await mr.json())[0];
      if (!master) return pageInfo([], 0, 0, "hasil");
      const batches = await semua("stok_batch", `?cabang_id=eq.${cab}&kode_obat=eq.${encodeURIComponent(exactKode)}&select=${batchFields}&order=expired_date.asc,id_batch.asc`);
      let rows = batches.length ? batches.map((b) => rowBatch(master, b)) : [rowTanpaBatch(master)];
      if (q) rows = rows.filter((x) => String(x.Kode_Batch || "").toLocaleLowerCase().includes(q));
      if (kritis) rows = rows.filter((x) => !x.Belum_Ada_Batch && Number(x.Stok_Real) > 0 && x.sisa_hari <= 90);
      return pageInfo(rows, rows.length, rows.length, "hasil");
    }

    // Sort/filter inventaris langsung pada batch agar urutan tidak hanya berlaku
    // pada halaman yang sedang terlihat. Mode ini sengaja memakai unit "hasil":
    // barang tanpa batch tidak memiliki baris batch untuk diurutkan.
    if (!q && (sort !== "nama" || status !== "semua")) {
      const statusFilter = status === "tersedia" ? "&stok_real=gt.0" : status === "habis" ? "&stok_real=eq.0" : "";
      const order = sort === "stok_asc" ? "stok_real.asc,expired_date.asc,id_batch.asc" :
        sort === "stok_desc" ? "stok_real.desc,expired_date.asc,id_batch.asc" :
        sort === "terbaru" ? "id_batch.desc" : "expired_date.asc,id_batch.asc";
      const r = await db("stok_batch", `?cabang_id=eq.${cab}${statusFilter}${criticalBatchFilter}&select=${batchFields},master_barang!inner(nama_obat,aktif)&master_barang.cabang_id=eq.${cab}&order=${order}&limit=${limit}&offset=${offset}`, { headers: { Prefer: "count=exact" } });
      if (!r.ok) throw new Error(await r.text());
      const batches = await r.json();
      const rows = batches.map((b) => rowBatch(b.master_barang || {}, b));
      return pageInfo(rows, totalFrom(r), rows.length, "hasil");
    }

    // Tampilan normal: database hanya mengirim halaman barang yang diminta;
    // LEFT embed mempertahankan barang tanpa batch sebagai stok 0.
    if (!q && !kritis) {
      const r = await db("master_barang", `?cabang_id=eq.${cab}&select=kode_obat,nama_obat,aktif,stok_batch(${batchFields})&stok_batch.cabang_id=eq.${cab}&order=nama_obat.asc,kode_obat.asc&limit=${limit}&offset=${offset}`, { headers: { Prefer: "count=exact" } });
      if (!r.ok) throw new Error(await r.text());
      const masters = await r.json();
      const rows = masters.flatMap(fromMaster);
      return pageInfo(rows, totalFrom(r), masters.length, "barang");
    }

    if (q && (sort !== "nama" || status !== "semua")) {
      const statusFilter = status === "tersedia" ? "&stok_real=gt.0" : status === "habis" ? "&stok_real=eq.0" : "";
      const searchFilter = data.jenis === "batch"
        ? `&kode_batch=ilike.${pattern}`
        : `&master_barang.or=(kode_obat.ilike.${pattern},nama_obat.ilike.${pattern})`;
      const order = sort === "stok_asc" ? "stok_real.asc,expired_date.asc,id_batch.asc" :
        sort === "stok_desc" ? "stok_real.desc,expired_date.asc,id_batch.asc" :
        sort === "terbaru" ? "id_batch.desc" : "expired_date.asc,id_batch.asc";
      const r = await db("stok_batch", `?cabang_id=eq.${cab}${statusFilter}${criticalBatchFilter}${searchFilter}&select=${batchFields},master_barang!inner(nama_obat,aktif)&master_barang.cabang_id=eq.${cab}&order=${order}&limit=${limit}&offset=${offset}`, { headers: { Prefer: "count=exact" } });
      if (!r.ok) throw new Error(await r.text());
      const batches = await r.json();
      const rows = batches.map((b) => rowBatch(b.master_barang || {}, b));
      return pageInfo(rows, totalFrom(r), rows.length, "hasil");
    }

    // Mode mendesak dipaginasi langsung pada batch yang benar-benar mendesak.
    if (!q && kritis) {
      const r = await db("stok_batch", `?cabang_id=eq.${cab}&stok_real=gt.0&expired_date=lte.${cutoffDate}&select=${batchFields},master_barang!inner(nama_obat,aktif)&master_barang.cabang_id=eq.${cab}&order=expired_date.asc,id_batch.asc&limit=${limit}&offset=${offset}`, { headers: { Prefer: "count=exact" } });
      if (!r.ok) throw new Error(await r.text());
      const batches = await r.json();
      const rows = batches.map((b) => rowBatch(b.master_barang || {}, b));
      return pageInfo(rows, totalFrom(r), rows.length, "hasil");
    }

    // Encoded % values around the term are the only intentional substring wildcards.
    if (data.jenis !== "batch") {
      const masterRelation = `stok_batch${kritis ? "!inner" : ""}(${batchFields})`;
      const r = await db("master_barang", `?cabang_id=eq.${cab}&or=(kode_obat.ilike.${pattern},nama_obat.ilike.${pattern})&select=kode_obat,nama_obat,aktif,${masterRelation}&stok_batch.cabang_id=eq.${cab}${criticalMasterFilter}&order=nama_obat.asc,kode_obat.asc&limit=${limit}&offset=${offset}`, { headers: { Prefer: "count=exact" } });
      if (!r.ok) throw new Error(await r.text());
      const masters = await r.json();
      const rows = masters.flatMap(fromMaster);
      return pageInfo(rows, totalFrom(r), masters.length, "barang");
    }
    const r = await db("stok_batch", `?cabang_id=eq.${cab}&kode_batch=ilike.${pattern}${criticalBatchFilter}&select=${batchFields},master_barang!inner(nama_obat,aktif)&master_barang.cabang_id=eq.${cab}&order=kode_obat.asc,expired_date.asc,id_batch.asc&limit=${limit}&offset=${offset}`, { headers: { Prefer: "count=exact" } });
    if (!r.ok) throw new Error(await r.text());
    const batches = await r.json();
    const rows = batches.map((b) => rowBatch(b.master_barang || {}, b));
    return pageInfo(rows, totalFrom(r), rows.length, "hasil");
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
    const p = { cabang_id: cabang, kode_obat: String(data.Kode_Obat).toUpperCase(), nama_obat: data.Nama_Obat, kategori: data.Kategori || "", golongan: data.Golongan || data.golongan || "Bebas", satuan: data.Satuan || "Pcs", barcode: data.Barcode || null, stok_min: data.Stok_Min || 10, harga_modal: data.Harga_Modal || 0, harga_jual_umum: data.Harga_Jual_Umum || 0, harga_khusus: data.Harga_Khusus || 0, harga_jual_mutasi: data.Harga_Jual_Mutasi || 0, ppn: data.PPN || 0, aktif: "YA" };
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
    // mode "edit" memakai purchase_update (membalik dulu efek faktur lama).
    // No_Faktur tetap berarti nomor faktur PBF; nomor faktur sistem yang sedang
    // diubah dikirim terpisah lewat No_Faktur_Sistem.
    const edit = data.mode === "edit";
    const noSistem = String(data.No_Faktur_Sistem || "").trim();
    if (edit && !noSistem) throw new Error("Nomor faktur yang akan diubah wajib diisi.");
    const rpc = edit ? "purchase_update" : "purchase_save";
    const body = edit
      ? { p_username: s.username, p_no_faktur: noSistem, p_no_faktur_supplier: data.No_Faktur, p_supplier: data.Supplier, p_kategori: data.Kategori, p_tanggal: data.Tanggal_Faktur, p_jatuh_tempo: data.Jatuh_Tempo || null, p_items: data.items || [], p_cabang_id: cabangSesi(s) }
      : { p_username: s.username, p_no_faktur_supplier: data.No_Faktur, p_supplier: data.Supplier, p_kategori: data.Kategori, p_tanggal: data.Tanggal_Faktur, p_jatuh_tempo: data.Jatuh_Tempo || null, p_items: data.items || [], p_cabang_id: cabangSesi(s) };
    const r = await db(`rpc/${rpc}`, "", { method: "POST", headers: { ...headers }, body: JSON.stringify(body) });
    if (!r.ok) {
      const text = await r.text();
      let detail = null;
      try { detail = JSON.parse(text); } catch (_) { /* Keep non-JSON server response below. */ }
      if (detail && detail.code === "23505" && /stok_batch_pkey/.test([detail.message, detail.details, detail.hint].filter(Boolean).join(" "))) {
        throw new Error("ID batch bentrok saat menyimpan pembelian. Tidak ada perubahan yang tersimpan. Silakan coba sekali lagi; jika masih terjadi, hubungi admin.");
      }
      throw new Error(detail && (detail.message || detail.details) || text || "Pembelian gagal.");
    }
    return await r.json();
  }
  if (name === "beli.list") {
    const cab = encodeURIComponent(cabangSesi(s));
    const kolom = "no_faktur,no_faktur_supplier,supplier,kategori,tanggal_faktur,jatuh_tempo,total_item,total_tagihan";
    // Kolom status/diedit_at baru ada setelah migrasi pembelian_edit_dan_harga_tambahan.
    // Kalau migrasi belum diterapkan, daftar tetap tampil (semua dianggap AKTIF)
    // supaya halaman Pembelian tidak mati hanya karena urutan deploy.
    let r = await db("trx_pembelian", `?cabang_id=eq.${cab}&select=${kolom},status,diedit_at&order=timestamp.desc&limit=200`);
    if (!r.ok) r = await db("trx_pembelian", `?cabang_id=eq.${cab}&select=${kolom}&order=timestamp.desc&limit=200`);
    if (!r.ok) throw new Error(await r.text());
    const rows = await r.json();
    return rows.map((x) => ({ No_Faktur: x.no_faktur, No_Faktur_Supplier: x.no_faktur_supplier, Supplier: x.supplier, Kategori: x.kategori, Tanggal_Faktur: x.tanggal_faktur, Jatuh_Tempo: x.jatuh_tempo, Total_Item: x.total_item, Total_Tagihan: x.total_tagihan, Status_Faktur: x.status || "AKTIF", Diedit_At: x.diedit_at || null, jatuh_tempo_hari: x.jatuh_tempo ? daysUntil(x.jatuh_tempo) : null }));
  }
  if (name === "beli.detail") {
    // Dipakai form Pembelian saat mengubah faktur: header + rincian item, ditambah
    // stok batch saat ini dan harga master terkini untuk tiap barang.
    const cab = cabangSesi(s);
    const no = String(data.No_Faktur || "").trim();
    if (!no) throw new Error("Nomor faktur wajib diisi.");
    const h = await one("trx_pembelian", `?cabang_id=eq.${encodeURIComponent(cab)}&no_faktur=eq.${encodeURIComponent(no)}&select=no_faktur,no_faktur_supplier,supplier,kategori,tanggal_faktur,jatuh_tempo,total_item,total_tagihan,petugas,status,diedit_oleh,diedit_at`);
    if (!h) throw new Error("Faktur tidak ditemukan di cabang ini.");
    const d = await db("trx_pembelian_detail", `?cabang_id=eq.${encodeURIComponent(cab)}&no_faktur=eq.${encodeURIComponent(no)}&select=kode_obat,nama_obat,kode_batch,expired_date,qty,harga_netto,ppn,diskon,harga_jual_umum_baru,harga_khusus_baru,harga_jual_mutasi_baru,subtotal&order=kode_obat.asc`);
    if (!d.ok) throw new Error(await d.text());
    const items = await d.json();
    const kode = [...new Set(items.map((x) => String(x.kode_obat || "").toUpperCase()).filter(Boolean))];
    const stok = {}, master = {};
    if (kode.length) {
      const daftar = kode.map((k) => encodeURIComponent(`"${k.replace(/"/g, '\\"')}"`)).join(",");
      for (let offset = 0; ; offset += 1000) {
        const br = await db("stok_batch", `?cabang_id=eq.${encodeURIComponent(cab)}&kode_obat=in.(${daftar})&select=kode_obat,kode_batch,stok_real&order=kode_obat.asc,kode_batch.asc&limit=1000&offset=${offset}`);
        if (!br.ok) throw new Error(await br.text());
        const page = await br.json();
        page.forEach((x) => { stok[String(x.kode_obat).toUpperCase() + "|" + String(x.kode_batch || "")] = Number(x.stok_real || 0); });
        if (page.length < 1000) break;
      }
      const mr = await db("master_barang", `?cabang_id=eq.${encodeURIComponent(cab)}&kode_obat=in.(${daftar})&select=kode_obat,harga_jual_umum,harga_khusus,harga_jual_mutasi,aktif`);
      if (mr.ok) (await mr.json()).forEach((x) => { master[String(x.kode_obat).toUpperCase()] = x; });
    }
    return {
      Header: {
        No_Faktur: h.no_faktur, No_Faktur_Supplier: h.no_faktur_supplier || "", Supplier: h.supplier,
        Kategori: h.kategori, Tanggal_Faktur: h.tanggal_faktur, Jatuh_Tempo: h.jatuh_tempo,
        Total_Item: h.total_item, Total_Tagihan: h.total_tagihan, Petugas: h.petugas,
        Status_Faktur: h.status || "AKTIF", Diedit_Oleh: h.diedit_oleh || "", Diedit_At: h.diedit_at || null
      },
      items: items.map((x) => {
        const k = String(x.kode_obat || "").toUpperCase();
        const m = master[k] || {};
        const kunci = k + "|" + String(x.kode_batch || "");
        return {
          Kode_Obat: k, Nama_Obat: x.nama_obat, Kode_Batch: x.kode_batch || "", Expired_Date: x.expired_date,
          Qty: x.qty, Harga_Netto: x.harga_netto, PPN: x.ppn, Diskon: x.diskon,
          Harga_Jual_Umum_Baru: x.harga_jual_umum_baru || 0,
          Harga_Khusus_Baru: x.harga_khusus_baru || 0,
          Harga_Jual_Mutasi_Baru: x.harga_jual_mutasi_baru || 0,
          Stok_Tersedia: Object.prototype.hasOwnProperty.call(stok, kunci) ? stok[kunci] : null,
          Jual_Umum_Kini: m.harga_jual_umum || 0, Jual_Khusus_Kini: m.harga_khusus || 0,
          Jual_Mutasi_Kini: m.harga_jual_mutasi || 0, Aktif: m.aktif || "YA"
        };
      })
    };
  }
  if (name === "beli.batal") {
    const no = String(data.No_Faktur || "").trim();
    const alasan = String(data.Alasan || "").trim();
    if (!no) throw new Error("Nomor faktur wajib diisi.");
    if (!alasan) throw new Error("Alasan pembatalan wajib diisi.");
    const r = await db("rpc/purchase_cancel", "", { method: "POST", headers: { ...headers }, body: JSON.stringify({ p_username: s.username, p_no_faktur: no, p_alasan: alasan, p_cabang_id: cabangSesi(s) }) });
    if (!r.ok) {
      const text = await r.text();
      let detail = null;
      try { detail = JSON.parse(text); } catch (_) { /* Keep non-JSON server response below. */ }
      throw new Error(detail && (detail.message || detail.details) || text || "Pembatalan faktur gagal.");
    }
    return await r.json();
  }
  if (name === "riwayat.notaList") {
    const jenis = String(data.jenis || "");
    const cfg = RIWAYAT_NOTA_CFG[jenis];
    if (!cfg || !(RIWAYAT_NOTA_ROLE[s.role] || []).includes(jenis)) throw new Error("Akses riwayat nota ini tidak diizinkan.");
    const shiftSupported = jenis === "penjualan" || jenis === "retur_jual";
    let shift = "";
    if (Object.prototype.hasOwnProperty.call(data, "shift")) {
      if (typeof data.shift !== "string") throw new Error("Filter shift tidak valid.");
      shift = data.shift.trim();
      if (data.shift !== "" && !shift) throw new Error("Filter shift tidak valid.");
    }
    if (shift && !shiftSupported) throw new Error("Filter shift hanya tersedia untuk penjualan dan retur penjualan.");
    if (shift && shift !== "Semua" && !["Pagi", "Sore", "Luar Jam"].includes(shift)) throw new Error("Filter shift tidak valid.");
    const tanggal = (value, label) => {
      const d = String(value || "").trim();
      if (!d) return "";
      const ms = Date.parse(`${d}T00:00:00.000Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== d) throw new Error(`Tanggal ${label} tidak valid.`);
      return d;
    };
    const dari = tanggal(data.dari, "mulai"), sampai = tanggal(data.sampai, "akhir");
    if (dari && sampai && dari > sampai) throw new Error("Tanggal mulai tidak boleh melewati tanggal akhir.");
    // Nomor dokumen dicari secara tepat; nama obat dicari sebagian melalui
    // tabel rincian agar nomor lain yang mirip tidak ikut muncul.
    const q = String(data.q || "").trim().replace(/[^A-Za-z0-9À-ÿ _-]/g, "").replace(/\s+/g, " ").slice(0, 80);
    const nLimit = Math.floor(Number(data.limit)), limit = Number.isFinite(nLimit) ? Math.max(1, Math.min(100, nLimit)) : 50;
    const nOffset = Math.floor(Number(data.offset)), offset = Number.isFinite(nOffset) ? Math.max(0, Math.min(1000000, nOffset)) : 0;
    let query = `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=${cfg.listSelect}`;
    if (dari) query += `&${cfg.tanggal}=gte.${encodeURIComponent(dari)}`;
    if (sampai) query += `&${cfg.tanggal}=lte.${encodeURIComponent(sampai)}`;
    if (shift && shift !== "Semua") query += `&shift=eq.${encodeURIComponent(shift)}`;
    let itemKeys = [];
    if (q) {
      // Nomor dokumen harus benar-benar sama; jangan gunakan ILIKE tanpa
      // wildcard karena perilakunya mudah berubah ketika query di-encode.
      const filters = cfg.searchFields.map((field) => `${field}.eq.${encodeURIComponent(q)}`);
      const detail = await db(cfg.detailTable, `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&${cfg.detailSearchField}=ilike.*${encodeURIComponent(q)}*&select=${cfg.key}&limit=1000`);
      if (!detail.ok) throw new Error(await detail.text());
      itemKeys = [...new Set((await detail.json()).map((x) => x[cfg.key]).filter(Boolean))];
      if (itemKeys.length) filters.push(`${cfg.key}.in.(${itemKeys.map((key) => encodeURIComponent(key)).join(",")})`);
      query += filters.length === 1 ? `&${filters[0]}` : `&or=(${filters.join(",")})`;
    }
    query += `&order=${cfg.order}&limit=${limit + 1}&offset=${offset}`;
    const r = await db(cfg.table, query);
    if (!r.ok) throw new Error(await r.text());
    let rows = await r.json();
    // Defense in depth: only return rows that match the exact document number
    // or a detail row containing the searched medicine name.
    if (q) {
      rows = rows.filter((row) => cfg.searchFields.some((field) => String(row[field] || "") === q) || itemKeys.includes(row[cfg.key]));
    }
    return { jenis, rows: rows.slice(0, limit).map(cfg.row), has_more: rows.length > limit, next_offset: offset + Math.min(rows.length, limit) };
  }
  if (name === "riwayat.notaDetail") {
    const jenis = String(data.jenis || ""), cfg = RIWAYAT_NOTA_CFG[jenis];
    if (!cfg || !(RIWAYAT_NOTA_ROLE[s.role] || []).includes(jenis)) throw new Error("Akses riwayat nota ini tidak diizinkan.");
    const noDokumen = String(data.no || "").trim().slice(0, 100);
    if (!noDokumen) throw new Error("Nomor nota wajib diisi.");
    const cabang = encodeURIComponent(cabangSesi(s)), no = encodeURIComponent(noDokumen);
    const hr = await db(cfg.table, `?cabang_id=eq.${cabang}&${cfg.key}=eq.${no}&select=${cfg.headerSelect}&limit=1`);
    if (!hr.ok) throw new Error(await hr.text());
    const header = (await hr.json())[0];
    if (!header) throw new Error("Nota tidak ditemukan pada cabang sesi ini.");
    const dr = await db(cfg.detailTable, `?cabang_id=eq.${cabang}&${cfg.key}=eq.${no}&select=${cfg.detailSelect}&order=id.asc`);
    if (!dr.ok) throw new Error(await dr.text());
    return { jenis, label: cfg.label, header: cfg.header(header), items: (await dr.json()).map(cfg.item) };
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
    const sales = await semua("trx_penjualan", `${qsRange(r0, "tanggal")}&cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=no_nota,tanggal,jam,nama_pelanggan,nomor_wa,tipe_customer,petugas_transaksi,shift,subtotal,diskon,harga_akhir,total_hpp&order=timestamp.desc,no_nota`);
    const expenses = await semua("biaya_operasional", `${qsRange(r0, "tanggal")}&cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=id,tanggal,keterangan,nominal,shift,petugas&order=timestamp.desc,id`);
    const returs = await returDalamRentang(cabangSesi(s), r0);
    const omzet = sales.reduce((n, x) => n + Number(x.harga_akhir || 0), 0), hpp = sales.reduce((n, x) => n + Number(x.total_hpp || 0), 0), biaya = expenses.reduce((n, x) => n + Number(x.nominal || 0), 0);
    const shiftOk = (x) => !f.shift || f.shift === "Semua" || x.shift === f.shift;
    const ss = sales.filter(shiftOk);
    const ee = expenses.filter(shiftOk);
    const rr = returs.filter(shiftOk);
    // Omzet & HPP bersih retur (retur dihitung pada tanggal retur).
    const omzet2 = ss.reduce((n, x) => n + Number(x.harga_akhir || 0), 0) - rr.reduce((n, x) => n + x.refund, 0), hpp2 = ss.reduce((n, x) => n + Number(x.total_hpp || 0), 0) - rr.reduce((n, x) => n + x.hpp, 0), biaya2 = ee.reduce((n, x) => n + Number(x.nominal || 0), 0);
    const hppKosong = ss.filter((x) => x.total_hpp === null || x.total_hpp === undefined).length;
    const liveSales = ss.slice(0, 10).map((x) => ({ No_Nota: x.no_nota, Nama_Pelanggan: x.nama_pelanggan, Harga_Akhir: x.harga_akhir, Jam: x.jam, Shift: x.shift }));
    const liveExpense = ee.slice(0, 10).map((x) => ({ Keterangan: x.keterangan, Nominal: x.nominal, Tanggal: x.tanggal }));
    // Detail diambil per rentang tanggal (bukan daftar no_nota) supaya URL tidak
    // kepanjangan, lalu disaring ke nota yang lolos filter shift.
    const idSet = new Set(ss.map((x) => x.no_nota));
    const details = (await semua("trx_penjualan_detail", `${qsRange(r0, "tanggal")}&cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=no_nota,kode_obat,nama_obat,qty,subtotal&order=id`)).filter((x) => idSet.has(x.no_nota));
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
    // Laba bersih di dashboard baru terbuka setelah target omset cabang tercapai
    // (berlaku untuk semua role). Halaman Kelola Target Omset (Owner) tidak terpengaruh.
    // Tren omzet harian 60 hari terakhir (tidak ikut filter rentang/shift) untuk
    // grafik "Omzet harian" 7/30 hari + pembanding periode sebelumnya.
    // Omzet bersih retur (retur dihitung pada tanggal retur), hari kosong = 0.
    const [ty, tm, td] = today().split("-").map(Number);
    const hariKe = (mundur) => new Date(Date.UTC(ty, tm - 1, td - mundur)).toISOString().slice(0, 10);
    const r60 = { from: hariKe(59), to: hariKe(0) };
    const jual60 = await semua("trx_penjualan", `${qsRange(r60, "tanggal")}&cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=tanggal,harga_akhir&order=no_nota`);
    const retur60 = await semua("trx_retur_jual", `${qsRange(r60, "tanggal")}&cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=tanggal,total_refund&order=no_retur`);
    const perHari = {};
    for (let i = 59; i >= 0; i--) perHari[hariKe(i)] = { tanggal: hariKe(i), omzet: 0, nota: 0 };
    jual60.forEach((x) => { const h = perHari[String(x.tanggal)]; if (h) { h.omzet += Number(x.harga_akhir || 0); h.nota++; } });
    retur60.forEach((x) => { const h = perHari[String(x.tanggal)]; if (h) h.omzet -= Number(x.total_refund || 0); });
    const trenHarian = Object.values(perHari);
    // Laba kotor (omzet - HPP) hanya untuk Owner. Role lain tetap menerima
    // payload dashboard, tapi angka labanya tidak pernah dikirim ke browser.
    return { rentang: { label: r0.label }, shift_filter: f.shift || "Semua", tren_harian: trenHarian, kpi: { omzet: omzet2, laba_kotor: s.role === "Owner" ? omzet2 - hpp2 : null, retur_total: rr.reduce((n, x) => n + x.refund, 0), retur_count: rr.length, hpp_kosong: hppKosong, nota: ss.length, rata_nota: ss.length ? omzet2 / ss.length : 0, delta_omzet: null, delta_nota: null, delta_rata: null }, sparkline, ...await stokDashboard(cabangSesi(s)), pj_shift: { role: s.role, petugas: s.nama, shift: shift(), jam: clock(), login_at: s.login_at, di_luar_jam: shift() === "Luar Jam", petugas_jaga: null }, segmen_pelanggan: segmen, live_sales: liveSales, live_expense: liveExpense, shift_chart: shiftChart, top_produk: topProduk, top_pelanggan: topPelanggan, at_risk: [], ai_enabled: false };
  }
  if (name === "laporan.labaRugi") {
    const r0 = rangeOf(data.filter || {});
    const sales = await semua("trx_penjualan", `${qsRange(r0, "tanggal")}&cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=no_nota,tipe_customer,harga_akhir,diskon,total_hpp&order=no_nota`);
    const expenses = await semua("biaya_operasional", `${qsRange(r0, "tanggal")}&cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=keterangan,nominal&order=id`);
    // Retur dihitung pada tanggal retur: mengurangi omzet (refund) dan HPP (barang kembali).
    const returs = await returDalamRentang(cabangSesi(s), r0);
    const retur = returs.reduce((n, x) => n + x.refund, 0);
    const hppRetur = returs.reduce((n, x) => n + x.hpp, 0);
    const omzet = sales.reduce((n, x) => n + Number(x.harga_akhir || 0) + Number(x.diskon || 0), 0);
    const diskon = sales.reduce((n, x) => n + Number(x.diskon || 0), 0);
    const hpp = sales.reduce((n, x) => n + Number(x.total_hpp || 0), 0) - hppRetur;
    const biaya = expenses.reduce((n, x) => n + Number(x.nominal || 0), 0);
    const tipe = {};
    sales.forEach((x) => {
      const k = x.tipe_customer || "Umum";
      tipe[k] ||= { tipe: k, nota: 0, omzet: 0, laba: 0 };
      tipe[k].nota++;
      tipe[k].omzet += Number(x.harga_akhir || 0);
      tipe[k].laba += Number(x.harga_akhir || 0) - Number(x.total_hpp || 0);
    });
    return { rentang: { label: r0.label }, omzet_kotor: omzet, total_diskon: diskon, total_retur: retur, jumlah_retur: returs.length, total_hpp: hpp, laba_kotor: omzet - diskon - retur - hpp, total_biaya: biaya, laba_bersih: omzet - diskon - retur - hpp - biaya, jumlah_nota: sales.length, rata_nota: sales.length ? omzet / sales.length : 0, margin: omzet - diskon - retur ? (omzet - diskon - retur - hpp) / (omzet - diskon - retur) * 100 : 0, per_tipe: Object.values(tipe), rincian_biaya: expenses.map((x) => ({ keterangan: x.keterangan, nominal: x.nominal })) };
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
      const d = await db("trx_penjualan_detail", `?no_nota=eq.${encodeURIComponent(x.no_nota)}&cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=*`);
      const sudah = await sudahDiretur(cabangSesi(s), x.no_nota);
      const items = (await d.json()).map((i) => ({ Kode_Obat: i.kode_obat, Nama_Obat: i.nama_obat, Kode_Batch: i.kode_batch, Qty: i.qty, Harga_Satuan: i.harga_satuan, Sudah_Retur_Qty: sudah.qty[`${i.kode_obat}|${i.kode_batch}`] || 0 }));
      out.push({ ...x, No_Nota: x.no_nota, Tanggal: x.tanggal, Jam: x.jam, Nama_Pelanggan: x.nama_pelanggan, sudah_retur: sudah.refund, items });
    }
    return out;
  }
  if (name === "retur.jualSimpan") {
    const r = await db("rpc/retur_jual_simpan", "", { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify({ p_username: s.username, p_cabang_id: cabangSesi(s), p_no_nota: data.No_Nota_Asal, p_alasan: data.Alasan, p_items: (data.items || []).map((i) => ({ kode_obat: i.Kode_Obat, kode_batch: i.Kode_Batch, qty: i.Qty, kondisi: i.Kondisi || "Baik" })) }) });
    if (!r.ok) throw new Error(await r.text());
    const x = await r.json();
    return Array.isArray(x) ? x[0] : x;
  }
  if (name === "retur.beliList") {
    const r = await db("trx_pembelian", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=no_faktur,no_faktur_supplier,supplier,tanggal_faktur,total_tagihan&order=timestamp.desc&limit=200`);
    if (!r.ok) throw new Error(await r.text());
    const rh = await db("trx_retur_beli", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&status=in.(PENDING_APPROVAL,APPROVED)&select=no_retur,no_faktur_asal&limit=1000`);
    if (!rh.ok) throw new Error(await rh.text());
    const headersRetur = await rh.json();
    const noRetur = headersRetur.map((x) => encodeURIComponent(x.no_retur));
    const rd = noRetur.length ? await db("trx_retur_beli_detail", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&no_retur=in.(${noRetur.join(",")})&select=no_retur,kode_obat,kode_batch,qty&limit=5000`) : null;
    if (rd && !rd.ok) throw new Error(await rd.text());
    const sudahRetur = {};
    for (const x of rd ? await rd.json() : []) {
      const h = headersRetur.find((y) => y.no_retur === x.no_retur);
      if (!h) continue;
      const k = `${h.no_faktur_asal}|${x.kode_obat}|${x.kode_batch}`;
      sudahRetur[k] = (sudahRetur[k] || 0) + Number(x.qty || 0);
    }
    const faktur = [];
    for (const x of await r.json()) {
      const d = await db("trx_pembelian_detail", `?no_faktur=eq.${encodeURIComponent(x.no_faktur)}&cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&select=*`);
      const details = await d.json();
      faktur.push({ No_Faktur: x.no_faktur, No_Faktur_Supplier: x.no_faktur_supplier, Supplier: x.supplier, Tanggal_Faktur: x.tanggal_faktur, Total_Tagihan: x.total_tagihan, sudah_retur: details.reduce((n, i) => n + Number(sudahRetur[`${x.no_faktur}|${i.kode_obat}|${i.kode_batch}`] || 0) * Number(i.harga_netto || 0), 0), items: details.map((i) => ({ Kode_Obat: i.kode_obat, Nama_Obat: i.nama_obat, Kode_Batch: i.kode_batch, Qty: i.qty, Sudah_Retur_Qty: Number(sudahRetur[`${x.no_faktur}|${i.kode_obat}|${i.kode_batch}`] || 0), Harga_Netto: i.harga_netto })) });
    }
    const q = `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}` + (data.status ? `&status=eq.${encodeURIComponent(data.status)}` : "") + "&order=timestamp.desc&limit=200";
    const rr = await db("trx_retur_beli", q);
    return { faktur, retur: rr.ok ? (await rr.json()).map((x) => ({ No_Retur: x.no_retur, No_Faktur: x.no_faktur_asal, Supplier: x.supplier, Tanggal: x.tanggal, Status: x.status, Created_By: x.created_by, Approved_By: x.approved_by, Tanggal_Approval: x.tanggal_approval, Total_Refund: x.total_refund, Alasan: x.alasan })) : [] };
  }
  if (name === "retur.beliSimpan") {
    const r = await db("rpc/retur_beli_simpan", "", { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify({ p_username: s.username, p_cabang_id: cabangSesi(s), p_no_faktur: data.No_Faktur_Asal, p_alasan: data.Alasan, p_items: (data.items || []).map((i) => ({ kode_obat: i.Kode_Obat, kode_batch: i.Kode_Batch, qty: i.Qty, kondisi: i.Kondisi || "Baik" })) }) });
    if (!r.ok) throw new Error(await r.text());
    const x = await r.json();
    return Array.isArray(x) ? x[0] : x;
  }
  if (name === "retur.beliApprove") {
    if (s.role !== "Owner") throw new Error("Hanya Owner yang dapat menyetujui retur beli.");
    if (data.keputusan !== "APPROVE" && data.keputusan !== "SETUJU" && data.keputusan !== "REJECT" && data.keputusan !== "TOLAK") throw new Error("Keputusan approval tidak valid.");
    const r = await db("rpc/retur_beli_approve", "", { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify({ p_username: s.username, p_cabang_id: cabangSesi(s), p_no_retur: data.No_Retur, p_keputusan: data.keputusan === "APPROVE" || data.keputusan === "SETUJU" ? "APPROVE" : "REJECT" }) });
    if (!r.ok) throw new Error(await r.text());
    const x = await r.json();
    return Array.isArray(x) ? x[0] : x;
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
  if (name === "cabang.list") {
    const r = await db("master_cabang", `?select=kode_cabang,nama_cabang&order=kode_cabang.asc&limit=50`);
    if (!r.ok) throw new Error(await r.text());
    return await r.json();
  }
  if (name === "user.simpan") {
    // Owner bisa pilih cabang via form (field Cabang). Untuk role lain, pakai sesi.
    const cabang = s.role === "Owner" && data.Cabang ? String(data.Cabang).trim() : cabangSesi(s);
    const p = { username: String(data.Username || data.username || "").trim(), nama: data.Nama || data.nama, role: data.Role || data.role, aktif: data.Aktif || "YA", cabang_id: cabang };
    if (!p.username || !p.nama || !p.role) throw new Error("Username, nama, dan role wajib diisi.");
    if (!p.cabang_id) throw new Error("Cabang wajib dipilih untuk akun ini.");
    if (data.mode === "edit") {
      const target = await one("app_users", `?username=eq.${encodeURIComponent(p.username)}&select=username,cabang_id`);
      if (!target) throw new Error("User tidak ditemukan.");
      if (String(target.cabang_id || "") !== p.cabang_id) throw new Error("User ini bukan milik cabang yang dipilih.");
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
