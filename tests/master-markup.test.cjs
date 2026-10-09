'use strict';
/* Uji alur markup Master Barang. Alur lama ("terapkan aturan borongan" dengan
   tombol Pratinjau) sudah diganti daftar kerja per barang, jadi uji di berkas
   ini menguji jaminan yang sama pada alur baru:
   - rumus markup persen/rasio dan pembulatan ke atas
   - batas markup 0–1000% (dan rasio 1–11) tetap ditolak
   - pemilihan barang (pilih semua / per baris) tetap bekerja
   - penerapan tidak mungkin tanpa konfirmasi; pembatalan tidak mengirim apa pun
   - harga yang belum disimpan tetap memberi peringatan saat panel ditutup
   - tidak ada aksi API baru: hanya aksi lama yang dipakai. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const MASTER = fs.readFileSync(path.join(root, 'public/js_master.js'), 'utf8');
const CORE = fs.readFileSync(path.join(root, 'public/js_core.js'), 'utf8');
const TRX = fs.readFileSync(path.join(root, 'public/js_trx.js'), 'utf8');
const API = fs.readFileSync(path.join(root, 'supabase/functions/api/index.ts'), 'utf8');

/** Ambil satu fungsi global dari berkas sumber (gaya repo: `function nama(`). */
function extractFunction(nama, sumber) {
  const start = sumber.indexOf(`function ${nama}(`);
  assert.notEqual(start, -1, `${nama} exists`);
  const end = sumber.indexOf('\n}', start);
  assert.notEqual(end, -1, `${nama} has a closing brace`);
  return sumber.slice(start, end + 2);
}

/** DOM mini: cukup untuk getElementById, querySelectorAll, dan elemen palsu. */
function dokumenMini(nilai, input) {
  const elemen = {};
  Object.keys(nilai || {}).forEach((id) => {
    elemen[id] = { value: String(nilai[id]), textContent: '', innerHTML: '', hidden: false, checked: false, disabled: false };
  });
  return {
    elemen,
    getElementById(id) { return elemen[id] || null; },
    querySelector() { return null; },
    querySelectorAll() { return input || []; },
    createElement() { return { style: {}, dataset: {}, className: '', appendChild() {} }; }
  };
}

/** Satu kolom harga palsu seperti yang dirender htmlTingkatMarkupMaster(). */
function inputHarga(kode, tingkat) {
  const sel = { innerHTML: '' };
  return {
    value: '', textContent: '', style: {},
    parentNode: { querySelector() { return sel; } },
    getAttribute(nama) {
      if (nama === 'data-markup-kode-baris') return kode;
      if (nama === 'data-markup-harga') return tingkat;
      return null;
    },
    selMargin: sel
  };
}

function baris(kode, modal, harga, nilai) {
  return JSON.parse(JSON.stringify({ kode, nama: 'Nama ' + kode, modal, harga: harga || {}, nilai: nilai || {} }));
}

/** Jalankan js_master.js di konteks vm dengan helper asli js_core/js_trx. */
function muatMaster(opts) {
  opts = opts || {};
  const catatan = { api: [], toast: [], confirm: [], modalTutup: 0 };
  const dok = opts.document || dokumenMini(opts.nilai, opts.input);
  const context = {
    VIEWS: {}, SESSION: { user: { role: 'Owner' } }, document: dok,
    api(aksi, data) { catatan.api.push({ aksi, data }); return opts.api ? opts.api(aksi, data) : Promise.resolve({ berubah: 1, dilewati: 0 }); },
    toast(pesan, buruk) { catatan.toast.push({ pesan, buruk: !!buruk }); },
    confirm(pesan) { catatan.confirm.push(pesan); return opts.confirm === undefined ? true : opts.confirm; },
    modalTutup() { catatan.modalTutup += 1; },
    modalBuka() {},
    promoApi() { return Promise.resolve([]); },
    setTimeout() { return 0; },
    clearTimeout() {}
  };
  vm.createContext(context);
  vm.runInContext(['esc', 'angka', 'rupiah', 'val', 'numVal'].map((n) => extractFunction(n, CORE)).join('\n'), context);
  vm.runInContext(['hargaDariMarkupJS', 'markupInputBeliKePersen', 'marginPersenBeli'].map((n) => extractFunction(n, TRX)).join('\n'), context);
  vm.runInContext(MASTER, context);
  return { ctx: context, catatan, dok };
}

