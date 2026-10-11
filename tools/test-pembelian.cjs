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
  extractFunction('isiHargaJualDariMaster')
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
// Harga jual di form Pembelian mengikuti nilai Master Barang, bukan markup.
assert.doesNotMatch(js, /blMarkup|MarkupBeli|terapkanMarkup|hargaDariMarkupJS|harga\.pengaturan/i, 'purchase form does not use a markup panel or markup calculation');
const masterPrices = {};
context.isiHargaJualDariMaster(masterPrices, {
  Harga_Jual_Umum: 1500,
  Harga_Khusus: 1200,
  Harga_Jual_Mutasi: 1750
});
assert.equal(masterPrices.Harga_Jual_Umum_Baru, 1500, 'Umum copies Master Barang price');
assert.equal(masterPrices.Harga_Khusus_Baru, 1200, 'Nakes copies Master Barang special price');
assert.equal(masterPrices.Harga_Jual_Mutasi_Baru, 1750, 'Apotek lain copies Master Barang mutation price');
assert.equal(masterPrices.Jual_Umum_Kini, 1500, 'current Umum price is kept for margin display');
assert.equal(masterPrices.Jual_Khusus_Kini, 1200, 'current Nakes price is kept for margin display');
assert.equal(masterPrices.Jual_Mutasi_Kini, 1750, 'current Mutasi price is kept for margin display');
// Manual changes remain possible after the initial copy from Master Barang.
masterPrices.Harga_Jual_Umum_Baru = 1600;
masterPrices.Harga_Khusus_Baru = 1300;
masterPrices.Harga_Jual_Mutasi_Baru = 1800;
assert.equal(masterPrices.Harga_Jual_Umum_Baru, 1600, 'Umum can be edited manually');
assert.equal(masterPrices.Harga_Khusus_Baru, 1300, 'Nakes can be edited manually');
assert.equal(masterPrices.Harga_Jual_Mutasi_Baru, 1800, 'Mutasi can be edited manually');
assert.equal((js.match(/^\s+isiHargaJualDariMaster\(it, b\);/gm) || []).length, 2, 'autocomplete and exact-code lookup both load all three prices from master');
assert.match(js, /Harga_Jual_Umum_Baru: it\.Harga_Jual_Umum_Baru/, 'edited Umum price is sent with purchase save');
assert.match(js, /Harga_Khusus_Baru: it\.Harga_Khusus_Baru/, 'edited Nakes price is sent with purchase save');
assert.match(js, /Harga_Jual_Mutasi_Baru: it\.Harga_Jual_Mutasi_Baru/, 'edited Mutasi price is sent with purchase save');
assert.match(js, /BELI\.items = \(d\.items && d\.items\.length\) \? d\.items : \[barisKosong\(\)\]/, 'editing an existing invoice loads the original recorded prices');
assert.match(js, /Harga jual.*Terisi otomatis dari Master Barang/s, 'form explains that prices are prefilled and editable');
const saveFnStart = js.indexOf('function simpanPembelian(');
const saveFnEnd = js.indexOf('function konfirmasiTimpaHargaJual(', saveFnStart);
const saveFn = js.slice(saveFnStart, saveFnEnd);
assert.equal((saveFn.match(/konfirmasiTimpaHargaJual\\(isi\\)/g) || []).length, 2, 'normal save and negative-margin override both confirm changed selling prices');
assert.match(js, /it\\._hargaJualAwal = \\{/, 'editing an invoice snapshots its original three sale prices');
assert.match(js, /Konfirmasi perubahan harga jual/, 'changed sale prices show an explicit overwrite confirmation');


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

console.log('PASS: effective modal/margin math, master-derived editable prices, safe search, Retur, pagination, and hutang safeguards.');
