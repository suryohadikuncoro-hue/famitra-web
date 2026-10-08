import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_KEY")!;
const HEADERS = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json"
};
const PAYMENT_METHODS = ["Tunai", "Transfer Bank", "QRIS", "E-wallet", "Kartu Debit", "Kartu Kredit", "Cek/Giro", "Lainnya"];
const PAGE_SIZE_MAX = 1000;
const ROW_CAP = 200000;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  }
});

const db = (table: string, query = "", init: RequestInit = {}) => fetch(`${URL}/rest/v1/${table}${query}`, {
  ...init,
  headers: { ...HEADERS, ...((init.headers || {}) as Record<string, string>) }
});
const enc = (value: unknown) => encodeURIComponent(String(value ?? ""));
const cabangSesi = (session: any) => {
  const branch = String(session?.cabang_id || "").trim();
  if (!branch) throw new Error("Sesi ini tidak punya cabang. Hubungi Owner untuk melengkapi data akun.");
  return branch;
};
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
const days = (date: string | null) => date
  ? Math.ceil((new Date(`${date}T00:00:00+07:00`).getTime() - Date.now()) / 86400000)
  : null;

// PostgREST `or=(...)` treats commas as separators; quote and escape search terms.
function polaCari(value: string) {
  const qLike = value.replace(/[\\%_*]/g, "\\$&");
  const quoted = qLike.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const encoded = encodeURIComponent(quoted).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `%22%25${encoded}%25%22`;
}
function daftarIn(values: string[]) {
  return values.map((value) => encodeURIComponent(`"${value.replace(/"/g, '\\"')}"`)).join(",");
}
async function rowsAll(table: string, query: string) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE_MAX) {
    const response = await db(table, `${query}&limit=${PAGE_SIZE_MAX}&offset=${offset}`);
    if (!response.ok) throw new Error(await response.text());
    const page = await response.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE_MAX) return rows;
    if (rows.length >= ROW_CAP) throw new Error("Hasil terlalu besar. Persempit kata pencarian.");
  }
}
async function one(table: string, query: string) {
  const response = await db(table, query);
  if (!response.ok) throw new Error(await response.text());
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] : null;
}
async function auth(token: string) {
  if (!token) return null;
  return one("app_sessions", `?token=eq.${enc(token)}&expires_at=gt.${enc(new Date().toISOString())}&select=username,nama,role,cabang_id`);
}

function parsePage(data: any) {
  const rawLimit = Math.floor(Number(data.limit));
  const rawOffset = Math.floor(Number(data.offset));
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 50;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.min(1000000, rawOffset)) : 0;
  return { limit, offset };
}