/** Beri kesempatan rantai promise simpanMarkupMaster() selesai. */
function tunggu() { return new Promise((resolve) => setTimeout(resolve, 5)); }

test('preview key changes when markup configuration changes', () => {
  const context = vm.createContext({ JSON });
  vm.runInContext(extractFunction('markupMasterKey', MASTER), context);
  const base = { mode: 'rasio', umum: 1.25, nakes: 1.1, mutasi: 1, pembulatan: 0 };
  const changed = { ...base, umum: 1.32 };
  assert.notEqual(context.markupMasterKey(base, '', ['umum']), context.markupMasterKey(changed, '', ['umum']));
  assert.notEqual(context.markupMasterKey(base, '', ['umum']), context.markupMasterKey(base, 'adem', ['umum']));
  assert.equal(context.markupMasterKey(base, '', ['nakes', 'umum']), context.markupMasterKey(base, '', ['umum', 'nakes']));
});

test('rumus markup persen dan pembulatan ke atas sama dengan aturan bisnis', () => {
  const { ctx } = muatMaster();
  assert.equal(ctx.hargaDariMarkupJS(999, 200, 100), 3000);
  assert.equal(ctx.hargaDariMarkupJS(999, 150, 100), 2500);
  assert.equal(ctx.hargaDariMarkupJS(999, 0, 100), 999);
  assert.equal(ctx.hargaDariMarkupJS(999, 0, 0), 999);
  assert.equal(ctx.hargaDariMarkupJS(2209.79, 35, 100), 3000);
  assert.equal(ctx.hargaDariMarkupJS(1000, 1000, 0), 11000);
  assert.equal(ctx.hargaDariMarkupJS(null, 200, 100), null);
  assert.equal(ctx.hargaDariMarkupJS(0, 200, 100), null);
});

test('batas markup 0–1000 persen dan rasio 1–11 tetap ditolak di luar rentang', () => {
  const { ctx } = muatMaster();
  assert.equal(ctx.hargaDariMarkupJS(1000, 1001, 0), null);
  assert.equal(ctx.hargaDariMarkupJS(1000, -1, 0), null);
  assert.notEqual(ctx.hargaDariMarkupJS(1000, 1000, 0), null);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.markupInputBeliKePersen(1000, 'persen'))), { valid: true, persen: 1000 });
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.markupInputBeliKePersen(1001, 'persen'))), { valid: false, persen: null });
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.markupInputBeliKePersen(2.5, 'rasio'))), { valid: true, persen: 150 });
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.markupInputBeliKePersen(1, 'rasio'))), { valid: true, persen: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.markupInputBeliKePersen(0.9, 'rasio'))), { valid: false, persen: null });
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.markupInputBeliKePersen(11.5, 'rasio'))), { valid: false, persen: null });
});

test('margin Master Barang memakai rumus yang sama dengan modul Pembelian', () => {
  const { ctx } = muatMaster();
  assert.equal(ctx.marginMarkupMaster(1500, 1000), 33.33333333333333);
  assert.equal(ctx.marginMarkupMaster(1000, 1000), 0);
  assert.equal(ctx.marginMarkupMaster(800, 1000), -25);
  assert.equal(ctx.marginMarkupMaster(null, 1000), null);
  assert.equal(ctx.marginMarkupMaster(1500, null), null);
  assert.equal(ctx.marginMarkupMaster(0, 1000), null);
  for (const pasangan of [[1500, 1000], [1000, 1000], [800, 1000], [null, 1000], [1500, null], [0, 1000], [-10, 1000], [1200, 0]]) {
    assert.equal(ctx.marginMarkupMaster(pasangan[0], pasangan[1]), ctx.marginPersenBeli(pasangan[0], pasangan[1]));
  }
});

