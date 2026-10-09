'use strict';
/* Uji penetapan harga di form Ubah/Tambah barang (Master Barang).
   Tombol "Terapkan markup" dan panel "Barang perlu ditinjau" sudah dihapus atas
   keputusan pemilik: harga ditetapkan satu pintu per barang di dalam form Ubah
   barang. Uji di berkas ini menjaga jaminan berikut:
   - rumus markup persen/rasio dan pembulatan ke atas (hargaDariMarkupJS)
   - batas markup 0–1000% (dan rasio 1–11) tetap ditolak
   - tiga markup terpisah: satu persen tidak pernah dipakai untuk ketiga tingkat
   - mengubah markup Umum hanya mengubah harga Umum
   - harga yang diketik manual tidak ditimpa saat markup tingkat lain diubah
   - margin terhitung benar dan warnanya mengikuti ambang 20%
   - modal kosong atau 0 tidak menghasilkan perhitungan markup
   - nilai bawaan markup dan mode diambil dari pengaturan tersimpan
   - mode persen/rasio bisa ditukar dan angkanya dikonversi, bukan dikosongkan
   - tombol dan panel markup lama benar-benar sudah tidak ada lagi
   - tidak ada aksi API baru, dan mode hanya pilihan di form (tidak tersimpan). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const MASTER = fs.readFileSync(path.join(root, 'public/js_master.js'), 'utf8');
const CORE = fs.readFileSync(path.join(root, 'public/js_core.js'), 'utf8');
const TRX = fs.readFileSync(path.join(root, 'public/js_trx.js'), 'utf8');
const CSS = fs.readFileSync(path.join(root, 'public/style.css'), 'utf8');
const API = fs.readFileSync(path.join(root, 'supabase/functions/api/index.ts'), 'utf8');

/** Ambil satu fungsi global dari berkas sumber (gaya repo: `function nama(`). */
function extractFunction(nama, sumber) {
  const start = sumber.indexOf(`function ${nama}(`);
  assert.notEqual(start, -1, `${nama} exists`);
  const end = sumber.indexOf('\n}', start);
  assert.notEqual(end, -1, `${nama} has a closing brace`);
  return sumber.slice(start, end + 2);
}

/** DOM mini: cukup untuk getElementById dan elemen palsu dengan nilai/oninput. */
function dokumenMini(nilai) {
  const elemen = {};
  Object.keys(nilai || {}).forEach((id) => {
    elemen[id] = { value: String(nilai[id]), textContent: '', innerHTML: '', hidden: false, checked: false, disabled: false, style: {} };
  });
  return {
    elemen,
    getElementById(id) { return elemen[id] || null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return { style: {}, dataset: {}, className: '', appendChild() {} }; },
    addEventListener() {}
  };
}

/** Id kolom yang dirender form Ubah barang (markup, harga, margin, padanan). */
const ID_FORM = {
  umum: { markup: 'fbMarkupUmum', harga: 'fbUmum', margin: 'fbMarginUmum', label: 'fbMarkupUmumLabel', pad: 'fbMarkupUmumPad' },
  nakes: { markup: 'fbMarkupNakes', harga: 'fbKhusus', margin: 'fbMarginNakes', label: 'fbMarkupNakesLabel', pad: 'fbMarkupNakesPad' },
  mutasi: { markup: 'fbMarkupMutasi', harga: 'fbMutasi', margin: 'fbMarginMutasi', label: 'fbMarkupMutasiLabel', pad: 'fbMarkupMutasiPad' }
};
const TINGKAT = ['umum', 'nakes', 'mutasi'];

/** DOM dengan semua kolom harga/markup/margin form barang (nilai awal kosong). */
function dokumenFormBarang(nilai) {
  const awal = {
    fbKode: 'OBT1', fbNama: 'Obat contoh', fbKat: '', fbSatuan: 'Pcs', fbMin: '10', fbGol: 'Bebas',
    fbModal: '', fbPPN: '0', fbMarkupMode: 'persen', fbCatatan: ''
  };
  TINGKAT.forEach((t) => {
    awal[ID_FORM[t].markup] = '';
    awal[ID_FORM[t].harga] = '0';
    awal[ID_FORM[t].margin] = '';
    awal[ID_FORM[t].label] = '';
    awal[ID_FORM[t].pad] = '';
  });
  return dokumenMini(Object.assign(awal, nilai || {}));
}

/** Barang contoh seperti baris Master Barang. */
function barangContoh(ubah) {
  return Object.assign({
    Kode_Obat: 'OBT1', Nama_Obat: 'Obat contoh', Kategori: 'Bebas', Satuan: 'Pcs', Stok_Min: 10,
    Golongan: 'Bebas', Harga_Modal: 1000, Harga_Jual_Umum: 1000, Harga_Khusus: 1000,
    Harga_Jual_Mutasi: 1000, PPN: 0, Aktif: 'YA'
  }, ubah || {});
}

const PENGATURAN_BAWAAN = { mode: 'persen', markup_umum_persen: 20, markup_nakes_persen: 20, markup_mutasi_persen: 20, pembulatan: 100 };

