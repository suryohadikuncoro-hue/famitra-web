import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_KEY")!;
const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" } });
const db = (table: string, query = "", init: RequestInit = {}) => fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
const one = async (table: string, query: string) => { const r = await db(table, query); const x = await r.json(); return Array.isArray(x) ? x[0] : null; };
const normWA = (v: string) => { let s = String(v || "").replace(/\D/g, ""); if (s.startsWith("0")) s = "62" + s.slice(1); if (!s.startsWith("62") && s) s = "62" + s; return s; };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
async function session(token: string | null) { if (!token) return null; return one("app_sessions", `?token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=*`); }
const cabangSesi = (s: any) => {
  const c = s && s.cabang_id ? String(s.cabang_id).trim() : "";
  if (!c) throw new Error("Sesi ini tidak punya cabang. Hubungi Owner untuk melengkapi data akun.");
  return c;
};
function segment(c: any) { const days = c.tanggal_terakhir_beli ? Math.floor((Date.now() - new Date(String(c.tanggal_terakhir_beli).slice(0,10) + "T00:00:00").getTime()) / 86400000) : null; if (!c.tanggal_terakhir_beli || Number(c.jumlah_transaksi || 0) === 0) return "Baru"; if ((days || 0) > 180) return "Dormant"; if ((days || 0) > 60) return "At-Risk"; if (Number(c.total_belanja || 0) >= 2000000 || Number(c.jumlah_transaksi || 0) >= 8) return "VIP"; return "Active Routine"; }
function allowed(role: string, name: string) { if (name === "dashboardAktif") return role === "Owner" || role === "Apoteker"; const owner = ["rewardList","rewardSave","rewardStatus","redemptionList","campaignList","campaignSave","campaignStatus","couponList","couponSave","report","bundleList","bundleSave","bundleStatus","poinSettingGet","poinSettingSave","poinSimulasi","poinKedaluwarsaRingkasan","poinTukarSimulasi"]; if (owner.includes(name)) return role === "Owner"; return ["Owner","Apoteker","Kasir"].includes(role); }
async function validate(data: any, s: any) {
  const code = String(data.code || "").trim().toUpperCase(); const wa = normWA(data.nomor_wa || "");
  if (!code) throw new Error("Kode kupon wajib diisi."); if (!wa) throw new Error("Pilih pelanggan terlebih dahulu.");
  const c = await one("master_customer", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&nomor_wa=eq.${encodeURIComponent(wa)}&select=*`); if (!c) throw new Error("Pelanggan belum terdaftar.");
  const cp = await one("promo_coupons", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&code=eq.${encodeURIComponent(code)}&is_active=eq.true&select=*,promo_campaigns!inner(name,status,starts_at,ends_at,promo_segment_targets(segment,customer_type))`); if (!cp) throw new Error("Kode kupon tidak ditemukan atau tidak aktif.");
  const now = Date.now(), start = new Date(cp.promo_campaigns.starts_at).getTime(), end = new Date(cp.promo_campaigns.ends_at).getTime(); if (cp.promo_campaigns.status !== "ACTIVE" || now < start || now > end) throw new Error("Kampanye kupon tidak aktif atau sudah berakhir.");
  const seg = segment(c); const targets = cp.promo_campaigns.promo_segment_targets || []; if (!targets.some((t: any) => t.segment === seg && (t.customer_type == null || t.customer_type === data.tipe_customer))) throw new Error("Pelanggan tidak termasuk segmen promo ini.");
  const subtotal = Number(data.subtotal || 0); if (subtotal < Number(cp.min_purchase || 0)) throw new Error(`Minimum belanja kupon adalah Rp${Number(cp.min_purchase || 0).toLocaleString("id-ID")}.`);
  const discount = cp.discount_type === "PERCENT" ? Math.min(subtotal * Number(cp.discount_value || 0) / 100, cp.max_discount == null ? subtotal : Number(cp.max_discount)) : Math.min(Number(cp.discount_value || 0), subtotal);
  const uses = await db("promo_redemptions", `?coupon_id=eq.${cp.id}&customer_id=eq.${c.id}&status=eq.APPLIED&select=id&limit=1000`); const used = uses.ok ? (await uses.json()).length : 0; if (used >= Number(cp.usage_limit_per_customer || 1)) throw new Error("Kupon sudah pernah digunakan oleh pelanggan ini.");
  return { valid: true, code: cp.code, campaign_name: cp.promo_campaigns.name, segment: seg, discount };
}
// Ringkasan promo yang SEDANG AKTIF untuk dashboard (Owner & Apoteker, cabang sesi):
// kampanye kupon (status ACTIVE & dalam periode), bundle (ACTIVE & dalam periode),
// undian (aktif & tanggal hari ini dalam periode) + ringkasan keuangan periode aktif.
async function semuaBaris(table: string, query: string) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await db(table, `${query}&limit=1000&offset=${offset}`);
    if (!r.ok) throw new Error(await r.text());
    const page = await r.json(); rows.push(...page);
    if (page.length < 1000 || rows.length > 100000) return rows;
  }
}
// Promo aktif untuk layar Kasir (Owner/Apoteker/Kasir, cabang sesi):
// bundle aktif + isi & harga per tipe pembeli, kupon yang cocok dengan pelanggan
// (segmen, tipe, sisa kuota per pelanggan), dan undian aktif (min. belanja).
// Hanya untuk SARAN di layar; validasi akhir tetap lewat validate/bundleValidate/checkout.
async function posPromo(branch: string, data: any) {
  const cab = encodeURIComponent(branch), now = new Date().toISOString(), hari = today();
  const [bundles, undian] = await Promise.all([
    semuaBaris("promo_bundles", `?cabang_id=eq.${cab}&status=eq.ACTIVE&starts_at=lte.${encodeURIComponent(now)}&ends_at=gte.${encodeURIComponent(now)}&select=code,name,bundle_price,ends_at,promo_bundle_items(kode_obat,qty)&order=ends_at.asc`),
    semuaBaris("lottery_campaigns", `?kode_cabang=eq.${cab}&aktif=eq.true&periode_mulai=lte.${hari}&periode_selesai=gte.${hari}&select=id,nama,periode_mulai,periode_selesai,min_total_belanja_idr,min_jumlah_transaksi,min_belanja_per_transaksi_idr&order=periode_selesai.asc`)
  ]);
  const kodes = [...new Set(bundles.flatMap((b: any) => (b.promo_bundle_items || []).map((i: any) => String(i.kode_obat))))];
  const barang: Record<string, any> = {};
  for (let i = 0; i < kodes.length; i += 150) {
    const rows = await semuaBaris("master_barang", `?cabang_id=eq.${cab}&kode_obat=in.(${kodes.slice(i, i + 150).map((k) => encodeURIComponent(`"${k}"`)).join(",")})&select=kode_obat,nama_obat,golongan,aktif,harga_jual_umum,harga_khusus,harga_jual_mutasi&order=kode_obat`);
    rows.forEach((r: any) => { barang[r.kode_obat] = r; });
  }
  const paket = bundles.map((b: any) => {
    const items = (b.promo_bundle_items || []).map((i: any) => { const m = barang[i.kode_obat] || {}; return {
      kode: i.kode_obat, qty: Number(i.qty || 1), nama: m.nama_obat || i.kode_obat, sah: m.aktif === "YA" && m.golongan === "Bebas",
      harga: { "Umum": Number(m.harga_jual_umum || 0), "Tenaga Kesehatan": Number(m.harga_khusus || 0), "Apotek Lain": Number(m.harga_jual_mutasi || 0) } }; });
    return { code: b.code, name: b.name, bundle_price: Number(b.bundle_price || 0), ends_at: b.ends_at, items };
  }).filter((b: any) => b.items.length && b.items.every((i: any) => i.sah));
  let kupon: any[] = [], pelanggan: any = null;
  // Kelayakan undian untuk pelanggan yang sedang dilayani. Aturannya SAMA dengan
  // penentuan pemenang (lottery_record_winner) dan daftar peserta
  // (participantData): transaksi di cabang campaign, di dalam periode, nomor WA
  // cocok, harga_akhir >= minimal per transaksi, lalu jumlah dan totalnya
  // dibandingkan dengan minimum campaign. Apotek Lain tidak ikut undian.
  // Hanya untuk ditampilkan; keputusan resmi tetap di server saat mencatat pemenang.
  let undianPelanggan: any[] | null = null;
  const wa = normWA(data?.nomor_wa || "");
  if (wa) {
    const c = await one("master_customer", `?cabang_id=eq.${cab}&nomor_wa=eq.${encodeURIComponent(wa)}&select=*`);
    if (c) {
      const seg = segment(c), tipe = data?.tipe_customer || c.tipe_customer || "Umum";
      pelanggan = { segmen: seg };
      undianPelanggan = [];
      // Tipe pelanggan untuk undian diambil dari DATA MASTER, bukan pilihan
      // dropdown kasir: aturan resmi (participantData / lottery_record_winner)
      // juga membaca master_customer.tipe_customer. Jadi label di kasir tidak
      // bisa bertentangan dengan daftar peserta.
      const tipeUndian = String(c.tipe_customer || "Umum");
      for (const u of undian) {
        let memenuhi = false;
        if (tipeUndian !== "Apotek Lain") {
          const trx = await semuaBaris("trx_penjualan", `?cabang_id=eq.${cab}&nomor_wa=eq.${encodeURIComponent(wa)}&tanggal=gte.${u.periode_mulai}&tanggal=lte.${u.periode_selesai}&select=harga_akhir&order=no_nota.asc`);
          const minPer = Number(u.min_belanja_per_transaksi_idr || 0);
          const minTrx = Math.max(1, Number(u.min_jumlah_transaksi || 1));
          const minTotal = Number(u.min_total_belanja_idr || 0);
          let n = 0, total = 0;
          for (const t of trx) { const a = Number(t.harga_akhir || 0); if (a >= minPer) { n++; total += a; } }
          memenuhi = n >= minTrx && total >= minTotal;
        }
        undianPelanggan.push({ nama: u.nama, selesai: u.periode_selesai, memenuhi });
      }
      const cps = await semuaBaris("promo_coupons", `?cabang_id=eq.${cab}&is_active=eq.true&select=id,code,discount_type,discount_value,max_discount,min_purchase,usage_limit_per_customer,promo_campaigns!inner(name,status,starts_at,ends_at,promo_segment_targets(segment,customer_type))&order=created_at.desc`);
      const t = Date.now();
      const cocok = cps.filter((cp: any) => { const k = cp.promo_campaigns || {};
        return k.status === "ACTIVE" && t >= new Date(k.starts_at).getTime() && t <= new Date(k.ends_at).getTime() &&
          (k.promo_segment_targets || []).some((x: any) => x.segment === seg && (x.customer_type == null || x.customer_type === tipe)); });
      const dipakai: Record<string, number> = {};
      if (cocok.length) {
        const red = await semuaBaris("promo_redemptions", `?customer_id=eq.${c.id}&status=eq.APPLIED&coupon_id=in.(${cocok.map((x: any) => x.id).join(",")})&select=coupon_id&order=id`);
        red.forEach((r: any) => { dipakai[r.coupon_id] = (dipakai[r.coupon_id] || 0) + 1; });
      }
      kupon = cocok.filter((cp: any) => (dipakai[cp.id] || 0) < Number(cp.usage_limit_per_customer || 1)).map((cp: any) => ({
        code: cp.code, name: cp.promo_campaigns.name, discount_type: cp.discount_type, discount_value: Number(cp.discount_value || 0),
        max_discount: cp.max_discount == null ? null : Number(cp.max_discount), min_purchase: Number(cp.min_purchase || 0), ends_at: cp.promo_campaigns.ends_at }));
    }
  }
  return { bundles: paket, kupon, pelanggan,
    // Pelanggan terdaftar: status kelayakan per campaign (memenuhi / belum).
    // Selain itu: daftar campaign tanpa status, memenuhi = null.
    undian: undianPelanggan || undian.map((u: any) => ({ nama: u.nama, selesai: u.periode_selesai, memenuhi: null })) };
}

