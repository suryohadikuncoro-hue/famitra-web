#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'public/js_trx.js'), 'utf8');
const masterJs = fs.readFileSync(path.join(root, 'public/js_master.js'), 'utf8');
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
  extractFunction('marginPersenBeli'),
  extractFunction('markupInputBeliKePersen'),
  extractFunction('markupPersenBeliKeInput'),
  extractFunction('hargaDariMarkupJS'),
  extractFunction('terapkanMarkupBaris'),
  extractFunction('terapkanMarkupSemuaBaris'),
  extractFunction('kunciHargaFakturBeli'),
  extractFunction('lepasKunciMarkupBeli')
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
assert.equal(context.hargaModalEfektifBeli(item), 999, 'modal cost includes PPN and applies the discount percentage');
assert.equal(Math.round(context.marginPersenBeli(item.Harga_Jual_Umum_Baru, context.hargaModalEfektifBeli(item)) * 10) / 10, 33.4, 'margin uses the discounted effective cost including PPN');
assert.equal(context.hargaModalEfektifBeli({ ...item, Diskon: 0 }), 1110, 'zero discount keeps PPN in the effective modal');
assert.equal(context.hargaModalEfektifBeli({ ...item, Diskon: 100 }), 0, 'full discount cannot produce a negative modal');
assert.equal(context.marginPersenBeli(item.Harga_Jual_Umum_Baru, context.hargaModalEfektifBeli({ ...item, PPN: -100 })), null, 'invalid tax rate does not produce a misleading margin');
const ratio = context.markupInputBeliKePersen('2.5', 'rasio');
assert.equal(ratio.valid, true, 'ratio 2.5 is accepted');
assert.equal(ratio.persen, 150, 'ratio 2.5 maps to the canonical 150 percent');
assert.equal(context.markupPersenBeliKeInput(150, 'rasio'), 2.5, 'saved 150 percent reloads as ratio 2.5');
assert.equal(context.markupInputBeliKePersen('11', 'rasio').persen, 1000, 'ratio 11 is the upper limit');
assert.equal(context.markupInputBeliKePersen('12', 'rasio').valid, false, 'ratio above 11 is rejected');
assert.equal(context.markupInputBeliKePersen('1001', 'persen').valid, false, 'percent above 1000 is rejected');
assert.equal(context.hargaDariMarkupJS(999, ratio.persen, 100), 2500, 'ratio markup uses canonical percent and required rounding');
assert.equal(context.hargaDariMarkupJS(999, 1001, 0), null, 'markup formula rejects a percent above the allowed range');
context.BELI = { editNoFaktur: null, markup: { tersedia: true, valid: true, umum: null, nakes: null, mutasi: null, pembulatan: 0 } };
const pricedItem = { Harga_Netto: 1000, Qty: 1, PPN: 0, Diskon: 0, Harga_Jual_Umum_Baru: 1500, _manual: {}, _markupOtomatis: {} };
context.terapkanMarkupBaris(pricedItem);
assert.equal(pricedItem.Harga_Jual_Umum_Baru, 1500, 'inactive markup does not clear the current master price');
context.BELI.markup.umum = 150;
context.terapkanMarkupBaris(pricedItem);
assert.equal(pricedItem.Harga_Jual_Umum_Baru, 2500, 'active markup populates an automatic price');
const existingRows = [
  { Harga_Netto: 1000, Qty: 1, PPN: 0, Diskon: 0, Harga_Jual_Umum_Baru: 0, _manual: {}, _markupOtomatis: {} },
  { Harga_Netto: 2000, Qty: 1, PPN: 0, Diskon: 0, Harga_Jual_Umum_Baru: 4321, _manual: { Harga_Jual_Umum_Baru: true }, _markupOtomatis: {} }
];
context.BELI.items = existingRows;
context.BELI.markup.umum = 100;
context.terapkanMarkupSemuaBaris();
assert.equal(existingRows[0].Harga_Jual_Umum_Baru, 2000, 'markup changes recalculate existing automatic rows');
assert.equal(existingRows[1].Harga_Jual_Umum_Baru, 4321, 'bulk recalculation preserves manual prices');
context.BELI.markup.umum = null;
context.terapkanMarkupBaris(pricedItem);
assert.equal(pricedItem.Harga_Jual_Umum_Baru, 0, 'disabling markup clears only its previously automatic price');
const manualItem = { ...pricedItem, Harga_Jual_Umum_Baru: 1234, _manual: { Harga_Jual_Umum_Baru: true }, _markupOtomatis: {} };
context.BELI.markup.umum = 150;
context.terapkanMarkupBaris(manualItem);
assert.equal(manualItem.Harga_Jual_Umum_Baru, 1234, 'manual sale price is never overwritten');