/** Jalankan js_master.js di konteks vm dengan helper asli js_core/js_trx.
 *  modalBuka menangkap isi modal supaya kolom form bisa diperiksa. */
function muatMaster(opts) {
  opts = opts || {};
  const catatan = { api: [], toast: [], modal: [], modalTutup: 0, confirm: [] };
  const dok = opts.document || dokumenFormBarang(opts.nilai);
  const context = {
    VIEWS: {}, SESSION: { user: { role: 'Owner' } }, document: dok,
    api(aksi, data) {
      catatan.api.push({ aksi, data });
      if (opts.api) return opts.api(aksi, data);
      return Promise.resolve({ tersedia: true, tersimpan: true, pengaturan: PENGATURAN_BAWAAN });
    },
    toast(pesan, buruk) { catatan.toast.push({ pesan, buruk: !!buruk }); },
    confirm(pesan) { catatan.confirm.push(pesan); return true; },
    modalBuka(judul, html, tombol) { catatan.modal.push({ judul, html, tombol: tombol || [] }); },
    modalTutup() { catatan.modalTutup += 1; },
    promoApi() { return Promise.resolve([]); },
    setTimeout() { return 0; },
    clearTimeout() {},
    window: { open() {} }
  };
  vm.createContext(context);
  vm.runInContext(['esc', 'angka', 'rupiah', 'val', 'numVal'].map((n) => extractFunction(n, CORE)).join('\n'), context);
  vm.runInContext(['hargaDariMarkupJS', 'markupInputBeliKePersen', 'markupPersenBeliKeInput', 'marginPersenBeli'].map((n) => extractFunction(n, TRX)).join('\n'), context);
  vm.runInContext(MASTER, context);
  return { ctx: context, catatan, dok };
}

/** Beri kesempatan rantai promise harga.pengaturan selesai. */
function tunggu() { return new Promise((resolve) => setTimeout(resolve, 5)); }

/** Buka form Ubah barang. Kolom modal dan harga diisi seperti render asli,
 *  jadi val() membaca nilai yang sama dengan yang dilihat pengguna. */
function bukaForm(opts) {
  opts = opts || {};
  const barang = opts.barang === undefined ? barangContoh(opts.barangUbah) : opts.barang;
  const opsi = Object.assign({}, opts, { barang });
  if (!opts.document && !opts.nilai) {
    const isi = barang || {};
    opsi.nilai = {
      fbModal: isi.Harga_Modal == null ? '' : String(isi.Harga_Modal),
      fbUmum: String(isi.Harga_Jual_Umum || 0),
      fbKhusus: String(isi.Harga_Khusus || 0),
      fbMutasi: String(isi.Harga_Jual_Mutasi || 0)
    };
  }
  const m = muatMaster(opsi);
  m.ctx.formBarang(barang);
  return m;
}

/** Tulis nilai ke kolom lalu jalankan oninput-nya seperti pengguna mengetik. */
function ketik(dok, id, nilai) {
  const el = dok.elemen[id];
  assert.ok(el, `kolom ${id} ada di form`);
  assert.equal(typeof el.oninput, 'function', `kolom ${id} punya pendengar oninput`);
  el.value = String(nilai);
  el.oninput();
}

/** Tukar mode markup seperti memilih opsi di <select id="fbMarkupMode">. */
function tukarMode(dok, mode) {
  const el = dok.elemen.fbMarkupMode;
  assert.ok(el.onchange, 'pemilih mode punya pendengar onchange');
  el.value = mode;
  el.onchange();
}

function persenPengaturan(konfig) {
  return Object.assign({ tersedia: true, tersimpan: true, pengaturan: Object.assign({}, PENGATURAN_BAWAAN, konfig || {}) }, {});
}

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
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.markupPersenBeliKeInput(150, 'rasio'))), 2.5);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.markupPersenBeliKeInput(null, 'persen'))), '');
});

test('margin form barang memakai rumus modul Pembelian dengan ambang 20%', () => {
  const { ctx } = muatMaster();
  assert.equal(ctx.ambangMarginBarang(), 20);
  assert.equal(ctx.marginHargaBarang(1500, 1000), 33.33333333333333);
  assert.equal(ctx.marginHargaBarang(1000, 1000), 0);
  assert.equal(ctx.marginHargaBarang(800, 1000), -25);
  assert.equal(ctx.marginHargaBarang(null, 1000), null);
  assert.equal(ctx.marginHargaBarang(1500, null), null);
  assert.equal(ctx.marginHargaBarang(0, 1000), null);
  for (const pasangan of [[1500, 1000], [1000, 1000], [800, 1000], [null, 1000], [1500, null], [0, 1000], [-10, 1000], [1200, 0]]) {
    assert.equal(ctx.marginHargaBarang(pasangan[0], pasangan[1]), ctx.marginPersenBeli(pasangan[0], pasangan[1]));
  }
  // Hijau mulai ambang 20%, merah di bawahnya, "—" bila modal belum diketahui.
  const chip = (harga, modal) => String(ctx.htmlMarginBarang(harga, modal));
  assert.match(chip(1250, 1000), /chip-ok/);
  assert.match(chip(1250, 1000), /20,0%/);
  assert.match(chip(1150, 1000), /chip-bad/);
  assert.match(chip(1150, 1000), /13,0%/);
  assert.match(chip(1249, 1000), /chip-bad/, '19,9% masih di bawah ambang');
  assert.match(chip(1249, 1000), /19,9%/);
  assert.match(chip(1250, 1000), /chip-ok/, 'tepat 20% sudah hijau');
  assert.match(chip(1200, null), /margin —/);
  assert.match(chip(0, 1000), /margin —/);
});

