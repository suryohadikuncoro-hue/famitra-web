// Offline regression suite untuk kedaluwarsa poin FIFO (migrasi 20261008150000).
// Run: node tests/poin-kedaluwarsa.test.cjs   (butuh Node >= 22.13 untuk membuang tipe TypeScript)
// Tanpa kredensial, package, database, browser, atau jaringan.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '..');
const source = f => fs.readFileSync(path.join(root, f), 'utf8');

const BERKAS_MIGRASI = 'supabase/migrations/20261008150000_loyalty_kedaluwarsa_fifo.sql';
// Tanggal tetap supaya uji tidak bergantung waktu berjalan.
const HARI_INI = '2026-10-08';

// =====================================================================
// Bagian A & B: tiruan rumus SQL di migrasi.
//   perolehan : points_change > 0 dan expired = false, cum_end = jumlah berjalan
//   pakai     : semua points_change < 0 kecuali reason = 'expire'
//   sisa      : greatest(0, cum_end - greatest(terpakai, cum_start))
//   hangus    : jumlah sisa milik perolehan yang tanggal kedaluwarsanya < hari ini
// =====================================================================

// Tiruan make_interval(months => n) pada date Postgres: kelebihan hari
// dibulatkan ke akhir bulan (2026-01-31 + 1 bulan = 2026-02-28).
function tambahBulan(tanggal, n) {
  const [y, m, d] = tanggal.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ty = Math.floor(total / 12), tm = (total % 12) + 1;
  const hariTerakhir = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const td = Math.min(d, hariTerakhir);
  return `${String(ty).padStart(4, '0')}-${String(tm).padStart(2, '0')}-${String(td).padStart(2, '0')}`;
}
const kurangBulan = (tanggal, n) => tambahBulan(tanggal, -n);

// Tiruan loyalty_tanggal_kedaluwarsa(). Catatan: uji ini memakai tanggal tanpa
// jam, jadi konversi ke zona Asia/Jakarta tidak mengubah harinya.
function tanggalKedaluwarsa(diperoleh, mode = 'bulan', bulan = 12) {
  if (!diperoleh) return null;
  const m = mode || 'bulan';
  if (m === 'selamanya') return null;
  const tanggal = String(diperoleh).slice(0, 10);
  if (m === 'akhir_tahun') return `${Number(tanggal.slice(0, 4)) + 1}-12-31`;
  return tambahBulan(tanggal, Math.max(1, bulan == null ? 12 : bulan));
}

// Tiruan CTE perolehan/pakai/sisa di loyalty_poin_akan_hangus().
function hangusFifo(baris, opsi = {}) {
  const hariIni = opsi.hariIni || HARI_INI;
  const mode = opsi.mode || 'bulan';
  const bulan = opsi.bulan == null ? 12 : opsi.bulan;

  const perolehan = baris
    .filter(r => r.points_change > 0 && !r.expired)
    .slice()
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || b.points_change - a.points_change);

  const terpakai = baris
    .filter(r => r.points_change < 0 && (r.reason || '') !== 'expire')
    .reduce((n, r) => n - r.points_change, 0);

  let cumEnd = 0;
  const rincian = perolehan.map(r => {
    const earned = r.points_change;
    cumEnd += earned;
    const cumStart = cumEnd - earned;
    return {
      earned,
      kedaluwarsa: tanggalKedaluwarsa(r.created_at, mode, bulan),
      sisa: Math.max(0, cumEnd - Math.max(terpakai, cumStart))
    };
  });

  const hangus = rincian
    .filter(x => x.kedaluwarsa !== null && x.kedaluwarsa < hariIni)
    .reduce((n, x) => n + x.sisa, 0);

  return { hangus, saldo: perolehan.reduce((n, r) => n + r.points_change, 0) - terpakai, rincian };
}

// =====================================================================
// Bagian A: rumus FIFO
// =====================================================================

