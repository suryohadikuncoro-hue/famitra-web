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
  assert.match(api, /const pageInfo = \(rows, total, pageCount, unit\) => \(\{ rows, total, limit, offset, page_count: pageCount, pagination_unit: unit, has_more: offset \+ pageCount < total, next_offset: offset \+ pageCount \}\)/);
  assert.match(api, /content-range/);
  assert.match(api, /limit=\$\{limit\}&offset=\$\{offset\}/);
});

test('stok.list preserves unknown modal and no-batch semantics', () => {
  assert.match(api, /Harga_Modal_Batch: null, \.\.\.harga\(m, null\), ID_Batch: null, Belum_Ada_Batch: true/);
  assert.match(api, /Harga_Modal_Batch: b\.harga_modal_batch/);
  assert.match(api, /batches\.length \? batches\.map\(\(b\) => rowBatch\(m, b\)\) : kritis \? \[\] : \[rowTanpaBatch\(m\)\]/);
});