test('form Ubah barang memuat modal terakhir, mode markup, tiga markup, dan tiga margin', () => {
  const m = bukaForm();
  assert.equal(m.catatan.modal.length, 1);
  assert.equal(m.catatan.modal[0].judul, 'Ubah Obat contoh');
  const html = m.catatan.modal[0].html;
  assert.match(html, /<label class="field"><span>Modal terakhir<\/span>/);
  assert.match(html, /sudah termasuk PPN dan sudah dikurangi diskon pembelian/);
  assert.match(html, /id="fbModal"/);
  // Pemilih mode persen/rasio, seperti markup di menu Pembelian.
  assert.match(html, /id="fbMarkupMode"/);
  assert.match(html, /<option value="persen">Persen di atas modal \(%\)<\/option>/);
  assert.match(html, /<option value="rasio">Rasio pengali modal \(×\)<\/option>/);
  // Tiga kolom markup terpisah per tipe pelanggan, bukan satu kolom bersama.
  assert.match(html, /id="fbMarkupUmum"/);
  assert.match(html, /id="fbMarkupNakes"/);
  assert.match(html, /id="fbMarkupMutasi"/);
  assert.doesNotMatch(html, /id="fbMarkup"/);
  assert.match(html, /Markup Umum \(%\)/);
  assert.match(html, /Markup Nakes \(%\)/);
  assert.match(html, /Markup Apotek lain \(%\)/);
  // Harga jual tetap bisa diketik manual dan tiap tingkat punya tempat margin.
  assert.match(html, /id="fbUmum"/);
  assert.match(html, /id="fbKhusus"/);
  assert.match(html, /id="fbMutasi"/);
  assert.match(html, /id="fbMarginUmum"/);
  assert.match(html, /id="fbMarginNakes"/);
  assert.match(html, /id="fbMarginMutasi"/);
  assert.match(html, /id="fbCatatan"/);
  // Struktur modal tetap rapi (tiap <label> ditutup).
  assert.equal((html.match(/<label/g) || []).length, (html.match(/<\/label>/g) || []).length);
  // Catatan di bawah kolom harga menjelaskan cara hitungnya (modal tersedia).
  assert.match(m.dok.elemen.fbCatatan.textContent, /Markup dihitung dari Modal terakhir/);
});

test('form Ubah barang: nilai bawaan markup dan mode diambil dari pengaturan tersimpan', async () => {
  const dok = dokumenFormBarang({ fbModal: '1000' });
  const m = bukaForm({
    document: dok,
    barang: barangContoh({ Harga_Jual_Umum: 0, Harga_Khusus: 0, Harga_Jual_Mutasi: 0 }),
    api: (aksi) => Promise.resolve(aksi === 'harga.pengaturan'
      ? persenPengaturan({ mode: 'rasio', markup_umum_persen: 25, markup_nakes_persen: 10, markup_mutasi_persen: 0, pembulatan: 0 })
      : { rows: [] })
  });
  await tunggu();
  assert.equal(m.catatan.api[0].aksi, 'harga.pengaturan');
  assert.equal(dok.elemen.fbMarkupMode.value, 'rasio', 'mode bawaan ikut pengaturan tersimpan');
  assert.equal(dok.elemen.fbMarkupUmum.value, '1.25', '25% ditampilkan sebagai rasio 1,25×');
  assert.equal(dok.elemen.fbMarkupNakes.value, '1.1');
  assert.equal(dok.elemen.fbMarkupMutasi.value, '1');
  assert.equal(dok.elemen.fbMarkupUmumLabel.textContent, 'Markup Umum (×)');
  assert.equal(dok.elemen.fbMarkupNakesLabel.textContent, 'Markup Nakes (×)');
  assert.equal(dok.elemen.fbMarkupMutasiLabel.textContent, 'Markup Apotek lain (×)');
  assert.equal(dok.elemen.fbMarkupUmumPad.textContent, '= 25%');
  assert.equal(dok.elemen.fbMarkupNakesPad.textContent, '= 10%');
  // Harga yang belum ditetapkan (0) terisi otomatis dari markup bawaan.
  assert.equal(dok.elemen.fbUmum.value, '1250');
  assert.equal(dok.elemen.fbKhusus.value, '1100');
  assert.equal(dok.elemen.fbMutasi.value, '1000');
  assert.match(dok.elemen.fbCatatan.textContent, /Markup dihitung dari Modal terakhir/);
  assert.match(MASTER, /markup_umum_persen/);
  assert.match(MASTER, /markup_nakes_persen/);
  assert.match(MASTER, /markup_mutasi_persen/);
});

