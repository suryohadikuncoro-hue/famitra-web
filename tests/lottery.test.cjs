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
      if (opts.noRuleColumns && table === 'lottery_campaigns' && (q.get('select') || '').includes('min_jumlah_transaksi')) return new Response(JSON.stringify({ code: '42703' }), { status: 400 });
      if (table === 'trx_penjualan' && opts.noHpp && q.get('select').includes('total_hpp')) return new Response(JSON.stringify({ code: '42703' }), { status: 400 });
      if (parsed.pathname.includes('/rpc/')) {
        if (opts.rpcError) return new Response(JSON.stringify({ code: 'P0001', message: opts.rpcError }), { status: 400 });
        return new Response(JSON.stringify({ id: C, coupon_code: 'LOT-TEST' }));
      }
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
test('committed lottery preflight accepts preview origin and content-type without database access', async () => {
  const b = backend();
  const response = await b.raw(new Request('https://offline.invalid', { method: 'OPTIONS', headers: {
    Origin: 'https://feat-kupon-undian.famitra-web.pages.dev',
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type'
  } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(response.headers.get('Access-Control-Allow-Headers'), /content-type/);
  assert.match(response.headers.get('Access-Control-Allow-Methods'), /POST/);
  assert.equal(b.calls.length, 0);
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
function frontend(opts = {}) {
  const currentCampaign = { ...campaign, ...(opts.campaign || {}) };
  const elements = {}, requests = [], timers = [];
  const el = id => elements[id] || (elements[id] = { id, value: '', innerHTML: '', textContent: '', style: {}, children: [], disabled: false,
    addEventListener(name, fn) { this[name] = fn; }, querySelectorAll() { return []; }, appendChild(x) { this.children.push(x); x.parentNode = this; if (x.id) elements[x.id] = x; },
    remove() { if (this.id) delete elements[this.id]; }, getAttribute(key) { return this[key]; }
  });
  const document = { getElementById: id => elements[id] || null, querySelectorAll: () => [], createElement: () => ({ style: {}, children: [], appendChild(x) { this.children.push(x); }, remove() { if (this.id) delete elements[this.id]; } }) };
  const ctx = vm.createContext({ document, window: {}, VIEWS: { marketing: { render() {} } }, console, setTimeout: fn => timers.push(fn), alert() {}, confirm: () => true,
    fetch: async (url, init) => { const data = JSON.parse(init.body); requests.push(data); return new Response(JSON.stringify({ ok: true, data: data.fn === 'lotteryEligibleParticipants' ? { campaign: currentCampaign, participants: [{ customer_id: U, nama: 'Ani', nomor_wa: '6281', tipe_customer: 'Umum', total_belanja_periode: 300000 }] } : { campaign: currentCampaign, prizes: [{ id: P }], winners: [] } })); },
    api: async name => { requests.push({ name }); return [{ kode_cabang: 'KARLA', nama_cabang: 'Karla' }]; }, Response
  });
  // Lexical SESSION specifically tests no reliance on window.SESSION.
  vm.runInContext('let SESSION = {token: "lexical-token", user: {role:"Owner", cabang_id:"KARLA"}};', ctx);
  const src = source('public/js_marketing_lottery.js').replace('  // expose entry', `  window.test = { lotteryApi, tabsHtml, render, loadList, listErrorHtml, bindWinners, showCustSuggest, clearCampaign, openDetail, readForm, renderForm, saveForm, saveWinner, rupiah, minimumHtml, validMinimum, tableParticipants, state: () => state, selected: () => _selectedCustomer, cache: () => _custCache, branches: () => _branches };\n  // expose entry`);
  vm.runInContext(src, ctx);
  return { ctx, t: ctx.window.test, el, elements, requests, timers };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('network failure has retry/deployment guidance, keeps escaped diagnostic and never shows empty success', async () => {
  const f = frontend(), cause = new TypeError('Failed to fetch <blocked>');
  f.ctx.fetch = async () => { throw cause; };
  await assert.rejects(f.t.lotteryApi('lotteryList'), e => {
    assert.equal(e.code, 'LOTTERY_NETWORK'); assert.equal(e.cause, cause);
    assert.match(e.message, /Periksa koneksi/); return true;
  });
  const body = f.el('lot-list-body'), retry = f.el('lot-retry');
  f.t.loadList(); await flush();
  assert.match(body.innerHTML, /role="alert"/); assert.match(body.innerHTML, /Coba Lagi/);
  assert.match(body.innerHTML, /Edge Function/); assert.match(body.innerHTML, /migrasi database/);
  assert.match(body.innerHTML, /CORS/); assert.match(body.innerHTML, /bukan bukti/);
  assert.match(body.innerHTML, /Failed to fetch &lt;blocked&gt;/);
  assert.doesNotMatch(body.innerHTML, /Belum ada campaign\./);
  assert.equal(f.t.state().detailCampaign, null);
  f.ctx.fetch = async () => new Response(JSON.stringify({ ok: true, data: [] }));
  retry.onclick(); await flush();
  assert.match(body.innerHTML, /Belum ada campaign\./); assert.doesNotMatch(body.innerHTML, /role="alert"/);
});
test('HTTP/backend/session errors are not mislabeled as network failures; non-JSON keeps status', async () => {
  const f = frontend(); let login = 0;
  f.ctx.paksaLogin = () => login++;
  for (const [status, payload] of [[401, { ok: false, code: 'NO_SESSION', error: 'Sesi berakhir' }], [403, { ok: false, error: 'Akses ditolak' }], [404, { message: 'Function not found' }], [500, { ok: false, error: 'Gagal mengakses data lottery' }]]) {
    f.ctx.fetch = async () => new Response(JSON.stringify(payload), { status });
    await assert.rejects(f.t.lotteryApi('lotteryList'), e => {
      assert.equal(e.status, status); assert.notEqual(e.code, 'LOTTERY_NETWORK');
      assert.equal(e.message, payload.error || payload.message);
      const html = f.t.listErrorHtml(e);
      if (status === 401 || status === 403) assert.doesNotMatch(html, /deployment/);
      else assert.match(html, /deployment/);
      return true;
    });
  }
  assert.equal(login, 1);
  f.ctx.fetch = async () => new Response('<html>bad gateway</html>', { status: 502 });
  await assert.rejects(f.t.lotteryApi('lotteryList'), e => {
    assert.equal(e.code, 'LOTTERY_RESPONSE'); assert.equal(e.status, 502);
    assert.match(e.message, /HTTP 502/); return true;
  });
});
test('campaign-dependent buttons have native disabled state and visible linked explanation', () => {
  const f = frontend();
  for (const selected of [false, true, false]) {
    f.t.state().detailCampaign = selected ? campaign : null;
    const html = f.t.tabsHtml();
    for (const id of ['participants', 'winners', 'report']) {
      const button = html.match(new RegExp('<button[^>]*data-tab="' + id + '"[^>]*>'))[0];
      if (selected) assert.doesNotMatch(button, /disabled|aria-describedby/);
      else { assert.match(button, / disabled aria-disabled="true"/); assert.match(button, /aria-describedby="lot-campaign-help"/); }
    }
    if (!selected) assert.match(html, /id="lot-campaign-help"[\s\S]*Pilih <b>Buka<\/b>/);
    assert.doesNotMatch(html, /pointer-events:none/);
    for (const id of ['list', 'form']) assert.doesNotMatch(html.match(new RegExp('<button[^>]*data-tab="' + id + '"[^>]*>'))[0], /disabled/);
  }
});
test('disabled tab handler cannot navigate without campaign; opens after selection and guards stale state', () => {
  const f = frontend(), rootEl = f.el('lottery-root');
  const buttons = ['participants', 'winners', 'report'].map(id => ({ disabled: false, getAttribute: () => id }));
  rootEl.querySelectorAll = () => buttons;
  f.t.render();
  for (const button of buttons) { button.onclick(); assert.equal(f.t.state().tab, 'list'); }
  f.t.state().detailCampaign = campaign;
  for (const button of buttons) { button.onclick(); assert.equal(f.t.state().tab, button.getAttribute()); }
  f.t.clearCampaign(); f.t.state().tab = 'list';
  for (const button of buttons) { button.onclick(); assert.equal(f.t.state().tab, 'list'); }
  f.t.state().detailCampaign = campaign; buttons[0].disabled = true;
  buttons[0].onclick(); assert.equal(f.t.state().tab, 'list');
});
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
  const fields = { 'lot-f-cabang': 'KARLA', 'lot-f-nama': 'Campaign', 'lot-f-mulai': '2026-09-01', 'lot-f-selesai': '2026-09-30', 'lot-f-catatan': '', 'lot-f-min-belanja': '0', 'lot-f-min-trx': '1', 'lot-f-min-per-trx': '0' };
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

// These tests execute JS against a PostgREST stub. They do NOT execute SQL RPCs;
// database enforcement/atomicity belongs to the rollback-only lottery.sql suite.
for (const [minimum, expected] of [[150.29, 1], [150.3, 1], [150.31, 0], [0, 1]]) {
  test(`cumulative minimum ${minimum}: below/equal/above boundary, two purchases and dates/branch`, async () => {
    const b = backend({ cap: 1, tables: { lottery_campaigns: [{ ...campaign, min_total_belanja_idr: minimum }] } });
    const r = await b.request('lotteryEligibleParticipants', { campaign_id: C });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.total_peserta, expected);
    assert.equal(r.body.data.total_transaksi, 2); // excludes other branch and after end
    if (expected) {
      assert.equal(r.body.data.participants[0].total_belanja_periode, 150.3);
      assert.equal(r.body.data.participants[0].jumlah_transaksi_periode, 2);
    }
    assert.ok(b.calls.filter(c => c.table === 'trx_penjualan').every(c => c.q.get('select').includes('harga_akhir::text')));
  });
}
test('zero default still requires a purchase; zero-value purchase eligible, lifetime totals ignored', async () => {
  const customers = [
    { id: U, nomor_wa: '6281', nama: 'Zero', tipe_customer: 'Umum', cabang_id: 'KARLA', total_belanja: 900000 },
    { id: P, nomor_wa: '6282', nama: 'None', tipe_customer: 'Umum', cabang_id: 'KARLA', total_belanja: 900000 }
  ];
  const purchases = [{ no_nota: 'zero', nomor_wa: '6281', tanggal: '2026-09-01', cabang_id: 'KARLA', harga_akhir: 0 }];
  for (const c of [campaign, { ...campaign, min_total_belanja_idr: 0 }]) {
    const b = backend({ tables: { lottery_campaigns: [c], master_customer: customers, trx_penjualan: purchases } });
    const r = await b.request('lotteryEligibleParticipants', { campaign_id: C });
    assert.equal(r.body.data.total_peserta, 1);
    assert.equal(r.body.data.participants[0].customer_id, U);
  }
});
test('decimal sums compare authoritative unrounded amounts, no invoice rounding or float boundary drift', async () => {
  const fixture = amount => ({ no_nota: amount, cabang_id: 'KARLA', tanggal: '2026-09-30', nomor_wa: '6281', harga_akhir: amount });
  for (const [amounts, minimum, expected] of [
    [['0.10','0.20'], '0.30', 1], [['149.994','150.005'], '300.00', 0],
    [['149.996','150.004'], '300.00', 1], [['0.004','0.006'], '0.01', 1],
    [['999999999999.98','0.009'], '999999999999.99', 0],
    [['999999999999.98','0.01'], '999999999999.99', 1]
  ]) {
    const b = backend({ tables: { lottery_campaigns: [{ ...campaign, min_total_belanja_idr: minimum }], trx_penjualan: amounts.map(fixture) } });
    const r = await b.request('lotteryEligibleParticipants', { campaign_id: C });
    assert.equal(r.status, 200); assert.equal(r.body.data.total_peserta, expected, amounts.join('+'));
  }
});
test('missing/non-finite transaction amount fails closed instead of qualifying', async () => {
  for (const amount of [null, '', 'NaN', 'Infinity', true]) {
    const b = backend({ tables: { trx_penjualan: [{ no_nota: 'bad', cabang_id: 'KARLA', tanggal: '2026-09-30', nomor_wa: '6281', harga_akhir: amount }] } });
    assert.equal((await b.request('lotteryEligibleParticipants', { campaign_id: C })).status, 422);
  }
});
test('report excludes subthreshold revenue/HPP but preserves historical winners and all prize costs', async () => {
  const eligible = { no_nota: 'eligible', cabang_id: 'KARLA', tanggal: '2026-09-30', nomor_wa: '6282', harga_akhir: 300000, total_hpp: 200000 };
  const b = backend({ tables: {
    lottery_campaigns: [{ ...campaign, min_total_belanja_idr: 300000 }],
    master_customer: [
      { id: U, nomor_wa: '6281', nama: 'Below', tipe_customer: 'Umum', cabang_id: 'KARLA' },
      { id: P, nomor_wa: '6282', nama: 'Meets', tipe_customer: 'Umum', cabang_id: 'KARLA' }
    ],
    trx_penjualan: [{ ...eligible, no_nota: 'below', nomor_wa: '6281', harga_akhir: 299999.99, total_hpp: 123 }, eligible]
  } });
  const r = await b.request('lotteryReport', { campaign_id: C });
  const x = r.body.data.ringkasan;
  assert.equal(x.total_peserta_eligible, 1); assert.equal(x.total_transaksi_peserta, 1);
  assert.equal(x.total_revenue_idr, 300000); assert.equal(x.total_hpp_idr, 200000); assert.equal(x.total_profit_idr, 100000);
  assert.equal(x.total_pemenang, 1); assert.equal(x.total_biaya_hadiah_idr, 25);
  assert.match(r.body.data.basis, /minimum.*saat ini/); assert.match(r.body.data.basis, /pemenang historis/);
  const none = await backend({ tables: { lottery_campaigns: [{ ...campaign, min_total_belanja_idr: 300000 }] } }).request('lotteryReport', { campaign_id: C });
  assert.equal(none.body.data.ringkasan.total_revenue_idr, 0);
  assert.equal(none.body.data.ringkasan.total_pemenang, 1);
});
test('campaign minimum validates before RPC, accepts 2 decimals and preserves omission on legacy edits', async () => {
  const malformed = [-1, '-0.01', null, '', ' ', true, false, [], {}, 'NaN', 'Infinity', '-Infinity', '300.001', 0.001, '300,000', '300\n', '0x10', '1e3', 1000000000000];
  for (const value of malformed) {
    const b = backend();
    const r = await b.request('lotterySave', { ...campaign, min_total_belanja_idr: value, prizes: [] });
    assert.equal(r.status, 400, JSON.stringify(value));
    assert.equal(b.calls.filter(c => c.table === 'lottery_save_campaign').length, 0);
  }
  for (const value of [0, 300000, 300000.25, '300000.00', '999999999999.99']) {
    const b = backend();
    assert.equal((await b.request('lotterySave', { ...campaign, min_total_belanja_idr: value, prizes: [] })).status, 200);
    const payload = JSON.parse(b.calls.find(c => c.table === 'lottery_save_campaign').init.body).p_data;
    assert.equal(payload.min_total_belanja_idr, value);
  }
  const b = backend(); await b.request('lotterySave', { ...campaign, prizes: [] });
  assert.equal(Object.hasOwn(JSON.parse(b.calls.find(c => c.table === 'lottery_save_campaign').init.body).p_data, 'min_total_belanja_idr'), false);
});
test('campaign GET/list return configured minimum and winner save surfaces authoritative RPC rejection', async () => {
  const b = backend({ tables: { lottery_campaigns: [{ ...campaign, min_total_belanja_idr: '300000.25' }] }, rpcError: 'Total belanja pelanggan selama campaign belum memenuhi minimum' });
  assert.equal((await b.request('lotteryGet', { id: C })).body.data.campaign.min_total_belanja_idr, '300000.25');
  assert.equal((await b.request('lotteryList')).body.data[0].min_total_belanja_idr, '300000.25');
  const r = await b.request('lotteryWinnerSave', { campaign_id: C, customer_id: U, prize_id: P, coupon_expired_at: '2026-10-31', total_belanja_periode: 999999, min_total_belanja_idr: 0 });
  assert.equal(r.status, 400); assert.match(r.body.error, /belum memenuhi minimum/);
  assert.ok(b.calls.some(c => c.table === 'lottery_record_winner'));
});
test('UI uses explicit cumulative spending field, edit preserves value, new defaults 0, displays actual spend', async () => {
  const f = frontend({ campaign: { min_total_belanja_idr: '300000.25' } });
  f.t.openDetail(C, true); await flush();
  assert.match(f.t.renderForm(), /id="lot-f-min-belanja"[^>]*step="0.01"[^>]*value="300000.25"/);
  assert.match(f.t.renderForm(), /Minimum total belanja selama campaign/);
  const fields = { 'lot-f-cabang': 'KARLA', 'lot-f-nama': 'Campaign', 'lot-f-mulai': '2026-09-01', 'lot-f-selesai': '2026-09-30', 'lot-f-catatan': '', 'lot-f-min-belanja': '300000.25', 'lot-f-min-trx': '1', 'lot-f-min-per-trx': '0' };
  for (const [id, value] of Object.entries(fields)) f.el(id).value = value;
  assert.equal(f.t.readForm().min_total_belanja_idr, '300000.25');
  f.el('lot-save'); f.t.saveForm(); await flush();
  assert.equal(f.requests.find(r => r.fn === 'lotterySave').args[0].min_total_belanja_idr, '300000.25');
  assert.match(f.t.renderForm(), /id="lot-f-min-belanja"[^>]*value="0"/);
  assert.match(f.t.minimumHtml({ min_total_belanja_idr: 300000 }), /300.000/);
  assert.match(f.t.tableParticipants([{ nama: 'Ani', total_belanja_periode: 350000 }]), /350.000/);
  const input = f.el('customer'); input.parentNode = f.el('parent');
  f.t.showCustSuggest(input, [{ nama: 'Ani', nomor_wa: '6281', total_belanja_periode: 350000 }]);
  const opt = f.elements['lot-w-suggest'].children[0]; assert.match(opt.textContent, /350.000/);
  opt.onclick(); assert.match(input.value, /350.000/);
});
test('UI rejects malformed/negative/excess precision threshold before sending save', () => {
  const f = frontend();
  for (const [id, value] of Object.entries({ 'lot-f-cabang': 'KARLA', 'lot-f-nama': 'Campaign', 'lot-f-mulai': '2026-09-01', 'lot-f-selesai': '2026-09-30', 'lot-f-catatan': '', 'lot-f-min-trx': '1', 'lot-f-min-per-trx': '0' })) f.el(id).value = value;
  f.el('lot-save');
  for (const v of ['', '-1', '0.001', 'NaN', 'Infinity', '1000000000000', '1e3', '300,000', '300\n']) {
    f.el('lot-f-min-belanja').value = v; f.t.saveForm();
  }
  assert.equal(f.requests.length, 0);
});
test('minimum migration static contracts: additive default, same private RPC signatures, locked DB SUM and history', () => {
  const sql = source('supabase/migrations/20260927020000_lottery_min_total_belanja.sql');
  assert.match(sql, /add column min_total_belanja_idr numeric\(14,2\) not null default 0/);
  assert.match(sql, /check \(min_total_belanja_idr >= 0 and min_total_belanja_idr <= 999999999999.99\)/);
  assert.match(sql, /min_total_belanja_idr = coalesce\(minimum, c.min_total_belanja_idr\)/);
  assert.match(sql, /count\(\*\), count\(t.harga_akhir\), sum\(t.harga_akhir\)/);
  assert.match(sql, /purchase_count = 0/); assert.match(sql, /purchase_total < c.min_total_belanja_idr/);
  assert.match(sql, /where id = cid for update/);
  assert.match(sql, /t.cabang_id = c.kode_cabang/);
  assert.match(sql, /t.tanggal >= c.periode_mulai and t.tanggal <= c.periode_selesai/);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(sql, /update public.lottery_winners/i);
  for (const fn of ['lottery_save_campaign', 'lottery_record_winner']) {
    assert.match(sql, new RegExp(`create or replace function public.${fn}\\(p_token text, p_data jsonb\\)`));
    assert.match(sql, new RegExp(`revoke all on function public.${fn}[^;]+from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant execute on function public.${fn}[^;]+to service_role`));
  }
  assert.equal((sql.match(/security invoker set search_path = public, pg_temp/g) || []).length, 2);
});

// ---- Syarat transaksi Kupon Undian: jumlah transaksi minimum + minimal belanja per transaksi ----
// Fixture default: pelanggan 6281 punya 2 transaksi dalam periode (100.10 dan 50.20).
const rule = (extra) => ({ tables: { lottery_campaigns: [{ ...campaign, ...extra }] } });
for (const [label, extra, expected, count, spend] of [
  ['default (1 transaksi, tanpa batas per transaksi)', {}, 1, 2, 150.3],
  ['kolom belum ada (migrasi belum diterapkan) = perilaku lama', { min_jumlah_transaksi: undefined, min_belanja_per_transaksi_idr: undefined }, 1, 2, 150.3],
  ['minimal 2 transaksi terpenuhi tepat di batas', { min_jumlah_transaksi: 2 }, 1, 2, 150.3],
  ['minimal 3 transaksi tidak terpenuhi', { min_jumlah_transaksi: 3 }, 0],
  ['per transaksi 60: hanya 1 transaksi dihitung, minimal 1 lolos', { min_belanja_per_transaksi_idr: '60' }, 1, 1, 100.1],
  ['per transaksi 60 + minimal 2 transaksi: tidak lolos', { min_belanja_per_transaksi_idr: '60', min_jumlah_transaksi: 2 }, 0],
  ['per transaksi tepat 50.20 dihitung (batas inklusif), 2 lolos', { min_belanja_per_transaksi_idr: '50.20', min_jumlah_transaksi: 2 }, 1, 2, 150.3],
  ['per transaksi 50.21: transaksi 50.20 tidak dihitung', { min_belanja_per_transaksi_idr: '50.21', min_jumlah_transaksi: 2 }, 0],
  ['per transaksi di atas semua transaksi: tidak ada yang dihitung', { min_belanja_per_transaksi_idr: '200' }, 0],
  ['total belanja hanya dari transaksi yang dihitung', { min_belanja_per_transaksi_idr: '60', min_total_belanja_idr: '120' }, 0],
  ['total belanja dari transaksi yang dihitung terpenuhi', { min_belanja_per_transaksi_idr: '60', min_total_belanja_idr: '100.10' }, 1, 1, 100.1],
]) {
  test(`syarat transaksi undian: ${label}`, async () => {
    const b = backend(rule(extra));
    const r = await b.request('lotteryEligibleParticipants', { campaign_id: C });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.total_peserta, expected);
    assert.equal(r.body.data.total_transaksi, 2); // total_transaksi tetap semua transaksi periode/cabang
    if (expected) {
      assert.equal(r.body.data.participants[0].jumlah_transaksi_periode, count);
      assert.equal(r.body.data.participants[0].total_belanja_periode, spend);
    }
  });
}
test('syarat transaksi undian: transaksi tanpa nilai tetap gagal tertutup walau di bawah batas per transaksi', async () => {
  const b = backend({ tables: { lottery_campaigns: [{ ...campaign, min_belanja_per_transaksi_idr: '60' }],
    trx_penjualan: [{ no_nota: '1', cabang_id: 'KARLA', tanggal: '2026-09-01', nomor_wa: '6281', harga_akhir: null }] } });
  const r = await b.request('lotteryEligibleParticipants', { campaign_id: C });
  assert.equal(r.status, 422);
});
test('syarat transaksi undian: validasi sebelum RPC, kunci yang tidak dikirim tidak dikirim ke RPC', async () => {
  for (const [field, values] of [
    ['min_jumlah_transaksi', [0, '0', -1, 1001, '1.5', 1.5, '', ' 3', '3 ', 'abc', null, true, [], {}, '1e2', '00000', '10000']],
    ['min_belanja_per_transaksi_idr', [-1, '-0.01', '', ' ', null, true, [], {}, 'NaN', '1e3', '25000.001', '25,000', '25000\n', 1000000000000]],
  ]) {
    for (const value of values) {
      const b = backend();
      const r = await b.request('lotterySave', { ...campaign, [field]: value, prizes: [] });
      assert.equal(r.status, 400, `${field}=${JSON.stringify(value)}`);
      assert.equal(b.calls.filter(c => c.table === 'lottery_save_campaign').length, 0);
    }
  }
  for (const [field, values] of [['min_jumlah_transaksi', [1, '10', 1000]], ['min_belanja_per_transaksi_idr', [0, 25000, '25000.50', '999999999999.99']]]) {
    for (const value of values) {
      const b = backend();
      assert.equal((await b.request('lotterySave', { ...campaign, [field]: value, prizes: [] })).status, 200, `${field}=${value}`);
      assert.equal(JSON.parse(b.calls.find(c => c.table === 'lottery_save_campaign').init.body).p_data[field], value);
    }
  }
  const b = backend(); await b.request('lotterySave', { ...campaign, prizes: [] });
  const sent = JSON.parse(b.calls.find(c => c.table === 'lottery_save_campaign').init.body).p_data;
  assert.equal(Object.hasOwn(sent, 'min_jumlah_transaksi'), false); assert.equal(Object.hasOwn(sent, 'min_belanja_per_transaksi_idr'), false);
  assert.equal(b.calls.filter(c => c.table === 'lottery_campaigns' && (c.q.get('select') || '').includes('min_jumlah_transaksi')).length, 0, 'tanpa field baru tidak perlu probe kolom');
});
test('syarat transaksi undian: migrasi belum diterapkan -> error jelas, RPC tidak dipanggil', async () => {
  const b = backend({ noRuleColumns: true });
  const r = await b.request('lotterySave', { ...campaign, min_jumlah_transaksi: 10, prizes: [] });
  assert.equal(r.status, 409); assert.match(r.body.error, /migrasi database belum diterapkan/);
  assert.equal(b.calls.filter(c => c.table === 'lottery_save_campaign').length, 0);
});
test('syarat transaksi undian: GET/list mengembalikan nilai tersimpan', async () => {
  const b = backend(rule({ min_jumlah_transaksi: 10, min_belanja_per_transaksi_idr: '25000.00' }));
  assert.equal((await b.request('lotteryGet', { id: C })).body.data.campaign.min_jumlah_transaksi, 10);
  assert.equal((await b.request('lotteryList')).body.data[0].min_belanja_per_transaksi_idr, '25000.00');
});
test('UI syarat transaksi: form menampilkan, mengirim, dan menolak nilai salah sebelum kirim', async () => {
  const f = frontend({ campaign: { min_jumlah_transaksi: 10, min_belanja_per_transaksi_idr: '25000' } });
  f.t.openDetail(C, true); await flush();
  assert.match(f.t.renderForm(), /id="lot-f-min-trx"[^>]*min="1"[^>]*step="1"[^>]*value="10"/);
  assert.match(f.t.renderForm(), /id="lot-f-min-per-trx"[^>]*step="0.01"[^>]*value="25000"/);
  assert.match(f.t.renderForm(), /Minimal jumlah transaksi/); assert.match(f.t.renderForm(), /Minimal belanja per transaksi/);
  const base = { 'lot-f-cabang': 'KARLA', 'lot-f-nama': 'Campaign', 'lot-f-mulai': '2026-09-01', 'lot-f-selesai': '2026-09-30', 'lot-f-catatan': '', 'lot-f-min-belanja': '0' };
  for (const [id, value] of Object.entries(base)) f.el(id).value = value;
  f.el('lot-save');
  for (const bad of ['', '0', '1001', '1.5', '-3', 'abc', '3\n']) { f.el('lot-f-min-trx').value = bad; f.el('lot-f-min-per-trx').value = '0'; f.t.saveForm(); }
  for (const bad of ['', '-1', '0.001', 'NaN', '25,000', '1e3']) { f.el('lot-f-min-trx').value = '10'; f.el('lot-f-min-per-trx').value = bad; f.t.saveForm(); }
  assert.equal(f.requests.filter(r => r.fn === 'lotterySave').length, 0);
  f.el('lot-f-min-trx').value = '10'; f.el('lot-f-min-per-trx').value = '25000';
  const sent = f.t.readForm(); assert.equal(sent.min_jumlah_transaksi, '10'); assert.equal(sent.min_belanja_per_transaksi_idr, '25000');
  f.t.saveForm(); await flush();
  const saved = f.requests.find(r => r.fn === 'lotterySave').args[0];
  assert.equal(saved.min_jumlah_transaksi, '10'); assert.equal(saved.min_belanja_per_transaksi_idr, '25000');
  assert.match(f.t.minimumHtml({ min_jumlah_transaksi: 10, min_belanja_per_transaksi_idr: 25000 }), /minimal <b>10<\/b> transaksi[\s\S]*25.000/);
  assert.match(f.t.minimumHtml({}), /minimal <b>1<\/b> transaksi/);
  f.t.clearCampaign(); assert.match(f.t.renderForm(), /id="lot-f-min-trx"[^>]*value="1"/); assert.match(f.t.renderForm(), /id="lot-f-min-per-trx"[^>]*value="0"/);
});
test('migrasi syarat transaksi: aditif, default perilaku lama, RPC privat, hitung transaksi yang memenuhi batas', () => {
  const sql = source('supabase/migrations/20260929010000_lottery_min_transaksi.sql');
  assert.match(sql, /begin;[\s\S]*commit;/i);
  assert.match(sql, /add column min_jumlah_transaksi integer not null default 1/);
  assert.match(sql, /add column min_belanja_per_transaksi_idr numeric\(14,2\) not null default 0/);
  assert.match(sql, /check \(min_jumlah_transaksi >= 1 and min_jumlah_transaksi <= 1000\)/);
  assert.match(sql, /check \(min_belanja_per_transaksi_idr >= 0 and min_belanja_per_transaksi_idr <= 999999999999.99\)/);
  assert.match(sql, /min_jumlah_transaksi = coalesce\(min_trx, c.min_jumlah_transaksi\)/);
  assert.match(sql, /min_belanja_per_transaksi_idr = coalesce\(min_per, c.min_belanja_per_transaksi_idr\)/);
  assert.match(sql, /t.harga_akhir >= c.min_belanja_per_transaksi_idr/);
  assert.match(sql, /qualifying_count < greatest\(c.min_jumlah_transaksi, 1\)/);
  assert.match(sql, /coalesce\(qualifying_total, 0\) < c.min_total_belanja_idr/);
  assert.match(sql, /purchase_count = 0/); assert.match(sql, /valid_amount_count <> purchase_count/);
  assert.match(sql, /where id = cid for update/); assert.match(sql, /t.cabang_id = c.kode_cabang/);
  assert.match(sql, /t.tanggal >= c.periode_mulai and t.tanggal <= c.periode_selesai/);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(sql, /update public.lottery_winners/i);
  for (const fn of ['lottery_save_campaign', 'lottery_record_winner']) {
    assert.match(sql, new RegExp(`create or replace function public.${fn}\\(p_token text, p_data jsonb\\)`));
    assert.match(sql, new RegExp(`revoke all on function public.${fn}[^;]+from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant execute on function public.${fn}[^;]+to service_role`));
  }
  assert.equal((sql.match(/security invoker set search_path = public, pg_temp/g) || []).length, 2);
});