async function list(cabang: string, data: any) {
  const { limit, offset } = parsePage(data);
  const q = String(data.q || "").trim().replace(/\s+/g, " ").slice(0, 80);
  const baseFields = "no_faktur,no_faktur_supplier,supplier,kategori,tanggal_faktur,jatuh_tempo,total_item,total_tagihan,timestamp";
  const extendedFields = `${baseFields},status,diedit_at`;
  let page: any[];
  let hasMore: boolean;
  let total: number;

  if (!q) {
    const query = `?cabang_id=eq.${enc(cabang)}&select=${extendedFields}&order=timestamp.desc,no_faktur.desc&limit=${limit + 1}&offset=${offset}`;
    let response = await db("trx_pembelian", query, { headers: { Prefer: "count=exact" } });
    if (!response.ok) {
      response = await db("trx_pembelian", `?cabang_id=eq.${enc(cabang)}&select=${baseFields}&order=timestamp.desc,no_faktur.desc&limit=${limit + 1}&offset=${offset}`, { headers: { Prefer: "count=exact" } });
    }
    if (!response.ok) throw new Error(await response.text());
    const fetched = await response.json();
    hasMore = fetched.length > limit;
    page = fetched.slice(0, limit);
    const count = Number((response.headers.get("content-range") || "").split("/")[1]);
    total = Number.isFinite(count) ? count : offset + page.length + (hasMore ? 1 : 0);
  } else {
    const pattern = polaCari(q);
    const headQuery = `?cabang_id=eq.${enc(cabang)}&or=(no_faktur.ilike.${pattern},no_faktur_supplier.ilike.${pattern},supplier.ilike.${pattern})&select=${extendedFields}&order=timestamp.desc,no_faktur.desc`;
    let headerMatches: any[];
    try {
      headerMatches = await rowsAll("trx_pembelian", headQuery);
    } catch (error) {
      const fallback = `?cabang_id=eq.${enc(cabang)}&or=(no_faktur.ilike.${pattern},no_faktur_supplier.ilike.${pattern},supplier.ilike.${pattern})&select=${baseFields}&order=timestamp.desc,no_faktur.desc`;
      headerMatches = await rowsAll("trx_pembelian", fallback);
    }

    const detailQuery = `?cabang_id=eq.${enc(cabang)}&or=(nama_obat.ilike.${pattern},kode_obat.ilike.${pattern})&select=no_faktur`;
    const detailMatches = await rowsAll("trx_pembelian_detail", detailQuery);
    const invoiceIds = [...new Set(detailMatches.map((row) => String(row.no_faktur || "")).filter(Boolean))];
    const found = new Map<string, any>(headerMatches.map((row) => [row.no_faktur, row]));
    const missingIds = invoiceIds.filter((id) => !found.has(id));
    for (let start = 0; start < missingIds.length; start += 80) {
      const chunk = missingIds.slice(start, start + 80);
      const response = await db("trx_pembelian", `?cabang_id=eq.${enc(cabang)}&no_faktur=in.(${daftarIn(chunk)})&select=${extendedFields}&order=timestamp.desc,no_faktur.desc`);
      let fetched: any[];
      if (!response.ok) {
        const fallback = await db("trx_pembelian", `?cabang_id=eq.${enc(cabang)}&no_faktur=in.(${daftarIn(chunk)})&select=${baseFields}&order=timestamp.desc,no_faktur.desc`);
        if (!fallback.ok) throw new Error(await fallback.text());
        fetched = await fallback.json();
      } else fetched = await response.json();
      for (const row of fetched) found.set(row.no_faktur, row);
    }
    const matches = [...found.values()].sort((a, b) => {
      const time = String(b.timestamp || "").localeCompare(String(a.timestamp || ""));
      return time || String(b.no_faktur).localeCompare(String(a.no_faktur));
    });
    total = matches.length;
    page = matches.slice(offset, offset + limit);
    hasMore = offset + page.length < total;
  }

  const invoiceIds = page.map((row) => String(row.no_faktur));
  const paymentByInvoice = new Map<string, any[]>();
  if (invoiceIds.length) {
    for (let start = 0; start < invoiceIds.length; start += 80) {
      const chunk = invoiceIds.slice(start, start + 80);
      const payments = await rowsAll("trx_pembayaran_hutang", `?cabang_id=eq.${enc(cabang)}&no_faktur=in.(${daftarIn(chunk)})&select=no_faktur,jumlah_bayar,status`);
      for (const payment of payments) {
        const current = paymentByInvoice.get(payment.no_faktur) || [];
        current.push(payment);
        paymentByInvoice.set(payment.no_faktur, current);
      }
    }
  }

  const rows = page.map((invoice) => {
    const payments = paymentByInvoice.get(invoice.no_faktur) || [];
    const paid = payments.filter((payment) => payment.status === "AKTIF")
      .reduce((sum, payment) => sum + Number(payment.jumlah_bayar || 0), 0);
    const canceled = payments.filter((payment) => payment.status === "DIBATALKAN")
      .reduce((sum, payment) => sum + Number(payment.jumlah_bayar || 0), 0);
    const isCanceled = invoice.status === "DIBATALKAN";
    const totalBill = Number(invoice.total_tagihan || 0);
    const remaining = isCanceled ? 0 : Math.max(0, totalBill - paid);
    const due = days(invoice.jatuh_tempo);
    let paymentStatus = "BELUM_DIBAYAR";
    if (isCanceled) paymentStatus = "DIBATALKAN";
    else if (remaining <= 0) paymentStatus = "LUNAS";
    else if (paid > 0) paymentStatus = due !== null && due < 0 ? "DIBAYAR_SEBAGIAN_TERLAMBAT" : "DIBAYAR_SEBAGIAN";
    else if (due !== null && due < 0) paymentStatus = "TERLAMBAT";
    return {
      No_Faktur: invoice.no_faktur,
      No_Faktur_Supplier: invoice.no_faktur_supplier,
      Supplier: invoice.supplier,
      Kategori: invoice.kategori,
      Tanggal_Faktur: invoice.tanggal_faktur,
      Jatuh_Tempo: invoice.jatuh_tempo,
      Total_Item: invoice.total_item,
      Total_Tagihan: totalBill,
      Total_Dibayar: paid,
      Sisa_Hutang: remaining,
      Status_Pembayaran: paymentStatus,
      Status_Faktur: isCanceled ? "DIBATALKAN" : "AKTIF",
      Diedit_At: invoice.diedit_at || null,
      jatuh_tempo_hari: due,
      Total_Dibatalkan: canceled
    };
  });
  return { rows, total, offset, limit, has_more: hasMore };
}

