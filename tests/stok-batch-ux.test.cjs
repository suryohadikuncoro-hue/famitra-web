const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'public/js_master.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/style.css'), 'utf8');

test('Stok & Batch uses a responsive card-compatible table contract', () => {
  assert.match(js, /<table data-tk="1" data-stok-table="1">/);
  for (const label of ['Batch \/ status', 'Kedaluwarsa', 'Sisa waktu', 'Stok', 'Modal efektif', 'Harga jual SKU', 'Margin batch']) {
    assert.match(js, new RegExp('data-label="' + label + '"'));
  }
  assert.match(js, /class="c tk-aksi"/);
  assert.match(css, /table\[data-tk="1"\] thead\{display:none\}/);
  assert.match(css, /table\[data-tk="1"\] td::before\{content:attr\(data-label\)/);
});

test('pricing columns render compact named rows instead of dense text blocks', () => {
  assert.match(js, /function hargaStokCell\(s\)/);
  assert.match(js, /function marginStokCell\(s\)/);
  assert.match(js, /class="st-price-list"/);
  assert.match(js, /class="st-margin-list"/);
  assert.match(css, /\.st-price-list>div,\.st-margin-list>div\{display:flex/);
});

test('margin visual states distinguish negative, available, and unknown values', () => {
  assert.match(js, /Number\(v\) < 0 \? 'chip-bad' : 'chip-ok'/);
  assert.match(js, /class="st-margin-empty">—<\/span>/);
  assert.match(js, /st-dot-ok/);
  assert.match(js, /st-dot-bad/);
  assert.match(js, /st-dot-muted/);
  assert.match(css, /\.st-margin-empty\{display:inline-block/);
});

test('stock UX keeps the batch edit action and add-batch action intact', () => {
  assert.match(js, /data-produk-index/);
  assert.match(js, /data-batch=/);
  assert.match(js, /formBatch\(JSON\.parse\(b\.dataset\.batch\)\)/);
  assert.match(js, /formBatch\(null, \{ Kode_Obat: produk\.Kode_Obat/);
});