async function dashboardAktif(branch: string) {
  const cab = encodeURIComponent(branch), now = new Date().toISOString(), hari = today();
  const [kampanye, bundles, undian] = await Promise.all([
    semuaBaris("promo_campaigns", `?cabang_id=eq.${cab}&status=eq.ACTIVE&starts_at=lte.${encodeURIComponent(now)}&ends_at=gte.${encodeURIComponent(now)}&select=id,name,description,starts_at,ends_at,promo_coupons(id,code,discount_type,discount_value,max_discount,min_purchase,usage_limit_total,is_active),promo_segment_targets(segment)&order=ends_at.asc`),
    semuaBaris("promo_bundles", `?cabang_id=eq.${cab}&status=eq.ACTIVE&starts_at=lte.${encodeURIComponent(now)}&ends_at=gte.${encodeURIComponent(now)}&select=id,name,code,bundle_price,starts_at,ends_at,promo_bundle_items(qty)&order=ends_at.asc`),
    semuaBaris("lottery_campaigns", `?kode_cabang=eq.${cab}&aktif=eq.true&periode_mulai=lte.${hari}&periode_selesai=gte.${hari}&select=id,nama,periode_mulai,periode_selesai,min_total_belanja_idr&order=periode_selesai.asc`)
  ]);
  const transaksi: Record<string, any> = {};
  const ambilNota = async (nomor: string[]) => {
    const perlu = [...new Set(nomor)].filter((x) => x && !transaksi[x]);
    for (let i = 0; i < perlu.length; i += 150) {
      const rows = await semuaBaris("trx_penjualan", `?cabang_id=eq.${cab}&no_nota=in.(${perlu.slice(i, i + 150).map((x) => encodeURIComponent(x)).join(",")})&select=no_nota,harga_akhir,total_hpp,nomor_wa,nama_pelanggan&order=no_nota`);
      rows.forEach((t: any) => { transaksi[t.no_nota] = t; });
    }
  };
  // Kupon: pemakaian dalam periode kampanye aktif.
  const kupon = [];
  for (const k of kampanye) {
    const red = await semuaBaris("promo_redemptions", `?cabang_id=eq.${cab}&campaign_id=eq.${k.id}&status=eq.APPLIED&redeemed_at=gte.${encodeURIComponent(k.starts_at)}&select=invoice_no,customer_id,discount_amount&order=redeemed_at`);
    await ambilNota(red.map((x: any) => x.invoice_no));
    kupon.push({ jenis: "kupon", id: k.id, nama: k.name, mulai: k.starts_at, selesai: k.ends_at,
      kode: (k.promo_coupons || []).filter((c: any) => c.is_active).map((c: any) => ({ code: c.code, discount_type: c.discount_type, discount_value: Number(c.discount_value), max_discount: c.max_discount == null ? null : Number(c.max_discount), min_purchase: Number(c.min_purchase || 0) })),
      segmen: (k.promo_segment_targets || []).map((t: any) => t.segment),
      dipakai: red.length, _nota: red.map((x: any) => x.invoice_no), _pelanggan: red.map((x: any) => "c:" + x.customer_id),
      diskon: red.reduce((n: number, x: any) => n + Number(x.discount_amount || 0), 0) });
  }
  // Bundle: transaksi bundle dalam periode aktif.
  const bundle = [];
  for (const b of bundles) {
    const tx = await semuaBaris("trx_penjualan", `?cabang_id=eq.${cab}&bundle_id=eq.${b.id}&timestamp=gte.${encodeURIComponent(b.starts_at)}&select=no_nota,harga_akhir,total_hpp,bundle_discount,nomor_wa,nama_pelanggan&order=no_nota`);
    tx.forEach((t: any) => { transaksi[t.no_nota] = t; });
    bundle.push({ jenis: "bundle", id: b.id, nama: b.name, kode: b.code, harga: Number(b.bundle_price || 0), mulai: b.starts_at, selesai: b.ends_at,
      jumlah_produk: (b.promo_bundle_items || []).length, terjual: tx.length, _nota: tx.map((t: any) => t.no_nota),
      _pelanggan: tx.map((t: any) => "w:" + (t.nomor_wa || t.nama_pelanggan || t.no_nota)),
      diskon: tx.reduce((n: number, t: any) => n + Number(t.bundle_discount || 0), 0) });
  }
  // Undian: hadiah aktif & pemenang tercatat.
  const lot = [];
  for (const u of undian) {
    const [hadiah, menang] = await Promise.all([
      semuaBaris("lottery_prizes", `?campaign_id=eq.${u.id}&retired=eq.false&select=id,nilai_hadiah_idr&order=id`),
      semuaBaris("lottery_winners", `?campaign_id=eq.${u.id}&select=id,pickup_status&order=id`)
    ]);
    lot.push({ jenis: "undian", id: u.id, nama: u.nama, mulai: u.periode_mulai, selesai: u.periode_selesai,
      min_belanja: Number(u.min_total_belanja_idr || 0), hadiah: hadiah.length,
      nilai_hadiah: hadiah.reduce((n: number, h: any) => n + Number(h.nilai_hadiah_idr || 0), 0),
      pemenang: menang.length, diambil: menang.filter((w: any) => w.pickup_status === "sudah_diambil").length });
  }
  // Ringkasan keuangan: nota unik dari kupon & bundle aktif (nota yang memakai keduanya dihitung sekali).
  const semuaNota = new Set<string>(), pelanggan = new Set<string>();
  let omzet = 0, hpp = 0, diskon = 0;
  [...kupon, ...bundle].forEach((x: any) => {
    diskon += x.diskon;
    x._pelanggan.forEach((p: string) => pelanggan.add(p));
    x._nota.forEach((n: string) => { if (semuaNota.has(n) || !transaksi[n]) return; semuaNota.add(n); omzet += Number(transaksi[n].harga_akhir || 0); hpp += Number(transaksi[n].total_hpp || 0); });
    x.omzet = x._nota.reduce((t: number, n: string) => t + Number((transaksi[n] || {}).harga_akhir || 0), 0);
    delete x._nota; delete x._pelanggan;
  });
  const laba = omzet - hpp;
  return { item: [...kupon, ...bundle, ...lot], jumlah_aktif: kupon.length + bundle.length + lot.length,
    ringkasan: { transaksi: semuaNota.size, omzet, diskon, hpp, laba_setelah_promo: laba,
      margin: omzet ? laba / omzet * 100 : null, roas: diskon ? omzet / diskon : null, pelanggan_unik: pelanggan.size } };
}