async function act(action: string, data: any, session: any) {
  if (session.role !== "Owner" && session.role !== "Apoteker") {
    throw new Error("Hanya Owner dan Apoteker yang dapat melihat atau mengelola hutang pembelian.");
  }
  const cabang = cabangSesi(session);

  if (action === "list") return await list(cabang, data);

  if (action === "history") {
    const noFaktur = String(data.no_faktur || "").trim();
    if (!noFaktur) throw new Error("Nomor faktur wajib diisi.");
    const invoice = await one("trx_pembelian", `?cabang_id=eq.${enc(cabang)}&no_faktur=eq.${enc(noFaktur)}&select=no_faktur,no_faktur_supplier,supplier,total_tagihan,jatuh_tempo`);
    if (!invoice) throw new Error("Faktur tidak ditemukan.");
    const response = await db("trx_pembayaran_hutang", `?cabang_id=eq.${enc(cabang)}&no_faktur=eq.${enc(noFaktur)}&select=*&order=created_at.desc&limit=200`);
    if (!response.ok) throw new Error(await response.text());
    return { faktur: invoice, pembayaran: await response.json() };
  }

  if (action === "pay") {
    const noFaktur = String(data.no_faktur || "").trim();
    const amount = Number(data.jumlah_bayar);
    const method = String(data.metode_bayar || "");
    const note = String(data.catatan || "").trim();
    if (!noFaktur) throw new Error("Nomor faktur wajib diisi.");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Jumlah pembayaran harus lebih dari Rp0.");
    if (!PAYMENT_METHODS.includes(method)) throw new Error("Metode pembayaran tidak valid.");
    if (method === "Lainnya" && !note) throw new Error("Catatan wajib diisi untuk metode Lainnya.");
    const response = await db("rpc/purchase_payment_save", "", {
      method: "POST",
      body: JSON.stringify({
        p_username: session.username,
        p_no_faktur: noFaktur,
        p_tanggal_bayar: data.tanggal_bayar || today(),
        p_jumlah_bayar: amount,
        p_metode_bayar: method,
        p_referensi: String(data.referensi || ""),
        p_catatan: note,
        p_cabang_id: cabang
      })
    });
    if (!response.ok) throw new Error(await response.text());
    return await response.json();
  }

  if (action === "cancel") {
    const id = String(data.id || "").trim();
    const reason = String(data.alasan_pembatalan || "").trim();
    if (!id || !reason) throw new Error("ID pembayaran dan alasan pembatalan wajib diisi.");
    const response = await db("rpc/purchase_payment_cancel", "", {
      method: "POST",
      body: JSON.stringify({
        p_username: session.username,
        p_id: id,
        p_alasan: reason,
        p_cabang_id: cabang
      })
    });
    if (!response.ok) throw new Error(await response.text());
    return await response.json();
  }

  throw new Error(`Aksi hutang ${action} belum tersedia.`);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return json({ ok: true });
  try {
    const body = await request.json();
    const session = await auth(body.token);
    if (!session) return json({ ok: false, error: "Sesi berakhir.", code: "NO_SESSION" }, 401);
    return json({ ok: true, data: await act(body.action, body.data || {}, session) });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
