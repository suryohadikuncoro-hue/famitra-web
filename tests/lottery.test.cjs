// Offline regression suite. Run: node --test tests/lottery.test.cjs
// No credentials, packages, live database, browser or network required.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = f => fs.readFileSync(path.join(root, f), 'utf8');
const C = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const campaign = { id: C, kode_cabang: 'KARLA', nama: 'Offline', periode_mulai: '2026-09-01', periode_selesai: '2026-09-30' };
function backend(opts = {}) {
  const calls = [];
  const tables = {
    app_sessions: [{ token: 'test-session', username: 'tester', role: 'Apoteker', cabang_id: 'KARLA', expires_at: '2099-01-01T00:00:00Z', ...(opts.session || {}) }],
    lottery_campaigns: [campaign], lottery_prizes: [{ id: P, campaign_id: C, nilai_hadiah_idr: '25.00', retired: false }],
    lottery_winners: [{ id: 'winner', prize_id: P, campaign_id: C, pickup_status: 'sudah_diambil' }],
    master_customer: [{ id: U, nomor_wa: '6281', nama: 'Ani', tipe_customer: 'Umum', cabang_id: 'KARLA' }],
    trx_penjualan: [
      { no_nota: '1', cabang_id: 'KARLA', tanggal: '2026-09-01', nomor_wa: '6281', harga_akhir: '100.10', total_hpp: '60.10' },
      { no_nota: '2', cabang_id: 'KARLA', tanggal: '2026-09-30', nomor_wa: '6281', harga_akhir: '50.20', total_hpp: '20.20' },
      { no_nota: '3', cabang_id: 'KARLA', tanggal: '2026-10-01', nomor_wa: '6281', harga_akhir: 999, total_hpp: 1 },
      { no_nota: '4', cabang_id: 'PULE', tanggal: '2026-09-30', nomor_wa: '6281', harga_akhir: 999, total_hpp: 1 }
    ], ...(opts.tables || {})
  };
  let handler;
  const ctx = vm.createContext({ Response, Request, Date, console, URL, Deno: { env: { get: key => key === 'SUPABASE_URL' ? 'https://offline.invalid' : 'fake-test-key' }, serve: fn => { handler = fn; } },
    fetch: async (url, init = {}) => {
      const parsed = new URL(url), q = parsed.searchParams, table = parsed.pathname.split('/').pop();
      calls.push({ table, q, init });
      if (opts.errorTable === table) return new Response(JSON.stringify({ code: 'XX000', message: 'internal-private-detail' }), { status: 500 });
      if (table === 'trx_penjualan' && opts.noHpp && q.get('select').includes('total_hpp')) return new Response(JSON.stringify({ code: '42703' }), { status: 400 });
      if (parsed.pathname.includes('/rpc/')) return new Response(JSON.stringify({ id: C, coupon_code: 'LOT-TEST' }));
      let rows = (tables[table] || []).filter(row => {
        for (const [key, cond] of q.entries()) {
          if (['limit', 'offset', 'select', 'order'].includes(key)) continue;
          const val = row[key];
          if (cond.startsWith('eq.') && String(val) !== cond.slice(3)) return false;
          if (cond.startsWith('neq.') && String(val) === cond.slice(4)) return false;
          if (cond.startsWith('gte.') && String(val) < cond.slice(4)) return false;
          if (cond.startsWith('lte.') && String(val) > cond.slice(4)) return false;
          if (cond.startsWith('gt.') && String(val) <= cond.slice(3)) return false;
          if (cond === 'not.is.null' && val == null) return false;
          if (cond.startsWith('in.(') && !cond.slice(4, -1).split(',').includes(String(val))) return false;
        }
        return true;
      });
      const offset = Number(q.get('offset') || 0), limit = Math.min(Number(q.get('limit') || 500), opts.cap || 500);
      rows = rows.slice(offset, offset + limit);
      return new Response(JSON.stringify(rows));
    }
  });
  vm.runInContext(source('supabase/functions/lottery/index.ts'), ctx);
  return { calls, ctx, request: async (fn, data = {}, token = 'test-session', extra = {}) => {
    const r = await handler(new Request('https://offline.invalid', { method: 'POST', body: JSON.stringify({ fn, args: [data, token] }), ...extra }));
    return { status: r.status, headers: r.headers, body: await r.json() };
  }, raw: handler };
}
test('canonical frontend router, CORS success/error/preflight, method and malformed input', async () => {
  const b = backend();
  const r = await b.request('lotteryGet', { id: C });
  assert.equal(r.status, 200); assert.equal(r.body.data.campaign.id, C);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
  for (const method of ['OPTIONS', 'GET']) {
    const response = await b.raw(new Request('https://offline.invalid', { method }));
    assert.equal(response.status, method === 'OPTIONS' ? 200 : 405);
    assert.match(response.headers.get('Access-Control-Allow-Methods'), /POST/);
  }
  for (const body of ['{', JSON.stringify({ args: ['lotteryList', {}, 'test-session'] }), JSON.stringify({ fn: 'toString', args: [{}, 'test-session'] })]) {
    const response = await b.raw(new Request('https://offline.invalid', { method: 'POST', body }));
    assert.equal(response.status, 400); assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  }
});
test('expired/missing sessions rejected; database errors do not leak token/URL/details', async () => {
  for (const b of [backend({ session: { expires_at: '2000-01-01' } }), backend({ tables: { app_sessions: [] } })]) {
    const r = await b.request('lotteryList'); assert.equal(r.status, 401); assert.equal(r.body.code, 'NO_SESSION');
  }
  const b = backend({ errorTable: 'app_sessions' }); const r = await b.request('lotteryList');
  assert.equal(r.status, 500); assert.doesNotMatch(JSON.stringify(r.body), /test-session|internal-private|offline.invalid/);
});
test('every lottery action rejects Kasir and branchless Apoteker', async () => {
  const names = ['lotteryList', 'lotteryGet', 'lotterySave', 'lotteryStatus', 'lotteryEligibleParticipants', 'lotteryWinnerSave', 'lotteryReport'];
  for (const session of [{ role: 'Kasir' }, { cabang_id: '' }]) {
    for (const name of names) assert.equal((await backend({ session }).request(name, { id: C, campaign_id: C })).status, 403);
  }
});
test('read-by-id and update authorize stored branch; Owner can inspect other branch', async () => {
  const data = { id: C, campaign_id: C, kode_cabang: 'PULE' };
  for (const name of ['lotteryGet', 'lotterySave', 'lotteryStatus', 'lotteryEligibleParticipants', 'lotteryWinnerSave', 'lotteryReport']) {
    const b = backend({ session: { cabang_id: 'PULE' } });
    assert.equal((await b.request(name, data)).status, 403, name);
    assert.equal(b.calls.filter(c => c.init.method === 'POST').length, 0);
  }
  assert.equal((await backend({ session: { role: 'Owner', cabang_id: 'PULE' } }).request('lotteryGet', { id: C })).status, 200);
});
test('pagination handles server cap smaller than requested, inclusive dates, same-branch eligibility', async () => {
  const b = backend({ cap: 1 }); const r = await b.request('lotteryEligibleParticipants', { campaign_id: C });
  assert.equal(r.body.data.total_peserta, 1); assert.equal(r.body.data.participants[0].jumlah_transaksi_periode, 2);
  assert.equal(r.body.data.participants[0].total_belanja_periode, 150.3);
  assert.deepEqual(b.calls.filter(c => c.table === 'trx_penjualan').map(c => c.q.get('offset')), ['0', '1', '2']);
});
test('eligible set excludes Apotek Lain, blanks and nonparticipants without OR URL interpolation', async () => {
  const b = backend({ tables: { master_customer: [
    { id: U, cabang_id: 'KARLA', nomor_wa: '6281', tipe_customer: 'Apotek Lain' },
    { id: P, cabang_id: 'KARLA', nomor_wa: ' ', tipe_customer: 'Umum' },
    { id: C, cabang_id: 'KARLA', nomor_wa: '6282', tipe_customer: 'Umum' }
  ] } });
  const r = await b.request('lotteryEligibleParticipants', { campaign_id: C });
  assert.equal(r.body.data.total_peserta, 0);
  assert.ok(b.calls.every(c => !c.q.has('or')));
});
test('report uses total_hpp and cent arithmetic, preserves ROI proxy formula, no false zero HPP', async () => {
  const r = await backend({ cap: 1 }).request('lotteryReport', { campaign_id: C });
  const x = r.body.data.ringkasan;
  assert.equal(x.total_revenue_idr, 150.3); assert.equal(x.total_hpp_idr, 80.3); assert.equal(x.total_profit_idr, 70);
  assert.equal(x.total_biaya_hadiah_idr, 25); assert.equal(x.roi_direct_percent, 280); assert.equal(x.total_transaksi_peserta, 2);
  const missing = await backend({ noHpp: true }).request('lotteryReport', { campaign_id: C });
  assert.equal(missing.body.data.ringkasan.total_profit_idr, null); assert.equal(missing.body.data.ringkasan.roi_direct_percent, null);
  assert.match(missing.body.data.warning, /HPP/);
  const b = backend({ tables: { trx_penjualan: [{ no_nota: '1', cabang_id: 'KARLA', tanggal: '2026-09-30', nomor_wa: '6281', harga_akhir: 100, total_hpp: null }] } });
  assert.equal((await b.request('lotteryReport', { campaign_id: C })).body.data.ringkasan.total_profit_idr, null);
});
test('campaign and winner writes use single RPC instead of partial table DELETE/POST', async () => {
  const b = backend();
  assert.equal((await b.request('lotterySave', { ...campaign, prizes: [] })).status, 200);
  assert.equal((await b.request('lotteryWinnerSave', { campaign_id: C, customer_id: U, prize_id: P, coupon_expired_at: '2026-10-01' })).status, 200);
  const writes = b.calls.filter(c => c.init.method);
  assert.deepEqual(writes.map(c => c.table), ['lottery_save_campaign', 'lottery_record_winner']);
  assert.ok(writes.every(c => JSON.parse(c.init.body).p_token === 'test-session'));
  assert.equal((await b.request('lotteryWinnerSave', { campaign_id: C, customer_id: U, prize_id: P, coupon_expired_at: '2026-02-30' })).status, 400);
});
function frontend() {
  const elements = {}, requests = [], timers = [];
  const el = id => elements[id] || (elements[id] = { id, value: '', innerHTML: '', textContent: '', style: {}, children: [], disabled: false,
    addEventListener(name, fn) { this[name] = fn; }, querySelectorAll() { return []; }, appendChild(x) { this.children.push(x); x.parentNode = this; if (x.id) elements[x.id] = x; },
    remove() { if (this.id) delete elements[this.id]; }, getAttribute(key) { return this[key]; }
  });
  const document = { getElementById: id => elements[id] || null, querySelectorAll: () => [], createElement: () => ({ style: {}, children: [], appendChild(x) { this.children.push(x); }, remove() { if (this.id) delete elements[this.id]; } }) };
  const ctx = vm.createContext({ document, window: {}, VIEWS: { marketing: { render() {} } }, console, setTimeout: fn => timers.push(fn), alert() {}, confirm: () => true,
    fetch: async (url, init) => { const data = JSON.parse(init.body); requests.push(data); return new Response(JSON.stringify({ ok: true, data: data.fn === 'lotteryEligibleParticipants' ? { participants: [{ customer_id: U, nama: 'Ani', nomor_wa: '6281', tipe_customer: 'Umum' }] } : { campaign, prizes: [{ id: P }], winners: [] } })); },
    api: async name => { requests.push({ name }); return [{ kode_cabang: 'KARLA', nama_cabang: 'Karla' }]; }, Response
  });
  // Lexical SESSION specifically tests no reliance on window.SESSION.
  vm.runInContext('let SESSION = {token: "lexical-token", user: {role:"Owner", cabang_id:"KARLA"}};', ctx);
  const src = source('public/js_marketing_lottery.js').replace('  // expose entry', `  window.test = { lotteryApi, bindWinners, showCustSuggest, clearCampaign, openDetail, readForm, renderForm, saveWinner, rupiah, state: () => state, selected: () => _selectedCustomer, cache: () => _custCache, branches: () => _branches };\n  // expose entry`);
  vm.runInContext(src, ctx);
  return { ctx, t: ctx.window.test, el, elements, requests, timers };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('frontend lexical session contract and real cabang.list source', async () => {
  const f = frontend(); await f.t.lotteryApi('lotteryList', {});
  assert.equal(f.requests[0].fn, 'lotteryList'); assert.equal(f.requests[0].args[1], 'lexical-token');
  f.ctx.window.MarketingLottery.mount(f.el('lottery-root')); await flush();
  assert.ok(f.requests.some(x => x.name === 'cabang.list')); assert.equal(f.t.branches()[0].kode_cabang, 'KARLA');
});
test('frontend winner cache loads before typing and selection clears on changed/short input', async () => {
  const f = frontend(); f.t.state().detailCampaign = campaign;
  const cust = f.el('lot-w-cust'); cust.parentNode = f.el('parent'); f.el('lot-w-save'); f.el('lot-w-msg');
  f.t.bindWinners(); assert.equal(cust.disabled, true); await flush(); assert.equal(f.t.cache().length, 1);
  cust.value = 'An'; cust.input(); const suggest = f.elements['lot-w-suggest']; assert.ok(suggest);
  suggest.children[0].onclick(); assert.equal(f.t.selected().customer_id, U);
  cust.value = 'A'; cust.input(); assert.equal(f.t.selected(), null); assert.equal(f.elements['lot-w-suggest'], undefined);
  f.t.clearCampaign(); assert.equal(f.t.cache().length, 0);
});
test('frontend stale participant response cannot populate changed campaign', async () => {
  const f = frontend(); f.t.state().detailCampaign = campaign;
  f.el('lot-w-cust').parentNode = f.el('parent'); f.el('lot-w-save');
  f.t.bindWinners(); f.t.clearCampaign(); await flush(); assert.equal(f.t.cache().length, 0);
});
test('frontend open/edit passes campaign ID and retained prize IDs; new campaign resets all', async () => {
  const f = frontend(); f.t.openDetail(C, true); await flush();
  assert.equal(f.t.state().editId, C); assert.equal(f.t.state().tab, 'form');
  const fields = { 'lot-f-cabang': 'KARLA', 'lot-f-nama': 'Campaign', 'lot-f-mulai': '2026-09-01', 'lot-f-selesai': '2026-09-30', 'lot-f-catatan': '' };
  for (const [id, value] of Object.entries(fields)) f.el(id).value = value;
  assert.equal(f.t.readForm().id, C);
  assert.match(f.t.renderForm(), /data-id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"/);
  f.t.clearCampaign(); assert.equal(f.t.readForm().id, undefined); assert.equal(f.t.state().prizes.length, 0);
  assert.equal(f.t.rupiah(null), 'Tidak tersedia'); assert.match(f.t.rupiah(0), /0/);
});
test('role menu wiring excludes Kasir; Apoteker gets lottery without Owner promo actions', () => {
  const core = source('public/js_core.js'), master = source('public/js_marketing_lottery.js');
  assert.match(core, /\['Owner', 'Apoteker'\]\.indexOf\(res\.data\.user\.role\)/);
  assert.match(master, /if \(role !== "Owner" && role !== "Apoteker"\)/);
  assert.match(master, /if \(role === "Apoteker"\)[\s\S]*?MarketingLottery\.mount[\s\S]*?return;/);
  assert.match(source('supabase/config.toml'), /\[functions.lottery\]\s*verify_jwt = false/);
});
test('SQL contract guards (static only): transactional history, authorization, eligibility, private RPC', () => {
  const sql = source('supabase/migrations/20260927010000_lottery_atomic_writes.sql');
  assert.match(sql, /begin;[\s\S]*commit;/i); assert.doesNotMatch(sql, /\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+TABLE\b/i);
  assert.match(sql, /where id = cid for update/); assert.match(sql, /s.cabang_id <> c.kode_cabang/);
  assert.match(sql, /customer.cabang_id <> c.kode_cabang/); assert.match(sql, /t.cabang_id = c.kode_cabang/);
  assert.match(sql, /t.tanggal >= c.periode_mulai and t.tanggal <= c.periode_selesai/);
  assert.match(sql, /where id = prizeid and campaign_id = cid and not retired/);
  assert.match(sql, /set retired = true where campaign_id = cid/);
  assert.match(sql, /Hadiah yang sudah memiliki pemenang tidak dapat diubah/);
  for (const fn of ['lottery_require_session', 'lottery_save_campaign', 'lottery_record_winner']) {
    assert.match(sql, new RegExp(`revoke all on function public.${fn}[^;]+from public, anon, authenticated`));
  }
});
