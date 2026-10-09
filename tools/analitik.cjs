#!/usr/bin/env node
/* ======================================================= Kanal baca analitik ===
 * Alat baca-saja untuk meja INS/OPS/MKT. Hanya bisa membaca view `v_analitik_*`
 * yang sudah di-grant ke role `authenticated` (lihat migrasi
 * supabase/migrations/20261001010000_view_analitik_readonly.sql).
 *
 * Kredensial user auth analitik dibaca dari supabase/.temp/analitik-auth.json —
 * folder itu sudah di-.gitignore, dan isinya tidak boleh ditampilkan atau disalin.
 *
 * Pemakaian (dari akar repo):
 *   node tools/analitik.cjs daftar
 *   node tools/analitik.cjs v_analitik_penjualan_harian "select=cabang_id,tanggal,omzet&cabang_id=eq.KARLA&order=tanggal.desc&limit=5"
 *   node tools/analitik.cjs v_analitik_nota_minus "order=laba_kotor_bersih.asc&limit=20"
 *   node tools/analitik.cjs v_analitik_stok "sisa_hari_ed=lte.90&stok_real=gt.0&order=sisa_hari_ed.asc&limit=20"
 *   node tools/analitik.cjs v_analitik_pembelian_detail "modal_di_atas_harga_umum=is.true&order=margin_umum_per_unit.asc&limit=20"
 *
 * Tanpa paket tambahan: hanya memakai fetch bawaan Node.
 */
const fs = require('fs');
const path = require('path');

const BERKAS_KREDENSIAL = path.join(__dirname, '..', 'supabase', '.temp', 'analitik-auth.json');

/* Daftar putih view: kanal ini menolak nama lain, termasuk nama tabel dasar. */
const VIEW_DIIZINKAN = [
  'v_analitik_penjualan_harian',
  'v_analitik_nota',
  'v_analitik_nota_minus',
  'v_analitik_produk',
  'v_analitik_stok',
  'v_analitik_pelanggan',
  'v_analitik_retur',
  'v_analitik_biaya',
  'v_analitik_hutang',
  'v_analitik_pembelian_detail',
  'v_analitik_promo',
  'v_analitik_target',
  'v_analitik_cabang'
];

function bacaKredensial() {
  if (!fs.existsSync(BERKAS_KREDENSIAL)) {
    throw new Error(
      'Berkas kredensial belum ada: ' + path.relative(path.join(__dirname, '..'), BERKAS_KREDENSIAL) + '\n' +
      'Buat berkas itu (lihat AGENTS.md bagian kanal akses baca analitik) dengan isi:\n' +
      '{ "url": "https://<project-ref>.supabase.co", "anon_key": "<publishable/anon key>",\n' +
      '  "email": "<email user auth analitik>", "password": "<password user itu>" }'
    );
  }
  const isi = JSON.parse(fs.readFileSync(BERKAS_KREDENSIAL, 'utf8'));
  const kurang = ['url', 'anon_key', 'email', 'password'].filter(function (k) { return !isi[k]; });
  if (kurang.length) throw new Error('Berkas kredensial belum lengkap, kurang: ' + kurang.join(', '));
  isi.url = String(isi.url).replace(/\/+$/, '');
  return isi;
}

async function ambilToken(kred) {
  const r = await fetch(kred.url + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: kred.anon_key },
    body: JSON.stringify({ email: kred.email, password: kred.password })
  });
  const j = await r.json().catch(function () { return {}; });
  if (!r.ok || !j.access_token) {
    // Tampilkan pesan asli dari Supabase supaya penyebabnya langsung terlihat.
    // Isi berkas kredensial tidak pernah ikut ke pesan ini.
    const pesan = j.error_description || j.msg || j.message || j.error || j.error_code ||
      JSON.stringify(j).slice(0, 300) || 'penyebab tidak diketahui';
    const petunjuk =
      r.status === 401 ? ' Periksa "anon_key" (Project Settings -> API) dan "url".' :
      r.status === 400 ? ' Periksa "email" dan "password" user analitik (harus sudah dikonfirmasi).' :
      r.status === 422 ? ' User Auth mungkin belum dibuat atau provider email dimatikan.' : '';
    throw new Error('Gagal login user analitik (HTTP ' + r.status + '): ' + pesan + petunjuk);
  }
  return j.access_token;
}

