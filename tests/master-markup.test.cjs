const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'public/js_master.js'), 'utf8');

function extractFunction(name) {
  const start = js.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const end = js.indexOf('\n}', start);
  assert.notEqual(end, -1, `${name} has a closing brace`);
  return js.slice(start, end + 2);
}

test('preview key changes when markup configuration changes', () => {
  const context = vm.createContext({ JSON });
  vm.runInContext(extractFunction('markupMasterKey'), context);
  const base = { mode: 'rasio', umum: 1.25, nakes: 1.1, mutasi: 1, pembulatan: 0 };
  const changed = { ...base, umum: 1.32 };
  assert.notEqual(context.markupMasterKey(base, '', ['umum']), context.markupMasterKey(changed, '', ['umum']));
  assert.notEqual(context.markupMasterKey(base, '', ['umum']), context.markupMasterKey(base, 'adem', ['umum']));
  assert.equal(context.markupMasterKey(base, '', ['nakes', 'umum']), context.markupMasterKey(base, '', ['umum', 'nakes']));
});

test('Master markup invalidates stale preview and accumulates actual RPC results', () => {
  assert.match(js, /tandaiPreviewMarkupMasterKotor/);
  assert.match(js, /Nilai berubah\. Klik Pratinjau kembali sebelum menerapkan/);
  assert.match(js, /preview\.textContent = 'Pratinjau'/);
  assert.match(js, /markupMasterKey\(cfgMarkupMaster\(\)/);
  assert.match(js, /hasil\.berubah \+= Number\(r && r\.berubah\)/);
  assert.match(js, /hasil\.dilewati \+= Number\(r && r\.dilewati\)/);
  assert.match(js, /Harga berubah: .*dilewati:/);
});

test('Master markup ignores late responses from an older preview request', () => {
  assert.match(js, /request = \+\+MARKUP_MASTER_PREVIEW_REQUEST/);
  assert.match(js, /if \(request !== MARKUP_MASTER_PREVIEW_REQUEST\) return/);
});

test('Master markup documents SKU sale prices and effective modal source', () => {
  assert.match(js, /Harga jual berlaku per SKU dan tersimpan di Master Barang/);
  assert.match(js, /modal efektif terbaru setelah PPN dan diskon/);
  assert.match(js, /<th class="r">Modal efektif<\/th>/);
  assert.match(js, /<th class="r">Modal efektif batch<\/th>/);
});

test('Master markup supports selecting several items before applying', () => {
  assert.match(js, /MARKUP_MASTER_SELECTED/);
  assert.match(js, /id="mkPilihSemua"/);
  assert.match(js, /data-markup-kode/);
  assert.match(js, /Terapkan item terpilih/);
  assert.match(js, /Pilih minimal satu item obat/);
});

test('Master markup searches by input with debounce and rejects short queries', () => {
  assert.match(js, /MARKUP_MASTER_SEARCH_TIMER/);
  assert.match(js, /query\.length < 2/);
  assert.match(js, /setTimeout\(function \(\) \{ MARKUP_MASTER_SEARCH_TIMER = null; previewMarkupMaster\(\); \}, 350\)/);
  assert.match(js, /Ketik minimal 2 karakter untuk mencari nama atau kode obat/);
});

test('Master markup disables apply after preview becomes stale and shows a summary', () => {
  assert.match(js, /querySelector\('#mkApply'\)/);
  assert.match(js, /b\.id=x\[3\]/);
  assert.match(js, /Anda akan mengubah /);
  assert.match(js, /Pembulatan:/);
  assert.match(js, /Lanjutkan\?/);
});

test('Stock & Batch exposes SKU sale prices and batch margins', () => {
  assert.match(js, /Harga jual SKU/);
  assert.match(js, /Margin batch/);
  assert.match(js, /Margin_Umum/);
  assert.match(js, /function marginStok/);
});
