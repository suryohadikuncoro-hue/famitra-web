// Uji offline untuk tiga JENIS reward (diskon / layanan / produk non farmasi)
// Migrasi: supabase/migrations/20261009170000_loyalty_reward_types.sql
// Run: node tests/reward-jenis.test.cjs     (tanpa database/jaringan)
//
// Latar belakang: tabel loyalty_rewards sudah mengizinkan reward_type
// 'discount' | 'service' | 'free_product', tetapi pos_checkout() dulu
// memperlakukan SEMUA reward sebagai potongan harga. Akibatnya reward seperti
// "Cek Tensi Gratis" ikut memotong harga jual.
//
// Aturan yang dijaga uji ini:
//   discount     -> potongan = floor(reward_value * faktor_tipe), dibatasi
//                   floor(dasar * maks_persen / 100) bila maks_persen < 100;
//                   nilai_manfaat = potongan itu.
//   service      -> potongan 0, nilai_manfaat = reward_value PENUH (tanpa
//   free_product    faktor tipe dan tanpa batas persen). Faktor tipe hanya
//                   menyaring: faktor <= 0 berarti tipe itu tidak boleh menukar.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const baca = f => fs.readFileSync(path.join(root, f), 'utf8');

const MIGRASI = 'supabase/migrations/20261009170000_loyalty_reward_types.sql';
const PROMO = 'supabase/functions/promo/index.ts';
const API = 'supabase/functions/api/index.ts';

const migrasi = baca(MIGRASI);
const promo = baca(PROMO);
const api = baca(API);

// Potong teks mulai dari penanda sampai akhir bloknya, supaya pemeriksaan teks
// tidak "dibantu" kecocokan dari bagian lain berkas.
function blokSql(sumber, tanda) {
  const mulai = sumber.toLowerCase().indexOf(tanda.toLowerCase());
  assert.ok(mulai >= 0, `harus menemukan blok: ${tanda}`);
  const sisa = sumber.slice(mulai);
  const akhir = sisa.indexOf('\n$function$;');
  return akhir >= 0 ? sisa.slice(0, akhir) : sisa;
}

function blokFungsiTs(sumber, tanda) {
  const mulai = sumber.indexOf(tanda);
  assert.ok(mulai >= 0, `harus menemukan blok: ${tanda}`);
  const sisa = sumber.slice(mulai);
  const akhir = sisa.indexOf('\n}\n');
  return akhir >= 0 ? sisa.slice(0, akhir) : sisa;
}

function blokAksi(sumber, nama) {
  const mulai = sumber.indexOf(`if (name === "${nama}")`);
  assert.ok(mulai >= 0, `aksi ${nama} harus ada`);
  const sisa = sumber.slice(mulai);
  const akhir = sisa.indexOf('\n  if (name ===', 1);
  return akhir >= 0 ? sisa.slice(0, akhir) : sisa;
}

// ---------------------------------------------------------------------------
// A. TIRUAN RUMUS
//    Ini BUKAN SQL asli. Fungsi di bawah adalah tiruan aritmetika dari
//    loyalty_tukar_periksa() pada migrasi 20261009170000: discount memakai
//    faktor tipe lalu batas persen; service / free_product memotong 0 dan
//    mencatat nilai manfaat penuh. Uji teks di bagian B yang menjaga migrasi
//    aslinya tetap memakai rumus ini.
// ---------------------------------------------------------------------------
function tiruanPeriksa({ reward_value, faktor, maks_persen = 100, dasar = 0, jenis = 'discount' }) {
  if (jenis === 'discount') {
    let nilai = Math.max(0, Math.floor(reward_value * faktor));
    if (maks_persen < 100) {
      const batas = Math.floor(dasar * maks_persen / 100);
      if (nilai > batas) nilai = batas;
    }
    return { potongan: nilai, manfaat: nilai, boleh: faktor > 0 };
  }
  // service / free_product: harga tidak berkurang, faktor hanya menyaring.
  return { potongan: 0, manfaat: Math.max(0, reward_value), boleh: faktor > 0 };
}

test('tiruan: discount memakai faktor tipe (5000 x 0,5 = 2500)', () => {
  const h = tiruanPeriksa({ reward_value: 5000, faktor: 0.5 });
  assert.equal(h.potongan, 2500);
  assert.equal(h.manfaat, 2500, 'untuk discount manfaat sama dengan potongan');
});

test('tiruan: discount dibatasi maks_persen (dasar 20.000, 50% = 10.000)', () => {
  const h = tiruanPeriksa({ reward_value: 15000, faktor: 1, maks_persen: 50, dasar: 20000 });
  assert.equal(h.potongan, 10000);
  assert.equal(h.manfaat, 10000);
});

test('tiruan: discount dengan maks_persen 100 tanpa batas tambahan', () => {
  const h = tiruanPeriksa({ reward_value: 15000, faktor: 1, maks_persen: 100, dasar: 20000 });
  assert.equal(h.potongan, 15000);
  assert.equal(h.manfaat, 15000);
});

test('tiruan: service tidak dipotong faktor (potongan 0, manfaat 25.000 penuh)', () => {
  const h = tiruanPeriksa({ reward_value: 25000, faktor: 0.5, jenis: 'service' });
  assert.equal(h.potongan, 0, 'layanan tidak boleh memotong harga jual');
  assert.equal(h.manfaat, 25000, 'manfaat layanan dicatat penuh');
});