test('Master markup: margin per tingkat hijau mulai ambang dan merah di bawahnya', () => {
  const { ctx } = muatMaster({ nilai: { mkAmbang: '20' } });
  ctx.MARKUP_MASTER_ROWS = [
    baris('A', 1000, { umum: { lama: 1250 } }),
    baris('B', 1000, { umum: { lama: 1150 } }),
    baris('C', 1000, { umum: { lama: 1500 } }, { umum: '1500' }),
    baris('D', null, { umum: { lama: 1200 } })
  ];
  const teks = (i) => ctx.htmlIsiMarginMarkupMaster(ctx.MARKUP_MASTER_ROWS[i], 'umum');
  assert.match(teks(0), /chip-ok/);
  assert.match(teks(0), /20,0%/);
  assert.match(teks(0), /kini/);
  assert.match(teks(1), /chip-bad/);
  assert.match(teks(1), /13,0%/);
  assert.match(teks(2), /chip-ok/);
  assert.match(teks(2), /33,3%/);
  assert.doesNotMatch(teks(2), /kini/);
  assert.match(teks(3), /margin —/);
});

test('Master markup: urutan bawaan margin terendah lebih dulu', () => {
  const { ctx, dok } = muatMaster({ nilai: { mkAmbang: '20', mkUrut: 'margin' } });
  ctx.MARKUP_MASTER_ROWS = [
    baris('A', 1000, { umum: { lama: 2000 } }),
    baris('B', 1000, { umum: { lama: 1200 } }),
    baris('C', 1000, { umum: { lama: 1500 } }),
    baris('D', null, { umum: { lama: 1200 } })
  ];
  assert.deepEqual(Array.from(ctx.urutkanMarkupMaster(ctx.MARKUP_MASTER_ROWS)).map((x) => x.kode), ['B', 'C', 'A', 'D']);
  assert.equal(ctx.marginTerendahMarkupMaster(ctx.MARKUP_MASTER_ROWS[3]), Infinity);
  dok.elemen.mkUrut.value = 'nama';
  assert.deepEqual(Array.from(ctx.urutkanMarkupMaster(ctx.MARKUP_MASTER_ROWS)).map((x) => x.kode), ['A', 'B', 'C', 'D']);
});

test('Master markup: pilihan golongan diambil dari data yang termuat', () => {
  const dok = dokumenMini({ mkGol: 'Resep' });
  const { ctx } = muatMaster({ document: dok });
  ctx.MARKUP_MASTER_ROWS = [baris('A', 1000, {}), baris('B', 1000, {}), baris('C', 1000, {}), baris('D', 1000, {})];
  ctx.MARKUP_MASTER_GOL = { A: 'Resep', B: 'Bebas', C: 'Resep', D: 'Khusus' };
  ctx.perbaruiGolonganMarkupMaster();
  assert.equal(dok.elemen.mkGol.innerHTML,
    '<option value="">Semua golongan</option><option value="Bebas">Bebas</option><option value="Resep">Resep</option><option value="Khusus">Khusus</option>');
  assert.equal(dok.elemen.mkGol.value, 'Resep');
});

test('Master markup: pilih semua dan pilih per baris selalu terbatas pada baris yang tampil', () => {
  const { ctx, dok } = muatMaster({ nilai: { mkGol: '' } });
  ctx.MARKUP_MASTER_ROWS = [baris('OBT1', 1000, { umum: { lama: 1200 } }), baris('OBT2', 1000, { umum: { lama: 1200 } }), baris('OBT3', 1000, { umum: { lama: 1200 } })];
  ctx.MARKUP_MASTER_GOL = { OBT1: 'Bebas', OBT2: 'Resep', OBT3: 'Resep' };
  ctx.MARKUP_MASTER_SELECTED = { OBT1: true };
  ctx.MARKUP_MASTER_SELECT_ALL = false;
  assert.deepEqual(Array.from(ctx.kodeMarkupMasterTerpilih()), ['OBT1']);
  ctx.MARKUP_MASTER_SELECT_ALL = true;
  assert.deepEqual(Array.from(ctx.kodeMarkupMasterTerpilih()).sort(), ['OBT1', 'OBT2', 'OBT3']);
  dok.elemen.mkGol.value = 'Resep';
  assert.deepEqual(Array.from(ctx.kodeMarkupMasterTerpilih()).sort(), ['OBT2', 'OBT3']);
});