test('FIFO: pemakaian menghabiskan perolehan tertua sehingga tidak ada yang hangus (kasus di rencana migrasi)', () => {
  const h = hangusFifo([
    { created_at: kurangBulan(HARI_INI, 13), points_change: 100 },
    { created_at: kurangBulan(HARI_INI, 1), points_change: 100 },
    { created_at: kurangBulan(HARI_INI, 1), points_change: -100, reason: 'redeem' }
  ]);
  assert.equal(h.hangus, 0, 'penukaran memakai poin terlama, jadi tidak ada sisa poin lama yang perlu hangus');
  assert.equal(h.saldo, 100, 'saldo yang benar adalah 100, bukan 0 seperti versi lama');
  assert.deepEqual(h.rincian.map(x => x.sisa), [0, 100], 'sisa hanya tertinggal di perolehan yang masih berlaku');
});

test('FIFO: tanpa pemakaian, perolehan yang sudah lewat masa berlaku hangus seluruhnya', () => {
  const h = hangusFifo([{ created_at: kurangBulan(HARI_INI, 13), points_change: 100 }]);
  assert.equal(h.hangus, 100);
  assert.equal(h.saldo, 100);
  const belumLewat = hangusFifo([{ created_at: kurangBulan(HARI_INI, 11), points_change: 100 }]);
  assert.equal(belumLewat.hangus, 0, '11 bulan belum melewati 12 bulan');
  assert.equal(
    hangusFifo([{ created_at: kurangBulan(HARI_INI, 12), points_change: 100 }]).hangus, 0,
    'kedaluwarsa tepat hari ini belum hangus, karena perbandingannya kedaluwarsa < hari ini'
  );
});

test('FIFO: pemakaian sebagian hanya menyisakan sisa yang belum terpakai', () => {
  const h = hangusFifo([
    { created_at: kurangBulan(HARI_INI, 13), points_change: 100 },
    { created_at: kurangBulan(HARI_INI, 1), points_change: -40, reason: 'redeem' }
  ]);
  assert.equal(h.hangus, 60, '100 perolehan lama dikurangi 40 yang terpakai');
  assert.equal(h.saldo, 60);
  assert.deepEqual(h.rincian.map(x => x.sisa), [60]);
});

test('FIFO: beberapa perolehan beda umur, hanya sisa perolehan lama yang hangus', () => {
  const h = hangusFifo([
    { created_at: kurangBulan(HARI_INI, 14), points_change: 50 },
    { created_at: kurangBulan(HARI_INI, 13), points_change: 70 },
    { created_at: kurangBulan(HARI_INI, 2), points_change: 90 },
    { created_at: kurangBulan(HARI_INI, 1), points_change: -100, reason: 'redeem' }
  ]);
  assert.equal(h.hangus, 20, '50 + 70 = 120, terpakai 100, sisa 20 di dua perolehan lama');
  assert.equal(h.saldo, 110);
  assert.deepEqual(h.rincian.map(x => x.sisa), [0, 20, 90]);
});

test('FIFO: pemakaian lebih besar dari perolehan lama tidak menyisakan yang hangus', () => {
  const h = hangusFifo([
    { created_at: kurangBulan(HARI_INI, 14), points_change: 50 },
    { created_at: kurangBulan(HARI_INI, 2), points_change: 70 },
    { created_at: kurangBulan(HARI_INI, 1), points_change: -80, reason: 'redeem' }
  ]);
  assert.equal(h.hangus, 0, '50 lama habis terpakai, sisanya 30 diambil dari perolehan baru');
  assert.equal(h.saldo, 40);
  assert.deepEqual(h.rincian.map(x => x.sisa), [0, 40]);
});