/* Periksa BENTUK berkas kredensial tanpa menampilkan isinya: panjang, jenis kunci,
   dan spasi tersembunyi yang biasanya membuat Supabase menolak (Invalid API key). */
function jenisKunci(k) {
  if (k.indexOf('sb_publishable_') === 0) return 'publishable key (benar untuk kanal ini)';
  if (k.indexOf('sb_secret_') === 0) return 'SECRET key (SALAH - kunci ini dilarang dipakai)';
  if (k.indexOf('eyJ') === 0) return 'JWT lama (anon atau service_role)';
  if (k.indexOf('http') === 0) return 'URL (SALAH - ini bukan kunci)';
  return 'tidak dikenali Supabase';
}

function periksaBentuk(nilai) {
  const s = String(nilai === undefined || nilai === null ? '' : nilai);
  const catatan = [];
  if (s !== s.trim()) catatan.push('ada spasi/baris kosong di ujung');
  if (/^["']|["']$/.test(s)) catatan.push('ada tanda kutip ikut tersimpan');
  return { panjang: s.length, catatan: catatan };
}

function diagnosa() {
  const kred = bacaKredensial();
  let host = '(url tidak valid)';
  try { host = new URL(kred.url).host; } catch (e) { /* biarkan */ }
  const kunci = periksaBentuk(kred.anon_key);
  const sandi = periksaBentuk(kred.password);
  const surel = String(kred.email);
  const at = surel.indexOf('@');
  const surelSamar = at > 0 ? surel.slice(0, 1) + '***' + surel.slice(at) : '(email tidak valid)';
  console.log('Bentuk berkas kredensial (isi tidak ditampilkan):');
  console.log('  url        : https://' + host);
  console.log('  anon_key   : ' + kunci.panjang + ' karakter, ' + jenisKunci(String(kred.anon_key)) +
    (kunci.catatan.length ? ' [' + kunci.catatan.join('; ') + ']' : ''));
  console.log('  email      : ' + surelSamar + (surel !== surel.trim() ? ' [ada spasi di ujung]' : ''));
  console.log('  password   : ' + sandi.panjang + ' karakter' +
    (sandi.catatan.length ? ' [' + sandi.catatan.join('; ') + ']' : ''));
}

async function main() {
  const aksi = process.argv[2];
  const kueri = process.argv[3] || '';

  if (!aksi || aksi === '-h' || aksi === '--help') {
    console.log('Pemakaian: node tools/analitik.cjs <nama-view|daftar|diagnosa> ["query-string PostgREST"]');
    console.log('Contoh  : node tools/analitik.cjs daftar');
    console.log('          node tools/analitik.cjs diagnosa   (periksa bentuk berkas kredensial)');
    return;
  }
  if (aksi === 'daftar') {
    console.log('View yang tersedia untuk kanal analitik:');
    VIEW_DIIZINKAN.forEach(function (v) { console.log('  - ' + v); });
    return;
  }
  if (aksi === 'diagnosa') {
    diagnosa();
    return;
  }
  if (VIEW_DIIZINKAN.indexOf(aksi) < 0) {
    throw new Error('Ditolak: "' + aksi + '" bukan view analitik yang diizinkan. Jalankan "daftar" untuk melihat daftarnya.');
  }

  const kred = bacaKredensial();
  const token = await ambilToken(kred);
  const url = kred.url + '/rest/v1/' + aksi + (kueri ? '?' + kueri : '');
  const r = await fetch(url, {
    headers: { apikey: kred.anon_key, Authorization: 'Bearer ' + token, Accept: 'application/json' }
  });
  const teks = await r.text();
  if (!r.ok) {
    throw new Error('Query gagal (HTTP ' + r.status + '): ' + teks.slice(0, 600));
  }
  let data;
  try { data = JSON.parse(teks); } catch (e) { data = teks; }
  console.log(JSON.stringify(data, null, 2));
  if (Array.isArray(data)) console.log('-- ' + data.length + ' baris');
}

main().catch(function (e) {
  console.error('GAGAL: ' + (e && e.message ? e.message : e));
  process.exit(1);
});