test('Master markup: tiga kolom markup tombol bantu terpisah per tipe pelanggan', () => {
  const form = extractFunction('formMarkupMaster', MASTER);
  assert.match(form, /id="mkPersenUmum"/);
  assert.match(form, /id="mkPersenNakes"/);
  assert.match(form, /id="mkPersenMutasi"/);
  assert.doesNotMatch(form, /id="mkPersen"/);
  assert.match(form, /Markup Umum \(%\)/);
  assert.match(form, /Markup Nakes \(%\)/);
  assert.match(form, /Markup Apotek lain \(%\)/);
  const { ctx } = muatMaster();
  assert.equal(ctx.idPersenMarkupMaster('umum'), 'mkPersenUmum');
  assert.equal(ctx.idPersenMarkupMaster('nakes'), 'mkPersenNakes');
  assert.equal(ctx.idPersenMarkupMaster('mutasi'), 'mkPersenMutasi');
  assert.equal(ctx.idPersenMarkupMaster(), null, 'tingkat tak dikenal tidak menunjuk kolom mana pun');
  assert.equal(ctx.labelMarkupMaster('umum'), 'Umum');
  assert.equal(ctx.labelMarkupMaster('nakes'), 'Nakes');
  assert.equal(ctx.labelMarkupMaster('mutasi'), 'Apotek lain');
  assert.deepEqual(Array.from(ctx.tingkatMarkupMaster()), ['umum', 'nakes', 'mutasi']);
});

test('Master markup: tombol Markup per baris mengisi tiap tingkat dengan persennya sendiri', () => {
  const input = [inputHarga('OBT1', 'umum'), inputHarga('OBT1', 'nakes'), inputHarga('OBT1', 'mutasi')];
  const { ctx } = muatMaster({ nilai: { mkPersenUmum: '39', mkPersenNakes: '9', mkPersenMutasi: '0', mkRound: '100' }, input });
  // Contoh nyata apotek: modal Rp4.300 -> umum Rp6.000, nakes Rp4.700, apotek lain Rp4.300.
  ctx.MARKUP_MASTER_ROWS = [baris('OBT1', 4300, { umum: { lama: 4300 }, nakes: { lama: 4300 }, mutasi: { lama: 4300 } })];
  ctx.isiMarkupMaster('OBT1');
  assert.deepEqual(input.map((i) => i.value), ['6000', '4700', '4300']);
  assert.equal(new Set(input.map((i) => i.value)).size, 3, 'ketiga harga harus berbeda');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.MARKUP_MASTER_ROWS[0].nilai)), { umum: '6000', nakes: '4700', mutasi: '4300' });
  assert.equal(ctx.teksTombolMarkupMaster(), 'Markup Umum 39% · Nakes 9% · Apotek lain 0%');
  assert.match(MASTER, /data-markup-isi=/);
  assert.match(MASTER, /id="mkPilihSemua"/);
  assert.match(MASTER, /ke baris terpilih/);
  assert.match(MASTER, /Pilih minimal satu item obat/);
});

test('Master markup: mengetik harga di satu tingkat tidak menyentuh tingkat lain', () => {
  const input = [inputHarga('OBT1', 'umum'), inputHarga('OBT1', 'nakes'), inputHarga('OBT1', 'mutasi')];
  const { ctx } = muatMaster({ nilai: { mkAmbang: '20', mkUrut: 'margin' }, input });
  ctx.MARKUP_MASTER_ROWS = [baris('OBT1', 1000, { umum: { lama: 1000 }, nakes: { lama: 1000 }, mutasi: { lama: 1000 } })];
  input[1].value = '1250';
  ctx.ketikMarkupMaster({ target: { closest: () => input[1] } });
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.MARKUP_MASTER_ROWS[0].nilai)), { nakes: '1250' });
  assert.deepEqual(Array.from(ctx.tingkatBerubahMarkupMaster(ctx.MARKUP_MASTER_ROWS[0])), ['nakes']);
  assert.equal(ctx.marginBarisMarkupMaster(ctx.MARKUP_MASTER_ROWS[0], 'nakes'), 20);
  assert.equal(ctx.marginBarisMarkupMaster(ctx.MARKUP_MASTER_ROWS[0], 'umum'), 0);
  assert.match(input[1].selMargin.innerHTML, /20,0%/);
});

