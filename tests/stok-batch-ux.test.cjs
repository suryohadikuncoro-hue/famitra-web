const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'public/js_master.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/style.css'), 'utf8');

/** Ambil source satu fungsi global beserta penutupnya untuk dijalankan di vm. */
function sumberFungsi(nama) {
  const start = js.indexOf('function ' + nama + '(');
  assert.notEqual(start, -1, 'fungsi ' + nama + ' ada di js_master.js');
  const end = js.indexOf('\n}', start);
  assert.notEqual(end, -1, 'fungsi ' + nama + ' punya penutup');
  return js.slice(start, end + 2);
}

/**
 * Jalankan formBatch() di konteks vm: modalBuka menangkap markup modal dan
 * tombol aksinya, val()/numVal() diisi nilai ujian, confirm() dicatat.
 */
function jalankanFormBatch(s, produk, opsi) {
  opsi = opsi || {};
  const nilai = opsi.nilai || {};
  const state = { judul: '', html: '', aksi: [], konfirmasi: [], api: [], toast: '' };
  const context = vm.createContext({
    esc: function (v) { return String(v == null ? '' : v); },
    modalBuka: function (judul, html, aksi) { state.judul = judul; state.html = html; state.aksi = aksi || []; },
    modalTutup: function () {},
    val: function (id) { return nilai[id] == null ? '' : String(nilai[id]); },
    numVal: function (id) { return Number(nilai[id] || 0); },
    toast: function (pesan) { state.toast = pesan; },
    confirm: function (pesan) { state.konfirmasi.push(pesan); return opsi.konfirmasi !== false; },
    api: function (nama, isi) {
      state.api.push({ nama: nama, isi: isi });
      return { then: function () { return { catch: function () {} }; } };
    },
    Number: Number, String: String, Math: Math
  });
  vm.runInContext(sumberFungsi('formBatch'), context);
  context.formBatch(s, produk);
  return state;
}

/** Tekan tombol "Simpan batch" pada modal hasil formBatch(). */
function simpanFormBatch(state) {
  const tombol = state.aksi.find(function (a) { return a.label === 'Simpan batch'; });
  assert.ok(tombol, 'modal batch menyediakan tombol "Simpan batch"');
  tombol.aksi();
  return state;
}

/** Fungsi global Stok & Batch yang ikut dijalankan di vm (perilaku nyata, bukan tiruan). */
const FUNGSI_STOK = [
  'muatStok', 'gambarPagerStok', 'marginStok', 'marginStokChip', 'marginStokCell', 'marginTinjauStok',
  'tipePerluTinjauStok', 'perluTinjauStok', 'ambangTinjauBawaan', 'ambangTinjauStok', 'ambangTinjauSatu',
  'tinjauStokBadge', 'pesanKosongStok'
];

/** Daftar tipe pelanggan diambil dari sumbernya supaya tidak ada daftar kembar di uji. */
const SUMBER_TIPE_STOK = js.match(/var STOK_TINJAU_TIPE = \[[\s\S]*?\];/)[0];

/** Ambil source satu fungsi global dengan mencocokkan kurung kurawal penutupnya. */
function sumberFungsiAman(nama) {
  const awal = js.indexOf('function ' + nama + '(');
  assert.notEqual(awal, -1, 'fungsi ' + nama + ' ada di js_master.js');
  let dalam = 0;
  for (let i = js.indexOf('{', awal); i < js.length; i++) {
    if (js[i] === '{') dalam++;
    else if (js[i] === '}') {
      dalam--;
      if (dalam === 0) return js.slice(awal, i + 1);
    }
  }
  throw new Error('fungsi ' + nama + ' tidak tertutup');
}

/**
 * Jalankan muatStok() dengan DOM dan api tiruan untuk memeriksa baris yang dirender.
 * Opsi: sembunyikanKosong (sakelar stKosong), tinjau (sakelar stTinjau), ambang (isi
 * kolom stTinjauAmbang), halaman(offset) untuk mengganti respons api per halaman.
 */
