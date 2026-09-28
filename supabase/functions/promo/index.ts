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
function allowed(role: string, name: string) { if (name === "dashboardAktif") return role === "Owner" || role === "Apoteker"; const owner = ["campaignList","campaignSave","campaignStatus","couponList","couponSave","report","bundleList","bundleSave","bundleStatus"]; if (owner.includes(name)) return role === "Owner"; return ["Owner","Apoteker","Kasir"].includes(role); }
async function validate(data: any, s: any) {
  const code = String(data.code || "").trim().toUpperCase(); const wa = normWA(data.nomor_wa || "");
  if (!code) throw new Error("Kode kupon wajib diisi."); if (!wa) throw new Error("Pilih pelanggan terlebih dahulu.");
  const c = await one("master_customer", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&nomor_wa=eq.${encodeURIComponent(wa)}&select=*`); if (!c) throw new Error("Pelanggan belum terdaftar.");
  const cp = await one("promo_coupons", `?cabang_id=eq.${encodeURIComponent(cabangSesi(s))}&code=eq.${encodeURIComponent(code)}&is_active=eq.true&select=*,promo_campaigns!inner(name,status,starts_at,ends_at),promo_segment_targets(segment,customer_type)`); if (!cp) throw new Error("Kode kupon tidak ditemukan atau tidak aktif.");
  const now = Date.now(), start = new Date(cp.promo_campaigns.starts_at).getTime(), end = new Date(cp.promo_campaigns.ends_at).getTime(); if (cp.promo_campaigns.status !== "ACTIVE" || now < start || now > end) throw new Error("Kampanye kupon tidak aktif atau sudah berakhir.");
  const seg = segment(c); const targets = cp.promo_segment_targets || []; if (!targets.some((t: any) => t.segment === seg && (t.customer_type == null || t.customer_type === data.tipe_customer))) throw new Error("Pelanggan tidak termasuk segmen promo ini.");
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

async function action(name: string, data: any, s: any) {
  if (!allowed(s.role, name)) throw new Error(`Akses ditolak untuk role ${s.role}.`);
  const branch = cabangSesi(s);
  if (name === "dashboardAktif") return await dashboardAktif(branch);
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
  throw new Error("Aksi promo tidak dikenal.");
}
Deno.serve(async (req: Request) => { if (req.method === "OPTIONS") return json({ ok: true }); try { const body = await req.json(); const [name, data, token] = body.args || []; const s = await session(token); if (!s) return json({ ok: false, error: "Sesi berakhir. Silakan login kembali.", code: "NO_SESSION" }); return json({ ok: true, data: await action(name, data || {}, s) }); } catch (e) { return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500); } });