test('Master markup: satu persentase tidak boleh dipakai untuk ketiga tingkat', () => {
  const input = [inputHarga('OBT1', 'umum'), inputHarga('OBT1', 'nakes'), inputHarga('OBT1', 'mutasi')];
  // Hanya kolom Nakes yang diisi; Umum dan Apotek lain sengaja dikosongkan.
  const { ctx } = muatMaster({ nilai: { mkPersenUmum: '', mkPersenNakes: '10', mkPersenMutasi: '', mkRound: '100' }, input });
  ctx.MARKUP_MASTER_ROWS = [baris('OBT1', 1000, { umum: { lama: 1200 }, nakes: { lama: 1200 }, mutasi: { lama: 1200 } })];
  ctx.isiMarkupMaster('OBT1');
  assert.equal(input[1].value, '1100');
  assert.equal(input[0].value, '', 'Umum tidak boleh ikut terisi oleh persen Nakes');
  assert.equal(input[2].value, '', 'Apotek lain tidak boleh ikut terisi oleh persen Nakes');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.MARKUP_MASTER_ROWS[0].nilai)), { nakes: '1100' });
  // Tanpa argumen tingkat, persen tidak boleh diambil dari kolom tingkat mana pun.
  assert.equal(ctx.nilaiPersenMarkupMaster(), null);
  assert.match(MASTER, /function nilaiPersenMarkupMaster\(t\)/);
  assert.doesNotMatch(MASTER, /nilaiPersenMarkupMaster\(\)/);
  assert.doesNotMatch(MASTER, /var persen = nilaiPersenMarkupMaster\(\)/);
});

test('Master markup: borongan "baris terpilih" memakai ketiga persentase per tingkat', () => {
  const input = [
    inputHarga('OBT1', 'umum'), inputHarga('OBT1', 'nakes'), inputHarga('OBT1', 'mutasi'),
    inputHarga('OBT2', 'umum'), inputHarga('OBT2', 'nakes'), inputHarga('OBT2', 'mutasi')
  ];
  const { ctx } = muatMaster({ nilai: { mkPersenUmum: '40', mkPersenNakes: '10', mkPersenMutasi: '0', mkRound: '100', mkGol: '' }, input });
  ctx.MARKUP_MASTER_ROWS = [baris('OBT1', 1000, {}), baris('OBT2', 2000, {})];
  ctx.MARKUP_MASTER_SELECT_ALL = true;
  ctx.MARKUP_MASTER_SELECTED = Object.create(null);
  ctx.boronganMarkupMaster();
  assert.deepEqual(input.map((i) => i.value), ['1400', '1100', '1000', '2800', '2200', '2000']);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.MARKUP_MASTER_ROWS[0].nilai)), { umum: '1400', nakes: '1100', mutasi: '1000' });
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.MARKUP_MASTER_ROWS[1].nilai)), { umum: '2800', nakes: '2200', mutasi: '2000' });
});

test('Master markup: nilai bawaan tombol bantu diambil dari pengaturan markup per tingkat', async () => {
  const dok = dokumenMini({ mkPersenUmum: '20', mkPersenNakes: '20', mkPersenMutasi: '20', mkRound: '100' });
  const { ctx } = muatMaster({
    document: dok,
    api(aksi) {
      if (aksi === 'harga.pengaturan') {
        return Promise.resolve({ tersedia: true, tersimpan: true, pengaturan: { mode: 'persen', markup_umum_persen: 40, markup_nakes_persen: 10, markup_mutasi_persen: 0, pembulatan: 500 } });
      }
      return Promise.resolve({ total: 0, rows: [] });
    }
  });
  ctx.muatPengaturanMarkupMaster();
  await tunggu();
  assert.equal(dok.elemen.mkPersenUmum.value, '40');
  assert.equal(dok.elemen.mkPersenNakes.value, '10');
  assert.equal(dok.elemen.mkPersenMutasi.value, '0');
  assert.equal(dok.elemen.mkRound.value, '500');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.cfgMarkupMaster())), { mode: 'persen', umum: 40, nakes: 10, mutasi: 0, pembulatan: 500 });
  assert.match(MASTER, /markup_umum_persen/);
  assert.match(MASTER, /markup_nakes_persen/);
  assert.match(MASTER, /markup_mutasi_persen/);
});