test('FIFO: urutan pencatatan pemakaian tidak mengubah total yang hangus', () => {
  const dasar = [
    { created_at: kurangBulan(HARI_INI, 14), points_change: 100 },
    { created_at: kurangBulan(HARI_INI, 2), points_change: 50 }
  ];
  const urutanA = [
    ...dasar,
    { created_at: kurangBulan(HARI_INI, 1), points_change: -25, reason: 'redeem' },
    { created_at: kurangBulan(HARI_INI, 1), points_change: -15, reason: 'return_adjustment' }
  ];
  const urutanB = [
    { created_at: kurangBulan(HARI_INI, 1), points_change: -15, reason: 'return_adjustment' },
    ...dasar.slice().reverse(),
    { created_at: kurangBulan(HARI_INI, 1), points_change: -25, reason: 'redeem' }
  ];
  const a = hangusFifo(urutanA), b = hangusFifo(urutanB);
  assert.equal(a.hangus, b.hangus, 'total hangus harus sama untuk urutan pencatatan apa pun');
  assert.equal(a.hangus, 60, 'terpakai 40, sisa 60 dari perolehan lama');
  assert.equal(a.saldo, b.saldo);
  assert.equal(a.saldo, 110);
});

test("FIFO: baris reason 'expire' bukan pemakaian dan perolehan yang sudah ditandai expired tidak dihitung lagi", () => {
  const jejakHangus = hangusFifo([
    { created_at: kurangBulan(HARI_INI, 13), points_change: 100 },
    { created_at: kurangBulan(HARI_INI, 13), points_change: -100, reason: 'expire' }
  ]);
  assert.equal(jejakHangus.hangus, 100, "baris 'expire' adalah catatan penghangusan, bukan pemakaian pelanggan");

  const sudahDitandai = hangusFifo([
    { created_at: kurangBulan(HARI_INI, 13), points_change: 100, expired: true },
    { created_at: kurangBulan(HARI_INI, 13), points_change: -100, reason: 'expire' }
  ]);
  assert.equal(sudahDitandai.hangus, 0, 'perolehan yang sudah ditandai expired tidak dihitung dua kali');

  const pemakaianBiasa = hangusFifo([
    { created_at: kurangBulan(HARI_INI, 13), points_change: 100 },
    { created_at: kurangBulan(HARI_INI, 13), points_change: -100, reason: 'return_adjustment' }
  ]);
  assert.equal(pemakaianBiasa.hangus, 0, 'alasan selain expire tetap dihitung sebagai pemakaian');
});

test('FIFO: sisa tidak pernah negatif walau pemakaian melebihi perolehan', () => {
  const h = hangusFifo([
    { created_at: kurangBulan(HARI_INI, 14), points_change: 50 },
    { created_at: kurangBulan(HARI_INI, 13), points_change: -80, reason: 'redeem' }
  ]);
  assert.equal(h.hangus, 0);
  assert.ok(h.rincian.every(x => x.sisa >= 0), 'greatest(0, ...) menjaga sisa tetap >= 0');
  assert.equal(h.saldo, -30, 'saldo buku mutasi bisa tidak sinkron, tetapi yang hangus tetap 0');
  const kosong = hangusFifo([]);
  assert.deepEqual([kosong.hangus, kosong.saldo, kosong.rincian.length], [0, 0, 0], 'tanpa perolehan tidak ada yang hangus');
});

// =====================================================================
// Bagian B: tanggal kedaluwarsa
// =====================================================================

test('tanggal kedaluwarsa: mode bulan menambah bulan sejak perolehan', () => {
  assert.equal(tanggalKedaluwarsa('2026-03-15', 'bulan', 12), '2027-03-15');
  assert.equal(tanggalKedaluwarsa('2026-03-15', 'bulan', 1), '2026-04-15');
  assert.equal(tanggalKedaluwarsa('2026-01-31', 'bulan', 1), '2026-02-28', 'kelebihan hari dibulatkan ke akhir bulan, seperti make_interval');
  assert.equal(tanggalKedaluwarsa('2026-03-15', 'bulan', 0), '2026-04-15', 'greatest(1, bulan) mencegah tanggal kedaluwarsa di masa lalu');
  assert.equal(tanggalKedaluwarsa('2026-03-15', null, null), '2027-03-15', 'mode/bulan kosong memakai bawaan bulan 12');
});

