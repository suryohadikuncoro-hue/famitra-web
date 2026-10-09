// Suite regresi offline untuk indikator kelayakan undian (lottery) di layar kasir.
// Run: node tests/undian-indikator-kasir.test.cjs
// Tanpa kredensial, package, database, browser, atau jaringan.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = f => fs.readFileSync(path.join(root, f), 'utf8');

const BERKAS_PROMO = 'supabase/functions/promo/index.ts';
const BERKAS_POS = 'public/js_pos.js';

// Mengambil satu blok kode berimbang kurung kurawal mulai dari `tanda`. Dipakai
// supaya pemeriksaan teks hanya berlaku pada fungsi/blok yang dimaksud, bukan
// seluruh berkas: pola `min_belanja` lama masih dipakai dashboardAktif, dan
// `!POS.items.length` masih wajar di bagian kasir yang lain (mis. validasi
// simpan nota), jadi keduanya TIDAK boleh diperiksa seberkas penuh.
function blokKode(teks, tanda) {
  const i = teks.indexOf(tanda);
  assert.notEqual(i, -1, 'tidak menemukan penanda: ' + tanda);
  const buka = teks.indexOf('{', i);
  assert.notEqual(buka, -1, 'tidak menemukan kurung kurawal pembuka: ' + tanda);
  let dalam = 0;
  for (let j = buka; j < teks.length; j++) {
    if (teks[j] === '{') dalam++;
    else if (teks[j] === '}') { dalam--; if (dalam === 0) return teks.slice(i, j + 1); }
  }
  throw new Error('kurung kurawal tidak berimbang pada: ' + tanda);
}
const rapat = teks => teks.replace(/\s+/g, ' ');

// =====================================================================
// Bagian A: tiruan rumus kelayakan undian.
// Ini TIRUAN dari kode server, BUKAN pemanggilan database. Sumbernya:
//   - posPromo() di supabase/functions/promo/index.ts (blok `let undianPelanggan`),
//   - participantData() di supabase/functions/lottery/index.ts (filter peserta).
// Aturan yang ditiru, sama untuk saran kasir maupun daftar peserta:
//   - pelanggan bertipe "Apotek Lain" TIDAK pernah memenuhi syarat;
//   - hanya transaksi yang nomor WA-nya cocok DAN tanggalnya di dalam periode
//     campaign (tanggal >= periode_mulai dan tanggal <= periode_selesai,
//     keduanya INKLUSIF) yang ikut dihitung;
//   - transaksi hanya DIHITUNG bila harga_akhir >= min_belanja_per_transaksi_idr
//     (kolom belum ada / 0 = perilaku lama, semua transaksi dihitung);
//   - memenuhi bila jumlah transaksi yang dihitung >= max(1, min_jumlah_transaksi)
//     DAN total harga_akhir transaksi yang dihitung >= min_total_belanja_idr.
// Pencocokan nomor WA tidak diuji di sini karena pada posPromo penyaringan
// nomor_wa=eq. dilakukan server; yang diuji adalah aritmetika minimumnya.
// =====================================================================
const angka = (v, bawaan) => (v === undefined || v === null ? bawaan : Number(v));

function memenuhiUndian(input) {
  const u = input.campaign || {};
  const tipe = input.tipe_customer === undefined || input.tipe_customer === null ? 'Umum' : input.tipe_customer;
  // Apotek Lain dilewati lebih dulu, sama seperti `if (tipe !== "Apotek Lain")`
  // di posPromo dan `tipe_customer=neq.Apotek Lain` di participantData.
  if (tipe === 'Apotek Lain') return false;

  const mulai = String(u.periode_mulai === undefined || u.periode_mulai === null ? '' : u.periode_mulai);
  const selesai = String(u.periode_selesai === undefined || u.periode_selesai === null ? '' : u.periode_selesai);
  const minPer = angka(u.min_belanja_per_transaksi_idr, 0);
  const minTrx = Math.max(1, angka(u.min_jumlah_transaksi, 1));
  const minTotal = angka(u.min_total_belanja_idr, 0);

  let n = 0;
  let total = 0;
  for (const t of input.transaksi || []) {
    // Tanggal bisnis berformat YYYY-MM-DD, jadi perbandingan teks = perbandingan
    // tanggal; batas awal dan akhir periode ikut dihitung (gte/lte).
    const tanggal = String(t.tanggal === undefined || t.tanggal === null ? '' : t.tanggal);
    if (tanggal < mulai || tanggal > selesai) continue;
    const a = angka(t.harga_akhir, 0);
    if (a >= minPer) { n++; total += a; }
  }
  return n >= minTrx && total >= minTotal;
}