test('form Ubah barang: pengaturan mode persen menampilkan satuan % dan padanan rasio', async () => {
  const dok = dokumenFormBarang({ fbModal: '1000' });
  bukaForm({
    document: dok,
    api: (aksi) => Promise.resolve(aksi === 'harga.pengaturan'
      ? persenPengaturan({ mode: 'persen', markup_umum_persen: 40, markup_nakes_persen: 0, markup_mutasi_persen: null, pembulatan: 100 })
      : { rows: [] })
  });
  await tunggu();
  assert.equal(dok.elemen.fbMarkupMode.value, 'persen');
  assert.equal(dok.elemen.fbMarkupUmum.value, '40');
  assert.equal(dok.elemen.fbMarkupUmumLabel.textContent, 'Markup Umum (%)');
  assert.equal(dok.elemen.fbMarkupUmumPad.textContent, '= 1.40× rasio');
  assert.equal(dok.elemen.fbMarkupNakes.value, '0');
  assert.equal(dok.elemen.fbMarkupNakesPad.textContent, '= 1× rasio');
  assert.equal(dok.elemen.fbMarkupMutasi.value, '', 'markup kosong di pengaturan dibiarkan kosong');
  assert.equal(dok.elemen.fbMarkupMutasiPad.textContent, '');
  // Modal 1.000 dengan markup 40% dan pembulatan ke atas Rp100.
  assert.equal(dok.elemen.fbUmum.value, '1400');
  assert.equal(dok.elemen.fbKhusus.value, '1000');
  assert.equal(dok.elemen.fbMutasi.value, '0');
});

test('form Ubah barang: mengubah markup Umum hanya mengubah harga Umum', () => {
  const m = bukaForm({ barang: barangContoh({ Harga_Modal: 4300, Harga_Jual_Umum: 4300, Harga_Khusus: 4300, Harga_Jual_Mutasi: 4300 }) });
  const dok = m.dok;
  ketik(dok, 'fbMarkupUmum', '39');
  assert.equal(dok.elemen.fbUmum.value, '6000', 'modal 4.300 + 39% dibulatkan ke atas Rp100');
  assert.equal(dok.elemen.fbKhusus.value, '4300', 'harga Nakes tidak disentuh');
  assert.equal(dok.elemen.fbMutasi.value, '4300', 'harga Apotek lain tidak disentuh');
  assert.match(dok.elemen.fbMarginUmum.innerHTML, /chip-ok/);
  assert.match(dok.elemen.fbMarginUmum.innerHTML, /28,3%/, 'margin umum (6000-4300)/6000');
  assert.match(dok.elemen.fbMarginNakes.innerHTML, /chip-bad/);
  assert.match(dok.elemen.fbMarginNakes.innerHTML, /0,0%/);
  // Perubahan harga hanya dikirim ke aksi lama barang.simpan, bukan aksi markup.
  assert.deepEqual(m.catatan.api.map((x) => x.aksi), ['harga.pengaturan']);
  assert.doesNotMatch(MASTER, /harga\.markupTerapkan/);
  assert.doesNotMatch(MASTER, /harga\.markupPreview/);
});

test('form Ubah barang: tiga markup terpisah, satu persen tidak dipakai untuk ketiganya', () => {
  const m = bukaForm({ barang: barangContoh({ Harga_Modal: 4300, Harga_Jual_Umum: 4300, Harga_Khusus: 4300, Harga_Jual_Mutasi: 4300 }) });
  const dok = m.dok, ctx = m.ctx;
  assert.deepEqual(Array.from(ctx.tingkatHargaBarang()), TINGKAT);
  assert.notEqual(ctx.idMarkupBarang('umum'), ctx.idMarkupBarang('nakes'));
  assert.notEqual(ctx.idMarkupBarang('nakes'), ctx.idMarkupBarang('mutasi'));
  assert.equal(ctx.idMarkupBarang(), null, 'tingkat tak dikenal tidak menunjuk kolom mana pun');
  assert.equal(ctx.idHargaBarang(), null);
  assert.equal(ctx.satuanMarkupBarang('rasio'), '×');
  assert.equal(ctx.satuanMarkupBarang('persen'), '%');
  // Contoh nyata apotek: modal Rp4.300 -> umum Rp6.000, nakes Rp4.700, apotek lain Rp4.300.
  ketik(dok, 'fbMarkupUmum', '39');
  ketik(dok, 'fbMarkupNakes', '9');
  ketik(dok, 'fbMarkupMutasi', '0');
  assert.equal(ctx.persenMarkupBarang('umum'), 39);
  assert.equal(ctx.persenMarkupBarang('nakes'), 9);
  assert.equal(ctx.persenMarkupBarang('mutasi'), 0);
  assert.equal(ctx.persenMarkupBarang(), null, 'tanpa argumen tingkat, persen tidak diambil dari kolom mana pun');
  assert.deepEqual([dok.elemen.fbUmum.value, dok.elemen.fbKhusus.value, dok.elemen.fbMutasi.value], ['6000', '4700', '4300']);
  assert.equal(new Set([dok.elemen.fbUmum.value, dok.elemen.fbKhusus.value, dok.elemen.fbMutasi.value]).size, 3, 'ketiga harga harus berbeda');
  assert.match(dok.elemen.fbMarginUmum.innerHTML, /28,3%/);
  assert.match(dok.elemen.fbMarginNakes.innerHTML, /8,5%/);
  assert.match(dok.elemen.fbMarginMutasi.innerHTML, /0,0%/);
  // Hanya kolom Nakes yang diisi: Umum dan Apotek lain milik pengguna (nilai
  // awalnya), jadi markup Nakes tidak boleh mengisinya.
  const lain = bukaForm({ barang: barangContoh({ Harga_Modal: 1000, Harga_Jual_Umum: 0, Harga_Khusus: 0, Harga_Jual_Mutasi: 0 }) });
  ketik(lain.dok, 'fbMarkupNakes', '10');
  assert.equal(lain.dok.elemen.fbKhusus.value, '1100');
  assert.equal(lain.ctx.persenMarkupBarang('umum'), null, 'markup Umum yang kosong dibiarkan kosong');
  assert.equal(lain.ctx.persenMarkupBarang('mutasi'), null);
});