function jalankanMuatStokLengkap(rows, opsi) {
  opsi = opsi || {};
  /** opsi.ambang boleh angka (semua tipe) atau objek { Umum, Nakes, Mutasi }. */
  const nilaiAmbang = function (kunci) {
    if (typeof opsi.ambang === 'number') return String(opsi.ambang);
    const isi = (opsi.ambang || {})[kunci];
    return isi == null ? '20' : String(isi);
  };
  const dom = {
    stBody: { innerHTML: '' },
    stPager: { innerHTML: '' },
    stHint: { textContent: '' },
    stKritis: { checked: false },
    stKosong: { checked: opsi.sembunyikanKosong !== false },
    stTinjau: { checked: !!opsi.tinjau },
    stTinjauAmbangUmum: { value: nilaiAmbang('Umum') },
    stTinjauAmbangNakes: { value: nilaiAmbang('Nakes') },
    stTinjauAmbangMutasi: { value: nilaiAmbang('Mutasi') }
  };
  const panggilan = [];
  const context = vm.createContext({
    STOK_LIMIT: 50,
    STOK_OFFSET: 0,
    document: { getElementById: function (id) { return dom[id] || null; } },
    val: function (id) {
      if (id === 'stStatus') return 'semua';
      if (id === 'stUrut') return 'nama';
      if (dom[id] && dom[id].value != null) return String(dom[id].value);
      return '';
    },
    api: function (nama, isi) {
      panggilan.push({ nama: nama, isi: isi });
      const res = opsi.halaman
        ? opsi.halaman(Number(isi.offset || 0))
        : { rows: rows, total: rows.length, limit: 50, offset: 0, page_count: rows.length, has_more: false };
      return {
        then: function (cb) { cb(res); return { catch: function () {} }; }
      };
    },
    esc: function (v) { return String(v == null ? '' : v); },
    angka: function (v) { return String(v); },
    rupiah: function (v) { return String(v); },
    tglIndo: function (v) { return String(v || ''); },
    chipExpired: function () { return ''; },
    tabelKosong: function (pesan, kolom) {
      return '<tr><td colspan="' + (kolom || 8) + '" class="empty">' + pesan + '</td></tr>';
    },
    isFinite: isFinite, Number: Number, String: String, Math: Math
  });
  for (const nama of FUNGSI_STOK) vm.runInContext(sumberFungsiAman(nama), context);
  vm.runInContext(SUMBER_TIPE_STOK, context);
  context.muatStok(0);
  return { html: dom.stBody.innerHTML, pager: dom.stPager.innerHTML, hint: dom.stHint.textContent, panggilan: panggilan };
}

/** HTML baris tabel hasil muatStok() saja (kontrak lama tetap dipertahankan). */
function jalankanMuatStok(rows, opsi) {
  return jalankanMuatStokLengkap(rows, opsi).html;
}

/** Atribut boolean pada tag <input id="..."> hasil render modal. */
function punyaAtribut(html, id, atribut) {
  const tag = html.match(new RegExp('<input id="' + id + '"[^>]*>'));
  assert.ok(tag, 'input ' + id + ' dirender di modal batch');
  return new RegExp('\\b' + atribut + '\\b').test(tag[0]);
}

/** Cari <input> yang tidak ditutup '>' sebelum tag berikutnya (bug markup modal). */
function inputTakTertutup(html) {
  const rusak = [];
  let i = html.indexOf('<input');
  while (i !== -1) {
    const berikut = html.indexOf('<', i + 6);
    const potong = html.slice(i, berikut === -1 ? html.length : berikut);
    if (potong.indexOf('>') === -1) rusak.push(potong);
    i = html.indexOf('<input', i + 6);
  }
  return rusak;
}

