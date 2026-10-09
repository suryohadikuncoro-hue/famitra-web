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

/** Jalankan muatStok() dengan DOM dan api tiruan untuk memeriksa baris yang dirender. */
function jalankanMuatStok(rows, opsi) {
  opsi = opsi || {};
  const dom = {
    stBody: { innerHTML: '' },
    stHint: { textContent: '' },
    stKritis: { checked: false },
    stKosong: { checked: opsi.sembunyikanKosong !== false }
  };
  const context = vm.createContext({
    STOK_LIMIT: 50,
    STOK_OFFSET: 0,
    document: { getElementById: function (id) { return dom[id] || null; } },
    val: function (id) {
      if (id === 'stStatus') return 'semua';
      if (id === 'stUrut') return 'nama';
      return '';
    },
    api: function () {
      return {
        then: function (cb) {
          cb({ rows: rows, total: rows.length, limit: 50, offset: 0, page_count: rows.length, has_more: false });
          return { catch: function () {} };
        }
      };
    },
    esc: function (v) { return String(v == null ? '' : v); },
    angka: function (v) { return String(v); },
    rupiah: function (v) { return String(v); },
    tglIndo: function (v) { return String(v || ''); },
    chipExpired: function () { return ''; },
    marginStokCell: function () { return ''; },
    gambarPagerStok: function () {},
    tabelKosong: function (pesan, kolom) {
      return '<tr><td colspan="' + (kolom || 8) + '" class="empty">' + pesan + '</td></tr>';
    },
    Number: Number, String: String, Math: Math
  });
  vm.runInContext(sumberFungsi('muatStok'), context);
  context.muatStok(0);
  return dom.stBody.innerHTML;
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