test('form Ubah barang: harga manual tidak ditimpa saat markup tingkat lain diubah', () => {
  const m = bukaForm({ barang: barangContoh({ Harga_Modal: 1000, Harga_Jual_Umum: 1000, Harga_Khusus: 1000, Harga_Jual_Mutasi: 1000 }) });
  const dok = m.dok;
  ketik(dok, 'fbUmum', '7000');
  assert.match(dok.elemen.fbMarginUmum.innerHTML, /85,7%/, 'margin diperbarui langsung saat harga diketik');
  assert.match(dok.elemen.fbMarginUmum.innerHTML, /chip-ok/);
  ketik(dok, 'fbMarkupNakes', '10');
  assert.equal(dok.elemen.fbKhusus.value, '1100', 'tingkat yang markupnya diubah dihitung ulang');
  assert.equal(dok.elemen.fbUmum.value, '7000', 'harga manual Umum tidak ditimpa');
  assert.equal(dok.elemen.fbMutasi.value, '1000', 'tingkat lain tidak disentuh');
  // Markup Umum diubah lagi: sekarang harga Umum memang boleh dihitung ulang.
  ketik(dok, 'fbMarkupUmum', '20');
  assert.equal(dok.elemen.fbUmum.value, '1200', 'markup tingkat itu sendiri yang mengubah harganya');
  assert.equal(dok.elemen.fbKhusus.value, '1100', 'harga manual Nakes tetap utuh');
});

test('form Ubah barang: modal kosong atau 0 tidak menghasilkan perhitungan markup', () => {
  const kosong = bukaForm({ barang: barangContoh({ Harga_Modal: null, Harga_Jual_Umum: 0, Harga_Khusus: 0, Harga_Jual_Mutasi: 0 }) });
  assert.equal(kosong.dok.elemen.fbModal.value, '');
  ketik(kosong.dok, 'fbMarkupUmum', '40');
  assert.equal(kosong.dok.elemen.fbUmum.value, '0', 'modal kosong: harga tidak dihitung');
  assert.equal(kosong.dok.elemen.fbKhusus.value, '0');
  assert.match(kosong.dok.elemen.fbCatatan.textContent, /Modal terakhir belum ada/);
  assert.equal(kosong.catatan.toast[0].buruk, true);
  assert.match(kosong.catatan.toast[0].pesan, /Modal terakhir belum ada, jadi markup Umum belum bisa dihitung/);

  const nol = bukaForm({ barang: barangContoh({ Harga_Modal: 0, Harga_Jual_Umum: 0, Harga_Khusus: 0, Harga_Jual_Mutasi: 0 }) });
  ketik(nol.dok, 'fbMarkupNakes', '50');
  assert.equal(nol.dok.elemen.fbKhusus.value, '0', 'modal 0: markup tidak dihitung');
  assert.match(nol.dok.elemen.fbMarginNakes.innerHTML, /margin —/);
  assert.match(nol.dok.elemen.fbCatatan.textContent, /kosong atau 0/);
  // Modal yang baru diisi langsung dipakai menghitung markup yang sudah diisi.
  ketik(nol.dok, 'fbModal', '2000');
  assert.equal(nol.dok.elemen.fbKhusus.value, '3000');
  assert.match(nol.dok.elemen.fbMarginNakes.innerHTML, /33,3%/);
});