test('Stok & Batch memakai kontrak tabel yang cocok untuk tampilan kartu responsif', () => {
  assert.match(js, /<table data-tk="1" data-stok-table="1">/);
  for (const label of ['Batch / status', 'Kedaluwarsa', 'Sisa waktu', 'Stok', 'Modal efektif', 'Margin batch']) {
    assert.match(js, new RegExp('data-label="' + label + '"'));
  }
  assert.match(js, /class="c tk-aksi"/);
  assert.match(css, /table\[data-tk="1"\] thead\{display:none\}/);
  assert.match(css, /table\[data-tk="1"\] td::before\{content:attr\(data-label\)/);
});

test('kolom harga jual SKU dibuang dari baris batch, baris margin ringkas dipertahankan', () => {
  // Perilaku lama (helper hargaStokCell + daftar harga bertingkat) tidak dipakai lagi.
  assert.doesNotMatch(js, /data-label="Harga jual SKU"/);
  assert.doesNotMatch(js, /function hargaStokCell\(s\)/);
  assert.doesNotMatch(js, /class="st-price-list"/);
  // Fungsi hargaStok() sudah tanpa pemanggil, jadi ikut dibuang.
  assert.doesNotMatch(js, /function hargaStok\(/);
  // CSS kelas itu harus benar-benar hilang dari stylesheet.
  assert.doesNotMatch(css, /\.st-price-list/);
  // Perilaku pengganti: tiga margin tetap dirender sebagai baris ringkas.
  assert.match(js, /function marginStokCell\(s\)/);
  assert.match(js, /class="st-margin-list"/);
  assert.match(css, /\.st-margin-list>div\{display:flex/);
  assert.match(css, /\.st-margin-list \.chip\{/);
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

test('baris batch tetap memuat modal efektif dan Margin batch tanpa kolom harga jual', () => {
  const mulai = js.indexOf('<table data-tk="1" data-stok-table="1">');
  const header = js.slice(mulai, js.indexOf('</tr></thead>', mulai));
  assert.equal((header.match(/<th[ >]/g) || []).length, 8, 'jumlah kolom header sesuai 8 sel baris');
  assert.match(header, /Modal efektif batch/);
  assert.match(header, /Margin batch/);
  assert.doesNotMatch(header, /Harga jual SKU<\/th>/);
  // Sel baris tetap punya label kartu untuk modal efektif dan margin batch.
  const barisStok = sumberFungsi('muatStok');
  assert.match(barisStok, /data-label="Modal efektif"/);
  assert.match(barisStok, /data-label="Margin batch"/);
  assert.doesNotMatch(barisStok, /data-label="Harga jual SKU"/);
  assert.match(barisStok, /marginStokCell\(s\)/);
  // colspan baris status ikut turun dari 10 menjadi 9 setelah kolom dibuang.
  assert.match(barisStok, /colspan="9"/);
  assert.doesNotMatch(barisStok, /colspan="10"/);
});

test('modal batch menutup atribut value sehingga nilai modal efektif tampil', () => {
  // Bug lama: penutup "> hilang sehingga nilai modal menelan sisa markup modal.
  const state = jalankanFormBatch(
    { ID_Batch: 'b1', Kode_Obat: 'OB001', Kode_Batch: 'B01', Expired_Date: '2027-01-01', Stok_Real: 3, Harga_Modal_Batch: 12500 },
    null
  );
  assert.deepEqual(inputTakTertutup(state.html), [], 'setiap input modal harus ditutup ">"');
  assert.ok(state.html.includes('value="12500"></label>'), 'input modal efektif harus tertutup rapat sebelum </label>');
  assert.match(state.html, /<input id="fsModal"[^>]*value="12500"\s*>/);
  assert.equal((state.html.match(/<label/g) || []).length, (state.html.match(/<\/label>/g) || []).length);
});

test('kode obat dan kode batch bisa diubah saat mengubah batch', () => {
  const batch = { ID_Batch: 'b1', Kode_Obat: 'OB001', Kode_Batch: 'B01', Expired_Date: '2027-01-01', Stok_Real: 3, Harga_Modal_Batch: 1000 };
  const ubah = jalankanFormBatch(batch, null);
  assert.equal(punyaAtribut(ubah.html, 'fsKode', 'readonly'), false, 'kode obat tidak readonly saat mengubah batch');
  assert.equal(punyaAtribut(ubah.html, 'fsBatch', 'readonly'), true, 'kode batch terkunci bila sudah terisi');

  // Ketentuan lama: batch dengan kode kosong tetap boleh diperbaiki kodenya.
  const kodeKosong = jalankanFormBatch({ ID_Batch: 'b2', Kode_Obat: 'OB002', Kode_Batch: '  ', Expired_Date: '2027-01-01', Stok_Real: 0, Harga_Modal_Batch: null }, null);
  assert.equal(punyaAtribut(kodeKosong.html, 'fsKode', 'readonly'), false);
  assert.equal(punyaAtribut(kodeKosong.html, 'fsBatch', 'readonly'), false, 'kode batch kosong harus bisa diisi');
  assert.match(kodeKosong.html, /Kode batch pada data ini kosong/);

  // Tambah batch untuk barang tertentu tetap mengunci kode obat dari konteks barang.
  const tambah = jalankanFormBatch(null, { Kode_Obat: 'OB003', Nama_Obat: 'Paracetamol' });
  assert.equal(punyaAtribut(tambah.html, 'fsKode', 'readonly'), true, 'kode obat terkunci saat menambah batch barang');
  assert.equal(punyaAtribut(tambah.html, 'fsBatch', 'readonly'), false);
});

test('mengubah kode obat atau kode batch saat edit meminta konfirmasi perpindahan stok', () => {
  const batch = { ID_Batch: 'b1', Kode_Obat: 'OB001', Kode_Batch: 'B01', Expired_Date: '2027-01-01', Stok_Real: 3, Harga_Modal_Batch: 1000 };
  const dasar = { fsExp: '2027-01-01', fsStok: 3, fsModal: 1000 };

  // Kode obat berpindah barang: confirm muncul, dan pembatalan membatalkan simpan.
  const pindah = simpanFormBatch(jalankanFormBatch(batch, null, { nilai: Object.assign({ fsKode: 'OB002', fsBatch: 'B01' }, dasar), konfirmasi: false }));
  assert.equal(pindah.konfirmasi.length, 1, 'confirm dipanggil sekali saat kode berubah');
  assert.match(pindah.konfirmasi[0], /berpindah barang/);
  assert.match(pindah.konfirmasi[0], /OB001/);
  assert.match(pindah.konfirmasi[0], /OB002/);
  assert.equal(pindah.api.length, 0, 'pembatalan tidak menyimpan batch');

  // Kode batch berubah juga wajib konfirmasi.
  const gantiBatch = simpanFormBatch(jalankanFormBatch(batch, null, { nilai: Object.assign({ fsKode: 'OB001', fsBatch: 'B02' }, dasar) }));
  assert.equal(gantiBatch.konfirmasi.length, 1);
  assert.equal(gantiBatch.api.length, 1);

  // Kode sama (beda huruf besar/kecil) tidak mengganggu penyimpanan.
  const sama = simpanFormBatch(jalankanFormBatch(batch, null, { nilai: Object.assign({ fsKode: 'ob001', fsBatch: 'B01' }, dasar) }));
  assert.equal(sama.konfirmasi.length, 0, 'kode tidak berubah berarti tanpa confirm');
  assert.equal(sama.api.length, 1);
  assert.equal(sama.api[0].nama, 'stok.simpanBatch');

  // Tambah batch baru tidak pernah minta konfirmasi.
  const tambah = simpanFormBatch(jalankanFormBatch(null, { Kode_Obat: 'OB009' }, { nilai: Object.assign({ fsKode: 'OB009', fsBatch: 'B09' }, dasar) }));
  assert.equal(tambah.konfirmasi.length, 0);
  assert.equal(tambah.api.length, 1);
});

test('sakelar stKosong aktif bawaan dan menyaring baris berstok nol', () => {
  assert.match(js, /id="stKosong" type="checkbox" checked/);
  assert.match(js, /Sembunyikan stok kosong/);
  assert.match(js, /document\.getElementById\('stKosong'\)\.onchange = function \(\) \{ muatStok\(0\); \}/);
  assert.match(js, /var sembunyikanKosong = document\.getElementById\('stKosong'\)\.checked;/);
  assert.match(js, /Number\(s\.Stok_Real \|\| 0\) <= 0/);

  const rows = [
    { Nama_Obat: 'Ada stok', Kode_Obat: 'OB1', Kode_Batch: 'B1', Expired_Date: '2027-01-01', Stok_Real: 5, Harga_Modal_Batch: 1000 },
    { Nama_Obat: 'Habis', Kode_Obat: 'OB2', Kode_Batch: 'B2', Expired_Date: '2027-01-01', Stok_Real: 0, Harga_Modal_Batch: null }
  ];
  const tampil = jalankanMuatStok(rows);
  assert.ok(tampil.includes('OB1'), 'baris berstok tampil');
  assert.ok(!tampil.includes('OB2'), 'baris berstok 0 disembunyikan secara bawaan');

  const semua = jalankanMuatStok(rows, { sembunyikanKosong: false });
  assert.ok(semua.includes('OB1') && semua.includes('OB2'), 'mematikan sakelar menampilkan stok 0');

  const kosongSemua = jalankanMuatStok([rows[1]]);
  assert.match(kosongSemua, /berstok 0 dan disembunyikan/);
});

/* ------------------------------------------- Penyaring "Perlu ditinjau" --- */

/**
 * Baris ujian penyaring per tipe. Angka Margin_* di sini adalah angka yang sama
 * dengan yang dirender kolom "Margin batch", jadi hasil penyaringan bisa
 * dibandingkan langsung dengan isi kolom.
 */
const BARIS_TINJAU = [
  { Nama_Obat: 'Lolos semua tipe', Kode_Obat: 'OB1', Kode_Batch: 'B1', Expired_Date: '2027-01-01', Stok_Real: 5, Harga_Modal_Batch: 5000, Margin_Umum: 40, Margin_Nakes: 35, Margin_Mutasi: 30 },
  { Nama_Obat: 'Gagal di Nakes', Kode_Obat: 'OB2', Kode_Batch: 'B2', Expired_Date: '2027-01-01', Stok_Real: 4, Harga_Modal_Batch: 9000, Margin_Umum: 30, Margin_Nakes: 5, Margin_Mutasi: 25 },
  { Nama_Obat: 'Gagal di Apotek lain', Kode_Obat: 'OB3', Kode_Batch: 'B3', Expired_Date: '2027-01-01', Stok_Real: 3, Harga_Modal_Batch: 9000, Margin_Umum: 30, Margin_Nakes: 25, Margin_Mutasi: 2 },
  { Nama_Obat: 'Margin negatif', Kode_Obat: 'OB4', Kode_Batch: 'B4', Expired_Date: '2027-01-01', Stok_Real: 2, Harga_Modal_Batch: 12000, Margin_Umum: -15, Margin_Nakes: -20, Margin_Mutasi: -25 },
  { Nama_Obat: 'Modal kosong', Kode_Obat: 'OB5', Kode_Batch: 'B5', Expired_Date: '2027-01-01', Stok_Real: 1, Harga_Modal_Batch: null, Margin_Umum: null, Margin_Nakes: null, Margin_Mutasi: null }
];

/** Ambang uji bawaan: sama untuk ketiga tipe, seperti nilai bawaan di aplikasi. */
const AMBANG_UJI = { Umum: 20, Nakes: 20, Mutasi: 20 };

/** Hitung sendiri dari angka kolom: perlu ditinjau bila satu tipe saja di bawah ambangnya. */
function perluTinjauDariKolom(row, ambang) {
  return ['Umum', 'Nakes', 'Mutasi'].some(function (kunci) {
    const m = row['Margin_' + kunci];
    return m == null || m < ambang[kunci];
  });
}

/** Render layar Stok & Batch utuh dengan DOM tiruan; dipakai memeriksa deretan penyaring. */
function renderStok() {
  const dom = {};
  const elemenKosong = function () {
    return {
      innerHTML: '', textContent: '', value: '', checked: false, placeholder: '',
      onclick: null, onchange: null, oninput: null,
      addEventListener: function () {}, closest: function () { return null; }
    };
  };
  const context = vm.createContext({
    VIEWS: {},
    document: { getElementById: function (id) { if (!dom[id]) dom[id] = elemenKosong(); return dom[id]; } },
    val: function () { return ''; },
    api: function () { return { then: function () { return { catch: function () {} }; } }; },
    esc: function (v) { return String(v == null ? '' : v); },
    angka: function (v) { return String(v); },
    rupiah: function (v) { return String(v); },
    tglIndo: function (v) { return String(v || ''); },
    chipExpired: function () { return ''; },
    tabelKosong: function () { return ''; },
    clearTimeout: function () {}, setTimeout: function () {},
    isFinite: isFinite, Number: Number, String: String, Math: Math
  });
  vm.runInContext(js, context);
  vm.runInContext('VIEWS.stok.render(document.getElementById("app"))', context);
  return dom.app.innerHTML;
}

test('penyaring "Perlu ditinjau" tersedia di Stok & Batch, mati bawaan, dengan satu ambang per tipe', () => {
  const html = renderStok();
  const tag = html.match(/<input id="stTinjau"[^>]*>/);
  assert.ok(tag, 'sakelar "Perlu ditinjau" dirender di deretan penyaring Stok & Batch');
  assert.equal(/\bchecked\b/.test(tag[0]), false, 'sakelar "Perlu ditinjau" mati secara bawaan');
  assert.match(html, /Sembunyikan stok kosong/);

  // Tiga kolom ambang, satu per tipe, masing-masing bertipe number dengan bawaan 20%.
  for (const [label, id] of [['Umum', 'stTinjauAmbangUmum'], ['Nakes', 'stTinjauAmbangNakes'], ['Apotek lain', 'stTinjauAmbangMutasi']]) {
    const input = html.match(new RegExp('<input id="' + id + '"[^>]*>'));
    assert.ok(input, 'kolom ambang ' + label + ' dirender');
    assert.match(input[0], /type="number"/);
    assert.match(input[0], /value="20"/, 'ambang ' + label + ' bawaan 20%');
    assert.match(html, new RegExp(label + ' <input id="' + id + '"'), 'label ' + label + ' menempel pada kolomnya');
  }
  assert.equal((html.match(/<input id="stTinjauAmbang/g) || []).length, 3, 'tepat tiga kolom ambang');

  // Angka bawaan 20% hanya hidup di satu fungsi kecil yang mudah diganti sumbernya.
  assert.match(js, /function ambangTinjauBawaan\(\) \{\s+return \{ Umum: 20, Nakes: 20, Mutasi: 20 \};/);
  assert.equal((js.match(/Umum: 20, Nakes: 20, Mutasi: 20/g) || []).length, 1, 'bawaan 20% tidak disebar');
  assert.match(js, /label: 'Apotek lain'/, 'tipe ketiga dilabeli "Apotek lain" seperti Master Barang');

  assert.match(js, /document\.getElementById\('stTinjau'\)\.onchange = function \(\) \{ muatStok\(0\); \}/);
  assert.match(js, /var tinjauAktif = document\.getElementById\('stTinjau'\)\.checked;/);
  assert.match(js, /perluTinjauStok\(s, ambangTinjau\)/);
  // Penyaring hanya di sisi tampilan: tidak ada nama aksi API baru.
  assert.doesNotMatch(js, /api\('stok\.tinjau/);
});

test('baris tampil bila satu tipe gagal di ambang tipe itu, dan hilang bila ketiganya lolos', () => {
  const mati = jalankanMuatStok(BARIS_TINJAU);
  for (const row of BARIS_TINJAU) assert.ok(mati.includes(row.Nama_Obat), row.Nama_Obat + ' tampil saat penyaring mati');

  const aktif = jalankanMuatStok(BARIS_TINJAU, { tinjau: true });
  assert.ok(!aktif.includes('Lolos semua tipe'), 'lolos di ketiga tipe disembunyikan');
  assert.ok(aktif.includes('Gagal di Nakes'), 'lolos di Umum tetapi gagal di Nakes tetap tampil');
  assert.ok(aktif.includes('Gagal di Apotek lain'), 'lolos di Nakes tetapi gagal di Apotek lain tetap tampil');
  assert.ok(aktif.includes('Margin negatif'), 'margin negatif tetap tampil');
  assert.ok(aktif.includes('Modal kosong'), 'baris bermodal kosong tetap tampil');

  // Setiap baris cocok dengan perhitungan dari angka kolom "Margin batch".
  for (const row of BARIS_TINJAU) {
    assert.equal(aktif.includes(row.Nama_Obat), perluTinjauDariKolom(row, AMBANG_UJI),
      row.Nama_Obat + ' sesuai angka kolom Margin batch');
  }
});

test('penanda menyebut tipe yang memicu dan angkanya sama dengan kolom "Margin batch"', () => {
  const aktif = jalankanMuatStok(BARIS_TINJAU, { tinjau: true });
  const baris = function (nama) {
    const mulai = aktif.indexOf(nama);
    assert.notEqual(mulai, -1, 'baris ' + nama + ' ada');
    return aktif.slice(mulai, aktif.indexOf('</tr>', mulai));
  };
  assert.match(baris('Gagal di Nakes'), /Nakes: 5,0% < 20,0%/, 'penanda menyebut Nakes beserta angkanya');
  assert.doesNotMatch(baris('Gagal di Nakes'), /Umum: /, 'Umum 30% yang lolos tidak ikut ditandai');
  assert.match(baris('Gagal di Apotek lain'), /Apotek lain: 2,0% < 20,0%/, 'penanda menyebut Apotek lain');
  assert.match(baris('Margin negatif'), /Umum: -15,0% < 20,0%/, 'penanda margin negatif memakai angkanya');
  assert.match(baris('Modal kosong'), /Modal batch kosong/);

  // Angka di penanda identik dengan chip di kolom Margin batch baris yang sama.
  for (const [nama, angka] of [['Gagal di Nakes', '5,0%'], ['Gagal di Apotek lain', '2,0%'], ['Margin negatif', '-15,0%']]) {
    const jumlah = (baris(nama).match(new RegExp(angka, 'g')) || []).length;
    assert.ok(jumlah >= 2, 'kolom dan penanda memakai angka ' + angka + ' yang sama pada ' + nama);
  }

  // Tanpa penyaring, tidak ada penanda tambahan.
  assert.doesNotMatch(jalankanMuatStok(BARIS_TINJAU), /st-tinjau-badge/);
});

test('mengubah salah satu ambang hanya menggeser tipe itu', () => {
  // Ambang Nakes diturunkan ke 3%: baris dengan Nakes 5% kembali lolos di semua tipe.
  const longgar = jalankanMuatStok(BARIS_TINJAU, { tinjau: true, ambang: { Nakes: 3 } });
  assert.ok(!longgar.includes('Gagal di Nakes'), 'Nakes 5% tidak lagi di bawah ambang 3%');
  assert.ok(longgar.includes('Gagal di Apotek lain'), 'ambang Apotek lain tidak ikut berubah');

  // Ambang Umum dinaikkan ke 35%: Umum 40% masih aman, Umum 30% ikut memicu.
  const ketat = jalankanMuatStok(BARIS_TINJAU, { tinjau: true, ambang: { Umum: 35 } });
  assert.ok(!ketat.includes('Lolos semua tipe'), 'Umum 40% masih di atas ambang 35%');
  assert.match(ketat, /Umum: 30,0% < 35,0%/, 'penanda memakai ambang baru');

  // Ambang kosong atau tidak sah kembali ke bawaan 20%.
  const bawaan = jalankanMuatStok(BARIS_TINJAU, { tinjau: true, ambang: { Nakes: '', Mutasi: 'abc' } });
  assert.match(bawaan, /Nakes: 5,0% < 20,0%/, 'ambang kosong kembali ke bawaan');
  assert.match(bawaan, /Apotek lain: 2,0% < 20,0%/, 'ambang tidak sah kembali ke bawaan');
});

test('baris yang harganya belum ada tetap tampil dan ditandai, bukan dibuang', () => {
  const aktif = jalankanMuatStok(BARIS_TINJAU, { tinjau: true });
  assert.ok(aktif.includes('Modal kosong'));
  assert.match(aktif, /Modal batch kosong/);
  assert.match(aktif, /st-tinjau-badge/);

  const tanpaHarga = jalankanMuatStok([{
    Nama_Obat: 'Harga Nakes kosong', Kode_Obat: 'OB8', Kode_Batch: 'B8', Expired_Date: '2027-01-01',
    Stok_Real: 2, Harga_Modal_Batch: 5000, Margin_Umum: 40, Margin_Nakes: null, Margin_Mutasi: 30
  }], { tinjau: true });
  assert.match(tanpaHarga, /Harga Nakes kosong/, 'harga satu tipe yang kosong tetap ditinjau');
  assert.match(tanpaHarga, /Nakes: harga jual belum ada/);
});

test('penyaring "Perlu ditinjau" bekerja bersama sakelar "Sembunyikan stok kosong"', () => {
  const rows = BARIS_TINJAU.concat([
    { Nama_Obat: 'Kosong perlu tinjau', Kode_Obat: 'OB6', Kode_Batch: 'B6', Expired_Date: '2027-01-01', Stok_Real: 0, Harga_Modal_Batch: 8000, Margin_Umum: -3, Margin_Nakes: 10, Margin_Mutasi: 25 },
    { Nama_Obat: 'Kosong lolos tipe', Kode_Obat: 'OB7', Kode_Batch: 'B7', Expired_Date: '2027-01-01', Stok_Real: 0, Harga_Modal_Batch: 8000, Margin_Umum: 60, Margin_Nakes: 60, Margin_Mutasi: 60 }
  ]);

  const keduanya = jalankanMuatStokLengkap(rows, { tinjau: true });
  assert.ok(!keduanya.html.includes('Kosong perlu tinjau'), 'stok 0 tetap disembunyikan stKosong');
  assert.ok(!keduanya.html.includes('Kosong lolos tipe'), 'stok 0 yang lolos tipe tetap disembunyikan');
  assert.ok(keduanya.html.includes('Gagal di Nakes') && keduanya.html.includes('Modal kosong'));
  assert.match(keduanya.pager, /baris berstok 0 disembunyikan/);
  assert.match(keduanya.pager, /baris margin di atas ambang disembunyikan/);

  const hanyaTinjau = jalankanMuatStokLengkap(rows, { tinjau: true, sembunyikanKosong: false });
  assert.ok(hanyaTinjau.html.includes('Kosong perlu tinjau'), 'stKosong mati menampilkan stok 0 yang perlu ditinjau');
  assert.ok(!hanyaTinjau.html.includes('Kosong lolos tipe'), 'stok 0 yang lolos tipe tetap disaring penyaring tinjau');
  assert.doesNotMatch(hanyaTinjau.pager, /baris berstok 0 disembunyikan/);

  const hanyaKosong = jalankanMuatStokLengkap(rows, { tinjau: false });
  assert.ok(hanyaKosong.html.includes('Lolos semua tipe'), 'tinjau mati: baris sehat kembali tampil');
  assert.ok(!hanyaKosong.html.includes('Kosong lolos tipe'), 'stKosong tetap bekerja sendiri');
  assert.doesNotMatch(hanyaKosong.pager, /margin di atas ambang disembunyikan/);
  assert.match(hanyaKosong.pager, /baris berstok 0 disembunyikan/);

  // Penyaring ini hanya menyaring tampilan: permintaan ke api tidak berubah.
  const kirim = jalankanMuatStokLengkap(BARIS_TINJAU, { tinjau: true }).panggilan;
  assert.equal(kirim.length, 1);
  assert.equal(kirim[0].nama, 'stok.list');
  assert.deepEqual(Object.keys(kirim[0].isi).sort(), ['jenis', 'kritis', 'limit', 'offset', 'q', 'sort', 'status']);
});

test('catatan jumlah baris yang disembunyikan muncul seperti pola sakelar stok kosong', () => {
  const aktif = jalankanMuatStokLengkap(BARIS_TINJAU, { tinjau: true });
  assert.match(aktif.pager, /1 baris margin di atas ambang disembunyikan/);
  assert.doesNotMatch(jalankanMuatStokLengkap(BARIS_TINJAU).pager, /margin di atas ambang disembunyikan/,
    'catatan tidak muncul saat penyaring mati');

  const sehat2 = Object.assign({}, BARIS_TINJAU[0], { Nama_Obat: 'Lolos semua tipe juga', Margin_Umum: 50, Margin_Nakes: 50, Margin_Mutasi: 50 });
  const dua = jalankanMuatStokLengkap([BARIS_TINJAU[0], sehat2, BARIS_TINJAU[1]], { tinjau: true });
  assert.match(dua.pager, /2 baris margin di atas ambang disembunyikan/);
});

test('halaman yang tersaring habis karena "Perlu ditinjau" maju otomatis ke halaman berikutnya', () => {
  const hasil = jalankanMuatStokLengkap([], {
    tinjau: true,
    halaman: function (offset) {
      return offset === 0
        ? { rows: [BARIS_TINJAU[0]], total: 2, limit: 50, offset: 0, page_count: 1, has_more: true, next_offset: 50 }
        : { rows: [BARIS_TINJAU[1]], total: 2, limit: 50, offset: offset, page_count: 1, has_more: false };
    }
  });
  assert.ok(hasil.html.includes('Gagal di Nakes'), 'halaman berikutnya dimuat otomatis');
  assert.doesNotMatch(hasil.html, /tidak lolos penyaring/);
});

test('halaman yang seluruhnya tersaring memberi pesan yang menyebut penyaring Perlu ditinjau', () => {
  const hasil = jalankanMuatStokLengkap([BARIS_TINJAU[0]], { tinjau: true });
  assert.match(hasil.html, /tidak lolos penyaring "Perlu ditinjau"/);
  assert.match(hasil.hint, /Umum, Nakes, Apotek lain/);
  assert.match(hasil.pager, /1 baris margin di atas ambang disembunyikan/);
  assert.doesNotMatch(hasil.pager, /berstok 0/, 'catatan stok kosong tidak dipakai saat penyebabnya ambang margin');
});