// Mode ubah faktur: pengaman lama tidak boleh lagi mematikan perhitungan markup,
// dan harga yang tercatat di faktur lama tidak boleh dihitung ulang saat dimuat.
const pengamanMarkup = extractFunction('terapkanMarkupBaris');
assert.match(pengamanMarkup, /if \(!BELI\.markup\.tersedia\) return;/, 'markup only stops when the settings are unavailable');
assert.doesNotMatch(pengamanMarkup, /editNoFaktur/, 'edit mode no longer disables markup recalculation');
assert.match(js, /kunciHargaFakturBeli\(BELI\.items\)[\s\S]*gambarBeli\(\)/, 'loading an old invoice locks the recorded prices before rendering');
const fakturLama = {
  Harga_Netto: 1000, Qty: 10, PPN: 10, Diskon: 0,
  Harga_Jual_Umum_Baru: 2000, Harga_Khusus_Baru: 1800, Harga_Jual_Mutasi_Baru: 1600,
  _manual: {}, _markupOtomatis: {}, _tercatat: {}
};
context.BELI = { editNoFaktur: 'PB-1', items: [fakturLama], markup: { tersedia: true, valid: true, umum: 100, nakes: 30, mutasi: 20, pembulatan: 100 } };
context.kunciHargaFakturBeli(context.BELI.items);
context.terapkanMarkupSemuaBaris();
assert.equal(fakturLama.Harga_Jual_Umum_Baru, 2000, 'opening an old invoice keeps the recorded umum price');
assert.equal(fakturLama.Harga_Khusus_Baru, 1800, 'opening an old invoice keeps the recorded nakes price');
assert.equal(fakturLama.Harga_Jual_Mutasi_Baru, 1600, 'opening an old invoice keeps the recorded mutation price');
context.lepasKunciMarkupBeli('umum');
context.terapkanMarkupSemuaBaris();
assert.equal(fakturLama.Harga_Jual_Umum_Baru, 2200, 'changing the umum markup recalculates umum in edit mode');
assert.equal(fakturLama.Harga_Khusus_Baru, 1800, 'changing umum markup leaves nakes untouched');
assert.equal(fakturLama.Harga_Jual_Mutasi_Baru, 1600, 'changing umum markup leaves mutation untouched');
assert.equal(Math.round(context.marginPersenBeli(fakturLama.Harga_Jual_Umum_Baru, context.hargaModalEfektifBeli(fakturLama)) * 10) / 10, 50, 'margin follows the recalculated price realtime');
context.lepasKunciMarkupBeli('nakes');
context.terapkanMarkupSemuaBaris();
assert.equal(fakturLama.Harga_Jual_Umum_Baru, 2200, 'nakes change does not reset the already recalculated umum price');

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.purchase_effective_unit_cost/i, 'SQL shares a single effective-cost function');
assert.match(migration, /purchase_validate_items\(p_items\)/i, 'purchase RPC wrappers validate incoming line values');
assert.match(migration, /purchase_validate_category\(p_kategori, p_items\)/i, 'purchase RPC wrappers validate category and tax consistency');
assert.match(migration, /Kategori Tidak Berpajak harus menggunakan PPN 0 persen/i, 'untaxed purchases cannot carry non-zero tax');
assert.match(migration, /v_ppn < 0 OR v_ppn > 100/i, 'backend rejects invalid tax rates');
assert.match(migration, /v_diskon < 0 OR v_diskon > 100/i, 'backend rejects negative or above-100-percent discounts');
assert.match(migration, /purchase_payment_save/i, 'migration provides an atomic payment RPC');
assert.match(migration, /FOR UPDATE/i, 'payment RPC locks its invoice before checking balance');
assert.match(migration, /sum\(p\.jumlah_bayar\)/i, 'payment RPC checks the current active paid amount');
assert.match(migration, /purchase_assert_no_shared_batches/i, 'edit/cancel paths reject ambiguous shared purchase batches');
assert.match(migration, /UPDATE public\.stok_batch[\s\S]*harga_modal_batch = latest_batch\.modal/i, 'migration backfills batch modal only');
assert.match(migration, /UPDATE public\.master_barang[\s\S]*harga_modal = latest_product\.modal/i, 'migration backfills master modal only');
assert.match(migration, /ADD COLUMN IF NOT EXISTS harga_modal_terakhir numeric/i, 'master keeps the last effective modal for audit');
assert.match(migration, /ADD COLUMN IF NOT EXISTS harga_modal_batch_terakhir numeric/i, 'batch keeps the last effective modal for audit');
assert.match(migration, /harga_modal_terakhir = coalesce\(m\.harga_modal_terakhir, m\.harga_modal\)[\s\S]*harga_modal = NULL/i, 'stale master modal becomes NULL while preserving the last value');
assert.match(migration, /harga_modal_batch_terakhir = coalesce\(s\.harga_modal_batch_terakhir, s\.harga_modal_batch\)[\s\S]*harga_modal_batch = NULL/i, 'stale batch modal becomes NULL while preserving the last value');
assert.match(api, /Harga_Modal_Batch: x\.harga_modal_batch == null \? null/i, 'dashboard preserves NULL batch modal');
assert.match(api, /expiring_nilai: expiringWithoutModal \? null/i, 'dashboard does not value stock with unknown modal as zero');
assert.match(masterJs, /b\.Harga_Modal == null \? '—'/i, 'master UI displays unknown modal explicitly');
assert.match(api, /const margin = \(jual, modal\) => jual == null \|\| modal == null/i, 'stock API leaves margin unknown when sale price or batch modal is unknown');
assert.match(api, /Harga_Jual_Umum: m\.harga_jual_umum/i, 'stock API returns SKU sale prices');
assert.match(api, /Margin_Umum: margin\(m\.harga_jual_umum, modal\)/i, 'stock API returns margin against effective batch modal');

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
