// Uji offline untuk migrasi 20261009160000_loyalty_expire_reason.sql
// Run: node tests/migrasi-expire-reason.test.cjs     (tanpa database/jaringan)
//
// Latar belakang: tabel loyalty_transactions punya CHECK pada kolom reason yang
// TIDAK memuat 'expire', padahal expire_loyalty_points() menulis nilai itu.
// Uji ini menjaga agar keduanya tidak pernah kembali tidak sinkron.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const baca = f => fs.readFileSync(path.join(root, f), 'utf8');

const MIGRASI = 'supabase/migrations/20261009160000_loyalty_expire_reason.sql';
const MIGRASI_KEDALUWARSA = 'supabase/migrations/20261008150000_loyalty_kedaluwarsa_fifo.sql';
const migrasi = baca(MIGRASI);

// Nilai yang dipakai repo saat menulis ke loyalty_transactions.reason.
function nilaiReasonYangDitulis() {
  const semua = fs.readdirSync(path.join(root, 'supabase/migrations'))
    .filter(f => f.endsWith('.sql'))
    .map(f => baca(path.join('supabase/migrations', f)))
    .join('\n');
  const nilai = new Set();
  // pola: Insert ... ,'<reason>')  dan  -..., '<reason>', false
  for (const m of semua.matchAll(/loyalty_transactions\([^)]*\)[\s\S]{0,400}?'([a-z_]+)'\s*(?:,|\))/g)) {
    if (/^[a-z_]+$/.test(m[1])) nilai.add(m[1]);
  }
  for (const m of semua.matchAll(/reason\s*=\s*'([a-z_]+)'/g)) nilai.add(m[1]);
  return nilai;
}

// Nilai yang diizinkan menurut migrasi ini.
function nilaiDiizinkan() {
  const blok = migrasi.match(/check \(reason = any \(array\[([\s\S]*?)\]::text\[\]\)\)/);
  assert.ok(blok, 'migrasi harus memuat definisi check (reason = any (array[...]))');
  return [...blok[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
}

test('migrasi: menambahkan expire ke daftar reason yang diizinkan', () => {
  assert.ok(nilaiDiizinkan().includes('expire'), "'expire' harus ada di daftar");
});

test('migrasi: seluruh nilai lama dipertahankan (tidak ada yang hilang)', () => {
  const lama = ['purchase', 'redeem', 'return_adjustment', 'birthday_bonus', 'referral', 'manual_adjustment'];
  const diizinkan = nilaiDiizinkan();
  for (const v of lama) assert.ok(diizinkan.includes(v), `nilai lama '${v}' harus tetap ada`);
});

test('INTI: setiap reason yang ditulis repo ada di daftar yang diizinkan', () => {
  const diizinkan = new Set(nilaiDiizinkan());
  const ditulis = nilaiReasonYangDitulis();
  assert.ok(ditulis.size > 0, 'harus menemukan nilai reason yang ditulis repo');
  for (const v of ditulis) {
    assert.ok(diizinkan.has(v), `repo menulis reason '${v}' tetapi tidak diizinkan constraint`);
  }
});

test('khusus: expire_loyalty_points menulis expire, dan expire kini diizinkan', () => {
  const kedaluwarsa = baca(MIGRASI_KEDALUWARSA);
  assert.match(kedaluwarsa, /'expire'/, 'fungsi kedaluwarsa harus menulis reason expire');
  assert.ok(nilaiDiizinkan().includes('expire'), 'dan expire harus diizinkan constraint');
});

test('migrasi: memakai drop constraint if exists supaya aman dijalankan berulang', () => {
  assert.match(migrasi, /drop constraint if exists loyalty_transactions_reason_check/i);
});

test('migrasi: menambah kembali constraint dengan nama yang sama', () => {
  assert.match(migrasi, /add constraint loyalty_transactions_reason_check/i);
});

test('migrasi: punya pengaman prasyarat tabel', () => {
  assert.match(migrasi, /raise exception 'Prasyarat belum ada/i);
  assert.match(migrasi, /loyalty_transactions/);
});

test('migrasi: memverifikasi hasilnya sendiri sebelum selesai', () => {
  assert.match(migrasi, /pg_get_constraintdef/);
  assert.match(migrasi, /Gagal: constraint loyalty_transactions_reason_check tidak ditemukan/);
});

test('migrasi: tidak mengubah fungsi apa pun (hanya izin tingkat tabel)', () => {
  assert.ok(!/create or replace function/i.test(migrasi), 'tidak boleh menyentuh fungsi');
});

test('migrasi: tidak destruktif', () => {
  assert.ok(!/drop table|truncate|delete from/i.test(migrasi), 'tidak boleh ada drop table/truncate/delete');
});

test('migrasi: penanda dolar seimbang', () => {
  const dd = (migrasi.match(/(?<!\$)\$\$(?!\$)/g) || []).length;
  assert.equal(dd % 2, 0, 'penanda $$ harus berpasangan');
});

test('migrasi: menjelaskan alasan perubahan dan asal temuan', () => {
  assert.match(migrasi, /expire_loyalty_points/);
  assert.match(migrasi, /db dump|di luar riwayat migrasi/i);
});