// ---- Pengaturan perolehan poin (per cabang) ----
const POIN_TIPE = ["Umum", "Tenaga Kesehatan", "Apotek Lain"];
const POIN_MIGRASI = "Migrasi pengaturan poin belum diterapkan di database (supabase/migrations/20260929020000_loyalty_pengaturan_perolehan.sql). Minta pengelola menjalankannya lebih dulu.";
const tglValid = (v: any) => { if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; const d = new Date(v + "T00:00:00Z"); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; };
function angkaPoin(v: any, nama: string, min: number, max: number, bulat = false, desimal2 = false) {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`${nama} harus berupa angka.`);
  if (bulat && !Number.isInteger(n)) throw new Error(`${nama} harus bilangan bulat.`);
  if (desimal2 && Math.round(n * 100) / 100 !== n) throw new Error(`${nama} paling banyak 2 angka di belakang koma.`);
  if (n < min || n > max) throw new Error(`${nama} harus antara ${min} dan ${max}.`);
  return n;
}
function validasiPoinSetting(d: any) {
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("Data pengaturan poin tidak valid.");
  const pilih = (v: any, daftar: string[], nama: string) => { if (!daftar.includes(v)) throw new Error(`${nama} tidak valid.`); return v; };
  const bool = (v: any, nama: string) => { if (typeof v !== "boolean") throw new Error(`${nama} tidak valid.`); return v; };
  const ft = d.faktor_tipe;
  if (!ft || typeof ft !== "object" || Array.isArray(ft)) throw new Error("Faktor tipe pelanggan wajib diisi.");
  const faktor_tipe: any = {};
  for (const t of POIN_TIPE) faktor_tipe[t] = angkaPoin(ft[t], `Faktor ${t}`, 0, 100, false, true);
  const kosong = d.maks_poin_per_transaksi === null || d.maks_poin_per_transaksi === undefined || d.maks_poin_per_transaksi === "";
  if (!Array.isArray(d.pengganda)) throw new Error("Daftar pengganda tidak valid.");
  if (d.pengganda.length > 50) throw new Error("Pengganda maksimal 50 aturan.");
  const pengganda = d.pengganda.map((it: any, i: number) => {
    if (!it || typeof it !== "object") throw new Error(`Pengganda #${i + 1} tidak valid.`);
    const nama = String(it.nama ?? "").trim();
    if (nama.length < 1 || nama.length > 60) throw new Error(`Nama pengganda #${i + 1} wajib diisi (maksimal 60 karakter).`);
    const o: any = { nama, aktif: bool(it.aktif, `Status pengganda “${nama}”`), faktor: angkaPoin(it.faktor, `Faktor pengganda “${nama}”`, 0.01, 100, false, true) };
    if (Array.isArray(it.hari) && it.hari.length) {
      const hs = [...new Set(it.hari.map((h: any) => Number(h)))] as number[];
      if (hs.some((h) => !Number.isInteger(h) || h < 0 || h > 6)) throw new Error(`Hari pengganda “${nama}” tidak valid.`);
      o.hari = hs.sort((a, b) => a - b);
    }
    for (const k of ["mulai", "selesai"]) if (it[k]) { if (!tglValid(it[k])) throw new Error(`Tanggal ${k} pengganda “${nama}” tidak valid.`); o[k] = it[k]; }
    if (o.mulai && o.selesai && o.selesai < o.mulai) throw new Error(`Tanggal selesai pengganda “${nama}” tidak boleh sebelum tanggal mulai.`);
    return o;
  });
  // Masa berlaku poin (PR 2). Bila belum dikirim (undefined, "", atau null),
  // dipakai bawaan 'bulan' 12 - sama dengan perilaku lama, sehingga pemanggil
  // lama tetap bekerja. Kedua kolom diperlakukan sama.
  const kosongMasa = (v: any) => v === undefined || v === "" || v === null;
  const masaMode = kosongMasa(d.masa_berlaku_mode) ? "bulan" : d.masa_berlaku_mode;
  const masaBulan = kosongMasa(d.masa_berlaku_bulan) ? 12 : d.masa_berlaku_bulan;
  // Pengaturan penukaran reward (PR 3). Bila faktor_tipe_tukar belum dikirim,
  // dipakai bawaan yang sama dengan aturan lama: Umum 1x, Tenaga Kesehatan
  // 0,5x, Apotek Lain 0x (tidak boleh menukar).
  const ftTukar = kosongMasa(d.faktor_tipe_tukar) ? { "Umum": 1, "Tenaga Kesehatan": 0.5, "Apotek Lain": 0 } : d.faktor_tipe_tukar;
  if (!ftTukar || typeof ftTukar !== "object" || Array.isArray(ftTukar)) throw new Error("Faktor penukaran per tipe pelanggan wajib diisi.");
  const faktor_tipe_tukar: any = {};
  for (const t of POIN_TIPE) faktor_tipe_tukar[t] = angkaPoin(ftTukar[t], `Faktor penukaran ${t}`, 0, 100, false, true);
  return {
    aktif: bool(d.aktif, "Status program"),
    basis_hitung: pilih(d.basis_hitung, ["harga_akhir", "subtotal"], "Dasar hitung"),
    rupiah_per_kelipatan: angkaPoin(d.rupiah_per_kelipatan, "Belanja per kelipatan", 1, 1000000000, false, true),
    poin_per_kelipatan: angkaPoin(d.poin_per_kelipatan, "Poin per kelipatan", 1, 1000, true),
    pembulatan: pilih(d.pembulatan, ["bawah", "atas", "terdekat"], "Pembulatan"),
    min_belanja: angkaPoin(d.min_belanja, "Minimal belanja", 0, 1000000000, false, true),
    maks_poin_per_transaksi: kosong ? null : angkaPoin(d.maks_poin_per_transaksi, "Batas poin per transaksi", 1, 1000000, true),
    faktor_tipe,
    gabung_pengganda: pilih(d.gabung_pengganda, ["tertinggi", "kali", "jumlah"], "Cara gabung pengganda"),
    pengganda,
    retur_kurangi_poin: bool(d.retur_kurangi_poin, "Pengaturan retur"),
    masa_berlaku_mode: pilih(masaMode, ["bulan", "selamanya", "akhir_tahun"], "Masa berlaku poin"),
    masa_berlaku_bulan: angkaPoin(masaBulan, "Masa berlaku (bulan)", 1, 120, true),
    faktor_tipe_tukar,
    min_poin_tukar: angkaPoin(kosongMasa(d.min_poin_tukar) ? 0 : d.min_poin_tukar, "Minimal poin untuk menukar", 0, 1000000, true),
    maks_persen_tukar: angkaPoin(kosongMasa(d.maks_persen_tukar) ? 100 : d.maks_persen_tukar, "Batas persentase penukaran", 1, 100, false, true),
    maks_tukar_per_hari: angkaPoin(kosongMasa(d.maks_tukar_per_hari) ? 0 : d.maks_tukar_per_hari, "Batas penukaran per hari", 0, 1000, true),
    maks_tukar_per_bulan: angkaPoin(kosongMasa(d.maks_tukar_per_bulan) ? 0 : d.maks_tukar_per_bulan, "Batas penukaran per bulan", 0, 10000, true)
  };
}
async function poinGagal(r: Response): Promise<never> {
  const t = await r.text();
  throw new Error(r.status === 404 || /PGRST20[25]|42P01|42883/.test(t) ? POIN_MIGRASI : t);
}
async function poinCfg(branch: string) {
  const [r, d] = await Promise.all([
    db("loyalty_settings", `?cabang_id=eq.${encodeURIComponent(branch)}&select=*&limit=1`),
    db("rpc/loyalty_cfg_default", "", { method: "POST", body: "{}" })
  ]);
  if (!r.ok) await poinGagal(r);
  if (!d.ok) await poinGagal(d);
  const rows = await r.json(), def = await d.json();
  return { tersimpan: rows.length > 0, cfg: rows[0] || def };
}