const campaign = (over = {}) => ({
  nama: 'Undian Oktober',
  periode_mulai: '2026-10-01',
  periode_selesai: '2026-10-31',
  min_total_belanja_idr: 0,
  min_jumlah_transaksi: 3,
  min_belanja_per_transaksi_idr: 15000,
  ...over
});
const nota = (tanggal, harga_akhir) => ({ tanggal, harga_akhir });
const cek = (over = {}) => memenuhiUndian({ campaign: campaign(), tipe_customer: 'Umum', transaksi: [], ...over });
const tigaNota = () => [nota('2026-10-02', 20000), nota('2026-10-05', 20000), nota('2026-10-09', 20000)];

test('undian: 3 transaksi Rp20.000 dengan minimum 3 transaksi dan Rp15.000 per nota memenuhi', () => {
  assert.equal(cek({ transaksi: tigaNota() }), true);
});

test('undian: baru 2 transaksi dari minimum 3 belum memenuhi', () => {
  assert.equal(cek({ transaksi: [nota('2026-10-02', 20000), nota('2026-10-05', 20000)] }), false);
});

test('undian: transaksi di bawah minimum per nota tidak ikut dihitung', () => {
  // 4 transaksi, tetapi hanya 2 yang >= Rp15.000.
  const transaksi = [nota('2026-10-02', 20000), nota('2026-10-03', 3000), nota('2026-10-04', 20000), nota('2026-10-05', 3000)];
  assert.equal(cek({ transaksi }), false, 'yang dihitung hanya 2 dari minimum 3');

  // Bila minimumnya diturunkan menjadi 2, dua nota kecil itu tetap diabaikan.
  assert.equal(cek({ campaign: campaign({ min_jumlah_transaksi: 2 }), transaksi }), true);
  assert.equal(
    cek({ campaign: campaign({ min_jumlah_transaksi: 2, min_total_belanja_idr: 40001 }), transaksi }),
    false,
    'total yang dihitung hanya 40.000 (dua nota Rp20.000)'
  );
});

test('undian: minimum total belanja diperiksa terpisah dari jumlah transaksi', () => {
  const transaksi = tigaNota(); // 3 x Rp20.000 = Rp60.000
  assert.equal(cek({ campaign: campaign({ min_total_belanja_idr: 100000 }), transaksi }), false);
  assert.equal(cek({ campaign: campaign({ min_total_belanja_idr: 50000 }), transaksi }), true);
  assert.equal(cek({ campaign: campaign({ min_total_belanja_idr: 60000 }), transaksi }), true, 'total pas dengan minimum tetap memenuhi');
  assert.equal(cek({ campaign: campaign({ min_total_belanja_idr: 60001 }), transaksi }), false, 'kurang Rp1 belum memenuhi');
});

test('undian: minimum per nota 0 dan minimum 1 transaksi = perilaku lama (satu nota Rp0 pun memenuhi)', () => {
  const lama = campaign({ min_belanja_per_transaksi_idr: 0, min_jumlah_transaksi: 1, min_total_belanja_idr: 0 });
  assert.equal(cek({ campaign: lama, transaksi: [nota('2026-10-02', 0)] }), true);

  // Kolom min_jumlah_transaksi 0 tetap diperlakukan sebagai 1 (Math.max(1, ...)).
  assert.equal(cek({ campaign: campaign({ min_jumlah_transaksi: 0, min_belanja_per_transaksi_idr: 0 }), transaksi: [nota('2026-10-02', 0)] }), true);
  // Tanpa transaksi sama sekali tetap tidak memenuhi walau minimum 0.
  assert.equal(cek({ campaign: lama, transaksi: [] }), false);
});

