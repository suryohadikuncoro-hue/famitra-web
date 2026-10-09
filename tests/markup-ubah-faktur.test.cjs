'use strict';
/* Uji markup pada form Pembelian saat sedang MENGUBAH faktur lama.
   Permintaan pemilik: "Saat ubah faktur pembelian, semua harga bisa ditetapkan
   di situ. Nyalakan perubahan harga/margin otomatis realtime ketika markup diubah,
   seperti skenario pada saat input faktur baru."
   Uji di berkas ini menjaga jaminan berikut:
   - pengaman terapkanMarkupBaris tidak lagi berhenti karena mode ubah faktur
   - membuka faktur lama menampilkan harga yang TERCATAT di faktur, bukan
     hitungan ulang dari markup saat ini
   - mengubah satu kolom markup hanya menghitung ulang tingkat itu; tingkat lain
     tidak tersentuh
   - harga yang diketik manual tidak tertimpa
   - margin/laba tingkat itu ikut berubah realtime
   - mode persen/rasio dan pembulatan memakai rumus yang sama dengan faktur baru
   - baris baru yang ditambah saat mengubah faktur tetap dihitung seperti biasa
   - jalur penyimpanan tidak berubah (harga jual tetap dikirim, mode edit tetap ada) */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const TRX = fs.readFileSync(path.join(root, 'public/js_trx.js'), 'utf8');

/** Ambil satu fungsi global dari berkas sumber (gaya repo: `function nama(`). */
function extractFunction(nama) {
  const start = TRX.indexOf(`function ${nama}(`);
  assert.notEqual(start, -1, `frontend function ${nama} exists`);
  const end = TRX.indexOf('\n}', start);
  assert.notEqual(end, -1, `frontend function ${nama} has a closing brace`);
  return TRX.slice(start, end + 2);
}

const context = vm.createContext({ Number, Math });
vm.runInContext([
  'function brutoBaris(it) { return (Number(it.Harga_Netto) || 0) * (Number(it.Qty) || 0) * (1 + (Number(it.PPN) || 0) / 100); }',
  'function val(id) { var el = document.getElementById(id); return el ? el.value : \'\'; }',
  'function gambarBeli() { }',
  extractFunction('diskonRupiahBaris'),
  extractFunction('hargaModalEfektifBeli'),
  extractFunction('marginPersenBeli'),
  extractFunction('hargaDariMarkupJS'),
  extractFunction('terapkanMarkupBaris'),
  extractFunction('terapkanMarkupSemuaBaris'),
  extractFunction('kunciHargaFakturBeli'),
  extractFunction('lepasKunciMarkupBeli'),
  extractFunction('htmlLabaBeli'),
  extractFunction('markupInputBeliKePersen'),
  extractFunction('markupPersenBeliKeInput'),
  extractFunction('padananMarkupBeli'),
  extractFunction('bacaMarkupBeli')
].join('\n'), context);