test('tiruan: free_product potongan 0 dan manfaat 30.000 penuh', () => {
  const h = tiruanPeriksa({ reward_value: 30000, faktor: 1, jenis: 'free_product' });
  assert.equal(h.potongan, 0);
  assert.equal(h.manfaat, 30000);
});

test('tiruan: batas persen tidak berlaku untuk service, faktor 0 tetap menyaring', () => {
  const h = tiruanPeriksa({ reward_value: 25000, faktor: 1, maks_persen: 50, dasar: 10000, jenis: 'service' });
  assert.equal(h.potongan, 0);
  assert.equal(h.manfaat, 25000, 'batas persen tidak boleh memotong nilai manfaat layanan');
  const tolak = tiruanPeriksa({ reward_value: 25000, faktor: 0, jenis: 'service' });
  assert.equal(tolak.boleh, false, 'faktor <= 0 berarti tipe itu tidak boleh menukar');
});

// ---------------------------------------------------------------------------
// B. PEMERIKSAAN TEKS MIGRASI
// ---------------------------------------------------------------------------
test('migrasi: fungsi periksa memeriksa jenis, blok kasir memakai v_reward_jenis', () => {
  const periksa = blokSql(migrasi, 'create or replace function public.loyalty_tukar_periksa(');
  assert.match(periksa, /if v_jenis = 'discount' then/, 'cabang discount harus eksplisit');
  assert.match(periksa, /v_nilai := greatest\(0, floor\(coalesce\(v_reward\.reward_value, 0\) \* v_faktor\)\)/);
  assert.match(periksa, /if v_persen < 100 then/);
  assert.match(periksa, /v_batas := floor\(v_dasar \* v_persen \/ 100\)/);
  // Jenis lain: potongan nol, manfaat nilai penuh, tanpa batas persen.
  assert.match(periksa, /v_nilai := 0;/);
  assert.match(periksa, /v_manfaat := greatest\(0, coalesce\(v_reward\.reward_value, 0\)\)/);
  assert.match(periksa, /'nilai_manfaat'/, 'hasil harus membawa nilai manfaat');
  assert.match(periksa, /if v_faktor <= 0 then/, 'faktor tipe tetap menyaring');

  const kasir = blokSql(migrasi, 'CREATE OR REPLACE FUNCTION public.pos_checkout(');
  assert.match(kasir, /v_reward_jenis := coalesce\(nullif\(v_reward\.reward_type, ''\), 'discount'\)/);
  assert.match(kasir, /v_reward_discount := greatest\(0, coalesce\(\(v_hasil_tukar->>'nilai_penukaran'\)::numeric, 0\)\)/);
  assert.match(kasir, /v_reward_manfaat := greatest\(0, coalesce\(\(v_hasil_tukar->>'nilai_manfaat'\)::numeric, v_reward_discount\)\)/);
  // Cadangan saat pengaturan tak terbaca: hanya discount yang memotong harga.
  assert.match(kasir, /IF v_reward_jenis = 'discount' THEN/);
  assert.match(kasir, /v_reward_discount := 0;/);
  // Nilai manfaat (bukan potongan) yang dicatat ke loyalty_redemptions.
  const ins = kasir.match(/insert into loyalty_redemptions\([^)]*\)[\s\S]{0,220}?;/i);
  assert.ok(ins, 'harus ada insert ke loyalty_redemptions');
  assert.match(ins[0], /reward_value/, 'kolom reward_value harus diisi');
  assert.match(ins[0], /v_reward_manfaat/, 'yang dicatat adalah nilai manfaat');
});

test('migrasi: hanya mengganti fungsi, tidak mengubah tabel atau kolom', () => {
  assert.ok(!/add column/i.test(migrasi), 'tidak boleh ada add column');
  assert.ok(!/alter table/i.test(migrasi), 'tidak boleh menyentuh tabel');
  const fungsi = migrasi.match(/create or replace function/gi) || [];
  assert.equal(fungsi.length, 2, 'hanya dua fungsi yang diganti');
});

// ---------------------------------------------------------------------------
// C. PEMERIKSAAN TEKS EDGE FUNCTION DAN TAMPILAN
// ---------------------------------------------------------------------------
test('promo: rewardSave menerima tiga jenis, dashboard memakai nilai non-diskon', () => {
  const simpan = blokAksi(promo, 'rewardSave');
  assert.match(simpan, /\["discount", "service", "free_product"\]\.includes\(jenis\)/);
  assert.match(simpan, /const jenis = jenisKirim === "" \? "discount" : jenisKirim/, 'bawaan discount');
  assert.match(simpan, /reward_type: jenis/, 'jenis ikut disimpan');

  const dash = blokFungsiTs(promo, 'async function dashboardAktif(branch: string)');
  assert.match(dash, /loyalty_redemptions/, 'biaya reward dibaca dari loyalty_redemptions');
  assert.match(dash, /if \(jenis !== "discount"\) nilaiNonDiskon \+= nilai;/);
  assert.match(dash, /const laba = omzet - hpp - nilaiNonDiskon;/, 'hanya biaya non-diskon dikurangkan');
});

test('api: reward.list mengembalikan reward_type dan nilai_berlaku 0 untuk non-diskon', () => {
  const blok = blokAksi(api, 'reward.list');
  assert.match(blok, /const jenis = x\.reward_type \|\| "discount";/);
  assert.match(blok, /reward_type: jenis/, 'balikan harus memuat reward_type');
  assert.match(blok, /nilai_berlaku: jenis === "discount" \? nilaiFaktor : 0/);
  assert.match(blok, /nilai_manfaat: jenis === "discount" \? nilaiFaktor : nilai/);
});