async function action(name: string, data: any, s: any) {
  if (!allowed(s.role, name)) throw new Error(`Akses ditolak untuk role ${s.role}.`);
  const branch = cabangSesi(s);
  if (name === "dashboardAktif") return await dashboardAktif(branch);
  if (name === "posPromo") return await posPromo(branch, data);
  if (name === "bundleList") { const r=await db("promo_bundles",`?cabang_id=eq.${encodeURIComponent(branch)}&select=*,promo_bundle_items(qty,kode_obat,master_barang(nama_obat,golongan))&order=created_at.desc&limit=200`);if(!r.ok)throw new Error(await r.text());return await r.json(); }
  if (name === "bundleSave") { const code=String(data.code||"").trim().toUpperCase(), items=Array.isArray(data.items)?data.items:[]; if(!data.name||!code||!data.starts_at||!data.ends_at||!items.length)throw new Error("Nama, kode, periode, dan minimal satu SKU wajib diisi."); const skus=items.map((x:any)=>String(x.kode_obat||"").trim().toUpperCase()); const r0=await db("master_barang",`?cabang_id=eq.${encodeURIComponent(branch)}&kode_obat=in.(${skus.map((x:string)=>encodeURIComponent(x)).join(',')})&select=kode_obat,nama_obat,golongan,aktif`);if(!r0.ok)throw new Error(await r0.text());const products=await r0.json();{ // Pesan spesifik per SKU supaya Owner tahu apa yang harus diperbaiki di Master Barang.
      const masalah:string[]=[]; for(const k of skus){ const pr=products.find((x:any)=>x.kode_obat===k);
        if(!pr) masalah.push(`${k}: tidak ditemukan di Master Barang cabang ${branch}`);
        else if(pr.aktif!=="YA") masalah.push(`${k} (${pr.nama_obat}): produk nonaktif`);
        else if(pr.golongan!=="Bebas") masalah.push(`${k} (${pr.nama_obat}): golongan ${pr.golongan?`"${pr.golongan}"`:"belum diisi"}, harus Bebas`); }
      if(masalah.length) throw new Error("Fixed bundle hanya boleh memakai SKU aktif golongan Bebas. "+masalah.join("; ")+"."); } const p={cabang_id:branch,name:String(data.name).trim(),code,description:data.description||"",bundle_price:Number(data.bundle_price||0),starts_at:data.starts_at,ends_at:data.ends_at,status:data.status||"DRAFT",created_by:s.username,updated_at:new Date().toISOString()};if(p.bundle_price<0)throw new Error("Harga bundle tidak valid.");const r=await db("promo_bundles","",{method:"POST",headers:{...headers,Prefer:"return=representation"},body:JSON.stringify(p)});if(!r.ok)throw new Error(await r.text());const row=(await r.json())[0];const ins=await db("promo_bundle_items","",{method:"POST",headers:{...headers,Prefer:"return=minimal"},body:JSON.stringify(items.map((x:any)=>({bundle_id:row.id,kode_obat:String(x.kode_obat).trim().toUpperCase(),qty:Math.max(1,Number(x.qty||1))})))});if(!ins.ok)throw new Error(await ins.text());return row; }
  if (name === "bundleStatus") { const status=String(data.status||"");if(!["ACTIVE","PAUSED","ARCHIVED"].includes(status))throw new Error("Status bundle tidak valid.");const r=await db("promo_bundles",`?id=eq.${encodeURIComponent(data.id)}&cabang_id=eq.${encodeURIComponent(branch)}`,{method:"PATCH",headers:{...headers,Prefer:"return=minimal"},body:JSON.stringify({status,updated_at:new Date().toISOString()})});if(!r.ok)throw new Error(await r.text());return true; }
  if (name === "bundleValidate") { const code=String(data.code||"").trim().toUpperCase(), items=Array.isArray(data.items)?data.items:[], tipe=data.tipe_customer||"Umum";const b=await one("promo_bundles",`?cabang_id=eq.${encodeURIComponent(branch)}&code=eq.${encodeURIComponent(code)}&status=eq.ACTIVE&select=*,promo_bundle_items(kode_obat,qty,master_barang(nama_obat,golongan,aktif,harga_jual_umum,harga_khusus,harga_jual_mutasi))`);if(!b)throw new Error("Bundle tidak aktif atau tidak ditemukan.");if(Date.now()<new Date(b.starts_at).getTime()||Date.now()>new Date(b.ends_at).getTime())throw new Error("Periode bundle sudah tidak aktif.");let base=0;for(const bi of b.promo_bundle_items||[]){if(bi.master_barang?.aktif!=="YA"||bi.master_barang?.golongan!=="Bebas")throw new Error("Bundle mengandung produk yang bukan golongan Bebas.");const ci=items.find((x:any)=>String(x.kode).toUpperCase()===String(bi.kode_obat).toUpperCase());if(!ci||Number(ci.qty||0)<Number(bi.qty))throw new Error(`Isi keranjang belum memenuhi bundle: ${bi.qty} x ${bi.master_barang?.nama_obat||bi.kode_obat}.`);const price=tipe==="Tenaga Kesehatan"?bi.master_barang.harga_khusus:tipe==="Apotek Lain"?bi.master_barang.harga_jual_mutasi:bi.master_barang.harga_jual_umum;base+=Number(price||0)*Number(bi.qty); }if(Number(b.bundle_price)>=base)throw new Error("Harga bundle harus lebih rendah dari harga normal.");return {valid:true,code:b.code,name:b.name,bundle_price:Number(b.bundle_price),base_price:base,discount:base-Number(b.bundle_price)}; }
  if (name === "bundleCheckout") { const payload={p_username:s.username,p_nomor_wa:data.nomor_wa||"",p_nama_pelanggan:data.nama_pelanggan||"Umum",p_tipe_customer:data.tipe_customer||"Umum",p_items:data.items||[],p_cabang_id:branch,p_diskon:data.diskon||0,p_bayar:data.bayar||0,p_reward_id:data.reward_id||null,p_bundle_code:String(data.bundle_code||"").trim().toUpperCase()};const r=await db("rpc/pos_checkout_bundle","",{method:"POST",headers,body:JSON.stringify(payload)});if(!r.ok)throw new Error(await r.text()||"Checkout bundle gagal.");return await r.json(); }
  if (name === "campaignList") { const r = await db("promo_campaigns", `?cabang_id=eq.${encodeURIComponent(branch)}&select=*,promo_segment_targets(segment,customer_type),promo_coupons(id,code,discount_type,discount_value,max_discount,min_purchase,usage_limit_total,usage_limit_per_customer,is_active)&order=created_at.desc&limit=200`); if (!r.ok) throw new Error(await r.text()); return await r.json(); }
  if (name === "campaignSave") { const p = { cabang_id: branch, name: String(data.name || "").trim(), description: data.description || "", starts_at: data.starts_at, ends_at: data.ends_at, status: data.status || "DRAFT", created_by: s.username, updated_at: new Date().toISOString() }; if (!p.name || !p.starts_at || !p.ends_at) throw new Error("Nama dan periode kampanye wajib diisi."); const r = await db("promo_campaigns", "", { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(p) }); if (!r.ok) throw new Error(await r.text()); const row = (await r.json())[0]; const targets = (data.segments || []).map((x: string) => ({ campaign_id: row.id, segment: x, customer_type: data.customer_type || null })); if (targets.length) { const tr = await db("promo_segment_targets", "", { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(targets) }); if (!tr.ok) throw new Error(await tr.text()); } return row; }
  if (name === "campaignStatus") { const status = String(data.status || ""); if (!["ACTIVE","PAUSED","ARCHIVED"].includes(status)) throw new Error("Status kampanye tidak valid."); const r = await db("promo_campaigns", `?id=eq.${encodeURIComponent(data.id)}&cabang_id=eq.${encodeURIComponent(branch)}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ status, updated_at: new Date().toISOString() }) }); if (!r.ok) throw new Error(await r.text()); return true; }
  if (name === "couponList") { const r = await db("promo_coupons", `?cabang_id=eq.${encodeURIComponent(branch)}&select=*,promo_campaigns(name,status,starts_at,ends_at)&order=created_at.desc&limit=200`); if (!r.ok) throw new Error(await r.text()); return await r.json(); }
  if (name === "couponSave") { const p: any = { campaign_id: data.campaign_id, cabang_id: branch, code: String(data.code || "").trim().toUpperCase(), discount_type: data.discount_type || "FIXED", discount_value: Number(data.discount_value || 0), max_discount: data.max_discount === "" || data.max_discount == null ? null : Number(data.max_discount), min_purchase: Number(data.min_purchase || 0), usage_limit_total: data.usage_limit_total === "" || data.usage_limit_total == null ? null : Number(data.usage_limit_total), usage_limit_per_customer: Math.max(1, Number(data.usage_limit_per_customer || 1)), is_active: data.is_active !== false }; if (!p.campaign_id || !p.code || p.discount_value <= 0) throw new Error("Kampanye, kode, dan nilai promo wajib diisi."); const r = await db("promo_coupons", "", { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(p) }); if (!r.ok) throw new Error(await r.text()); return true; }
  if (name === "validate") return validate(data, s);
  if (name === "report") { const r = await db("promo_redemptions", `?cabang_id=eq.${encodeURIComponent(branch)}&status=eq.APPLIED&select=campaign_id,coupon_id,customer_id,invoice_no,discount_amount,redeemed_at,status,promo_campaigns(name),promo_coupons(code),master_customer(nama,nomor_wa)&order=redeemed_at.desc&limit=5000`); if (!r.ok) throw new Error(await r.text()); const rows = await r.json(); const ids = [...new Set(rows.map((x:any)=>x.invoice_no).filter(Boolean))]; const txRows:any[] = []; for (let i = 0; i < ids.length; i += 200) { const batch = ids.slice(i, i + 200); const tx = await db("trx_penjualan", `?cabang_id=eq.${encodeURIComponent(branch)}&no_nota=in.(${batch.map((x:string)=>encodeURIComponent(x)).join(',')})&select=no_nota,subtotal,harga_akhir,total_hpp,diskon,tanggal&limit=200`); if (!tx.ok) throw new Error(`Gagal memuat transaksi report: ${await tx.text()}`); const batchRows = await tx.json(); if (Array.isArray(batchRows)) txRows.push(...batchRows); } const byInvoice:any = Object.fromEntries(txRows.map((x:any)=>[x.no_nota,x])); const enriched = rows.map((x:any)=>({...x,transaction:byInvoice[x.invoice_no]||null})); const campaigns:any = {}; enriched.forEach((x:any)=>{const key=x.campaign_id||'unknown', t=x.transaction||{}, c=x.promo_campaigns||{}; if(!campaigns[key]) campaigns[key]={campaign_id:key,name:c.name||'Tanpa kampanye',redemptions:0,unique_customers:{},discount_total:0,revenue:0,hpp:0,subtotal:0,profit_after_promo:0}; const z=campaigns[key]; z.redemptions++; z.unique_customers[x.customer_id]=true; z.discount_total+=Number(x.discount_amount||0); z.revenue+=Number(t.harga_akhir||0); z.hpp+=Number(t.total_hpp||0); z.subtotal+=Number(t.subtotal||0); z.profit_after_promo+=Number(t.harga_akhir||0)-Number(t.total_hpp||0); }); const campaignRows=Object.values(campaigns).map((z:any)=>{const cost=z.discount_total,profit=z.profit_after_promo; return {campaign_id:z.campaign_id,name:z.name,redemptions:z.redemptions,unique_customers:Object.keys(z.unique_customers).length,discount_total:cost,revenue:z.revenue,hpp:z.hpp,subtotal:z.subtotal,profit_after_promo:profit,margin_after_promo:z.revenue?profit/z.revenue*100:null,roas:cost?z.revenue/cost:null,roi_direct:cost?profit/cost*100:null,average_order_value:z.redemptions?z.revenue/z.redemptions:0};}).sort((a:any,b:any)=>b.profit_after_promo-a.profit_after_promo); const br=await db("trx_penjualan",`?cabang_id=eq.${encodeURIComponent(branch)}&bundle_id=not.is.null&select=no_nota,tanggal,timestamp,nomor_wa,nama_pelanggan,tipe_customer,bundle_id,bundle_code,bundle_discount,subtotal,harga_akhir,total_hpp&order=timestamp.desc&limit=5000`); if(!br.ok) throw new Error(await br.text()); const bundleTransactions=await br.json(); const bundles:any={}; bundleTransactions.forEach((t:any)=>{const key=t.bundle_id||t.bundle_code||'unknown'; if(!bundles[key]) bundles[key]={bundle_id:key,name:t.bundle_code||'Fixed bundle',redemptions:0,unique_customers:{},discount_total:0,revenue:0,hpp:0,subtotal:0,profit_after_promo:0}; const z=bundles[key], customer=String(t.nomor_wa||t.nama_pelanggan||t.no_nota); z.redemptions++; z.unique_customers[customer]=true; z.discount_total+=Number(t.bundle_discount||0); z.revenue+=Number(t.harga_akhir||0); z.hpp+=Number(t.total_hpp||0); z.subtotal+=Number(t.subtotal||0); z.profit_after_promo+=Number(t.harga_akhir||0)-Number(t.total_hpp||0); }); const bundleRows=Object.values(bundles).map((z:any)=>{const cost=z.discount_total,profit=z.profit_after_promo; return {bundle_id:z.bundle_id,name:z.name,redemptions:z.redemptions,unique_customers:Object.keys(z.unique_customers).length,discount_total:cost,revenue:z.revenue,hpp:z.hpp,subtotal:z.subtotal,profit_after_promo:profit,margin_after_promo:z.revenue?profit/z.revenue*100:null,roas:cost?z.revenue/cost:null,roi_direct:cost?profit/cost*100:null,average_order_value:z.redemptions?z.revenue/z.redemptions:0};}).sort((a:any,b:any)=>b.profit_after_promo-a.profit_after_promo); const all=[...campaignRows,...bundleRows]; const total=all.reduce((a:any,x:any)=>({discount_total:a.discount_total+x.discount_total,revenue:a.revenue+x.revenue,hpp:a.hpp+x.hpp,profit_after_promo:a.profit_after_promo+x.profit_after_promo}),{discount_total:0,revenue:0,hpp:0,profit_after_promo:0}); return {redemptions:rows.length,bundle_transactions:bundleTransactions.length,total_promotions:rows.length+bundleTransactions.length,unique_customers:new Set(rows.map((x:any)=>x.customer_id).concat(bundleTransactions.map((x:any)=>x.nomor_wa||x.nama_pelanggan))).size,discount_total:total.discount_total,revenue:total.revenue,hpp:total.hpp,profit_after_promo:total.profit_after_promo,roas:total.discount_total?total.revenue/total.discount_total:null,roi_direct:total.discount_total?total.profit_after_promo/total.discount_total*100:null,campaigns:campaignRows,bundles:bundleRows,rows:enriched,bundle_rows:bundleTransactions}; }
  if (name === "checkout") { const payload = { p_username: s.username, p_nomor_wa: data.nomor_wa || "", p_nama_pelanggan: data.nama_pelanggan || "Umum", p_tipe_customer: data.tipe_customer || "Umum", p_items: data.items || [], p_cabang_id: branch, p_diskon: data.diskon || 0, p_bayar: data.bayar || 0, p_reward_id: data.reward_id || null, p_coupon_code: String(data.coupon_code || "").trim().toUpperCase() }; const r = await db("rpc/pos_checkout_promo", "", { method: "POST", headers, body: JSON.stringify(payload) }); if (!r.ok) throw new Error(await r.text() || "Checkout promo gagal."); return await r.json(); }
  // --- Poin & Reward (Marketing): kelola reward per cabang + riwayat penukaran ---
  if (name === "rewardList") {
    const r = await db("loyalty_rewards", `?cabang_id=eq.${encodeURIComponent(branch)}&select=id,name,points_required,reward_type,reward_value,min_tier,is_active&order=points_required.asc&limit=200`);
    if (!r.ok) throw new Error(await r.text());
    return await r.json();
  }
  if (name === "rewardSave") {
    const nama = String(data.name || "").trim(), poin = Math.floor(Number(data.points_required)), nilai = Number(data.reward_value), tier = String(data.min_tier || "reguler");
    if (!nama) throw new Error("Nama reward wajib diisi.");
    if (!Number.isFinite(poin) || poin <= 0) throw new Error("Poin yang dibutuhkan harus lebih dari 0.");
    if (!Number.isFinite(nilai) || nilai <= 0) throw new Error("Nilai diskon reward harus lebih dari 0.");
    if (!["reguler", "silver", "gold"].includes(tier)) throw new Error("Tier minimum tidak valid.");
    const p = { name: nama, points_required: poin, reward_type: "discount", reward_value: nilai, min_tier: tier };
    const ret = { ...headers, Prefer: "return=representation" };
    if (data.id) {
      const r = await db("loyalty_rewards", `?id=eq.${encodeURIComponent(data.id)}&cabang_id=eq.${encodeURIComponent(branch)}`, { method: "PATCH", headers: ret, body: JSON.stringify(p) });
      if (!r.ok) throw new Error(await r.text());
      const rows = await r.json(); if (!rows.length) throw new Error("Reward tidak ditemukan di cabang ini.");
      return rows[0];
    }
    const r = await db("loyalty_rewards", "", { method: "POST", headers: ret, body: JSON.stringify({ ...p, cabang_id: branch, is_active: true }) });
    if (!r.ok) throw new Error(await r.text());
    return (await r.json())[0];
  }
  if (name === "rewardStatus") {
    if (typeof data.is_active !== "boolean") throw new Error("Status reward tidak valid.");
    const r = await db("loyalty_rewards", `?id=eq.${encodeURIComponent(data.id)}&cabang_id=eq.${encodeURIComponent(branch)}`, { method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify({ is_active: data.is_active }) });
    if (!r.ok) throw new Error(await r.text());
    if (!(await r.json()).length) throw new Error("Reward tidak ditemukan di cabang ini.");
    return true;
  }
  if (name === "poinSettingGet") {
    const { tersimpan, cfg } = await poinCfg(branch);
    const h = await db("loyalty_settings_riwayat", `?cabang_id=eq.${encodeURIComponent(branch)}&select=disimpan_oleh,disimpan_pada&order=disimpan_pada.desc&limit=20`);
    if (!h.ok) await poinGagal(h);
    return { tersimpan, cfg, riwayat: await h.json() };
  }
  if (name === "poinSettingSave") {
    const p = validasiPoinSetting(data);
    const r = await db("loyalty_settings", "?on_conflict=cabang_id", { method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ ...p, cabang_id: branch, updated_by: s.username || null, updated_at: new Date().toISOString() }) });
    if (!r.ok) await poinGagal(r);
    const saved = (await r.json())[0];
    const h = await db("loyalty_settings_riwayat", "", { method: "POST", body: JSON.stringify({ cabang_id: branch, disimpan_oleh: s.username || null, snapshot: saved }) });
    if (!h.ok) throw new Error("Pengaturan tersimpan, tetapi riwayat perubahan gagal dicatat: " + await h.text());
    return { tersimpan: true, cfg: saved };
  }
  if (name === "poinSimulasi") {
    const tipe = String(data.tipe_customer || "Umum");
    if (!POIN_TIPE.includes(tipe)) throw new Error("Tipe pelanggan tidak valid.");
    const harga = angkaPoin(data.harga_akhir, "Harga akhir", 0, 10000000000);
    const subtotal = data.subtotal === undefined || data.subtotal === "" ? harga : angkaPoin(data.subtotal, "Subtotal", 0, 10000000000);
    const tanggal = data.tanggal ? String(data.tanggal) : today();
    if (!tglValid(tanggal)) throw new Error("Tanggal simulasi tidak valid (format YYYY-MM-DD).");
    const cfg = data.cfg ? validasiPoinSetting(data.cfg) : (await poinCfg(branch)).cfg;
    const r = await db("rpc/loyalty_hitung_poin_detail", "", { method: "POST", body: JSON.stringify({ cfg, p_tipe: tipe, p_subtotal: subtotal, p_harga_akhir: harga, p_tanggal: tanggal, p_retur: data.retur === true }) });
    if (!r.ok) await poinGagal(r);
    return await r.json();
  }
  if (name === "poinKedaluwarsaRingkasan") {
    // Uji kering: melihat siapa dan berapa poin yang AKAN hangus, tanpa
    // mengubah apa pun. Penghangusan sungguhan hanya lewat expire_loyalty_points
    // yang dijalankan otomatis saat CRM dibuka.
    const cfgRingkas = (await poinCfg(branch)).cfg;
    const r = await db("rpc/loyalty_poin_akan_hangus", "", { method: "POST", body: JSON.stringify({ p_cabang_id: branch }) });
    if (!r.ok) await poinGagal(r);
    const rows = await r.json();
    const akan = rows.reduce((n: number, x: any) => n + Number(x.akan_hangus || 0), 0);
    return {
      mode: String(cfgRingkas.masa_berlaku_mode || "bulan"),
      bulan: Number(cfgRingkas.masa_berlaku_bulan || 12),
      total_akan_hangus: akan,
      jumlah_pelanggan: rows.length,
      jumlah_saldo_kurang: rows.filter((x: any) => x.saldo_cukup !== true).length,
      baris: rows.map((x: any) => ({
        nama: x.nama || "Tanpa nama",
        nomor_wa: x.nomor_wa || "",
        saldo: Number(x.total_points || 0),
        akan_hangus: Number(x.akan_hangus || 0),
        perolehan: Number(x.jumlah_perolehan || 0),
        kedaluwarsa_terawal: x.kedaluwarsa_terawal,
        saldo_cukup: x.saldo_cukup === true
      }))
    };
  }
  if (name === "poinTukarSimulasi") {
    // Memakai fungsi yang SAMA dengan kasir (loyalty_tukar_periksa), jadi angka
    // yang dilihat Owner identik dengan yang berlaku saat transaksi.
    const rewardId = String(data.reward_id || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rewardId)) throw new Error("Pilih reward yang mau disimulasikan.");
    const wa = normWA(String(data.nomor_wa || ""));
    if (!wa) throw new Error("Nomor WA pelanggan wajib diisi untuk simulasi penukaran.");
    const subtotalSim = angkaPoin(data.subtotal, "Subtotal transaksi", 0, 10000000000);
    const diskonSim = (data.diskon === undefined || data.diskon === "" || data.diskon === null) ? 0 : angkaPoin(data.diskon, "Diskon transaksi", 0, 10000000000);
    const r = await db("rpc/loyalty_tukar_periksa", "", { method: "POST", body: JSON.stringify({ p_cabang_id: branch, p_reward_id: rewardId, p_nomor_wa: wa, p_subtotal: subtotalSim, p_diskon: diskonSim }) });
    if (!r.ok) await poinGagal(r);
    return await r.json();
  }
  if (name === "redemptionList") {
    const cab = encodeURIComponent(branch);
    const [rw, kp] = await Promise.all([
      db("loyalty_redemptions", `?cabang_id=eq.${cab}&select=no_nota,points_used,reward_value,status,created_at,loyalty_rewards(name),master_customer(nama,nomor_wa)&order=created_at.desc&limit=200`),
      db("promo_redemptions", `?cabang_id=eq.${cab}&status=eq.APPLIED&select=invoice_no,discount_amount,redeemed_at,promo_campaigns(name),promo_coupons(code),master_customer(nama,nomor_wa)&order=redeemed_at.desc&limit=200`)
    ]);
    if (!rw.ok) throw new Error(await rw.text());
    if (!kp.ok) throw new Error(await kp.text());
    const reward = (await rw.json()).map((x: any) => ({ jenis: "reward", waktu: x.created_at, no_nota: x.no_nota, pelanggan: x.master_customer?.nama || "-", nomor_wa: x.master_customer?.nomor_wa || "", nama: x.loyalty_rewards?.name || "-", poin: Number(x.points_used || 0), nilai: Number(x.reward_value || 0), status: x.status }));
    const kupon = (await kp.json()).map((x: any) => ({ jenis: "kupon", waktu: x.redeemed_at, no_nota: x.invoice_no, pelanggan: x.master_customer?.nama || "-", nomor_wa: x.master_customer?.nomor_wa || "", nama: `${x.promo_coupons?.code || "-"} · ${x.promo_campaigns?.name || "-"}`, poin: 0, nilai: Number(x.discount_amount || 0), status: "APPLIED" }));
    return [...reward, ...kupon].sort((a, b) => String(b.waktu).localeCompare(String(a.waktu))).slice(0, 200);
  }
  throw new Error("Aksi promo tidak dikenal.");
}
Deno.serve(async (req: Request) => { if (req.method === "OPTIONS") return json({ ok: true }); try { const body = await req.json(); const [name, data, token] = body.args || []; const s = await session(token); if (!s) return json({ ok: false, error: "Sesi berakhir. Silakan login kembali.", code: "NO_SESSION" }); return json({ ok: true, data: await action(name, data || {}, s) }); } catch (e) { return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500); } });