test('form Ubah barang: pemilih mode tersedia dan menukar mode mengonversi angka, bukan mengosongkan', () => {
  const m = bukaForm({ barang: barangContoh({ Harga_Modal: 1000, Harga_Jual_Umum: 0, Harga_Khusus: 0, Harga_Jual_Mutasi: 0 }) });
  const dok = m.dok, ctx = m.ctx;
  assert.equal(dok.elemen.fbMarkupMode.value, 'persen');
  assert.equal(ctx.modeMarkupBarang(), 'persen');
  ketik(dok, 'fbMarkupUmum', '25');
  assert.equal(dok.elemen.fbUmum.value, '1300', '1.000 + 25% dibulatkan ke atas Rp100');
  assert.match(dok.elemen.fbMarkupUmumPad.textContent, /1\.25× rasio/);
  // Pindah ke rasio: angka 25 menjadi 1,25× dan harga jualnya harus tetap sama.
  tukarMode(dok, 'rasio');
  assert.equal(ctx.modeMarkupBarang(), 'rasio');
  assert.equal(dok.elemen.fbMarkupUmum.value, '1.25', 'angka dikonversi, bukan dikosongkan');
  assert.equal(dok.elemen.fbMarkupUmumLabel.textContent, 'Markup Umum (×)');
  assert.equal(dok.elemen.fbMarkupUmumPad.textContent, '= 25%');
  assert.equal(ctx.persenMarkupBarang('umum'), 25);
  assert.equal(dok.elemen.fbUmum.value, '1300', 'hasil harga jual tidak berubah oleh mode');
  // Kembali ke persen: 1,25× menjadi 25% lagi.
  tukarMode(dok, 'persen');
  assert.equal(dok.elemen.fbMarkupUmum.value, '25');
  assert.equal(dok.elemen.fbMarkupUmumLabel.textContent, 'Markup Umum (%)');
  assert.equal(dok.elemen.fbUmum.value, '1300');
  // Mode juga dikenali dari kolom pilihan, bukan dari nilai tersimpan.
  dok.elemen.fbMarkupMode.value = 'rasio';
  assert.equal(ctx.modeMarkupBarang(), 'rasio');
});

test('form Ubah barang: mode rasio, modal 1.000 dengan markup 2× menghasilkan harga 2.000', async () => {
  const dok = dokumenFormBarang({ fbModal: '1000', fbMarkupMode: 'rasio' });
  const m = bukaForm({
    document: dok,
    barang: barangContoh({ Harga_Modal: 1000, Harga_Jual_Umum: 0, Harga_Khusus: 0, Harga_Jual_Mutasi: 0 }),
    api: (aksi) => Promise.resolve(aksi === 'harga.pengaturan'
      ? persenPengaturan({ mode: 'rasio', markup_umum_persen: 100, markup_nakes_persen: 100, markup_mutasi_persen: 100, pembulatan: 0 })
      : { rows: [] })
  });
  await tunggu();
  assert.equal(dok.elemen.fbMarkupUmum.value, '2', 'markup 100% tampil sebagai 2× di mode rasio');
  assert.equal(dok.elemen.fbUmum.value, '2000');
  assert.match(dok.elemen.fbMarginUmum.innerHTML, /50,0%/, 'margin 2.000 dari modal 1.000');
  assert.match(dok.elemen.fbMarginUmum.innerHTML, /chip-ok/);
  // Mengubah rasio ke 1,5× -> harga 1.500 dan margin 33,3%.
  ketik(dok, 'fbMarkupUmum', '1.5');
  assert.equal(dok.elemen.fbUmum.value, '1500');
  assert.match(dok.elemen.fbMarginUmum.innerHTML, /33,3%/);
  assert.match(dok.elemen.fbMarginUmum.innerHTML, /chip-ok/);
  // Rasio 1,1× -> 1.100, margin 9,1% (merah).
  ketik(dok, 'fbMarkupUmum', '1.1');
  assert.equal(dok.elemen.fbUmum.value, '1100');
  assert.match(dok.elemen.fbMarginUmum.innerHTML, /9,1%/);
  assert.match(dok.elemen.fbMarginUmum.innerHTML, /chip-bad/);
});

test('form Ubah barang: nilai di luar batas ditolak di kedua mode', () => {
  const m = bukaForm({ barang: barangContoh({ Harga_Modal: 1000, Harga_Jual_Umum: 0, Harga_Khusus: 0, Harga_Jual_Mutasi: 0 }) });
  const dok = m.dok, ctx = m.ctx;
  ketik(dok, 'fbMarkupUmum', '1000');
  assert.equal(dok.elemen.fbUmum.value, '11000', 'persen 1000% masih sah');
  ketik(dok, 'fbMarkupUmum', '1001');
  assert.equal(ctx.persenMarkupBarang('umum'), null);
  assert.equal(ctx.validMarkupBarang(), false);
  assert.equal(dok.elemen.fbUmum.value, '11000', 'nilai di luar batas tidak menghasilkan harga baru');
  assert.match(dok.elemen.fbCatatan.textContent, /di luar batas: persen 0–1000% atau rasio 1–11/);
  ketik(dok, 'fbMarkupUmum', '-5');
  assert.equal(ctx.validMarkupBarang(), false);
  assert.equal(dok.elemen.fbUmum.value, '11000');
  // Mode rasio: batas 1–11.
  ketik(dok, 'fbMarkupUmum', '');
  tukarMode(dok, 'rasio');
  ketik(dok, 'fbMarkupUmum', '11');
  assert.equal(ctx.persenMarkupBarang('umum'), 1000);
  assert.equal(dok.elemen.fbUmum.value, '11000');
  ketik(dok, 'fbMarkupUmum', '11.5');
  assert.equal(ctx.persenMarkupBarang('umum'), null);
  assert.equal(dok.elemen.fbUmum.value, '11000');
  ketik(dok, 'fbMarkupUmum', '0.9');
  assert.equal(ctx.persenMarkupBarang('umum'), null);
  assert.equal(ctx.validMarkupBarang(), false);
  assert.equal(dok.elemen.fbUmum.value, '11000');
});

