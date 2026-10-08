#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'public/js_trx.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'supabase/functions/api/index.ts'), 'utf8');
const hutang = fs.readFileSync(path.join(root, 'supabase/functions/hutang/index.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261009130000_pembelian_diskon_hutang_atomik.sql'), 'utf8');

function extractFunction(name) {
  const start = js.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `frontend function ${name} exists`);
  const end = js.indexOf('\n}', start);
  assert.notEqual(end, -1, `frontend function ${name} has a closing brace`);
  return js.slice(start, end + 2);
}

const context = vm.createContext({ Number, Math });
const polaCariSource = api.match(/var polaCari = \(nilai\) => \{[\s\S]*?\n\};/);
assert.ok(polaCariSource, 'shared PostgREST search-pattern helper exists');
const searchContext = vm.createContext({ encodeURIComponent });
vm.runInContext(polaCariSource[0], searchContext);
assert.equal(searchContext.polaCari('paracetamol'), '%22%25paracetamol%25%22', 'medicine names become partial ILIKE terms');
assert.equal(searchContext.polaCari('MOL-0,75'), '%22%25MOL-0%2C75%25%22', 'comma in a medicine code is safely escaped for PostgREST OR filters');
vm.runInContext([
  'function brutoBaris(it) { return (Number(it.Harga_Netto) || 0) * (Number(it.Qty) || 0) * (1 + (Number(it.PPN) || 0) / 100); }',
  extractFunction('diskonRupiahBaris'),
  extractFunction('hargaModalEfektifBeli'),
  extractFunction('labaPersenBeli')
].join('\n'), context);

const item = {
  Harga_Netto: 1000,
  Qty: 10,
  PPN: 11,
  Diskon: 10,
  Harga_Jual_Umum_Baru: 1500,
  Jual_Umum_Kini: 0
};
assert.equal(context.diskonRupiahBaris(item), 1110, '10% discount is applied to gross including PPN');
assert.equal(context.hargaModalEfektifBeli(item), 900, 'modal cost excludes PPN and includes the discount');
assert.equal(context.labaPersenBeli(item), 40, 'margin uses the discounted effective cost');
assert.equal(context.hargaModalEfektifBeli({ ...item, Diskon: 0 }), 1000, 'zero discount keeps the netto cost');
assert.equal(context.hargaModalEfektifBeli({ ...item, Diskon: 100 }), 0, 'full discount cannot produce a negative modal');
assert.equal(context.labaPersenBeli({ ...item, PPN: -100 }), null, 'invalid tax rate does not produce a misleading margin');

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.purchase_effective_unit_cost/i, 'SQL shares a single effective-cost function');
assert.match(migration, /purchase_validate_items\(p_items\)/i, 'purchase RPC wrappers validate incoming line values');
assert.match(migration, /v_ppn < 0 OR v_ppn > 100/i, 'backend rejects invalid tax rates');
assert.match(migration, /v_diskon < 0 OR v_diskon > v_bruto/i, 'backend rejects negative or over-gross discounts');
assert.match(migration, /purchase_payment_save/i, 'migration provides an atomic payment RPC');
assert.match(migration, /FOR UPDATE/i, 'payment RPC locks its invoice before checking balance');
assert.match(migration, /sum\(p\.jumlah_bayar\)/i, 'payment RPC checks the current active paid amount');
assert.match(migration, /purchase_assert_no_shared_batches/i, 'edit/cancel paths reject ambiguous shared purchase batches');
assert.match(migration, /UPDATE public\.stok_batch[\s\S]*harga_modal_batch = latest_batch\.modal/i, 'migration backfills batch modal only');
assert.match(migration, /UPDATE public\.master_barang[\s\S]*harga_modal = latest_product\.modal/i, 'migration backfills master modal only');

assert.match(api, /const headerFilters = cfg\.searchFields\.map\(\(field\) => `\$\{field\}\.ilike\.\$\{pattern\}`\)/, 'nota document search uses partial, escaped ILIKE');
assert.match(api, /detailSearchFields: \["nama_obat", "kode_obat"\]/, 'riwayat searches both medicine name and code');
assert.match(api, /retur\.jualList[\s\S]*nama_obat\.ilike\.\$\{pattern\}[\s\S]*kode_obat\.ilike\.\$\{pattern\}/, 'Retur Jual searches across medicine names and codes');
assert.match(api, /retur\.beliList[\s\S]*nama_obat\.ilike\.\$\{pattern\}[\s\S]*kode_obat\.ilike\.\$\{pattern\}/, 'Retur Beli searches across medicine names and codes');
assert.match(api, /retur\.beliList[\s\S]*status=eq\.AKTIF/, 'Retur Beli search does not return canceled purchase invoices');
assert.match(hutang, /session\.role !== "Owner" && session\.role !== "Apoteker"/, 'hutang endpoints authorize list and history actions');
assert.match(hutang, /apiHutang|purchase_payment_save/, 'payment writes use the atomic database RPC');
assert.match(hutang, /if \(!response\.ok\) throw new Error\(await response\.text\(\)\)/, 'payment query failures are not silently converted to zero');
assert.match(hutang, /no_faktur=in\.\(\$\{daftarIn\(chunk\)\}\)/, 'payment summaries are fetched in grouped batches, not one query per invoice');
assert.match(js, /apiHutang\('list', \{ q: q, limit: 50, offset: offset \}\)/, 'purchase history search is server-side and paginated');
assert.match(js, /request !== BELI\.riwayatRequest/, 'late history responses cannot overwrite newer search results');
assert.match(js, /api\('retur\.beliList', \{ q: q, faktur_only: true \}\)/, 'Retur Beli sends typed search to the backend');
assert.match(js, /request !== RETUR\.beli\.searchRequest/, 'late Retur Beli responses cannot replace newer search results');

console.log('PASS: local checks for discounted modal/margin math, safe partial search, Retur, pagination, and hutang safeguards.');