test('tanggal kedaluwarsa: mode selamanya tidak pernah hangus', () => {
  assert.equal(tanggalKedaluwarsa('2020-01-01', 'selamanya', 12), null);
  const h = hangusFifo([{ created_at: '2020-01-01', points_change: 500 }], { mode: 'selamanya' });
  assert.equal(h.hangus, 0);
  assert.equal(h.saldo, 500);
});

test('tanggal kedaluwarsa: mode akhir_tahun selalu 31 Desember tahun berikutnya', () => {
  assert.equal(tanggalKedaluwarsa('2026-03-15', 'akhir_tahun', 12), '2027-12-31');
  assert.equal(tanggalKedaluwarsa('2026-12-30', 'akhir_tahun', 12), '2027-12-31', 'perolehan akhir tahun tidak langsung hangus beberapa hari kemudian');
  assert.equal(tanggalKedaluwarsa('2026-12-31', 'akhir_tahun', 120), '2027-12-31', 'masa_berlaku_bulan diabaikan pada mode ini');
  assert.equal(hangusFifo([{ created_at: '2026-01-05', points_change: 30 }], { mode: 'akhir_tahun' }).hangus, 0, 'belum sampai 31 Desember tahun berikutnya');
  assert.equal(hangusFifo([{ created_at: '2024-01-05', points_change: 30 }], { mode: 'akhir_tahun' }).hangus, 30, 'sudah lewat 31 Desember 2025');
});

// =====================================================================
// Bagian C: pemeriksaan berkas migrasi
// =====================================================================
const SQL = source(BERKAS_MIGRASI);
// Komentar baris dibuang dulu supaya perapatan spasi tidak menelan kode.
const RAPAT = SQL.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ');
// "Hari ini" di SQL boleh current_date atau tanggal Jakarta; keduanya harus
// konsisten antara uji kering dan penghangusan.
const HARI_INI_SQL = /(current_date|\(now\(\) at time zone 'Asia\/Jakarta'\)::date)/;

// Setiap pernyataan delete/update wajib punya WHERE (aturan AGENTS.md).
function pernyataanTanpaWhere(teks, kata) {
  const hasil = [];
  for (const m of teks.matchAll(new RegExp(`${kata}\\s+(?:public\\.)?[\\w.]+`, 'gi'))) {
    const sisa = teks.slice(m.index);
    const akhir = sisa.indexOf(';');
    const pernyataan = akhir === -1 ? sisa : sisa.slice(0, akhir);
    if (!/\bwhere\b/i.test(pernyataan)) hasil.push(pernyataan.trim().slice(0, 90));
  }
  return hasil;
}

test('migrasi: tidak destruktif (tanpa drop table/truncate, dan setiap delete/update punya where)', () => {
  assert.doesNotMatch(RAPAT, /drop\s+table|truncate/i);
  assert.doesNotMatch(RAPAT, /delete\s+from/i, 'migrasi ini tidak perlu menghapus baris');
  assert.deepEqual(pernyataanTanpaWhere(RAPAT, 'delete\\s+from'), []);
  const update = pernyataanTanpaWhere(RAPAT, 'update');
  assert.deepEqual(update, [], 'semua update wajib punya where: ' + update.join(' | '));
  assert.equal(pernyataanTanpaWhere('delete from public.x;', 'delete\\s+from').length, 1, 'pengaman benar-benar mendeteksi delete tanpa where');
  assert.equal(pernyataanTanpaWhere('update public.x set a = 1 where id = 2;', 'update').length, 0);
});