/** DOM mini: cukup untuk getElementById dan kolom markup form Pembelian. */
function dokumenMini(nilai) {
  const elemen = {};
  Object.keys(nilai || {}).forEach((id) => {
    elemen[id] = { value: String(nilai[id]), textContent: '', innerHTML: '' };
  });
  return {
    elemen,
    getElementById(id) { return elemen[id] || null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}

/** Mode "ubah faktur" dengan markup aktif; persen bawaan 50/30/20. */
function aktifkanMarkupUbah(ubah) {
  context.BELI = {
    editNoFaktur: 'PB-TEST-1',
    items: [],
    markup: Object.assign({ tersedia: true, valid: true, mode: 'persen', umum: 50, nakes: 30, mutasi: 20, pembulatan: 100 }, ubah || {})
  };
  return context.BELI;
}

/** Baris seperti hasil muat `beli.detail`: harga jual baru = nilai tercatat. */
function barisFaktur(ubah) {
  return Object.assign({
    Kode_Obat: 'OBT-1', Nama_Obat: 'Paracetamol', Qty: 10, Harga_Netto: 1000, PPN: 10, Diskon: 0,
    Harga_Jual_Umum_Baru: 2000, Harga_Khusus_Baru: 1800, Harga_Jual_Mutasi_Baru: 1600,
    Jual_Umum_Kini: 1500, Jual_Khusus_Kini: 1400, Jual_Mutasi_Kini: 1300,
    _manual: {}, _markupOtomatis: {}, _tercatat: {}
  }, ubah || {});
}

test('pengaman terapkanMarkupBaris tidak lagi berhenti karena mode ubah faktur', () => {
  const badan = extractFunction('terapkanMarkupBaris');
  assert.match(badan, /if \(!BELI\.markup\.tersedia\) return;/, 'perhitungan hanya berhenti bila pengaturan markup tidak tersedia');
  assert.doesNotMatch(badan, /editNoFaktur/, 'mode ubah faktur tidak lagi mematikan perhitungan markup');
  assert.doesNotMatch(badan, /BELI\.editNoFaktur/, 'syarat lama BELI.editNoFaktur sudah dibuang');
});

test('faktur lama dimuat: harga yang tampil adalah nilai tercatat, bukan hasil markup', () => {
  const beli = aktifkanMarkupUbah({ umum: 100 });
  const it = barisFaktur();
  beli.items = [it];
  // Modal efektif 1.100; markup 100% akan menghasilkan 2.200, bukan 2.000.
  assert.equal(context.hargaDariMarkupJS(context.hargaModalEfektifBeli(it), 100, 100), 2200);
  context.kunciHargaFakturBeli(beli.items);
  context.terapkanMarkupSemuaBaris();
  assert.equal(it.Harga_Jual_Umum_Baru, 2000, 'harga umum tetap seperti tercatat di faktur');
  assert.equal(it.Harga_Khusus_Baru, 1800, 'harga nakes tetap seperti tercatat di faktur');
  assert.equal(it.Harga_Jual_Mutasi_Baru, 1600, 'harga mutasi tetap seperti tercatat di faktur');
});

test('memuat faktur lama memasang kunci sebelum form digambar', () => {
  const badan = extractFunction('bukaUbahFaktur');
  assert.match(badan, /kunciHargaFakturBeli\(BELI\.items\)/, 'faktur lama yang dimuat mengunci harga tercatat');
  assert.ok(badan.indexOf('kunciHargaFakturBeli(BELI.items)') < badan.indexOf('gambarBeli()'),
    'kunci dipasang sebelum kolom harga digambar');
});

test('mode ubah: mengubah markup Umum menghitung ulang Umum saja', () => {
  const beli = aktifkanMarkupUbah({ umum: 100, nakes: 30, mutasi: 20 });
  const it = barisFaktur();
  beli.items = [it];
  context.kunciHargaFakturBeli(beli.items);
  context.lepasKunciMarkupBeli('umum');
  context.terapkanMarkupSemuaBaris();
  assert.equal(it.Harga_Jual_Umum_Baru, 2200, 'tingkat yang markupnya diubah langsung terhitung');
  assert.equal(it.Harga_Khusus_Baru, 1800, 'harga nakes tidak tersentuh');
  assert.equal(it.Harga_Jual_Mutasi_Baru, 1600, 'harga mutasi tidak tersentuh');
});

test('mode ubah: setiap tingkat punya kuncinya sendiri (nakes & mutasi)', () => {
  const beli = aktifkanMarkupUbah({ umum: 100, nakes: 100, mutasi: 100 });
  const it = barisFaktur();
  beli.items = [it];
  context.kunciHargaFakturBeli(beli.items);
  context.lepasKunciMarkupBeli('nakes');
  context.terapkanMarkupSemuaBaris();
  assert.equal(it.Harga_Jual_Umum_Baru, 2000, 'umum tetap tercatat');
  assert.equal(it.Harga_Khusus_Baru, 2200, 'nakes dihitung ulang');
  assert.equal(it.Harga_Jual_Mutasi_Baru, 1600, 'mutasi tetap tercatat');
  context.lepasKunciMarkupBeli('mutasi');
  context.terapkanMarkupSemuaBaris();
  assert.equal(it.Harga_Jual_Mutasi_Baru, 2200, 'mutasi dihitung ulang setelah markupnya diubah');
  assert.equal(it.Harga_Khusus_Baru, 2200, 'nakes tetap pada hitungan terakhirnya');
});

test('mode ubah: harga yang diketik manual tidak tertimpa', () => {
  const beli = aktifkanMarkupUbah({ umum: 100, nakes: 300, mutasi: 20 });
  const it = barisFaktur({ Harga_Khusus_Baru: 1750, _manual: { Harga_Khusus_Baru: true } });
  beli.items = [it];
  context.kunciHargaFakturBeli(beli.items);
  context.lepasKunciMarkupBeli('umum');
  context.terapkanMarkupSemuaBaris();
  assert.equal(it.Harga_Jual_Umum_Baru, 2200, 'tingkat lain tetap dihitung ulang');
  assert.equal(it.Harga_Khusus_Baru, 1750, 'harga manual tidak ditimpa markup tingkat lain');
  assert.equal(it.Harga_Jual_Mutasi_Baru, 1600, 'tingkat yang tidak diubah tetap seperti tercatat');
  context.lepasKunciMarkupBeli('nakes');
  context.terapkanMarkupSemuaBaris();
  assert.equal(it.Harga_Khusus_Baru, 1750, 'harga manual juga tidak ditimpa markup tingkatnya sendiri (perilaku faktur baru)');
});

test('mode ubah: harga manual pada satu tingkat tidak mengganggu tingkat lain', () => {
  const beli = aktifkanMarkupUbah({ umum: 100 });
  const it = barisFaktur({ Harga_Jual_Umum_Baru: 1999, _manual: { Harga_Jual_Umum_Baru: true } });
  beli.items = [it];
  context.kunciHargaFakturBeli(beli.items);
  context.lepasKunciMarkupBeli('umum');
  context.terapkanMarkupSemuaBaris();
  assert.equal(it.Harga_Jual_Umum_Baru, 1999, 'harga umum yang diketik tidak ditimpa');
});

test('mode ubah: margin/laba tingkat itu ikut berubah realtime', () => {
  const beli = aktifkanMarkupUbah({ umum: 100 });
  const it = barisFaktur();
  beli.items = [it];
  context.kunciHargaFakturBeli(beli.items);
  const modal = context.hargaModalEfektifBeli(it);
  assert.equal(modal, 1100, 'modal efektif termasuk PPN');
  assert.equal(Math.round(context.marginPersenBeli(it.Harga_Jual_Umum_Baru, modal) * 10) / 10, 45, 'laba awal dari harga tercatat');
  assert.match(context.htmlLabaBeli(it), /Umum[\s\S]*45,0%/);
  context.lepasKunciMarkupBeli('umum');
  context.terapkanMarkupSemuaBaris();
  assert.equal(Math.round(context.marginPersenBeli(it.Harga_Jual_Umum_Baru, modal) * 10) / 10, 50, 'laba ikut berubah setelah markup diubah');
  assert.match(context.htmlLabaBeli(it), /Umum[\s\S]*50,0%/, 'kolom Laba % menampilkan angka baru');
});

test('mode ubah memakai aturan mode rasio dan pembulatan yang sama', () => {
  const beli = aktifkanMarkupUbah({ mode: 'rasio', umum: 150, pembulatan: 500 });
  const it = barisFaktur();
  beli.items = [it];
  context.kunciHargaFakturBeli(beli.items);
  context.lepasKunciMarkupBeli('umum');
  context.terapkanMarkupSemuaBaris();
  // Rasio 2,5 = markup 150% → 1.100 × 2,5 = 2.750 → dibulatkan ke atas Rp500 = 3.000.
  assert.equal(it.Harga_Jual_Umum_Baru, context.hargaDariMarkupJS(1100, 150, 500));
  assert.equal(it.Harga_Jual_Umum_Baru, 3000, 'rasio dan pembulatan dihitung seperti faktur baru');
});

test('mode ubah: markup tidak tersedia tetap tidak menghitung apa pun', () => {
  const beli = aktifkanMarkupUbah({ umum: 100 });
  beli.markup.tersedia = false;
  const it = barisFaktur();
  beli.items = [it];
  context.terapkanMarkupSemuaBaris();
  assert.equal(it.Harga_Jual_Umum_Baru, 2000, 'tanpa pengaturan markup harga dibiarkan apa adanya');
});

test('mode ubah: baris baru yang ditambahkan tetap dihitung seperti faktur baru', () => {
  const beli = aktifkanMarkupUbah({ umum: 100 });
  const baru = barisFaktur({ Harga_Jual_Umum_Baru: 0, Harga_Khusus_Baru: 0, Harga_Jual_Mutasi_Baru: 0, PPN: 0 });
  beli.items = [barisFaktur()];
  context.kunciHargaFakturBeli(beli.items);
  beli.items.push(baru);
  context.terapkanMarkupSemuaBaris();
  assert.equal(baru.Harga_Jual_Umum_Baru, 2000, 'baris baru mendapat harga hasil markup');
});

test('jalur penyimpanan tidak berubah: harga jual tetap dikirim, mode edit tetap ada', () => {
  assert.match(TRX, /mode: BELI\.editNoFaktur \? 'edit' : 'baru'/, 'mode simpan masih dibedakan');
  for (const medan of ['Harga_Jual_Umum_Baru', 'Harga_Khusus_Baru', 'Harga_Jual_Mutasi_Baru']) {
    assert.match(TRX, new RegExp(`${medan}: it\\.${medan}`), `${medan} tetap dikirim saat menyimpan`);
  }
  assert.match(TRX, /api\('beli\.simpan'/, 'tetap memakai aksi API yang sama');
});

test('setiap kolom markup mengirim tingkatnya sendiri ke bacaMarkupBeli', () => {
  assert.match(TRX, /\[\['blMarkupUmum','umum'\],\['blMarkupNakes','nakes'\],\['blMarkupMutasi','mutasi'\]\]/, 'tiga kolom markup dipetakan ke tingkatnya');
  assert.match(TRX, /el\.oninput = function \(\) \{ bacaMarkupBeli\(x\[1\]\); \}/, 'handler input mengirim tingkat yang diubah');
  assert.match(TRX, /el\.onchange = function \(\) \{ bacaMarkupBeli\(x\[1\]\); \}/, 'handler change mengirim tingkat yang diubah');
  assert.match(TRX, /if \(tingkat\) lepasKunciMarkupBeli\(tingkat\);/, 'hanya tingkat yang diubah kuncinya dilepas');
});

test('integrasi: mengetik markup Umum pada mode ubah menghitung ulang hanya Umum', () => {
  const dom = dokumenMini({
    blMarkupMode: 'persen', blMarkupUmum: '50', blMarkupNakes: '30',
    blMarkupMutasi: '20', blMarkupPembulatan: '100', blMarkupStatus: ''
  });
  const beli = aktifkanMarkupUbah();
  const it = barisFaktur();
  beli.items = [it];
  context.document = dom;
  context.kunciHargaFakturBeli(beli.items);
  context.terapkanMarkupSemuaBaris();
  assert.equal(it.Harga_Jual_Umum_Baru, 2000, 'harga tercatat tampil saat faktur dibuka');
  dom.elemen.blMarkupUmum.value = '100';
  context.bacaMarkupBeli('umum');
  assert.equal(it.Harga_Jual_Umum_Baru, 2200, 'markup Umum yang diubah langsung menghitung ulang Umum');
  assert.equal(it.Harga_Khusus_Baru, 1800, 'Nakes tidak tersentuh');
  assert.equal(it.Harga_Jual_Mutasi_Baru, 1600, 'Mutasi tidak tersentuh');
  assert.equal(Math.round(context.marginPersenBeli(it.Harga_Jual_Umum_Baru, context.hargaModalEfektifBeli(it)) * 10) / 10, 50, 'laba Umum ikut berubah realtime');
  dom.elemen.blMarkupNakes.value = '100';
  context.bacaMarkupBeli('nakes');
  assert.equal(it.Harga_Khusus_Baru, 2200, 'markup Nakes menghitung ulang Nakes');
  assert.equal(it.Harga_Jual_Umum_Baru, 2200, 'Umum tetap pada hitungan terakhirnya');
  assert.equal(it.Harga_Jual_Mutasi_Baru, 1600, 'Mutasi tetap seperti tercatat di faktur');
});