test('undian: pelanggan Apotek Lain tidak pernah memenuhi syarat', () => {
  const transaksi = [nota('2026-10-02', 50000), nota('2026-10-03', 50000), nota('2026-10-04', 50000), nota('2026-10-05', 50000)];
  assert.equal(cek({ transaksi, tipe_customer: 'Apotek Lain' }), false, 'transaksinya banyak pun tetap ditolak');
  assert.equal(cek({ transaksi, tipe_customer: 'Umum' }), true, 'data yang sama memenuhi untuk tipe Umum');
  assert.equal(cek({ transaksi, tipe_customer: 'Tenaga Kesehatan' }), true, 'hanya Apotek Lain yang dikecualikan');
});

test('undian: tanggal periode_mulai dan periode_selesai inklusif, di luarnya tidak dihitung', () => {
  const transaksi = [
    nota('2026-09-30', 20000), // sehari sebelum periode -> tidak dihitung
    nota('2026-10-01', 20000), // tepat periode_mulai -> dihitung
    nota('2026-10-31', 20000), // tepat periode_selesai -> dihitung
    nota('2026-11-01', 20000)  // sehari setelah periode -> tidak dihitung
  ];
  assert.equal(cek({ transaksi }), false, 'hanya 2 transaksi batas yang dihitung, minimum 3');
  assert.equal(cek({ campaign: campaign({ min_jumlah_transaksi: 2 }), transaksi }), true);
  assert.equal(cek({ campaign: campaign({ min_jumlah_transaksi: 2, min_total_belanja_idr: 40001 }), transaksi }), false, 'total hanya dari nota batas (2 x Rp20.000)');
  // Nota di tengah periode melengkapi hitungan batas.
  assert.equal(cek({ transaksi: transaksi.concat([nota('2026-10-15', 20000)]) }), true);
});

test('undian: tanpa transaksi sama sekali belum memenuhi', () => {
  assert.equal(cek({ transaksi: [] }), false);
  assert.equal(cek({ campaign: campaign({ min_total_belanja_idr: 0, min_jumlah_transaksi: 1, min_belanja_per_transaksi_idr: 0 }), transaksi: [] }), false);
});

test('undian: kolom minimum yang belum ada memakai bawaan lama (0 per nota, 1 transaksi, 0 total)', () => {
  const belumDimigrasi = { nama: 'Undian Lama', periode_mulai: '2026-10-01', periode_selesai: '2026-10-31' };
  assert.equal(cek({ campaign: belumDimigrasi, transaksi: [nota('2026-10-02', 0)] }), true);
  assert.equal(cek({ campaign: belumDimigrasi, transaksi: [] }), false);
  // min_belanja_per_transaksi_idr null diperlakukan sama seperti belum ada.
  assert.equal(cek({ campaign: campaign({ min_belanja_per_transaksi_idr: null }), transaksi: [nota('2026-10-02', 100)] }), false, 'minimum 3 transaksi tetap berlaku');
  assert.equal(cek({ campaign: campaign({ min_belanja_per_transaksi_idr: null, min_jumlah_transaksi: null }), transaksi: [nota('2026-10-02', 100)] }), true);
});

// =====================================================================
// Bagian B: pemeriksaan teks supabase/functions/promo/index.ts.
// Hanya isi fungsi posPromo yang diperiksa (lihat catatan di blokKode).
// =====================================================================
const PROMO = source(BERKAS_PROMO);
const POS_PROMO = blokKode(PROMO, 'async function posPromo(');
const POS_PROMO_RAPAT = rapat(POS_PROMO);
const SETELAH_POS_PROMO = rapat(PROMO.slice(PROMO.indexOf(POS_PROMO) + POS_PROMO.length)).trim();