test('Master markup: harga baru dibalik ke markup persen dan dikirim lewat aksi lama tanpa pembulatan', async () => {
  let panggil = 0;
  const { ctx, catatan } = muatMaster({
    nilai: { mkAmbang: '20' },
    api() { panggil += 1; return Promise.resolve(panggil === 1 ? { berubah: 2, dilewati: 1 } : { berubah: 1, dilewati: 1 }); }
  });
  ctx.MARKUP_MASTER_ROWS = [
    baris('OBT1', 1000, { umum: { lama: 1000 } }, { umum: '1500' }),
    baris('OBT2', 2000, { umum: { lama: 2000 } }, { umum: '3000' }),
    baris('OBT3', 1000, { umum: { lama: 1200 } }, { umum: '1150' })
  ];
  ctx.simpanMarkupMaster();
  await tunggu();
  assert.equal(catatan.confirm.length, 1);
  assert.match(catatan.confirm[0], /Anda akan mengubah 3 barang \(3 kolom harga\)/);
  assert.match(catatan.confirm[0], /Di antaranya 1 barang marginnya masih di bawah ambang 20%/);
  assert.match(catatan.confirm[0], /Lanjutkan\?/);
  assert.deepEqual(catatan.api.map((x) => x.aksi), ['harga.markupTerapkan', 'harga.markupTerapkan']);
  assert.deepEqual(JSON.parse(JSON.stringify(catatan.api[0].data)), {
    kode_obat: ['OBT1', 'OBT2'], tingkat: ['umum'], mode: 'persen',
    umum: 50, nakes: null, mutasi: null, pembulatan: 0, sumber: 'tinjau harga master'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(catatan.api[1].data.kode_obat)), ['OBT3']);
  assert.equal(catatan.api[1].data.umum, 15);
  assert.equal(catatan.api[1].data.pembulatan, 0);
  assert.equal(catatan.modalTutup, 1);
  assert.match(catatan.toast.map((t) => t.pesan).join(' '), /Harga berubah: 3; dilewati: 2/);
});

test('Master markup: penerapan tidak mungkin tanpa konfirmasi dan pembatalan tidak mengirim apa pun', async () => {
  const { ctx, catatan } = muatMaster({ nilai: { mkAmbang: '20' }, confirm: false });
  ctx.MARKUP_MASTER_ROWS = [baris('OBT1', 1000, { umum: { lama: 1000 } }, { umum: '1500' })];
  ctx.simpanMarkupMaster();
  await tunggu();
  assert.equal(catatan.confirm.length, 1);
  assert.equal(catatan.api.length, 0);
  assert.equal(catatan.modalTutup, 0);
  assert.match(catatan.toast.map((t) => t.pesan).join(' '), /^$/);
  // Ringkasan hanya muncul setelah ada yang bisa dikirim; tanpa perubahan tidak ada pertanyaan.
  const kosong = muatMaster({ confirm: false });
  kosong.ctx.MARKUP_MASTER_ROWS = [baris('OBT1', 1000, { umum: { lama: 1000 } })];
  kosong.ctx.simpanMarkupMaster();
  await tunggu();
  assert.equal(kosong.catatan.confirm.length, 0);
  assert.equal(kosong.catatan.api.length, 0);
  assert.match(kosong.catatan.toast[0].pesan, /Belum ada harga baru yang diisi/);
});

test('Master markup: harga di luar rentang 0–1000% atau tanpa modal ditolak sebelum dikirim', async () => {
  const { ctx, catatan } = muatMaster({ nilai: { mkAmbang: '20' } });
  ctx.MARKUP_MASTER_ROWS = [
    baris('OBT1', 1000, { umum: { lama: 1000 } }, { umum: '500' }),
    baris('OBT2', 1000, { umum: { lama: 1000 } }, { umum: '20000' }),
    baris('OBT3', null, { umum: { lama: 1000 } }, { umum: '1500' })
  ];
  ctx.simpanMarkupMaster();
  await tunggu();
  assert.equal(catatan.confirm.length, 0);
  assert.equal(catatan.api.length, 0);
  assert.equal(catatan.toast[0].buruk, true);
  assert.match(catatan.toast[0].pesan, /belum bisa disimpan/);
});

