// supabase/functions/lottery/index.ts
// Edge Function: Kupon Undian (Marketing)
//
// Akses: Owner + Apoteker (Kasir ditolak)
// Actions:
//   lotteryList                  - daftar campaign
//   lotteryGet                   - detail 1 campaign + hadiah
//   lotterySave                  - buat/update campaign + hadiah
//   lotteryStatus                - aktif/non-aktif campaign
//   lotteryEligibleParticipants  - peserta eligible (filter tipe != 'Apotek Lain', ada nomor_wa, hitung trx di periode/cabang)
//   lotteryWinnerSave            - catat pemenang (offline)
//   lotteryReport                - ROI & ROAS

// @ts-nocheck — Deno runtime, jalankan via `supabase functions deploy`

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
    headers: { "Content-Type": "application/json" },
  });
}

async function rest(
  path: string,
  init: RequestInit & { prefer?: string } = {},
) {
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

// -------------------- session --------------------

async function session(token: string | null) {
  if (!token) return null;
  const rows = await rest(
    `/app_sessions?token=eq.${encodeURIComponent(token)}&select=token,username,nama,role,cabang_id`,
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function allowed(role: string, name: string) {
  // Semua aksi lottery hanya untuk Owner + Apoteker
  const lotteryActions = [
    "lotteryList",
    "lotteryGet",
    "lotterySave",
    "lotteryStatus",
    "lotteryEligibleParticipants",
    "lotteryWinnerSave",
    "lotteryReport",
  ];
  if (lotteryActions.includes(name)) return role === "Owner" || role === "Apoteker";
  return false;
}

// Apoteker terikat ke cabang sesi; Owner boleh lintas cabang (kalau dipilih)
function cabangSesi(s: any, kodeCabang?: string) {
  if (s.role === "Owner") return kodeCabang || null; // null = semua
  return s.cabang_id || null; // Apoteker: WAJIB pakai cabang sesi
}

// -------------------- helpers --------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrThrow(v: any, label: string) {
  if (!v || typeof v !== "string" || !UUID_RE.test(v)) throw new Error(`${label} tidak valid (uuid)`);
  return v;
}

function strOrThrow(v: any, label: string) {
  if (!v || typeof v !== "string") throw new Error(`${label} wajib diisi`);
  return v;
}

function num(v: any, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function randomCouponCode() {
  // LOT-XXXXXX (6 char alnum uppercase, tanpa 0/O/1/I supaya tidak rancu)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `LOT-${s}`;
}

// -------------------- actions --------------------

async function lotteryList(data: any, s: any) {
  const filterCabang = cabangSesi(s, data?.kode_cabang);
  const onlyAktif = data?.only_aktif === true;
  const limit = Math.min(num(data?.limit, 100), 500);

  let path = `/lottery_campaigns?order=periode_mulai.desc&limit=${limit}`;
  if (filterCabang) path += `&kode_cabang=eq.${encodeURIComponent(filterCabang)}`;
  if (onlyAktif) path += `&aktif=eq.true`;
  const rows = await rest(path);

  // attach prize summary (count & total nilai) per campaign
  const ids = (rows || []).map((r: any) => r.id);
  let prizeMap = new Map<string, { count: number; total_nilai: number }>();
  if (ids.length) {
    const inList = `(${ids.join(",")})`;
    const prizes = await rest(`/lottery_prizes?campaign_id=in.${inList}&select=campaign_id,nilai_hadiah_idr`);
    for (const p of prizes || []) {
      const cur = prizeMap.get(p.campaign_id) || { count: 0, total_nilai: 0 };
      cur.count += 1;
      cur.total_nilai += num(p.nilai_hadiah_idr, 0);
      prizeMap.set(p.campaign_id, cur);
    }
  }
  return (rows || []).map((r: any) => ({
    ...r,
    prize_summary: prizeMap.get(r.id) || { count: 0, total_nilai: 0 },
  }));
}

async function lotteryGet(data: any, _s: any) {
  const id = uuidOrThrow(data?.id, "id campaign");
  const [campaign] = await rest(`/lottery_campaigns?id=eq.${id}&limit=1`);
  if (!campaign) throw new Error("Campaign tidak ditemukan");
  const prizes = await rest(`/lottery_prizes?campaign_id=eq.${id}&order=probabilitas_persen.desc`);
  const winners = await rest(
    `/lottery_winners?campaign_id=eq.${id}&order=recorded_at.desc&limit=500`,
  );
  return { campaign, prizes, winners };
}

async function lotterySave(data: any, s: any) {
  const id = data?.id || null;
  const kode_cabang = strOrThrow(data?.kode_cabang, "kode_cabang");

  // Cabang enforcement: Apoteker hanya boleh di cabangnya
  if (s.role === "Apoteker" && s.cabang_id !== kode_cabang) {
    throw new Error("Apoteker hanya boleh membuat campaign di cabang sendiri");
  }

  const payload = {
    kode_cabang,
    nama: strOrThrow(data?.nama, "nama"),
    periode_mulai: strOrThrow(data?.periode_mulai, "periode_mulai"),
    periode_selesai: strOrThrow(data?.periode_selesai, "periode_selesai"),
    aktif: data?.aktif === true,
    catatan: data?.catatan ?? null,
    updated_at: new Date().toISOString(),
  };

  let campaignId = id;
  if (id) {
    await rest(`/lottery_campaigns?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  } else {
    const inserted = await rest(`/lottery_campaigns`, {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify({ ...payload, created_by: s.username || null }),
    });
    campaignId = inserted?.[0]?.id;
  }
  if (!campaignId) throw new Error("Gagal menyimpan campaign");

  // Replace prizes (simple, transactional cukup untuk kasus offline)
  if (Array.isArray(data?.prizes)) {
    await rest(`/lottery_prizes?campaign_id=eq.${campaignId}`, { method: "DELETE" });
    const prizes = data.prizes
      .filter((p: any) => p && (p.nama_hadiah || p.nama_produk))
      .map((p: any) => ({
        campaign_id: campaignId,
        nama_hadiah: strOrThrow(p.nama_hadiah || p.nama_produk, "nama hadiah"),
        nama_produk: p.nama_produk || p.nama_hadiah || null,
        nilai_hadiah_idr: num(p.nilai_hadiah_idr, 0),
        probabilitas_persen: num(p.probabilitas_persen, 0),
        gambar_url: p.gambar_url || null,
      }));
    if (prizes.length) {
      await rest(`/lottery_prizes`, {
        method: "POST",
        body: JSON.stringify(prizes),
      });
    }
  }

  return { id: campaignId };
}

async function lotteryStatus(data: any, s: any) {
  const id = uuidOrThrow(data?.id, "id campaign");
  const aktif = data?.aktif === true;
  // Validasi cabang utk Apoteker
  const [cur] = await rest(`/lottery_campaigns?id=eq.${id}&limit=1&select=id,kode_cabang`);
  if (!cur) throw new Error("Campaign tidak ditemukan");
  if (s.role === "Apoteker" && s.cabang_id !== cur.kode_cabang) {
    throw new Error("Apoteker hanya boleh mengubah status campaign di cabang sendiri");
  }
  await rest(`/lottery_campaigns?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({ aktif, updated_at: new Date().toISOString() }),
  });
  return { id, aktif };
}

async function lotteryEligibleParticipants(data: any, _s: any) {
  const campaignId = uuidOrThrow(data?.campaign_id, "campaign_id");
  const [campaign] = await rest(
    `/lottery_campaigns?id=eq.${campaignId}&limit=1&select=id,kode_cabang,periode_mulai,periode_selesai,nama`,
  );
  if (!campaign) throw new Error("Campaign tidak ditemukan");

  // Ambil customer eligible: tipe != 'Apotek Lain', ada nomor_wa, di cabang campaign
  const customers = await rest(
    `/master_customer?select=id,nomor_wa,nama,tipe_customer,cabang_id,segment_crm&cabang_id=eq.${encodeURIComponent(campaign.kode_cabang)}&tipe_customer=neq.Apotek%20Lain&nomor_wa=not.is.null&order=nama.asc&limit=5000`,
  );

  // Hitung jumlah transaksi & total belanja per customer di periode campaign, hanya yg ada nomor_wa
  const trx = await rest(
    `/trx_penjualan?select=nomor_wa,harga_akhir,tanggal&cabang_id=eq.${encodeURIComponent(campaign.kode_cabang)}&tanggal=gte.${campaign.periode_mulai}&tanggal=lte.${campaign.periode_selesai}&nomor_wa=not.is.null&limit=50000`,
  );

  const stats = new Map<string, { count: number; total: number }>();
  for (const t of trx || []) {
    const wa = String(t.nomor_wa || "").trim();
    if (!wa) continue;
    const cur = stats.get(wa) || { count: 0, total: 0 };
    cur.count += 1;
    cur.total += num(t.harga_akhir, 0);
    stats.set(wa, cur);
  }

  // Filter hanya yg transaksi >=1 di periode tsb
  const participants = (customers || [])
    .map((c: any) => {
      const s = stats.get(String(c.nomor_wa).trim()) || { count: 0, total: 0 };
      return {
        customer_id: c.id,
        nomor_wa: c.nomor_wa,
        nama: c.nama,
        tipe_customer: c.tipe_customer,
        segment_crm: c.segment_crm,
        jumlah_transaksi_periode: s.count,
        total_belanja_periode: s.total,
      };
    })
    .filter((p: any) => p.jumlah_transaksi_periode > 0)
    .sort((a: any, b: any) => b.jumlah_transaksi_periode - a.jumlah_transaksi_periode);

  return {
    campaign,
    total_peserta: participants.length,
    total_transaksi: (trx || []).length,
    participants,
  };
}

async function lotteryWinnerSave(data: any, s: any) {
  const campaign_id = uuidOrThrow(data?.campaign_id, "campaign_id");
  const customer_id = uuidOrThrow(data?.customer_id, "customer_id");
  const prize_id = uuidOrThrow(data?.prize_id, "prize_id");
  const coupon_expired_at = strOrThrow(data?.coupon_expired_at, "coupon_expired_at");
  // pickup_status='sudah_diambil' harus disertai pickup_date
  if (data?.pickup_status === "sudah_diambil" && !data?.pickup_date) {
    throw new Error("Tanggal ambil wajib diisi jika status 'sudah_diambil'");
  }

  // Validasi cabang utk Apoteker
  const [campaign] = await rest(`/lottery_campaigns?id=eq.${campaign_id}&limit=1&select=id,kode_cabang`);
  if (!campaign) throw new Error("Campaign tidak ditemukan");
  if (s.role === "Apoteker" && s.cabang_id !== campaign.kode_cabang) {
    throw new Error("Apoteker hanya boleh mencatat pemenang di cabang sendiri");
  }

  // Validasi customer eligible (exclude Apotek Lain & tanpa nomor_wa)
  const [customer] = await rest(
    `/master_customer?id=eq.${customer_id}&limit=1&select=id,tipe_customer,nomor_wa`,
  );
  if (!customer) throw new Error("Customer tidak ditemukan");
  if (customer.tipe_customer === "Apotek Lain") {
    throw new Error("Customer tipe 'Apotek Lain' tidak eligible");
  }
  if (!customer.nomor_wa) {
    throw new Error("Customer tanpa nomor WhatsApp tidak eligible");
  }

  const [prize] = await rest(`/lottery_prizes?id=eq.${prize_id}&limit=1&select=id,campaign_id`);
  if (!prize) throw new Error("Hadiah tidak ditemukan");
  if (prize.campaign_id !== campaign_id) {
    throw new Error("Hadiah bukan milik campaign ini");
  }

  // Retry insert dengan coupon_code baru jika kena unique violation (race)
  let lastErr: any;
  for (let attempt = 0; attempt < 8; attempt++) {
    const coupon_code = data?.coupon_code || randomCouponCode();
    try {
      const insert = await rest(`/lottery_winners`, {
        method: "POST",
        prefer: "return=representation",
        body: JSON.stringify({
          campaign_id,
          customer_id,
          prize_id,
          coupon_code,
          coupon_expired_at,
          pickup_date: data?.pickup_date || null,
          pickup_status: data?.pickup_status || "belum_diambil",
          recorded_by: s.username || null,
        }),
      });
      return insert?.[0] || { coupon_code };
    } catch (e: any) {
      lastErr = e;
      // 23505 = unique_violation → retry dengan kode baru
      if (String(e?.message || "").includes("23505") || String(e?.message || "").includes("duplicate")) {
        continue;
      }
      throw e;
    }
  }
  throw new Error("Gagal generate kode kupon unik setelah beberapa percobaan: " + (lastErr?.message || ""));
}

async function lotteryReport(data: any, _s: any) {
  const campaignId = uuidOrThrow(data?.campaign_id, "campaign_id");
  const [campaign] = await rest(
    `/lottery_campaigns?id=eq.${campaignId}&limit=1&select=id,kode_cabang,nama,periode_mulai,periode_selesai`,
  );
  if (!campaign) throw new Error("Campaign tidak ditemukan");

  // Winners + prizes (untuk total nilai hadiah yang sudah diberikan)
  const winners = await rest(
    `/lottery_winners?campaign_id=eq.${campaignId}&select=id,prize_id,coupon_code,pickup_status&limit=5000`,
  );
  const prizeIds = (winners || []).map((w: any) => w.prize_id);
  const prizeMap = new Map<string, number>();
  if (prizeIds.length) {
    const prizes = await rest(
      `/lottery_prizes?id=in.(${prizeIds.join(",")})&select=id,nilai_hadiah_idr,nama_hadiah`,
    );
    for (const p of prizes || []) prizeMap.set(p.id, num(p.nilai_hadiah_idr, 0));
  }

  let cost = 0;
  let hadiah_terambil = 0;
  for (const w of winners || []) {
    cost += prizeMap.get(w.prize_id) || 0;
    if (w.pickup_status === "sudah_diambil") hadiah_terambil += 1;
  }

  // Revenue & profit dari trx_penjualan PESERTA ELIGIBLE saja
  // (sesuai rule #9 & #11: hanya customer dgn nomor_wa terdaftar, tipe != 'Apotek Lain')
  const eligible = await rest(
    `/master_customer?select=nomor_wa&cabang_id=eq.${encodeURIComponent(campaign.kode_cabang)}&tipe_customer=neq.Apotek%20Lain&nomor_wa=not.is.null&limit=10000`,
  );
  const eligibleWA = (eligible || [])
    .map((c: any) => String(c.nomor_wa || "").trim())
    .filter((w: string) => w.length > 0);

  let trx: any[] = [];
  if (eligibleWA.length) {
    // filter pakai OR (banyak nomor_wa). PostgREST: nomor_wa=in.(a,b,c) atau or=(...)
    // Pakai 'or' dengan koma-escaped untuk safety
    const orList = eligibleWA
      .map((w: string) => `nomor_wa.eq.${encodeURIComponent(w)}`)
      .join(",");
    trx = await rest(
      `/trx_penjualan?select=nomor_wa,harga_akhir&cabang_id=eq.${encodeURIComponent(campaign.kode_cabang)}&tanggal=gte.${campaign.periode_mulai}&tanggal=lte.${campaign.periode_selesai}&or=(${orList})&limit=100000`,
    );
  }

  let revenue = 0;
  for (const t of trx || []) {
    revenue += num(t.harga_akhir, 0);
  }
  // profit=0 kalau kolom hpp tidak tersedia; query terpisah agar tidak crash jika hpp tidak ada
  let profit = 0;
  try {
    const trxWithHpp = await rest(
      `/trx_penjualan?select=nomor_wa,harga_akhir,hpp&cabang_id=eq.${encodeURIComponent(campaign.kode_cabang)}&tanggal=gte.${campaign.periode_mulai}&tanggal=lte.${campaign.periode_selesai}&or=(${orList})&limit=100000`,
    );
    for (const t of trxWithHpp || []) {
      profit += num(t.harga_akhir, 0) - num(t.hpp, 0);
    }
  } catch (_e) {
    // kolom hpp tidak ada → profit tetap 0
    profit = 0;
  }

  const roas = cost > 0 ? revenue / cost : null;
  const roi_direct = cost > 0 ? (profit / cost) * 100 : null;

  return {
    campaign,
    ringkasan: {
      total_pemenang: (winners || []).length,
      hadiah_terambil,
      total_biaya_hadiah_idr: cost,
      total_peserta_eligible: eligibleWA.length,
      total_transaksi_peserta: (trx || []).length,
      total_revenue_idr: revenue,
      total_profit_idr: profit,
      roas,
      roi_direct_percent: roi_direct,
    },
  };
}

// -------------------- router --------------------

const handlers: Record<string, (data: any, s: any) => Promise<any>> = {
  lotteryList,
  lotteryGet,
  lotterySave,
  lotteryStatus,
  lotteryEligibleParticipants,
  lotteryWinnerSave,
  lotteryReport,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const [name, data, token] = body.args || [];
    const s = await session(token);
    if (!s) return json({ ok: false, error: "Sesi berakhir. Silakan login ulang.", code: "NO_SESSION" }, 401);
    if (!allowed(s.role, name)) {
      return json({ ok: false, error: `Akses ditolak untuk ${s.role} pada aksi ${name}` }, 403);
    }
    const fn = handlers[name];
    if (!fn) return json({ ok: false, error: `Aksi tidak dikenal: ${name}` }, 400);
    const result = await fn(data || {}, s);
    return json({ ok: true, data: result });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
});