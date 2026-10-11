const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'supabase/functions/api/index.ts'), 'utf8');

function loadExpression(name, pattern, globals = {}) {
  const match = api.match(pattern);
  assert.ok(match, `${name} exists in the API source`);
  const context = vm.createContext({ Number, ...globals });
  vm.runInContext(`${match[0]}\nthis.loaded = ${name};`, context);
  return context.loaded;
}

function sourceFunction(name) {
  const start = api.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists in API source`);
  const end = api.indexOf('\n}', start);
  assert.notEqual(end, -1, `${name} has a closing brace`);
  return api.slice(start, end + 2);
}
function loadFunctions(names) {
  const context = vm.createContext({ Number, String, Math, Map, Set, encodeURIComponent });
  const functions = names.map((name) => sourceFunction(name)).join('\n');
  vm.runInContext(functions + '\nthis.loaded = {' + names.map((name) => `${name}: ${name}`).join(',') + '};', context);
  return context.loaded;
}

const margin = loadExpression('margin', /const margin = .*?;/);
const harga = loadExpression('harga', /const harga = \(m, modal\) => .*;/, { margin });
const stokList = api.slice(api.indexOf('if (name === "stok.list")'), api.indexOf('if (name === "stok.simpanBatch")'));

test('stok.list exposes the complete per-SKU pricing contract', () => {
  for (const field of [
    'Harga_Jual_Umum', 'Harga_Jual_Nakes', 'Harga_Jual_Mutasi',
    'Margin_Umum', 'Margin_Nakes', 'Margin_Mutasi'
  ]) assert.match(api, new RegExp(field));
  assert.match(api, /Harga_Modal_Batch: b\.harga_modal_batch, \.\.\.harga\(m, b\.harga_modal_batch\)/);
  assert.match(api, /Harga_Modal_Batch: null, \.\.\.harga\(m, null\)/);
});

test('margin uses sale price as denominator and handles unknown values safely', () => {
  assert.equal(margin(1500, 1000), 33.33333333333333);
  assert.equal(margin(1000, 1000), 0);
  assert.equal(margin(800, 1000), -25);
  assert.equal(margin(null, 1000), null);
  assert.equal(margin(1500, null), null);
  assert.equal(margin(0, 1000), null);
  assert.equal(margin(-10, 1000), null);
});

test('harga maps master SKU prices and calculates all three margins per batch', () => {
  const master = {
    harga_jual_umum: 1500,
    harga_khusus: 1200,
    harga_jual_mutasi: 1000
  };
  assert.deepEqual(JSON.parse(JSON.stringify(harga(master, 1000))), {
    Harga_Jual_Umum: 1500,
    Harga_Jual_Nakes: 1200,
    Harga_Jual_Mutasi: 1000,
    Margin_Umum: 33.33333333333333,
    Margin_Nakes: 16.666666666666664,
    Margin_Mutasi: 0
  });
  assert.equal(harga(master, null).Margin_Umum, null);
});

test('every stok.list database path requests sale prices from master_barang', () => {
  const queryLines = stokList.split('\n').filter((line) => line.includes('select=') && line.includes('master_barang'));
  assert.ok(queryLines.length >= 7, `expected all stok.list paths, found ${queryLines.length}`);
  for (const line of queryLines) {
    assert.match(line, /harga_jual_umum,harga_khusus,harga_jual_mutasi/);
    assert.match(line, /cabang_id=eq\.\$\{cab\}/);
  }
});

test('stok.list keeps pagination metadata and session-cabang filtering', () => {
  assert.match(api, /const cabang = cabangSesi\(s\)/);
  assert.match(api, /const pageInfo = async \(rows, total, pageCount, unit\) => \(\{[\s\S]*?rows: await rowsDenganSupplier\(rows\)/);
  assert.match(api, /content-range/);
  assert.match(api, /limit=\$\{limit\}&offset=\$\{offset\}/);
});

test('supplier hanya dibaca dari detail batch dan header faktur aktif di cabang sesi', () => {
  assert.match(stokList, /await semua\("trx_pembelian_detail",\s*`\?cabang_id=eq\.\$\{cab\}&kode_obat=in\.\(/);
  assert.match(stokList, /await semua\("trx_pembelian",\s*`\?cabang_id=eq\.\$\{cab\}&status=eq\.AKTIF&no_faktur=in\.\(/);
  assert.match(stokList, /const detailCocok = detailRows\.filter\(\(d\) => keys\.has\(stokKunciBatchSupplier\(d\.kode_obat, d\.kode_batch\)\)\)/);
  assert.match(api, /function stokSupplierDariRiwayat\(rows, detailRows, invoiceRows\)/);
});

test('supplier batch berasal dari faktur aktif dan nama duplikat hanya ditampilkan sekali', () => {
  const { stokSupplierDariRiwayat: mapSuppliers } = loadFunctions(['stokKunciBatchSupplier', 'stokSupplierDariRiwayat']);
  const rows = [
    { Kode_Obat: 'OB1', Kode_Batch: 'B-1', Belum_Ada_Batch: false },
    { Kode_Obat: 'OB1', Kode_Batch: 'B-2', Belum_Ada_Batch: false },
    { Kode_Obat: 'OB1', Kode_Batch: '', Belum_Ada_Batch: true }
  ];
  const details = [
    { no_faktur: 'FK1', kode_obat: 'OB1', kode_batch: 'B-1' },
    { no_faktur: 'FK2', kode_obat: 'OB1', kode_batch: 'B-1' },
    { no_faktur: 'FK3', kode_obat: 'OB1', kode_batch: 'B-1' },
    { no_faktur: 'FK4', kode_obat: 'OB1', kode_batch: 'B-2' },
    { no_faktur: 'FK1', kode_obat: 'OB2', kode_batch: 'B-1' }
  ];
  const headers = [
    { no_faktur: 'FK1', supplier: 'PT Alpha', status: 'AKTIF' },
    { no_faktur: 'FK2', supplier: 'PT Alpha', status: 'AKTIF' },
    { no_faktur: 'FK3', supplier: 'PT Bina', status: 'BATAL' },
    { no_faktur: 'FK4', supplier: 'CV Gamma', status: 'AKTIF' }
  ];
  const actual = mapSuppliers(rows, details, headers);
  assert.equal(actual[0].Supplier, 'PT Alpha', 'duplicate active supplier is deduplicated and cancelled invoice is ignored');
  assert.equal(actual[1].Supplier, 'CV Gamma');
  assert.equal(actual[2].Supplier, '');
});

test('pengurutan Margin terendah memakai margin terkecil dari tiga tipe, margin tak tersedia terakhir', () => {
  const { marginTerendahStok, urutkanStokMarginTerendah: sort } = loadFunctions(['marginTerendahStok', 'urutkanStokMarginTerendah']);
  const rows = [
    { Nama_Obat: 'Normal', Kode_Batch: 'B1', Margin_Umum: 30, Margin_Nakes: 20, Margin_Mutasi: 10 },
    { Nama_Obat: 'Negatif', Kode_Batch: 'B2', Margin_Umum: 5, Margin_Nakes: -4, Margin_Mutasi: 2 },
    { Nama_Obat: 'Unknown', Kode_Batch: 'B3', Margin_Umum: null, Margin_Nakes: null, Margin_Mutasi: null },
    { Nama_Obat: 'Risiko', Kode_Batch: 'B4', Margin_Umum: 4, Margin_Nakes: 9, Margin_Mutasi: 3 }
  ];
  assert.equal(marginTerendahStok(rows[0]), 10);
  assert.deepEqual(sort(rows).map(x => x.Nama_Obat), ['Negatif', 'Risiko', 'Normal', 'Unknown']);
  assert.deepEqual(rows.map(x => x.Nama_Obat), ['Normal', 'Negatif', 'Unknown', 'Risiko'], 'source array is not mutated');
});

test('stok.list mengurutkan Margin terendah global sebelum pagination dan menghormati filter', () => {
  assert.match(api, /"margin_asc"\]\.includes\(data\.sort\)/);
  assert.match(stokList, /if \(sort === "margin_asc"\)/);
  assert.match(stokList, /const batches = await semua\("stok_batch", query\)/);
  assert.match(stokList, /rows = urutkanStokMarginTerendah\(rows\)/);
  assert.match(stokList, /rows = masters\.flatMap\(fromMaster\)/, 'items without batches remain visible at the end when their margins are unavailable');
  assert.match(stokList, /const page = rows\.slice\(offset, offset \+ limit\)/);
  assert.match(stokList, /data\.sembunyikan_kosong/);
  assert.match(stokList, /data\.perlu_ditinjau/);
  assert.match(stokList, /data\.ambang_tinjau/);
});

test('stok.list preserves unknown modal and no-batch semantics', () => {
  assert.match(api, /Harga_Modal_Batch: null, \.\.\.harga\(m, null\), ID_Batch: null, Belum_Ada_Batch: true/);
  assert.match(api, /Harga_Modal_Batch: b\.harga_modal_batch/);
  assert.match(api, /batches\.length \? batches\.map\(\(b\) => rowBatch\(m, b\)\) : kritis \? \[\] : \[rowTanpaBatch\(m\)\]/);
});