test('promo (teks): posPromo meminta ketiga kolom minimum undian dan tidak lagi memakai pola min_belanja lama', () => {
  assert.ok(POS_PROMO.includes('select=id,nama,periode_mulai,periode_selesai,min_total_belanja_idr,min_jumlah_transaksi,min_belanja_per_transaksi_idr'), 'query lottery_campaigns harus meminta ketiga kolom minimum');
  assert.match(POS_PROMO_RAPAT, /semuaBaris\("lottery_campaigns",/);
  assert.ok(POS_PROMO_RAPAT.includes('kode_cabang=eq.${cab}&aktif=eq.true&periode_mulai=lte.${hari}&periode_selesai=gte.${hari}'), 'campaign diambil untuk cabang sesi dan hari ini');
  assert.ok(!POS_PROMO_RAPAT.includes('min_belanja: Number(u.min_total_belanja_idr'), 'pola min_belanja lama tidak boleh dipakai lagi di posPromo');
  assert.ok(!POS_PROMO.includes('min_belanja:'), 'posPromo tidak lagi mengirim field min_belanja');
  // Pemotongan blok harus berhenti tepat di akhir posPromo.
  assert.match(SETELAH_POS_PROMO, /^async function dashboardAktif\(/);
});

test('promo (teks): memenuhi dihitung dari jumlah transaksi yang lolos, total belanja, dan minimum per nota', () => {
  assert.ok(POS_PROMO_RAPAT.includes('const minPer = Number(u.min_belanja_per_transaksi_idr || 0);'), 'minimum per transaksi dibaca');
  assert.ok(POS_PROMO_RAPAT.includes('const minTrx = Math.max(1, Number(u.min_jumlah_transaksi || 1));'), 'minimum jumlah transaksi minimal 1');
  assert.ok(POS_PROMO_RAPAT.includes('const minTotal = Number(u.min_total_belanja_idr || 0);'), 'minimum total belanja dibaca');
  assert.ok(POS_PROMO_RAPAT.includes('let n = 0, total = 0;'), 'penghitung jumlah dan total disiapkan');
  assert.ok(POS_PROMO_RAPAT.includes('if (a >= minPer) { n++; total += a; }'), 'hanya transaksi >= minimum per nota yang dihitung');
  assert.ok(POS_PROMO_RAPAT.includes('memenuhi = n >= minTrx && total >= minTotal;'), 'memenuhi memakai KETIGA kolom minimum');
  assert.ok(POS_PROMO_RAPAT.includes('undianPelanggan.push({ nama: u.nama, selesai: u.periode_selesai, memenuhi });'), 'status per campaign dikirim ke kasir');
});

test('promo (teks): Apotek Lain dilewati dan transaksi dibaca per nomor WA di dalam periode campaign', () => {
  assert.ok(POS_PROMO_RAPAT.includes('if (tipeUndian !== "Apotek Lain") {'), 'tipe Apotek Lain tidak dihitung');
  // Tipe untuk undian HARUS dari data master pelanggan: aturan resmi
  // (participantData / lottery_record_winner) juga membaca master_customer,
  // sehingga label di kasir tidak bisa bertentangan dengan daftar peserta.
  assert.ok(
    /const tipeUndian = String\(c\.tipe_customer \|\| "Umum"\)/.test(POS_PROMO_RAPAT),
    'tipe undian diambil dari data master pelanggan, bukan pilihan dropdown kasir'
  );
  const query = '"trx_penjualan", `?cabang_id=eq.${cab}&nomor_wa=eq.${encodeURIComponent(wa)}&tanggal=gte.${u.periode_mulai}&tanggal=lte.${u.periode_selesai}&select=harga_akhir&order=no_nota.asc`';
  assert.ok(POS_PROMO_RAPAT.includes(query), 'query trx_penjualan harus menyaring nomor WA + rentang tanggal dan urut no_nota.asc');
  assert.ok(POS_PROMO_RAPAT.includes('const wa = normWA(data?.nomor_wa || "");'), 'nomor WA dinormalkan dulu');
  // urutan: ambil pelanggan -> daftar undian -> kupon.
  assert.ok(
    POS_PROMO_RAPAT.indexOf('master_customer') < POS_PROMO_RAPAT.indexOf('undianPelanggan = [];') &&
    POS_PROMO_RAPAT.indexOf('undianPelanggan = [];') < POS_PROMO_RAPAT.indexOf('promo_coupons'),
    'urutan pengambilan data tidak berubah'
  );
});

test('promo (teks): bila tidak ada WA atau pelanggan belum terdaftar, undian dikembalikan dengan memenuhi null', () => {
  assert.ok(POS_PROMO_RAPAT.includes('let undianPelanggan: any[] | null = null;'), 'daftar status hanya diisi bila pelanggan ditemukan');
  assert.ok(POS_PROMO_RAPAT.includes('if (wa) {'), 'tanpa nomor WA tidak ada perhitungan');
  assert.ok(POS_PROMO_RAPAT.includes('if (c) {'), 'tanpa baris master_customer tidak ada perhitungan');
  assert.ok(
    POS_PROMO_RAPAT.includes('undian: undianPelanggan || undian.map((u: any) => ({ nama: u.nama, selesai: u.periode_selesai, memenuhi: null }))'),
    'cadangan tanpa pelanggan memakai memenuhi: null'
  );
});

// =====================================================================
// Bagian C: pemeriksaan teks public/js_pos.js, khusus blok posUndian.
// =====================================================================
const POS_JS = source(BERKAS_POS);
const BLOK_UNDIAN = blokKode(POS_JS, "var elUndian = document.getElementById('posUndian');");
const BLOK_UNDIAN_RAPAT = rapat(BLOK_UNDIAN);
const SETELAH_BLOK_UNDIAN = rapat(POS_JS.slice(POS_JS.indexOf(BLOK_UNDIAN) + BLOK_UNDIAN.length)).trim();

test('kasir (teks): blok posUndian tidak menunggu keranjang terisi dan memuat kedua kalimat status', () => {
  assert.doesNotMatch(BLOK_UNDIAN_RAPAT, /!POS\.items\.length/, 'indikator undian harus muncul walau keranjang masih kosong');
  assert.ok(BLOK_UNDIAN.includes('Memenuhi syarat'), 'kalimat status memenuhi');
  assert.ok(BLOK_UNDIAN.includes('Belum memenuhi syarat'), 'kalimat status belum memenuhi');
  // Pemotongan blok berhenti tepat di akhir `if (elUndian) { ... }`: sisa berkas
  // dimulai dengan penutup fungsi gambarRingkasan, lalu fungsi berikutnya.
  assert.ok(BLOK_UNDIAN_RAPAT.trim().endsWith('} }'), 'blok posUndian harus berakhir pada penutup if (elUndian): ' + BLOK_UNDIAN_RAPAT.slice(-60));
  assert.match(SETELAH_BLOK_UNDIAN, /^\}[\s\S]*function terapkanKodePaket\(/, 'pemotongan blok posUndian tidak tepat: ' + SETELAH_BLOK_UNDIAN.slice(0, 60));
});

test('kasir (teks): blok posUndian hanya untuk pelanggan terdaftar dan nama campaign di-escape', () => {
  assert.match(BLOK_UNDIAN_RAPAT, /!POS\.customer \|\| !POS\.customer\.terdaftar/, 'hanya pelanggan terdaftar');
  assert.match(BLOK_UNDIAN_RAPAT, /u\.memenuhi === null \|\| u\.memenuhi === undefined/, 'memenuhi null/undefined tidak ditampilkan');
  assert.ok(BLOK_UNDIAN.includes('esc(u.nama)'), 'nama campaign wajib lewat esc()');
  assert.ok(!/\+\s*u\.nama/.test(BLOK_UNDIAN), 'nama campaign tidak boleh ditempel mentah');
  assert.ok(BLOK_UNDIAN.includes('class="pay-undian'), 'kelas pay-undian dipakai');
  assert.ok(BLOK_UNDIAN.includes("' lolos'"), 'kelas lolos hanya saat memenuhi');
  assert.match(BLOK_UNDIAN_RAPAT, /u\.memenuhi \? ' lolos' : ''/, 'kelas lolos mengikuti nilai memenuhi');
});

// =====================================================================
// Bagian D: menjalankan TEKS ASLI blok posUndian di vm dengan document dan
// esc tiruan. Tidak ada berkas kasir lain yang dieksekusi.
// =====================================================================
function jalankanUndian(pos) {
  const el = { innerHTML: '', hidden: false };
  const ctx = vm.createContext({
    POS: pos,
    document: { getElementById: function (id) { return id === 'posUndian' ? el : null; } },
    // esc sederhana, perilakunya sama dengan esc() di public/js_core.js.
    esc: function (s) {
      return String(s === undefined || s === null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
  });
  vm.runInContext(BLOK_UNDIAN, ctx);
  return el.innerHTML;
}
// POS di aplikasi selalu punya items (lihat var POS di public/js_pos.js); keranjang
// dibuat kosong justru untuk membuktikan indikator tidak menunggu barang masuk.
const posUndian = (undian, customer) => ({ promo: { bundles: [], kupon: [], undian }, items: [], customer });

test('kasir (vm): pelanggan belum terdaftar membuat indikator undian kosong', () => {
  const html = jalankanUndian(posUndian([{ nama: 'Undian Oktober', memenuhi: true }], { wa: '', terdaftar: false }));
  assert.equal(html, '', 'pelanggan belum terdaftar: indikator kosong');
  // Tanpa data pelanggan sama sekali juga kosong (tidak melempar error).
  assert.equal(jalankanUndian(posUndian([{ nama: 'Undian Oktober', memenuhi: true }], null)), '');
});

test('kasir (vm): memenuhi true menampilkan "Memenuhi syarat" dengan kelas lolos', () => {
  const pos = posUndian([{ nama: 'Undian Oktober', memenuhi: true }], { wa: '62811', terdaftar: true });
  assert.equal(pos.items.length, 0, 'keranjang sengaja kosong');
  const html = jalankanUndian(pos);
  assert.ok(html.includes('Memenuhi syarat'), html);
  assert.ok(html.includes('Undian Oktober'), html);
  assert.match(html, /class="pay-undian lolos"/, html);
  assert.doesNotMatch(html, /Belum memenuhi syarat/);
});

test('kasir (vm): memenuhi false menampilkan "Belum memenuhi syarat" tanpa kelas lolos', () => {
  const html = jalankanUndian(posUndian([{ nama: 'Undian Oktober', memenuhi: false }], { wa: '62811', terdaftar: true }));
  assert.ok(html.includes('Belum memenuhi syarat'), html);
  assert.ok(html.includes('Undian Oktober'), html);
  assert.ok(html.includes('class="pay-undian"'), html);
  assert.doesNotMatch(html, /lolos/);
  assert.doesNotMatch(html, /Memenuhi syarat <b>/);
});

test('kasir (vm): memenuhi null atau undefined membuat indikator kosong', () => {
  const cust = { wa: '62811', terdaftar: true };
  assert.equal(jalankanUndian(posUndian([{ nama: 'Undian Oktober', memenuhi: null }], cust)), '');
  assert.equal(jalankanUndian(posUndian([{ nama: 'Undian Oktober' }], cust)), '', 'kolom memenuhi hilang = null');
  assert.equal(jalankanUndian(posUndian([], cust)), '', 'tanpa campaign aktif = kosong');
  // Campaign pertama yang menentukan, sama seperti kode aslinya.
  const dua = jalankanUndian(posUndian([{ nama: 'Undian Oktober', memenuhi: true }, { nama: 'Undian Lama', memenuhi: false }], cust));
  assert.ok(dua.includes('Undian Oktober'), dua);
  assert.ok(!dua.includes('Undian Lama'), dua);
});

test('kasir (vm): nama campaign berisi <script> tampil ter-escape', () => {
  const html = jalankanUndian(posUndian([{ nama: '<script>alert(1)</script>', memenuhi: true }], { wa: '62811', terdaftar: true }));
  assert.ok(!html.includes('<script>'), 'tag mentah tidak boleh masuk innerHTML: ' + html);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), html);
  assert.ok(html.includes('Memenuhi syarat'), html);
});
