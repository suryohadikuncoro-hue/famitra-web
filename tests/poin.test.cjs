// Offline regression suite untuk pengaturan perolehan poin.
// Run: node --test tests/poin.test.cjs   (butuh Node >= 22.13 untuk membuang tipe TypeScript)
// Tanpa kredensial, package, database, browser, atau jaringan.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '..');
const source = f => fs.readFileSync(path.join(root, f), 'utf8');

const DEFAULT_CFG = { aktif: true, basis_hitung: 'harga_akhir', rupiah_per_kelipatan: 1000, poin_per_kelipatan: 1, pembulatan: 'bawah', min_belanja: 0, maks_poin_per_transaksi: null, faktor_tipe: { 'Umum': 1, 'Tenaga Kesehatan': 0, 'Apotek Lain': 0 }, gabung_pengganda: 'tertinggi', pengganda: [], retur_kurangi_poin: true };
const valid = (over = {}) => ({ ...JSON.parse(JSON.stringify(DEFAULT_CFG)), ...over });

function backend(opts = {}) {
  const calls = [];
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
      if (opts.missingMigration && (rest.startsWith('loyalty_settings') || rest.startsWith('rpc/loyalty_'))) return json({ code: 'PGRST205', message: 'Could not find the table' }, 404);
      if (opts.riwayatError && rest === 'loyalty_settings_riwayat' && call.method === 'POST') return json({ message: 'boom' }, 500);
      if (rest === 'rpc/loyalty_cfg_default') return json(DEFAULT_CFG);
      if (rest === 'rpc/loyalty_hitung_poin_detail') return json({ poin: 42, echo: call.body });
      if (rest === 'loyalty_settings' && call.method === 'POST') {
        const row = { ...call.body }; tables.loyalty_settings = [row]; return json([row]);
      }
      if (rest === 'loyalty_settings_riwayat' && call.method === 'POST') { tables.loyalty_settings_riwayat.push(call.body); return json([call.body]); }
      let rows = (tables[rest] || []).filter(r => {
        for (const [k, c] of q.entries()) if (c.startsWith('eq.') && String(r[k]) !== c.slice(3)) return false;
        return true;
      });
      return json(rows);
    }
  });
  vm.runInContext(stripTypeScriptTypes(source('supabase/functions/promo/index.ts').replace(/^import "jsr:[^\n]*\n/, '')), ctx);
  return { calls, tables, req: async (name, data = {}, token = 'owner') => {
    const r = await handler(new Request('https://offline.invalid', { method: 'POST', body: JSON.stringify({ args: [name, data, token] }) }));
    return { status: r.status, body: await r.json() };
  } };
}
const denied = r => r.body.ok === false && /Akses ditolak/.test(r.body.error);

test('hanya Owner yang boleh memakai aksi pengaturan poin', async () => {
  const b = backend();
  for (const fn of ['poinSettingGet', 'poinSettingSave', 'poinSimulasi']) {
    for (const t of ['apoteker', 'kasir']) assert.ok(denied(await b.req(fn, valid({ harga_akhir: 1000 }), t)), `${fn} harus ditolak untuk ${t}`);
  }
  assert.equal((await b.req('poinSettingGet')).body.ok, true);
  assert.equal(b.calls.filter(c => c.table.startsWith('loyalty_settings')).length, 2, 'penolakan tidak boleh menyentuh tabel');
});

test('get: nilai bawaan bila belum tersimpan, baris cabang bila sudah ada, dan selalu terkunci ke cabang sesi', async () => {
  let b = backend();
  let r = await b.req('poinSettingGet', { cabang_id: 'PULE' });
  assert.equal(r.body.data.tersimpan, false);
  assert.deepEqual(r.body.data.cfg, DEFAULT_CFG);
  assert.ok(b.calls.filter(c => c.table === 'loyalty_settings').every(c => c.q.get('cabang_id') === 'eq.KARLA'));
  assert.ok(b.calls.filter(c => c.table === 'loyalty_settings_riwayat').every(c => c.q.get('cabang_id') === 'eq.KARLA'));
  b = backend({ settings: [{ cabang_id: 'KARLA', ...valid({ rupiah_per_kelipatan: 5000 }) }] });
  r = await b.req('poinSettingGet');
  assert.equal(r.body.data.tersimpan, true);
  assert.equal(r.body.data.cfg.rupiah_per_kelipatan, 5000);
});

test('save: cabang dan pengguna diambil dari sesi, riwayat dicatat, input cabang_id/updated_by diabaikan', async () => {
  const b = backend();
  const payload = valid({ rupiah_per_kelipatan: '10000', poin_per_kelipatan: 2, pembulatan: 'atas', min_belanja: 20000, maks_poin_per_transaksi: 50,
    faktor_tipe: { 'Umum': 1, 'Tenaga Kesehatan': 0.5, 'Apotek Lain': 0 }, gabung_pengganda: 'kali',
    pengganda: [{ nama: ' Selasa 2x ', aktif: true, faktor: 2, hari: [2, 2, 1], mulai: '2026-10-01', selesai: '2026-10-31', ekstra: 'x' }],
    cabang_id: 'PULE', updated_by: 'hacker', id: 'x' });
  const r = await b.req('poinSettingSave', payload);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  const w = b.calls.find(c => c.table === 'loyalty_settings' && c.method === 'POST');
  assert.equal(w.body.cabang_id, 'KARLA');
  assert.equal(w.body.updated_by, 'suryo');
  assert.equal(w.q.get('on_conflict'), 'cabang_id');
  assert.match(w.headers.Prefer, /resolution=merge-duplicates/);
  assert.equal(w.body.rupiah_per_kelipatan, 10000, 'angka bertipe string dinormalkan');
  assert.deepEqual(w.body.pengganda, [{ nama: 'Selasa 2x', aktif: true, faktor: 2, hari: [1, 2], mulai: '2026-10-01', selesai: '2026-10-31' }], 'field asing dibuang, hari unik & terurut, nama dipangkas');
  assert.ok(!('id' in w.body));
  assert.equal(b.tables.loyalty_settings_riwayat.length, 1);
  assert.equal(b.tables.loyalty_settings_riwayat[0].cabang_id, 'KARLA');
  assert.equal(b.tables.loyalty_settings_riwayat[0].disimpan_oleh, 'suryo');
});

test('save: nilai batas yang sah diterima', async () => {
  const b = backend();
  const oke = [
    valid({ faktor_tipe: { 'Umum': 0, 'Tenaga Kesehatan': 100, 'Apotek Lain': 0.01 } }),
    valid({ maks_poin_per_transaksi: null }), valid({ maks_poin_per_transaksi: '' }), valid({ maks_poin_per_transaksi: 1000000 }),
    valid({ poin_per_kelipatan: 1000 }), valid({ rupiah_per_kelipatan: 1 }), valid({ min_belanja: 0 }), valid({ aktif: false }),
    valid({ pengganda: Array.from({ length: 50 }, (_, i) => ({ nama: 'P' + i, aktif: true, faktor: 0.01 })) }),
    valid({ pengganda: [{ nama: 'x', aktif: false, faktor: 100, hari: [0, 6], mulai: '2026-02-28', selesai: '2026-02-28' }] })
  ];
  for (const p of oke) { const r = await b.req('poinSettingSave', p); assert.equal(r.body.ok, true, JSON.stringify([p, r.body])); }
});

test('save: input tidak valid ditolak sebelum menyentuh database', async () => {
  const b = backend();
  const bad = [
    [null, /Faktor tipe/], [{}, /Faktor tipe/], [[], /tidak valid/], ['teks', /tidak valid/],
    [valid({ aktif: 'ya' }), /Status program/], [valid({ basis_hitung: 'x' }), /Dasar hitung/], [valid({ pembulatan: 'x' }), /Pembulatan/],
    [valid({ gabung_pengganda: 'x' }), /Cara gabung/], [valid({ retur_kurangi_poin: 1 }), /Pengaturan retur/],
    [valid({ rupiah_per_kelipatan: 0 }), /Belanja per kelipatan/], [valid({ rupiah_per_kelipatan: -5 }), /Belanja per kelipatan/],
    [valid({ rupiah_per_kelipatan: 10.005 }), /2 angka/], [valid({ rupiah_per_kelipatan: 'abc' }), /angka/], [valid({ rupiah_per_kelipatan: NaN }), /angka/],
    [valid({ poin_per_kelipatan: 0 }), /Poin per kelipatan/], [valid({ poin_per_kelipatan: 1001 }), /Poin per kelipatan/], [valid({ poin_per_kelipatan: 1.5 }), /bulat/],
    [valid({ min_belanja: -1 }), /Minimal belanja/], [valid({ maks_poin_per_transaksi: 0 }), /Batas poin/], [valid({ maks_poin_per_transaksi: 2.5 }), /bulat/],
    [valid({ faktor_tipe: null }), /Faktor tipe/], [valid({ faktor_tipe: { 'Umum': 1 } }), /Faktor Tenaga Kesehatan/],
    [valid({ faktor_tipe: { 'Umum': -1, 'Tenaga Kesehatan': 0, 'Apotek Lain': 0 } }), /Faktor Umum/], [valid({ faktor_tipe: { 'Umum': 101, 'Tenaga Kesehatan': 0, 'Apotek Lain': 0 } }), /Faktor Umum/],
    [valid({ pengganda: 'x' }), /Daftar pengganda/], [valid({ pengganda: Array.from({ length: 51 }, () => ({ nama: 'a', aktif: true, faktor: 2 })) }), /maksimal 50/],
    [valid({ pengganda: [null] }), /#1/], [valid({ pengganda: [{ nama: '', aktif: true, faktor: 2 }] }), /Nama pengganda/],
    [valid({ pengganda: [{ nama: 'x'.repeat(61), aktif: true, faktor: 2 }] }), /Nama pengganda/],
    [valid({ pengganda: [{ nama: 'a', aktif: 'ya', faktor: 2 }] }), /Status pengganda/], [valid({ pengganda: [{ nama: 'a', aktif: true, faktor: 0 }] }), /Faktor pengganda/],
    [valid({ pengganda: [{ nama: 'a', aktif: true, faktor: 101 }] }), /Faktor pengganda/], [valid({ pengganda: [{ nama: 'a', aktif: true, faktor: 2, hari: [7] }] }), /Hari pengganda/],
    [valid({ pengganda: [{ nama: 'a', aktif: true, faktor: 2, hari: [1.5] }] }), /Hari pengganda/],
    [valid({ pengganda: [{ nama: 'a', aktif: true, faktor: 2, mulai: '2026-02-30' }] }), /mulai/], [valid({ pengganda: [{ nama: 'a', aktif: true, faktor: 2, selesai: 'besok' }] }), /selesai/],
    [valid({ pengganda: [{ nama: 'a', aktif: true, faktor: 2, mulai: '2026-10-02', selesai: '2026-10-01' }] }), /sebelum tanggal mulai/]
  ];
  for (const [p, re] of bad) {
    const r = await b.req('poinSettingSave', p);
    assert.equal(r.body.ok, false, 'harus ditolak: ' + JSON.stringify(p));
    assert.match(r.body.error, re, JSON.stringify(p) + ' => ' + r.body.error);
  }
  assert.equal(b.calls.filter(c => c.table === 'loyalty_settings' && c.method === 'POST').length, 0);
});

test('migrasi belum diterapkan: pesan jelas untuk get/save/simulasi', async () => {
  const b = backend({ missingMigration: true });
  for (const [fn, data] of [['poinSettingGet', {}], ['poinSettingSave', valid()], ['poinSimulasi', { harga_akhir: 1000 }]]) {
    const r = await b.req(fn, data);
    assert.equal(r.body.ok, false, fn);
    assert.match(r.body.error, /Migrasi pengaturan poin belum diterapkan/, fn);
  }
});

test('save: kegagalan mencatat riwayat dilaporkan, bukan disembunyikan', async () => {
  const r = await backend({ riwayatError: true }).req('poinSettingSave', valid());
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /riwayat perubahan gagal dicatat/);
});

test('simulasi: memakai draf (tervalidasi) atau pengaturan tersimpan, dan meneruskan parameter dengan benar', async () => {
  let b = backend();
  let r = await b.req('poinSimulasi', { cfg: valid({ pembulatan: 'atas' }), tipe_customer: 'Tenaga Kesehatan', harga_akhir: '25000', subtotal: 30000, tanggal: '2026-09-29', retur: true });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  let rpc = b.calls.find(c => c.table === 'rpc/loyalty_hitung_poin_detail').body;
  assert.equal(rpc.cfg.pembulatan, 'atas'); assert.equal(rpc.p_tipe, 'Tenaga Kesehatan');
  assert.equal(rpc.p_harga_akhir, 25000); assert.equal(rpc.p_subtotal, 30000); assert.equal(rpc.p_tanggal, '2026-09-29'); assert.equal(rpc.p_retur, true);
  b = backend();
  r = await b.req('poinSimulasi', { harga_akhir: 5000, retur: 'true' });
  rpc = b.calls.find(c => c.table === 'rpc/loyalty_hitung_poin_detail').body;
  assert.deepEqual(rpc.cfg, DEFAULT_CFG, 'tanpa draf memakai nilai bawaan');
  assert.equal(rpc.p_tipe, 'Umum'); assert.equal(rpc.p_subtotal, 5000, 'subtotal kosong = harga akhir');
  assert.equal(rpc.p_retur, false, 'retur hanya true bila boolean true');
  assert.match(rpc.p_tanggal, /^\d{4}-\d{2}-\d{2}$/);
  b = backend({ settings: [{ cabang_id: 'KARLA', ...valid({ rupiah_per_kelipatan: 7000 }) }] });
  await b.req('poinSimulasi', { harga_akhir: 5000 });
  assert.equal(b.calls.find(c => c.table === 'rpc/loyalty_hitung_poin_detail').body.cfg.rupiah_per_kelipatan, 7000, 'memakai pengaturan tersimpan');
});

test('simulasi: input tidak valid ditolak', async () => {
  const b = backend();
  for (const [d, re] of [[{ harga_akhir: 1000, tipe_customer: 'VIP' }, /Tipe pelanggan/], [{ harga_akhir: -1 }, /Harga akhir/], [{ harga_akhir: 'x' }, /Harga akhir/],
    [{ harga_akhir: 1000, subtotal: -5 }, /Subtotal/], [{ harga_akhir: 1000, tanggal: '2026-13-01' }, /Tanggal/], [{ harga_akhir: 1000, cfg: valid({ pembulatan: 'x' }) }, /Pembulatan/]]) {
    const r = await b.req('poinSimulasi', d);
    assert.equal(r.body.ok, false, JSON.stringify(d)); assert.match(r.body.error, re);
  }
  assert.equal(b.calls.filter(c => c.table.startsWith('rpc/loyalty_hitung')).length, 0);
});

test('sesi tidak valid ditolak', async () => {
  const b = backend();
  const r = await b.req('poinSettingGet', {}, 'tidak-ada');
  assert.equal(r.body.ok, false);
  assert.equal(b.calls.filter(c => c.table.startsWith('loyalty_settings')).length, 0);
});

test('migrasi: memenuhi aturan AGENTS.md (GRANT, RLS, policy) dan tidak destruktif', () => {
  const sql = source('supabase/migrations/20260929020000_loyalty_pengaturan_perolehan.sql');
  for (const t of ['loyalty_settings', 'loyalty_settings_riwayat']) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`, 'i'), 'RLS ' + t);
    assert.match(sql, new RegExp(`create policy \\w+ on public\\.${t}`, 'i'), 'policy ' + t);
    assert.match(sql, new RegExp(`grant [a-z, ]+ on public\\.${t} to service_role`, 'i'), 'grant ' + t);
    assert.match(sql, new RegExp(`revoke all on public\\.${t} from public, anon, authenticated`, 'i'), 'revoke ' + t);
  }
  assert.doesNotMatch(sql, /grant[^;]*\bto\s+(anon|authenticated|public)\b/i, 'tidak ada grant ke anon/authenticated/public');
  assert.doesNotMatch(sql, /drop\s+table|truncate|delete\s+from|alter\s+table\s+public\.(master_customer|trx_|loyalty_transactions|loyalty_rewards)/i, 'tidak menyentuh tabel lama');
  assert.match(sql, /rumus lama|Cadangan/i, 'trigger punya cadangan rumus lama');
  assert.match(sql, /Prasyarat belum ada[\s\S]*20260925070000/, 'migrasi menolak dirinya bila prasyarat loyalty belum diterapkan');
  assert.ok(sql.indexOf('Prasyarat belum ada') < sql.indexOf('create table'), 'pengaman dijalankan sebelum membuat apa pun');
});

test('UI: kalimat aturan tetap dihapus, aksi baru terpasang, teks pengguna di-escape', () => {
  const js = source('public/js_marketing_poin.js');
  assert.doesNotMatch(js, /Perolehan poin saat ini/);
  for (const a of ['poinSettingGet', 'poinSettingSave', 'poinSimulasi']) assert.ok(js.includes(`'${a}'`), a);
  assert.ok(js.includes('esc(x.nama)'), 'nama pengganda di-escape');
  assert.ok(js.includes('esc(r.disimpan_oleh'), 'nama pengguna riwayat di-escape');
  assert.doesNotThrow(() => new vm.Script(js));
});
