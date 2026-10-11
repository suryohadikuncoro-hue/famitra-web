'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const TRX = fs.readFileSync(path.join(root, 'public/js_trx.js'), 'utf8');
const CSS = fs.readFileSync(path.join(root, 'public/style.css'), 'utf8');

function extractFunction(name) {
  const start = TRX.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'function ' + name + ' exists');
  const end = TRX.indexOf('\n}', start);
  assert.notEqual(end, -1, 'function ' + name + ' closes');
  return TRX.slice(start, end + 2);
}

const context = vm.createContext({ Number });
vm.runInContext([
  extractFunction('isiHargaJualDariMaster')
].join('\n'), context);

test('form Pembelian tidak lagi memuat panel atau logika markup', () => {
  assert.doesNotMatch(TRX, /blMarkup|MarkupBeli|terapkanMarkup|hargaDariMarkupJS|harga\.pengaturan/i);
  assert.doesNotMatch(CSS, /beli-markup|blMarkup/i);
});

test('pemilihan barang menyalin ketiga harga jual dari Master Barang', () => {
  const item = {};
  context.isiHargaJualDariMaster(item, {
    Harga_Jual_Umum: 15000,
    Harga_Khusus: 12000,
    Harga_Jual_Mutasi: 16500
  });
  assert.equal(item.Harga_Jual_Umum_Baru, 15000);
  assert.equal(item.Harga_Khusus_Baru, 12000);
  assert.equal(item.Harga_Jual_Mutasi_Baru, 16500);
  assert.equal(item.Jual_Umum_Kini, 15000);
  assert.equal(item.Jual_Khusus_Kini, 12000);
  assert.equal(item.Jual_Mutasi_Kini, 16500);
});

test('autocomplete dan input kode barang langsung memakai harga dari master', () => {
  assert.equal((TRX.match(/^\s+isiHargaJualDariMaster\(it, b\);/gm) || []).length, 2);
  assert.match(TRX, /function pilihSaranBeli\(index\)/);
  assert.match(TRX, /api\('barang\.list', \{ q: it\.Kode_Obat \}\)/);
});

test('harga jual dari master tetap bisa diedit dan dikirim saat menyimpan', () => {
  assert.match(TRX, /it\[f\.dataset\.f\] = \(f\.type === 'number'\) \? Number\(f\.value\) \|\| 0 : f\.value/);
  for (const field of ['Harga_Jual_Umum_Baru', 'Harga_Khusus_Baru', 'Harga_Jual_Mutasi_Baru']) {
    assert.match(TRX, new RegExp(field + ': it\\.' + field));
  }
  assert.match(TRX, /api\('beli\.simpan'/);
});

test('mengedit faktur lama memuat rincian harga historis, bukan harga baru master', () => {
  assert.match(TRX, /BELI\.items = \(d\.items && d\.items\.length\) \? d\.items : \[barisKosong\(\)\]/);
  const editFlowStart = TRX.indexOf('function bukaUbahFaktur(');
  const editFlowEnd = TRX.indexOf('function bukaDetailFaktur(', editFlowStart);
  assert.ok(editFlowStart >= 0 && editFlowEnd > editFlowStart);
  const editFlow = TRX.slice(editFlowStart, editFlowEnd);
  assert.doesNotMatch(editFlow, /isiHargaJualDariMaster/);
});