test('migrasi: menambah kolom masa berlaku dan menolak diri bila prasyarat belum ada', () => {
  const blok = RAPAT.match(/alter table public\.loyalty_settings add column if not exists masa_berlaku_mode[\s\S]*?;/i);
  assert.ok(blok, 'harus ada alter table ... add column if not exists masa_berlaku_mode');
  assert.match(blok[0], /add column if not exists masa_berlaku_mode text not null default 'bulan'/i);
  assert.match(blok[0], /add column if not exists masa_berlaku_bulan integer not null default 12/i);
  assert.match(RAPAT, /masa_berlaku_mode in \('bulan','selamanya','akhir_tahun'\)/i, 'mode dibatasi constraint');
  assert.match(RAPAT, /masa_berlaku_bulan between 1 and 120/i, 'jumlah bulan dibatasi constraint');
  assert.match(RAPAT, /raise exception 'Prasyarat belum ada: terapkan dulu migrasi 20260929020000/i);
  assert.match(RAPAT, /raise exception 'Prasyarat belum ada: kolom loyalty_transactions\.expired belum ada/i);
  assert.ok(
    RAPAT.search(/raise exception 'Prasyarat belum ada/i) < RAPAT.search(/alter table public\.loyalty_settings add column/i),
    'pengaman prasyarat dijalankan sebelum mengubah apa pun'
  );
});

test('migrasi: hanya perolehan yang ditandai hangus dan pemakaian mengecualikan reason expire', () => {
  const tanda = RAPAT.match(/update public\.loyalty_transactions t set expired = true[\s\S]*?;/i);
  assert.ok(tanda, 'harus ada update yang menandai perolehan sebagai expired');
  assert.equal(RAPAT.match(/set expired = true/gi).length, 1, 'hanya satu tempat yang menandai hangus');
  assert.match(tanda[0], /points_change > 0/, 'yang ditandai hanya baris perolehan, bukan pemakaian');
  assert.match(tanda[0], /loyalty_tanggal_kedaluwarsa\(t\.created_at, v_mode, v_bulan\) < /);
  const hariTanda = tanda[0].match(HARI_INI_SQL);
  assert.ok(hariTanda, 'penandaan hangus membandingkan tanggal kedaluwarsa dengan hari ini');

  const pakai = RAPAT.match(/pakai as \(([\s\S]*?)\)\s*,\s*sisa as/i);
  assert.ok(pakai, 'harus ada CTE pakai');
  assert.match(pakai[1], /t\.points_change < 0/);
  assert.match(pakai[1], /coalesce\(t\.reason, ''\) <> 'expire'/, "baris 'expire' tidak dihitung sebagai pemakaian");

  assert.match(RAPAT, /perolehan as \(([\s\S]*?)\)\s*,\s*pakai as/i);
  const perolehan = RAPAT.match(/perolehan as \(([\s\S]*?)\)\s*,\s*pakai as/i)[1];
  assert.match(perolehan, /t\.points_change > 0/);
  assert.match(perolehan, /coalesce\(t\.expired, false\) = false/, 'perolehan yang sudah hangus tidak dihitung lagi');
  assert.match(perolehan, /order by t\.created_at, t\.points_change desc/, 'urutan FIFO berdasarkan created_at');

  const sisa = RAPAT.match(/sisa as \(([\s\S]*?)\)\s*select c\.id/i);
  assert.ok(sisa, 'harus ada CTE sisa');
  assert.match(sisa[1], /greatest\(0, p\.cum_end - greatest\(coalesce\(k\.terpakai, 0\), p\.cum_end - p\.earned\)\)/, 'rumus sisa FIFO');
  const hariKering = RAPAT.match(/s\.kedaluwarsa < (current_date|\(now\(\) at time zone 'Asia\/Jakarta'\)::date)/);
  assert.ok(hariKering, 'uji kering membandingkan tanggal kedaluwarsa dengan hari ini');
  assert.equal(hariKering[1], hariTanda[1], 'uji kering dan penghangusan memakai definisi hari ini yang sama');

  assert.match(RAPAT, /create or replace function public\.expire_loyalty_points\(\) returns integer/i);
  assert.match(RAPAT, /if not r\.saldo_cukup then/, 'saldo tidak sinkron dilewati, bukan diubah');
  assert.match(RAPAT, /v_total := v_total \+ r\.akan_hangus::integer/, 'nilai kembalian = total poin yang dihanguskan');
  assert.match(
    RAPAT,
    /insert into public\.loyalty_transactions\(cabang_id, customer_id, no_nota, points_change, reason, expired\) select v_cab, c\.id, [\s\S]*?-r\.akan_hangus::integer, 'expire', false from public\.master_customer c/,
    "buku mutasi mencatat penghangusan sebagai baris negatif dengan reason 'expire'"
  );
});

test('migrasi: fungsi baru hanya boleh dipanggil service_role', () => {
  for (const f of [
    'public.loyalty_tanggal_kedaluwarsa(timestamptz, text, integer)',
    'public.loyalty_poin_akan_hangus(text)',
    'public.expire_loyalty_points()',
    'public.loyalty_cfg_default()'
  ]) {
    assert.ok(RAPAT.includes(`revoke all on function ${f} from public, anon, authenticated`), 'revoke ' + f);
    assert.ok(RAPAT.includes(`grant execute on function ${f} to service_role`), 'grant ' + f);
  }
  assert.doesNotMatch(RAPAT, /grant[^;]*\bto\s+(anon|authenticated|public)\b/i, 'tidak ada grant ke anon/authenticated/public');
  assert.match(RAPAT, /create index if not exists idx_loyalty_transactions_cabang_customer_created/i);
});

// =====================================================================
// Bagian D: Edge Function promo
// =====================================================================
const DEFAULT_CFG = { aktif: true, basis_hitung: 'harga_akhir', rupiah_per_kelipatan: 1000, poin_per_kelipatan: 1, pembulatan: 'bawah', min_belanja: 0, maks_poin_per_transaksi: null, faktor_tipe: { 'Umum': 1, 'Tenaga Kesehatan': 0, 'Apotek Lain': 0 }, gabung_pengganda: 'tertinggi', pengganda: [], retur_kurangi_poin: true, masa_berlaku_mode: 'bulan', masa_berlaku_bulan: 12 };
const valid = (over = {}) => ({ ...JSON.parse(JSON.stringify(DEFAULT_CFG)), ...over });

function backendPromo(opts = {}) {
  const calls = [];
  const tersimpan = [];
  const riwayat = [];
  const akanHangus = opts.akanHangus === undefined ? [
    { nama: 'Budi', nomor_wa: '62811', total_points: 120, akan_hangus: 20, jumlah_perolehan: 2, kedaluwarsa_terawal: '2026-09-08', saldo_cukup: true },
    { nama: null, nomor_wa: null, total_points: 5, akan_hangus: 30, jumlah_perolehan: 1, kedaluwarsa_terawal: '2026-08-08', saldo_cukup: false }
  ] : opts.akanHangus;
  const tables = {
    app_sessions: [
      { token: 'owner', username: 'suryo', role: 'Owner', cabang_id: 'KARLA' },
      { token: 'apoteker', username: 'apt', role: 'Apoteker', cabang_id: 'KARLA' },
      { token: 'kasir', username: 'ksr', role: 'Kasir', cabang_id: 'KARLA' }
    ],
    loyalty_settings: opts.settings || [],
    loyalty_settings_riwayat: []
  };
  let handler;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const ctx = vm.createContext({ Response, Request, Date, Intl, console, URL, Promise, Math, Number, String, Array, Set, Object, JSON, Error,
    Deno: { env: { get: k => (k === 'SUPABASE_URL' ? 'https://offline.invalid' : 'fake-test-key') }, serve: fn => { handler = fn; } },
    fetch: async (url, init = {}) => {
      const u = new URL(url), q = u.searchParams, rest = u.pathname.replace('/rest/v1/', '');
      const call = { table: rest, q, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, headers: init.headers || {} };
      calls.push(call);
      if (rest === 'rpc/loyalty_cfg_default') return json(DEFAULT_CFG);
      if (rest === 'rpc/loyalty_poin_akan_hangus') return json(akanHangus);
      if (rest === 'loyalty_settings' && call.method === 'POST') { tersimpan.push(call.body); return json([call.body]); }
      if (rest === 'loyalty_settings_riwayat' && call.method === 'POST') { riwayat.push(call.body); return json([call.body]); }
      const rows = (tables[rest] || []).filter(r => {
        for (const [k, c] of q.entries()) if (c.startsWith('eq.') && String(r[k]) !== c.slice(3)) return false;
        return true;
      });
      return json(rows);
    }
  });
  vm.runInContext(stripTypeScriptTypes(source('supabase/functions/promo/index.ts').replace(/^import "jsr:[^\n]*\n/, '')), ctx);
  return { calls, tersimpan, riwayat, req: async (name, data = {}, token = 'owner') => {
    const r = await handler(new Request('https://offline.invalid', { method: 'POST', body: JSON.stringify({ args: [name, data, token] }) }));
    return { status: r.status, body: await r.json() };
  } };
}
const ditolak = r => r.body.ok === false && /Akses ditolak/.test(r.body.error);

test('promo: masa_berlaku_mode hanya menerima bulan, selamanya, atau akhir_tahun', async () => {
  const b = backendPromo();
  for (const mode of ['bulan', 'selamanya', 'akhir_tahun']) {
    const r = await b.req('poinSettingSave', valid({ masa_berlaku_mode: mode }));
    assert.equal(r.body.ok, true, mode + ': ' + JSON.stringify(r.body));
  }
  assert.deepEqual(b.tersimpan.map(x => x.masa_berlaku_mode), ['bulan', 'selamanya', 'akhir_tahun']);
  for (const mode of ['mingguan', 'BULAN', 'tahun', 12, true]) {
    const r = await b.req('poinSettingSave', valid({ masa_berlaku_mode: mode }));
    assert.equal(r.body.ok, false, 'harus ditolak: ' + JSON.stringify(mode));
    assert.match(r.body.error, /Masa berlaku poin tidak valid/, JSON.stringify(mode));
  }
  assert.equal(b.tersimpan.length, 3, 'input tidak valid ditolak sebelum menyentuh database');
  // Kosong (undefined, '', null) diperlakukan sama seperti kolom tidak dikirim,
  // yaitu memakai bawaan 'bulan' - sejajar dengan perlakuan masa_berlaku_bulan.
  for (const mode of [undefined, '', null]) {
    const r = await b.req('poinSettingSave', valid({ masa_berlaku_mode: mode }));
    assert.equal(r.body.ok, true, 'kosong memakai bawaan: ' + JSON.stringify(mode) + ' ' + JSON.stringify(r.body));
    assert.equal(b.tersimpan[b.tersimpan.length - 1].masa_berlaku_mode, 'bulan');
  }
});

test('promo: masa_berlaku_bulan dibatasi 1 sampai 120', async () => {
  const b = backendPromo();
  for (const bulan of [1, 120, '6']) {
    const r = await b.req('poinSettingSave', valid({ masa_berlaku_bulan: bulan }));
    assert.equal(r.body.ok, true, JSON.stringify([bulan, r.body]));
  }
  assert.deepEqual(b.tersimpan.map(x => x.masa_berlaku_bulan), [1, 120, 6], 'angka bertipe string dinormalkan');
  // NaN sengaja tidak dipakai: nilainya menjadi null saat melewati JSON dan
  // justru dianggap "tidak dikirim", bukan nilai tidak valid.
  const bad = [[0, /antara 1 dan 120/], [121, /antara 1 dan 120/], [-3, /antara 1 dan 120/], [1.5, /bilangan bulat/], ['abc', /berupa angka/], [{}, /berupa angka/]];
  for (const [bulan, re] of bad) {
    const r = await b.req('poinSettingSave', valid({ masa_berlaku_bulan: bulan }));
    assert.equal(r.body.ok, false, 'harus ditolak: ' + JSON.stringify(bulan));
    assert.match(r.body.error, re, JSON.stringify([bulan, r.body.error]));
  }
  assert.equal(b.tersimpan.length, 3);
});

test('promo: pemanggil lama tetap bekerja dengan bawaan bulan 12', async () => {
  const b = backendPromo();
  const lama = valid();
  delete lama.masa_berlaku_mode;
  delete lama.masa_berlaku_bulan;
  let r = await b.req('poinSettingSave', lama);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(b.tersimpan[0].masa_berlaku_mode, 'bulan', 'kolom yang tidak dikirim memakai bawaan');
  assert.equal(b.tersimpan[0].masa_berlaku_bulan, 12);
  assert.equal(r.body.data.cfg.masa_berlaku_bulan, 12, 'UI menerima nilai yang benar-benar tersimpan');

  r = await b.req('poinSettingSave', valid({ masa_berlaku_mode: '', masa_berlaku_bulan: null }));
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(b.tersimpan[1].masa_berlaku_mode, 'bulan', 'string kosong dianggap tidak dikirim');
  assert.equal(b.tersimpan[1].masa_berlaku_bulan, 12, 'null dianggap tidak dikirim');

  r = await b.req('poinSettingSave', valid({ masa_berlaku_mode: 'akhir_tahun', masa_berlaku_bulan: undefined }));
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(b.tersimpan[2].masa_berlaku_mode, 'akhir_tahun');
  assert.equal(b.tersimpan[2].masa_berlaku_bulan, 12);
});

test('promo: poinKedaluwarsaRingkasan hanya Owner, uji kering, dan terkunci ke cabang sesi', async () => {
  const b = backendPromo();
  for (const t of ['apoteker', 'kasir']) {
    assert.ok(ditolak(await b.req('poinKedaluwarsaRingkasan', {}, t)), `poinKedaluwarsaRingkasan harus ditolak untuk ${t}`);
  }
  assert.equal(b.calls.filter(c => c.table.startsWith('rpc/')).length, 0, 'penolakan tidak boleh menyentuh database');

  const r = await b.req('poinKedaluwarsaRingkasan');
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(r.body.data.mode, 'bulan');
  assert.equal(r.body.data.bulan, 12);
  assert.equal(r.body.data.total_akan_hangus, 50, '20 + 30');
  assert.equal(r.body.data.jumlah_pelanggan, 2);
  assert.equal(r.body.data.jumlah_saldo_kurang, 1, 'pelanggan dengan saldo tidak sinkron dilaporkan');
  assert.equal(r.body.data.baris[0].nama, 'Budi');
  assert.equal(r.body.data.baris[1].nama, 'Tanpa nama', 'nama kosong diganti teks bawaan');
  assert.equal(r.body.data.baris[1].nomor_wa, '');
  assert.equal(r.body.data.baris[1].saldo_cukup, false);

  const rpc = b.calls.filter(c => c.table === 'rpc/loyalty_poin_akan_hangus');
  assert.equal(rpc.length, 1);
  assert.deepEqual(rpc[0].body, { p_cabang_id: 'KARLA' }, 'cabang selalu dari sesi, bukan dari masukan pemanggil');
  assert.ok(b.calls.filter(c => c.table === 'loyalty_settings').every(c => c.q.get('cabang_id') === 'eq.KARLA'));
  assert.equal(b.calls.filter(c => c.method === 'POST' && ['loyalty_settings', 'loyalty_settings_riwayat'].includes(c.table)).length, 0, 'uji kering tidak boleh menulis apa pun');

  const b2 = backendPromo({ settings: [{ cabang_id: 'KARLA', ...valid({ masa_berlaku_mode: 'akhir_tahun', masa_berlaku_bulan: 6 }) }] });
  const r2 = await b2.req('poinKedaluwarsaRingkasan');
  assert.equal(r2.body.data.mode, 'akhir_tahun', 'ringkasan memakai pengaturan cabang yang tersimpan');
  assert.equal(r2.body.data.bulan, 6);
});