test('form Ubah barang: menukar mode saat angka di luar batas tidak mengubah arti angkanya', () => {
  const m = bukaForm({ barang: barangContoh({ Harga_Modal: 1000, Harga_Jual_Umum: 1000, Harga_Khusus: 1000, Harga_Jual_Mutasi: 1000 }) });
  const dok = m.dok;
  ketik(dok, 'fbMarkupUmum', '2000');
  assert.equal(dok.elemen.fbUmum.value, '1000');
  tukarMode(dok, 'rasio');
  assert.equal(dok.elemen.fbMarkupUmum.value, '2000', 'angka dibiarkan apa adanya supaya tidak berubah arti diam-diam');
  assert.equal(dok.elemen.fbUmum.value, '1000', 'harga tidak dihitung dari angka yang tidak sah');
  assert.match(dok.elemen.fbCatatan.textContent, /di luar batas/);
});

test('form Ubah barang tidak menyimpan mode/pengaturan cabang dan tidak menambah aksi API baru', () => {
  const form = extractFunction('formBarang', MASTER);
  const simpan = form.slice(form.indexOf("api('barang.simpan'"), form.indexOf('}).then(function () {'));
  assert.match(simpan, /Harga_Jual_Umum: numVal\('fbUmum'\)/);
  assert.match(simpan, /Harga_Khusus: numVal\('fbKhusus'\)/);
  assert.match(simpan, /Harga_Jual_Mutasi: numVal\('fbMutasi'\)/);
  assert.doesNotMatch(simpan, /fbMarkup|markup_/, 'mode dan markup tidak ikut dikirim ke barang.simpan');
  // Mode hanya pilihan di form: pengaturan cabang tidak pernah ditulis dari sini.
  assert.doesNotMatch(MASTER, /harga\.simpanPengaturan/);
  assert.match(MASTER, /harga\.pengaturan/);
  const blok = MASTER.slice(MASTER.indexOf('/* --- Penetapan harga di form Ubah barang'), MASTER.indexOf('/* Ubah stok langsung dari Master Barang'));
  const dipakai = [...blok.matchAll(/api\('([^']+)'/g)].map((x) => x[1]);
  assert.deepEqual([...new Set(dipakai)].sort(), ['harga.pengaturan'], 'blok harga hanya membaca pengaturan lewat aksi lama; harga disimpan lewat barang.simpan di form');
  // Aksi lama tetap ada di Edge Function; Master Barang berhenti memakainya.
  const aksiHarga = [...API.matchAll(/"(harga\.[A-Za-z]+)"/g)].map((x) => x[1]);
  assert.deepEqual([...new Set(aksiHarga)].sort(), ['harga.markupPreview', 'harga.markupTerapkan', 'harga.pengaturan', 'harga.simpanPengaturan']);
});

test('tombol dan panel markup lama sudah tidak ada lagi', () => {
  // Penanda panel "Barang perlu ditinjau" (PR #94/#96) tidak boleh kembali.
  for (const penanda of [
    'bgMarkup', 'Terapkan markup', 'Barang perlu ditinjau', 'MARKUP_MASTER', 'formMarkupMaster',
    'previewMarkupMaster', 'muatHalamanMarkupMaster', 'gambarMarkupMaster', 'sinkronkanMarkupMaster',
    'gambarTombolMarkupMaster', 'muatPengaturanMarkupMaster', 'lengkapiGolonganMarkupMaster',
    'simpanMarkupMaster', 'tutupMarkupMaster', 'isiMarkupMaster', 'boronganMarkupMaster',
    'ketikMarkupMaster', 'klikMarkupMaster', 'ubahPenyaringMarkupMaster', 'potongMarkupMaster',
    'htmlBarisMarkupMaster', 'htmlTingkatMarkupMaster', 'htmlIsiMarginMarkupMaster',
    'urutkanMarkupMaster', 'barisMarkupMasterTampil', 'kodeMarkupMasterTerpilih',
    'nilaiPersenMarkupMaster', 'persenMarkupMaster', 'teksTombolMarkupMaster',
    'ambangMarkupMaster', 'marginMarkupMaster', 'marginTerendahMarkupMaster',
    'SaranMarkupMaster', 'MARKUP_MASTER_SELECTED', 'data-markup', 'mkCari', 'mkGol', 'mkAmbang',
    'mkPersenUmum', 'mkPersenNakes', 'mkPersenMutasi', 'mkRound', 'mkUrut', 'mkPilihSemua',
    'mkBorongan', 'mkRingkas', 'mkPreview', 'mkLagi', 'mkApply', 'mkSuggest',
    'harga.markupPreview', 'harga.markupTerapkan'
  ]) {
    assert.doesNotMatch(MASTER, new RegExp(penanda.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `js_master.js tidak boleh memuat ${penanda}`);
  }
  assert.doesNotMatch(MASTER, /function \w*MarkupMaster\(/);
  // Fungsi panel digantikan fungsi form: tiga markup per tingkat tetap dijaga.
  assert.match(MASTER, /function idMarkupBarang\(t\)/);
  assert.match(MASTER, /function tingkatHargaBarang\(\)/);
  assert.match(MASTER, /function hitungMarkupBarang\(manual, ubah\)/);
  assert.match(MASTER, /function ubahModeMarkupBarang\(manual\)/);
  // Tombol "Tambah barang" dan tombol Ubah per baris tetap ada.
  assert.match(MASTER, /id="bgTambah"/);
  assert.match(MASTER, /<button class="btn btn-sm" data-edit=/);
  // CSS panel lama ikut dibuang, kelas .suggest milik kasir/Pembelian tetap ada.
  assert.doesNotMatch(CSS, /\.mk-cari/);
  assert.doesNotMatch(CSS, /\.mk-suggest/);
  assert.match(CSS, /\.suggest\{/);
  assert.match(CSS, /\.beli-suggest\{/);
});

test('Master Barang memakai istilah "Modal terakhir" dan tidak mengubah istilah Stok & Batch', () => {
  assert.match(MASTER, /title="Modal dari pembelian terakhir, sudah termasuk PPN dan sudah dikurangi diskon pembelian\.">Modal terakhir<\/th>/);
  assert.doesNotMatch(MASTER, /<th class="r">Modal efektif<\/th>/);
  assert.match(MASTER, /<th class="r" title="Biaya modal efektif untuk batch ini setelah PPN dan diskon">Modal efektif batch<\/th>/);
  assert.match(MASTER, /data-label="Modal efektif"/);
  assert.match(MASTER, /sudah termasuk PPN dan sudah dikurangi diskon pembelian/);
  assert.match(MASTER, /Harga jual SKU/);
});

test('Stock & Batch exposes SKU sale prices and batch margins', () => {
  assert.match(MASTER, /Margin batch/);
  assert.match(MASTER, /Margin_Umum/);
  assert.match(MASTER, /function marginStok/);
  assert.match(MASTER, /function marginStokCell/);
});

test('form Ubah barang: tombol Simpan perubahan mengirim harga hasil markup lewat barang.simpan', async () => {
  const m = bukaForm({ barang: barangContoh({ Harga_Modal: 1000, Harga_Jual_Umum: 0, Harga_Khusus: 0, Harga_Jual_Mutasi: 0 }) });
  const dok = m.dok;
  ketik(dok, 'fbMarkupUmum', '25');
  ketik(dok, 'fbMarkupNakes', '10');
  assert.equal(dok.elemen.fbUmum.value, '1300');
  assert.equal(dok.elemen.fbKhusus.value, '1100');
  const simpan = m.catatan.modal[0].tombol.filter((t) => t.label === 'Simpan perubahan')[0];
  assert.ok(simpan, 'form Ubah barang menyediakan tombol Simpan perubahan');
  simpan.aksi();
  await tunggu();
  const kirim = m.catatan.api.filter((x) => x.aksi === 'barang.simpan')[0];
  assert.ok(kirim, 'harga dikirim lewat aksi lama barang.simpan');
  assert.deepEqual(
    JSON.parse(JSON.stringify({ mode: kirim.data.mode, modal: kirim.data.Harga_Modal, umum: kirim.data.Harga_Jual_Umum, khusus: kirim.data.Harga_Khusus, mutasi: kirim.data.Harga_Jual_Mutasi })),
    { mode: 'edit', modal: 1000, umum: 1300, khusus: 1100, mutasi: 0 }
  );
  assert.equal(m.catatan.modalTutup, 1);
  assert.match(m.catatan.toast.map((t) => t.pesan).join(' '), /Barang tersimpan/);
});

test('form Tambah barang baru: modal diisi, markup langsung mengisi harga jual', () => {
  const m = bukaForm({ barang: null });
  const dok = m.dok;
  assert.equal(m.catatan.modal[0].judul, 'Tambah barang baru');
  assert.equal(dok.elemen.fbModal.value, '');
  ketik(dok, 'fbMarkupUmum', '25');
  assert.equal(dok.elemen.fbUmum.value, '0', 'tanpa modal belum ada harga yang dihitung');
  ketik(dok, 'fbModal', '4000');
  assert.equal(dok.elemen.fbUmum.value, '5000', 'modal 4.000 + 25% dibulatkan ke atas Rp100');
  assert.match(dok.elemen.fbMarginUmum.innerHTML, /20,0%/);
  assert.match(dok.elemen.fbMarginUmum.innerHTML, /chip-ok/);
  assert.match(dok.elemen.fbCatatan.textContent, /Markup dihitung dari Modal terakhir/);
});

test('form Ubah barang meng-escape teks dari data dan tidak merusak struktur modal', () => {
  const m = bukaForm({ barang: barangContoh({ Nama_Obat: '<b>Obat</b> & "lain"', Kode_Obat: '<x>', Kategori: '<i>k</i>' }) });
  const html = m.catatan.modal[0].html;
  assert.doesNotMatch(html, /<b>Obat<\/b>/);
  assert.match(html, /&lt;b&gt;Obat&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<x>/);
  assert.doesNotMatch(html, /<i>k<\/i>/);
  assert.equal((html.match(/<label/g) || []).length, (html.match(/<\/label>/g) || []).length);
  assert.equal((html.match(/<input/g) || []).length, (html.match(/<input[^>]*>/g) || []).length, 'setiap input ditutup ">"');
});