test('Master markup: harga baru yang belum disimpan memberi peringatan saat panel ditutup', async () => {
  const ditahan = muatMaster({ nilai: { mkAmbang: '20' }, confirm: false });
  ditahan.ctx.MARKUP_MASTER_ROWS = [baris('OBT1', 1000, { umum: { lama: 1000 } }, { umum: '1500' })];
  ditahan.ctx.tutupMarkupMaster();
  assert.equal(ditahan.catatan.confirm.length, 1);
  assert.match(ditahan.catatan.confirm[0], /belum disimpan/);
  assert.equal(ditahan.catatan.modalTutup, 0);

  const lanjut = muatMaster({ nilai: { mkAmbang: '20' }, confirm: true });
  lanjut.ctx.MARKUP_MASTER_ROWS = [baris('OBT1', 1000, { umum: { lama: 1000 } }, { umum: '1500' })];
  lanjut.ctx.tutupMarkupMaster();
  assert.equal(lanjut.catatan.modalTutup, 1);

  const bersih = muatMaster({ confirm: false });
  bersih.ctx.MARKUP_MASTER_ROWS = [baris('OBT1', 1000, { umum: { lama: 1000 } })];
  bersih.ctx.tutupMarkupMaster();
  assert.equal(bersih.catatan.confirm.length, 0);
  assert.equal(bersih.catatan.modalTutup, 1);
});

test('Master markup: respons pratinjau yang terlambat diabaikan', () => {
  assert.match(MASTER, /request = \+\+MARKUP_MASTER_PREVIEW_REQUEST/);
  assert.match(MASTER, /if \(request !== MARKUP_MASTER_PREVIEW_REQUEST\) return/);
});

test('Master markup mencari dengan jeda 350 ms dan menolak pencarian terlalu pendek', () => {
  assert.match(MASTER, /MARKUP_MASTER_SEARCH_TIMER/);
  assert.match(MASTER, /query\.length < 2/);
  assert.match(MASTER, /setTimeout\(function \(\) \{ MARKUP_MASTER_SEARCH_TIMER = null; previewMarkupMaster\(\); \}, 350\)/);
  assert.match(MASTER, /Ketik minimal 2 karakter untuk mencari nama atau kode obat/);
  assert.match(MASTER, /id="mkCari"/);
  assert.match(MASTER, /id="mkGol"/);
  assert.match(MASTER, /id="mkAmbang"[^>]*value="20"/);
  assert.match(MASTER, /function ambangMarkupMaster\(\)[\s\S]*?return 20;/);
  assert.match(MASTER, /Margin terendah lebih dulu/);
});

test('Master markup tidak menambah aksi API baru', () => {
  const blok = MASTER.slice(MASTER.indexOf('/* --- Daftar kerja markup'), MASTER.indexOf('/* Ubah stok langsung dari Master Barang'));
  const dipakai = [...blok.matchAll(/api\('([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(dipakai)].sort(), ['barang.list', 'harga.markupPreview', 'harga.markupTerapkan', 'harga.pengaturan']);
  const aksiHarga = [...API.matchAll(/"(harga\.[A-Za-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(aksiHarga)].sort(), ['harga.markupPreview', 'harga.markupTerapkan', 'harga.pengaturan', 'harga.simpanPengaturan']);
  assert.match(API, /p_kode_obat: kode, p_tingkat: tingkat, p_markup_umum_persen: u/);
});

test('Master Barang memakai istilah "Modal terakhir" dan tidak mengubah istilah Stok & Batch', () => {
  assert.match(MASTER, /title="Modal dari pembelian terakhir, sudah termasuk PPN dan sudah dikurangi diskon pembelian\.">Modal terakhir<\/th>/);
  assert.doesNotMatch(MASTER, /<th class="r">Modal efektif<\/th>/);
  assert.match(MASTER, /<th class="r" title="Biaya modal efektif untuk batch ini setelah PPN dan diskon">Modal efektif batch<\/th>/);
  assert.match(MASTER, /data-label="Modal efektif"/);
  assert.match(MASTER, /Harga jual berlaku per SKU dan tersimpan di Master Barang/);
  assert.match(MASTER, /sudah termasuk PPN dan sudah dikurangi diskon pembelian/);
  assert.match(MASTER, /modalBuka\('Barang perlu ditinjau'/);
});

test('Stock & Batch exposes SKU sale prices and batch margins', () => {
  assert.match(MASTER, /Harga jual SKU/);
  assert.match(MASTER, /Margin batch/);
  assert.match(MASTER, /Margin_Umum/);
  assert.match(MASTER, /function marginStok/);
});
