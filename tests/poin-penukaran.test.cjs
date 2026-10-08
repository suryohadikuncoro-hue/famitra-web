// Offline regression suite untuk pengaturan penukaran reward (migrasi 20261008160000).
// Run: node tests/poin-penukaran.test.cjs   (butuh Node >= 22.13 untuk membuang tipe TypeScript)
// Tanpa kredensial, package, database, browser, atau jaringan.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '..');
const source = f => fs.readFileSync(path.join(root, f), 'utf8');

const BERKAS_MIGRASI = 'supabase/migrations/20261008160000_loyalty_pengaturan_penukaran.sql';
const BERKAS_PROMO = 'supabase/functions/promo/index.ts';

// =====================================================================
// Bagian A: tiruan rumus public.loyalty_tukar_periksa() di migrasi.
// Ini TIRUAN dari SQL, bukan pemanggilan database. Urutan pemeriksaan dan
// rumusnya harus sama persis dengan fungsi di
// supabase/migrations/20261008160000_loyalty_pengaturan_penukaran.sql:
//   faktor  = faktor_tipe_tukar[tipe_pelanggan] (bawaan Umum 1, Nakes 0,5,
//             Apotek Lain 0)
//   nilai   = floor(reward_value * faktor)
//   dasar   = max(0, subtotal - diskon)
//   bila maks_persen_tukar < 100:
//             nilai = min(nilai, floor(dasar * maks_persen_tukar / 100))
//   urutan penolakan: faktor <= 0 -> tier kurang -> poin kurang ->
//             saldo < min_poin_tukar -> nilai <= 0 -> batas harian ->
//             batas bulanan
//   poin yang dipotong SELALU reward.points_required (faktor tipe hanya
//   mempengaruhi nilai potongan rupiah, bukan jumlah poin).
// =====================================================================

const BAWAAN_TUKAR = {
  faktor_tipe_tukar: { 'Umum': 1, 'Tenaga Kesehatan': 0.5, 'Apotek Lain': 0 },
  min_poin_tukar: 0,
  maks_persen_tukar: 100,
  maks_tukar_per_hari: 0,
  maks_tukar_per_bulan: 0
};

const angka = (v, bawaan) => (v === undefined || v === null ? bawaan : Number(v));
const tierKe = t => (t === 'gold' ? 3 : t === 'silver' ? 2 : 1);

// Tiruan loyalty_tukar_periksa(). p_cabang_id/reward/customer diasumsikan
// sudah lolos pencarian baris (reward ada & aktif, pelanggan terdaftar).
function tukarPeriksa(input) {
  const cfg = { ...BAWAAN_TUKAR, ...(input.cfg || {}) };
  const reward = input.reward;
  const cust = input.cust;

  const faktor = angka((cfg.faktor_tipe_tukar || {})[cust.tipe_customer], 0);
  const min = angka(cfg.min_poin_tukar, 0);
  const persen = angka(cfg.maks_persen_tukar, 100);
  const batasHari = angka(cfg.maks_tukar_per_hari, 0);
  const batasBulan = angka(cfg.maks_tukar_per_bulan, 0);

  const poin = angka(reward.points_required, 0);
  const total = angka(cust.total_points, 0);

  const dasar = Math.max(0, angka(input.subtotal, 0) - Math.max(0, angka(input.diskon, 0)));
  let nilai = Math.max(0, Math.floor(angka(reward.reward_value, 0) * faktor));
  if (persen < 100) {
    const batas = Math.floor(dasar * persen / 100);
    if (nilai > batas) nilai = batas;
  }

  // Hitungan harian/bulanan hanya dibaca bila salah satu batas dipasang,
  // sama seperti if v_batas_hari > 0 or v_batas_bulan > 0 di SQL.
  const hitungBatas = batasHari > 0 || batasBulan > 0;
  const hariIni = hitungBatas ? angka(input.hariIni, 0) : 0;
  const bulanIni = hitungBatas ? angka(input.bulanIni, 0) : 0;

  let alasan = null;
  if (faktor <= 0) {
    alasan = `Tipe pelanggan ${cust.tipe_customer || 'Umum'} tidak mendapat penukaran poin.`;
  } else if (tierKe(cust.tier) < tierKe(reward.min_tier)) {
    alasan = `Tier pelanggan belum memenuhi syarat reward ini (butuh ${reward.min_tier || 'reguler'}).`;
  } else if (total < poin) {
    alasan = `Poin tidak mencukupi: butuh ${poin}, tersedia ${total}.`;
  } else if (min > 0 && total < min) {
    alasan = `Minimal saldo ${min} poin untuk bisa menukar.`;
  } else if (nilai <= 0) {
    alasan = 'Nilai penukaran reward ini nol.';
  } else if (batasHari > 0 && hariIni >= batasHari) {
    alasan = `Batas penukaran hari ini sudah tercapai (${batasHari} kali).`;
  } else if (batasBulan > 0 && bulanIni >= batasBulan) {
    alasan = `Batas penukaran bulan ini sudah tercapai (${batasBulan} kali).`;
  }

  return {
    boleh: alasan === null,
    alasan,
    poin_dibutuhkan: poin,
    poin_tersedia: total,
    sisa_setelah: Math.max(0, total - poin),
    nilai_penukaran: alasan === null ? nilai : 0,
    nilai_reward: angka(reward.reward_value, 0),
    faktor_tipe: faktor,
    dasar
  };
}

const reward = (over = {}) => ({ points_required: 100, reward_value: 5000, min_tier: 'reguler', ...over });
const cust = (over = {}) => ({ tipe_customer: 'Umum', tier: 'reguler', total_points: 1000, ...over });
// Subtotal bawaan besar supaya batas persentase 100% tidak ikut memotong.
const periksa = (over = {}) => tukarPeriksa({ reward: reward(), cust: cust(), subtotal: 100000, diskon: 0, ...over });

test('tukar (bawaan = perilaku lama): Umum penuh, Tenaga Kesehatan setengah, Apotek Lain ditolak', () => {
  const umum = periksa();
  assert.equal(umum.boleh, true, JSON.stringify(umum));
  assert.equal(umum.nilai_penukaran, 5000, 'Umum memakai faktor 1 (perilaku lama)');
  assert.equal(umum.faktor_tipe, 1);
  assert.equal(umum.poin_dibutuhkan, 100, 'poin yang dipotong selalu points_required reward');

  const nakes = periksa({ cust: cust({ tipe_customer: 'Tenaga Kesehatan' }) });
  assert.equal(nakes.boleh, true, JSON.stringify(nakes));
  assert.equal(nakes.faktor_tipe, 0.5);
  assert.equal(nakes.nilai_penukaran, 2500, 'Tenaga Kesehatan memotong setengah (perilaku lama)');
  assert.equal(nakes.poin_dibutuhkan, 100, 'faktor tipe tidak mengubah jumlah poin yang dipotong');

  const apotekLain = periksa({ cust: cust({ tipe_customer: 'Apotek Lain' }) });
  assert.equal(apotekLain.boleh, false);
  assert.equal(apotekLain.faktor_tipe, 0);
  assert.match(apotekLain.alasan, /Apotek Lain tidak mendapat penukaran poin/);
  assert.equal(apotekLain.nilai_penukaran, 0, 'yang ditolak tidak memberi nilai potongan');
});

test('tukar: faktor yang diubah Owner berlaku (nakes faktor 1 = potongan penuh)', () => {
  const p = periksa({
    cfg: { faktor_tipe_tukar: { 'Umum': 1, 'Tenaga Kesehatan': 1, 'Apotek Lain': 0 } },
    cust: cust({ tipe_customer: 'Tenaga Kesehatan' })
  });
  assert.equal(p.boleh, true, JSON.stringify(p));
  assert.equal(p.faktor_tipe, 1);
  assert.equal(p.nilai_penukaran, 5000, 'faktor 1 memberi potongan penuh Rp5.000');
  // Tipe yang tidak disebut di pengaturan dianggap faktor 0, bukan 1.
  const lain = periksa({
    cfg: { faktor_tipe_tukar: { 'Umum': 1 } },
    cust: cust({ tipe_customer: 'Tenaga Kesehatan' })
  });
  assert.equal(lain.boleh, false);
  assert.equal(lain.faktor_tipe, 0);
});

test('tukar: min_poin_tukar menolak saldo di bawah batas dan mengizinkan saldo pas', () => {
  const kurang = periksa({ cfg: { min_poin_tukar: 200 }, cust: cust({ total_points: 150 }) });
  assert.equal(kurang.boleh, false);
  assert.match(kurang.alasan, /Minimal saldo 200 poin/, 'alasan harus menyebut minimal poin');

  const pas = periksa({ cfg: { min_poin_tukar: 200 }, cust: cust({ total_points: 200 }) });
  assert.equal(pas.boleh, true, 'saldo sama dengan batas tetap boleh: ' + JSON.stringify(pas));

  const tanpaBatas = periksa({ cfg: { min_poin_tukar: 0 }, cust: cust({ total_points: 100 }) });
  assert.equal(tanpaBatas.boleh, true, 'min 0 = tanpa minimal');
  // Dibandingkan dengan total_points, bukan dengan sisa setelah penukaran.
  const hampir = periksa({ cfg: { min_poin_tukar: 101 }, cust: cust({ total_points: 100 }) });
  assert.equal(hampir.boleh, false);
  assert.match(hampir.alasan, /Minimal saldo 101 poin/);
});

test('tukar: maks_persen_tukar 50 membatasi potongan pada setengah dasar transaksi', () => {
  const p = periksa({
    cfg: { maks_persen_tukar: 50 },
    reward: reward({ reward_value: 15000 }),
    subtotal: 20000
  });
  assert.equal(p.boleh, true, JSON.stringify(p));
  assert.equal(p.dasar, 20000);
  assert.equal(p.nilai_penukaran, 10000, 'floor(50% x 20.000) = 10.000');

  // Diskon ikut mengurangi dasar sebelum batas persentase dihitung.
  const denganDiskon = periksa({
    cfg: { maks_persen_tukar: 50 },
    reward: reward({ reward_value: 15000 }),
    subtotal: 20000,
    diskon: 5000
  });
  assert.equal(denganDiskon.dasar, 15000);
  assert.equal(denganDiskon.nilai_penukaran, 7500, 'floor(50% x 15.000) = 7.500');

  // Potongan yang sudah di bawah batas tidak dinaikkan.
  const kecil = periksa({ cfg: { maks_persen_tukar: 50 }, reward: reward({ reward_value: 3000 }), subtotal: 20000 });
  assert.equal(kecil.nilai_penukaran, 3000, 'batas hanya memotong, tidak menambah');
});

test('tukar: maks_persen_tukar 100 = tanpa batas tambahan (perilaku lama dijaga)', () => {
  const p = periksa({ cfg: { maks_persen_tukar: 100 }, reward: reward({ reward_value: 15000 }), subtotal: 20000 });
  assert.equal(p.nilai_penukaran, 15000, 'reward Rp15.000 pada belanja Rp20.000 tetap Rp15.000');

  // Perilaku lama membolehkan nilai potongan melebihi dasar; harga akhir di
  // pos_checkout tetap dijaga tidak pernah negatif.
  const melebihi = periksa({ cfg: { maks_persen_tukar: 100 }, reward: reward({ reward_value: 25000 }), subtotal: 20000 });
  assert.equal(melebihi.boleh, true);
  assert.equal(melebihi.nilai_penukaran, 25000, 'tanpa batas tambahan nilai tidak dipotong ke dasar');
});

test('tukar: batas harian menolak saat sudah tercapai dan 0 berarti tanpa batas', () => {
  const tercapai = periksa({ cfg: { maks_tukar_per_hari: 1 }, hariIni: 1 });
  assert.equal(tercapai.boleh, false);
  assert.match(tercapai.alasan, /Batas penukaran hari ini sudah tercapai \(1 kali\)/);

  const belum = periksa({ cfg: { maks_tukar_per_hari: 2 }, hariIni: 1 });
  assert.equal(belum.boleh, true, '1 < 2 masih boleh');

  const tanpaBatas = periksa({ cfg: { maks_tukar_per_hari: 0 }, hariIni: 99 });
  assert.equal(tanpaBatas.boleh, true, 'batas 0 tidak pernah menolak');
  assert.equal(periksa({ cfg: { maks_tukar_per_hari: 0, maks_tukar_per_bulan: 0 }, hariIni: 99, bulanIni: 99 }).boleh, true);
});

test('tukar: batas bulanan bekerja seperti batas harian dan dihitung terpisah', () => {
  const tercapai = periksa({ cfg: { maks_tukar_per_bulan: 2 }, bulanIni: 2 });
  assert.equal(tercapai.boleh, false);
  assert.match(tercapai.alasan, /Batas penukaran bulan ini sudah tercapai \(2 kali\)/);

  const belum = periksa({ cfg: { maks_tukar_per_bulan: 2 }, bulanIni: 1 });
  assert.equal(belum.boleh, true);

  // Banyak penukaran hari ini tidak menghabiskan jatah bulanan yang lebih besar.
  const harianSaja = periksa({ cfg: { maks_tukar_per_hari: 0, maks_tukar_per_bulan: 5 }, hariIni: 9, bulanIni: 4 });
  assert.equal(harianSaja.boleh, true, 'batas harian 0 tidak ikut menolak walau hitungan harian besar');
  // Bulan baru dengan bulanIni kecil tidak terpengaruh hitungan harian cabang lain.
  const bulananSaja = periksa({ cfg: { maks_tukar_per_hari: 1, maks_tukar_per_bulan: 0 }, hariIni: 0, bulanIni: 9 });
  assert.equal(bulananSaja.boleh, true, 'batas bulanan 0 tidak ikut menolak');
  // Keduanya tercapai: alasan harian yang muncul lebih dulu (urutan SQL).
  const keduanya = periksa({ cfg: { maks_tukar_per_hari: 1, maks_tukar_per_bulan: 1 }, hariIni: 1, bulanIni: 1 });
  assert.match(keduanya.alasan, /hari ini/);
});

test('tukar: poin kurang ditolak dan sisa_setelah tidak pernah negatif', () => {
  const kurang = periksa({ reward: reward({ points_required: 200 }), cust: cust({ total_points: 150 }) });
  assert.equal(kurang.boleh, false);
  assert.match(kurang.alasan, /Poin tidak mencukupi: butuh 200, tersedia 150/);
  assert.equal(kurang.sisa_setelah, 0, 'greatest(0, ...) menjaga sisa_setelah >= 0');
  assert.equal(kurang.nilai_penukaran, 0);

  const nol = periksa({ reward: reward({ points_required: 200 }), cust: cust({ total_points: 0 }) });
  assert.equal(nol.boleh, false);
  assert.equal(nol.sisa_setelah, 0);

  const pas = periksa({ reward: reward({ points_required: 100 }), cust: cust({ total_points: 100 }) });
  assert.equal(pas.boleh, true, 'poin pas boleh ditukar');
  assert.equal(pas.sisa_setelah, 0);
});

test('tukar: tier reward dihormati (gold ditolak untuk pelanggan reguler)', () => {
  const ditolakTier = periksa({ reward: reward({ min_tier: 'gold' }), cust: cust({ tier: 'reguler' }) });
  assert.equal(ditolakTier.boleh, false);
  assert.match(ditolakTier.alasan, /Tier pelanggan belum memenuhi syarat reward ini \(butuh gold\)/);

  const gold = periksa({ reward: reward({ min_tier: 'gold' }), cust: cust({ tier: 'gold' }) });
  assert.equal(gold.boleh, true, JSON.stringify(gold));

  const silverUntukReguler = periksa({ reward: reward({ min_tier: 'silver' }), cust: cust({ tier: 'reguler' }) });
  assert.equal(silverUntukReguler.boleh, false);
  assert.match(silverUntukReguler.alasan, /butuh silver/);
  assert.equal(periksa({ reward: reward({ min_tier: 'silver' }), cust: cust({ tier: 'gold' }) }).boleh, true, 'tier lebih tinggi boleh');
});

test('tukar: urutan penolakan sama dengan SQL (yang paling awal menang)', () => {
  // faktor 0 lebih dulu daripada tier dan poin kurang.
  const faktor = periksa({
    reward: reward({ min_tier: 'gold', points_required: 999 }),
    cust: cust({ tipe_customer: 'Apotek Lain', tier: 'reguler', total_points: 0 })
  });
  assert.match(faktor.alasan, /Apotek Lain tidak mendapat penukaran poin/);

  // tier lebih dulu daripada poin kurang dan min_poin_tukar.
  const tier = periksa({
    cfg: { min_poin_tukar: 5000 },
    reward: reward({ min_tier: 'gold', points_required: 999 }),
    cust: cust({ tier: 'reguler', total_points: 1 })
  });
  assert.match(tier.alasan, /Tier pelanggan belum memenuhi syarat/);

  // poin kurang lebih dulu daripada min_poin_tukar dan nilai nol.
  const poin = periksa({
    cfg: { min_poin_tukar: 5000 },
    reward: reward({ points_required: 200, reward_value: 0 }),
    cust: cust({ total_points: 150 })
  });
  assert.match(poin.alasan, /Poin tidak mencukupi/);

  // min_poin_tukar lebih dulu daripada nilai nol.
  const min = periksa({
    cfg: { min_poin_tukar: 100 },
    reward: reward({ points_required: 10, reward_value: 0 }),
    cust: cust({ total_points: 50 })
  });
  assert.match(min.alasan, /Minimal saldo 100 poin/);

  // nilai nol lebih dulu daripada batas harian.
  const nilai = periksa({
    cfg: { maks_tukar_per_hari: 1 },
    reward: reward({ reward_value: 0 }),
    hariIni: 5
  });
  assert.match(nilai.alasan, /Nilai penukaran reward ini nol/);
});

// =====================================================================
// Bagian B: pemeriksaan berkas migrasi 20261008160000.
// =====================================================================
const SQL = source(BERKAS_MIGRASI);
// Komentar baris dibuang dulu supaya perapatan spasi tidak menelan kode.
const RAPAT = SQL.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ');

// Setiap pernyataan delete/update wajib punya WHERE (aturan AGENTS.md).
// "FOR UPDATE SKIP LOCKED" adalah penguncian baris, bukan pernyataan update,
// jadi tidak ikut diperiksa.
function pernyataanTanpaWhere(teks, kata) {
  const hasil = [];
  for (const m of teks.matchAll(new RegExp(`(?<!for\\s)${kata}\\s+(?:public\\.)?[\\w.]+`, 'gi'))) {
    const sisa = teks.slice(m.index);
    const akhir = sisa.indexOf(';');
    const pernyataan = akhir === -1 ? sisa : sisa.slice(0, akhir);
    if (!/\bwhere\b/i.test(pernyataan)) hasil.push(pernyataan.trim().slice(0, 90));
  }
  return hasil;
}

test('migrasi: tidak destruktif (tanpa drop table/truncate, dan setiap delete/update punya where)', () => {
  assert.doesNotMatch(RAPAT, /drop\s+table|truncate/i);
  assert.doesNotMatch(RAPAT, /delete\s+from/i, 'migrasi ini tidak perlu menghapus baris');
  assert.deepEqual(pernyataanTanpaWhere(RAPAT, 'delete\\s+from'), []);
  const update = pernyataanTanpaWhere(RAPAT, 'update');
  assert.deepEqual(update, [], 'semua update wajib punya where: ' + update.join(' | '));
  assert.equal(pernyataanTanpaWhere('delete from public.x;', 'delete\\s+from').length, 1, 'pengaman benar-benar mendeteksi delete tanpa where');
  assert.equal(pernyataanTanpaWhere('update public.x set a = 1;', 'update').length, 1, 'pengaman benar-benar mendeteksi update tanpa where');
  assert.equal(pernyataanTanpaWhere('update public.x set a = 1 where id = 2;', 'update').length, 0);
  assert.equal(pernyataanTanpaWhere('ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1;', 'update').length, 0, 'penguncian FOR UPDATE bukan pernyataan update');
});

test('migrasi: menambah lima kolom penukaran dengan add column if not exists', () => {
  const blok = RAPAT.match(/alter table public\.loyalty_settings add column if not exists faktor_tipe_tukar[\s\S]*?;/i);
  assert.ok(blok, 'harus ada alter table ... add column if not exists faktor_tipe_tukar');
  const b = blok[0];
  assert.match(b, /add column if not exists faktor_tipe_tukar jsonb not null default jsonb_build_object\('Umum', 1, 'Tenaga Kesehatan', 0\.5, 'Apotek Lain', 0\)/i, 'faktor_tipe_tukar: bawaan Umum 1, Nakes 0,5, Apotek Lain 0');
  assert.match(b, /add column if not exists min_poin_tukar integer not null default 0/i);
  assert.match(b, /add column if not exists maks_persen_tukar numeric\(5,2\) not null default 100/i);
  assert.match(b, /add column if not exists maks_tukar_per_hari integer not null default 0/i);
  assert.match(b, /add column if not exists maks_tukar_per_bulan integer not null default 0/i);
  assert.match(RAPAT, /min_poin_tukar between 0 and 1000000/i, 'minimal poin dibatasi constraint');
  assert.match(RAPAT, /maks_persen_tukar between 1 and 100/i, 'batas persentase dibatasi constraint');
  assert.match(RAPAT, /maks_tukar_per_hari between 0 and 1000/i);
  assert.match(RAPAT, /maks_tukar_per_bulan between 0 and 10000/i);
});

test('migrasi: loyalty_cfg_default() memuat kelima kolom dengan nilai bawaan yang benar', () => {
  const def = RAPAT.match(/create or replace function public\.loyalty_cfg_default\(\)[\s\S]*?\$\$;/i);
  assert.ok(def, 'harus ada create or replace function public.loyalty_cfg_default()');
  const isi = def[0];
  assert.match(isi, /'faktor_tipe_tukar', jsonb_build_object\('Umum', 1, 'Tenaga Kesehatan', 0\.5, 'Apotek Lain', 0\)/, 'bawaan faktor penukaran');
  assert.match(isi, /'min_poin_tukar', 0/);
  assert.match(isi, /'maks_persen_tukar', 100/);
  assert.match(isi, /'maks_tukar_per_hari', 0/);
  assert.match(isi, /'maks_tukar_per_bulan', 0/);
  // Bawaan lama harus tetap ada supaya perilaku sebelumnya tidak berubah.
  assert.match(isi, /'faktor_tipe', jsonb_build_object\('Umum', 1, 'Tenaga Kesehatan', 0, 'Apotek Lain', 0\)/, 'faktor perolehan tetap Nakes 0');
  assert.match(isi, /'masa_berlaku_bulan', 12/);
  assert.match(isi, /'aktif', true/);
});

test('migrasi: menolak diri bila prasyarat loyalty_settings atau pos_checkout belum ada', () => {
  assert.match(RAPAT, /raise exception 'Prasyarat belum ada: terapkan dulu migrasi 20260929020000_loyalty_pengaturan_perolehan\.sql\.'/i);
  assert.match(RAPAT, /raise exception 'Prasyarat belum ada: fungsi pos_checkout belum ada \(migrasi 20260925050000\)\.'/i);
  assert.ok(
    RAPAT.search(/raise exception 'Prasyarat belum ada/i) < RAPAT.search(/alter table public\.loyalty_settings add column/i),
    'pengaman prasyarat dijalankan sebelum mengubah apa pun'
  );
});

test('migrasi: loyalty_tukar_periksa hanya boleh dipanggil service_role', () => {
  const f = 'public.loyalty_tukar_periksa(text, uuid, text, numeric, numeric)';
  assert.match(RAPAT, /create or replace function public\.loyalty_tukar_periksa\(\s*p_cabang_id text,/i, 'fungsi penukaran harus ada');
  assert.match(RAPAT, /language plpgsql stable security definer/i, 'fungsi berjalan sebagai definer dan stabil');
  assert.ok(RAPAT.includes(`revoke all on function ${f} from public, anon, authenticated`), 'revoke ' + f);
  assert.ok(RAPAT.includes(`grant execute on function ${f} to service_role`), 'grant ' + f);
  assert.ok(RAPAT.includes('revoke all on function public.loyalty_cfg_default() from public, anon, authenticated'), 'revoke loyalty_cfg_default');
  assert.ok(RAPAT.includes('grant execute on function public.loyalty_cfg_default() to service_role'), 'grant loyalty_cfg_default');
  assert.doesNotMatch(RAPAT, /grant[^;]*\bto\s+(anon|authenticated|public)\b/i, 'tidak ada grant ke anon/authenticated/public');
});

test('migrasi: pos_checkout memakai loyalty_tukar_periksa dan tetap punya cadangan aturan lama', () => {
  assert.equal(
    RAPAT.match(/v_hasil_tukar := public\.loyalty_tukar_periksa\(/g).length, 1,
    'pemeriksaan penukaran dipanggil tepat di satu tempat'
  );
  assert.match(RAPAT, /v_hasil_tukar := public\.loyalty_tukar_periksa\(v_cabang_id, p_reward_id, norm_wa\(p_nomor_wa\), v_subtotal, greatest\(0, coalesce\(p_diskon,0\)\)\)/);
  assert.match(RAPAT, /if v_hasil_tukar is null then/i, 'harus ada jalur cadangan saat pengaturan tidak terbaca');
  assert.ok(RAPAT.includes('v_reward_discount := floor(v_reward_discount/2);'), 'nakes tetap setengah di jalur cadangan');
  assert.ok(RAPAT.includes("RAISE EXCEPTION 'Pelanggan Apotek Lain tidak memiliki poin atau reward.';"), 'Apotek Lain tetap ditolak di jalur cadangan');
  assert.ok(RAPAT.includes("RAISE EXCEPTION 'Poin pelanggan tidak mencukupi untuk reward ini.';"), 'jalur cadangan tetap memeriksa poin');
  assert.ok(RAPAT.includes("RAISE EXCEPTION 'Tier pelanggan belum memenuhi syarat reward ini.';"), 'jalur cadangan tetap memeriksa tier');
  // Jalur cadangan dipakai sebelum pengaturan: urutannya call -> cadangan -> keputusan pengaturan.
  assert.ok(
    RAPAT.indexOf('IF v_hasil_tukar IS NULL THEN') < RAPAT.indexOf("RAISE EXCEPTION '%', coalesce(v_hasil_tukar->>'alasan'"),
    'cadangan diperiksa lebih dulu, baru alasan dari pengaturan'
  );
  // Poin yang dipotong selalu points_required reward (faktor hanya nilai rupiah).
  assert.match(RAPAT, /v_reward\.points_required,v_reward_discount/, 'redemption mencatat poin sebesar points_required');
  assert.match(RAPAT, /total_points=total_points-v_reward\.points_required/, 'saldo dipotong sebesar points_required');
});

test('migrasi: pemanggilan loyalty_tukar_periksa dibungkus BEGIN ... EXCEPTION sehingga penjualan tidak gagal', () => {
  const bungkus = RAPAT.match(/begin\s+v_hasil_tukar := public\.loyalty_tukar_periksa\([\s\S]*?exception when others then\s+v_hasil_tukar := null;\s*end;/i);
  assert.ok(bungkus, 'harus ada blok BEGIN ... EXCEPTION WHEN others THEN v_hasil_tukar := NULL; END;');
  assert.doesNotMatch(bungkus[0], /raise exception/i, 'blok penjaga tidak boleh melempar error baru');
  const sebelumException = bungkus[0].slice(0, bungkus[0].search(/exception when others/i));
  assert.equal((sebelumException.match(/;/g) || []).length, 1, 'blok penjaga hanya berisi satu pernyataan (pemanggilan fungsi)');
});

test('migrasi: pos_checkout tidak mengubah bagian di luar blok reward', () => {
  assert.match(RAPAT, /create or replace function public\.pos_checkout\(/i);
  assert.ok(
    RAPAT.includes('v_harga_akhir := greatest(0, v_subtotal - coalesce(p_diskon,0) - v_reward_discount);'),
    'rumus harga akhir harus utuh persis seperti sebelumnya'
  );
  assert.ok(RAPAT.includes('FOR UPDATE SKIP LOCKED LIMIT 1;'), 'pengambilan batch stok tidak berubah');
  assert.ok(RAPAT.includes("RAISE EXCEPTION 'Keranjang kosong.';"), 'validasi keranjang tidak berubah');
  assert.ok(RAPAT.includes("PERFORM pg_advisory_xact_lock(hashtext('pos_checkout:'||v_cabang_id));"), 'lock per cabang tidak berubah');
  assert.match(RAPAT, /SELECT 'INV-'\|\|v_cabang_id\|\|'-'\|\|to_char\(v_tanggal,'YYYYMMDD'\)\|\|'-'\|\|lpad\(\(count\(\*\)\+1\)::text,4,'0'\)/, 'penomoran nota tidak berubah');
});

// =====================================================================
// Bagian C: Edge Function promo (dijalankan sungguhan lewat vm).
// =====================================================================
const DEFAULT_CFG = {
  aktif: true, basis_hitung: 'harga_akhir', rupiah_per_kelipatan: 1000, poin_per_kelipatan: 1,
  pembulatan: 'bawah', min_belanja: 0, maks_poin_per_transaksi: null,
  faktor_tipe: { 'Umum': 1, 'Tenaga Kesehatan': 0, 'Apotek Lain': 0 },
  gabung_pengganda: 'tertinggi', pengganda: [], retur_kurangi_poin: true,
  masa_berlaku_mode: 'bulan', masa_berlaku_bulan: 12,
  faktor_tipe_tukar: { 'Umum': 1, 'Tenaga Kesehatan': 0.5, 'Apotek Lain': 0 },
  min_poin_tukar: 0, maks_persen_tukar: 100, maks_tukar_per_hari: 0, maks_tukar_per_bulan: 0
};
const valid = (over = {}) => ({ ...JSON.parse(JSON.stringify(DEFAULT_CFG)), ...over });
const KOLOM_TUKAR = ['faktor_tipe_tukar', 'min_poin_tukar', 'maks_persen_tukar', 'maks_tukar_per_hari', 'maks_tukar_per_bulan'];
const UUID_REWARD = '11111111-2222-3333-4444-555555555555';

function backendPromo(opts = {}) {
  const calls = [];
  const tersimpan = [];
  const riwayat = [];
  const tukar = [];
  const tables = {
    app_sessions: [
      { token: 'owner', username: 'suryo', role: 'Owner', cabang_id: 'KARLA' },
      { token: 'apoteker', username: 'apt', role: 'Apoteker', cabang_id: 'KARLA' },
      { token: 'kasir', username: 'ksr', role: 'Kasir', cabang_id: 'KARLA' }
    ],
    loyalty_settings: opts.settings || [],
    loyalty_settings_riwayat: []
  };
  let handler;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const ctx = vm.createContext({ Response, Request, Date, Intl, console, URL, Promise, Math, Number, String, Array, Set, Object, JSON, Error,
    Deno: { env: { get: k => (k === 'SUPABASE_URL' ? 'https://offline.invalid' : 'fake-test-key') }, serve: fn => { handler = fn; } },
    fetch: async (url, init = {}) => {
      const u = new URL(url), q = u.searchParams, rest = u.pathname.replace('/rest/v1/', '');
      const call = { table: rest, q, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, headers: init.headers || {} };
      calls.push(call);
      if (rest === 'rpc/loyalty_cfg_default') return json(DEFAULT_CFG);
      if (rest === 'rpc/loyalty_tukar_periksa') { tukar.push(call.body); return json(opts.tukar || { boleh: true, alasan: null, poin_dibutuhkan: 100, nilai_penukaran: 5000 }); }
      if (rest === 'loyalty_settings' && call.method === 'POST') { tersimpan.push(call.body); return json([call.body]); }
      if (rest === 'loyalty_settings_riwayat' && call.method === 'POST') { riwayat.push(call.body); return json([call.body]); }
      const rows = (tables[rest] || []).filter(r => {
        for (const [k, c] of q.entries()) if (c.startsWith('eq.') && String(r[k]) !== c.slice(3)) return false;
        return true;
      });
      return json(rows);
    }
  });
  vm.runInContext(stripTypeScriptTypes(source(BERKAS_PROMO).replace(/^import "jsr:[^\n]*\n/, '')), ctx);
  return { calls, tersimpan, riwayat, tukar, req: async (name, data = {}, token = 'owner') => {
    const r = await handler(new Request('https://offline.invalid', { method: 'POST', body: JSON.stringify({ args: [name, data, token] }) }));
    return { status: r.status, body: await r.json() };
  } };
}
const ditolak = r => r.body.ok === false && /Akses ditolak/.test(r.body.error);

test('promo: faktor_tipe_tukar menerima 0 sampai 100 dan menolak nilai di luar itu', async () => {
  const b = backendPromo();
  const oke = [
    { 'Umum': 1, 'Tenaga Kesehatan': 0.5, 'Apotek Lain': 0 },
    { 'Umum': 0, 'Tenaga Kesehatan': 0, 'Apotek Lain': 0 },
    { 'Umum': 100, 'Tenaga Kesehatan': 100, 'Apotek Lain': 100 },
    { 'Umum': '1', 'Tenaga Kesehatan': '0.5', 'Apotek Lain': 0 }
  ];
  for (const ft of oke) {
    const r = await b.req('poinSettingSave', valid({ faktor_tipe_tukar: ft }));
    assert.equal(r.body.ok, true, JSON.stringify([ft, r.body]));
  }
  assert.deepEqual(b.tersimpan[0].faktor_tipe_tukar, { 'Umum': 1, 'Tenaga Kesehatan': 0.5, 'Apotek Lain': 0 });
  assert.deepEqual(b.tersimpan[3].faktor_tipe_tukar, { 'Umum': 1, 'Tenaga Kesehatan': 0.5, 'Apotek Lain': 0 }, 'angka bertipe string dinormalkan');

  const bad = [
    [{ 'Umum': -1, 'Tenaga Kesehatan': 0, 'Apotek Lain': 0 }, /Faktor penukaran Umum/],
    [{ 'Umum': 1, 'Tenaga Kesehatan': -0.5, 'Apotek Lain': 0 }, /Faktor penukaran Tenaga Kesehatan/],
    [{ 'Umum': 101, 'Tenaga Kesehatan': 0, 'Apotek Lain': 0 }, /Faktor penukaran Umum/],
    [{ 'Umum': 1, 'Tenaga Kesehatan': 0.5, 'Apotek Lain': 100.01 }, /Faktor penukaran Apotek Lain/],
    [{ 'Umum': 'abc', 'Tenaga Kesehatan': 0, 'Apotek Lain': 0 }, /Faktor penukaran Umum/],
    [{ 'Umum': {}, 'Tenaga Kesehatan': 0, 'Apotek Lain': 0 }, /Faktor penukaran Umum/],
    [{ 'Umum': 1, 'Tenaga Kesehatan': 0.5 }, /Faktor penukaran Apotek Lain/],
    [[], /Faktor penukaran per tipe pelanggan wajib diisi/]
  ];
  for (const [ft, re] of bad) {
    const r = await b.req('poinSettingSave', valid({ faktor_tipe_tukar: ft }));
    assert.equal(r.body.ok, false, 'harus ditolak: ' + JSON.stringify(ft));
    assert.match(r.body.error, re, JSON.stringify([ft, r.body.error]));
  }
  assert.equal(b.tersimpan.length, 4, 'input tidak valid ditolak sebelum menyentuh database');
});

test('promo: min_poin_tukar, maks_tukar_per_hari, maks_tukar_per_bulan menolak negatif dan bukan bilangan bulat', async () => {
  const b = backendPromo();
  const kolom = [
    ['min_poin_tukar', 'Minimal poin untuk menukar', 1000000],
    ['maks_tukar_per_hari', 'Batas penukaran per hari', 1000],
    ['maks_tukar_per_bulan', 'Batas penukaran per bulan', 10000]
  ];
  for (const [nama, label, maks] of kolom) {
    const r = await b.req('poinSettingSave', valid({ [nama]: maks }));
    assert.equal(r.body.ok, true, JSON.stringify([nama, r.body]));
    assert.equal(b.tersimpan[b.tersimpan.length - 1][nama], maks);
    const nol = await b.req('poinSettingSave', valid({ [nama]: 0 }));
    assert.equal(nol.body.ok, true, nama + ' boleh 0 (tanpa batas)');
    const string = await b.req('poinSettingSave', valid({ [nama]: '25' }));
    assert.equal(string.body.ok, true, nama + ' menerima angka bertipe string');
    assert.equal(b.tersimpan[b.tersimpan.length - 1][nama], 25, 'dinormalkan menjadi angka');

    for (const [nilai, re] of [[-1, new RegExp(`^${label} harus antara 0 dan ${maks}\\.$`)], [maks + 1, /harus antara 0 dan/], [1.5, new RegExp(`^${label} harus bilangan bulat\\.$`)], ['abc', new RegExp(`^${label} harus berupa angka\\.$`)], [{}, /berupa angka/]]) {
      const r = await b.req('poinSettingSave', valid({ [nama]: nilai }));
      assert.equal(r.body.ok, false, `harus ditolak: ${nama} = ` + JSON.stringify(nilai));
      assert.match(r.body.error, re, JSON.stringify([nama, nilai, r.body.error]));
    }
  }
  assert.equal(b.tersimpan.length, 9, 'hanya nilai sah yang tersimpan (3 kolom x 3 bentuk sah)');
});

test('promo: maks_persen_tukar hanya menerima 1 sampai 100', async () => {
  const b = backendPromo();
  for (const [nilai, hasil] of [[1, 1], [100, 100], ['50', 50]]) {
    const r = await b.req('poinSettingSave', valid({ maks_persen_tukar: nilai }));
    assert.equal(r.body.ok, true, JSON.stringify([nilai, r.body]));
    assert.equal(b.tersimpan[b.tersimpan.length - 1].maks_persen_tukar, hasil);
  }
  const bad = [
    [0, /Batas persentase penukaran harus antara 1 dan 100\./],
    [101, /Batas persentase penukaran harus antara 1 dan 100\./],
    [-5, /Batas persentase penukaran harus antara 1 dan 100\./],
    [1.005, /Batas persentase penukaran paling banyak 2 angka di belakang koma\./],
    ['x', /Batas persentase penukaran harus berupa angka\./]
  ];
  for (const [nilai, re] of bad) {
    const r = await b.req('poinSettingSave', valid({ maks_persen_tukar: nilai }));
    assert.equal(r.body.ok, false, 'harus ditolak: ' + JSON.stringify(nilai));
    assert.match(r.body.error, re, JSON.stringify([nilai, r.body.error]));
  }
  assert.equal(b.tersimpan.length, 3);
});

test('promo: pemanggil lama tanpa kelima kolom penukaran tetap diterima dengan nilai bawaan', async () => {
  const b = backendPromo();
  const lama = valid();
  for (const k of KOLOM_TUKAR) delete lama[k];
  const r = await b.req('poinSettingSave', lama);
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  const w = b.tersimpan[0];
  assert.deepEqual(w.faktor_tipe_tukar, { 'Umum': 1, 'Tenaga Kesehatan': 0.5, 'Apotek Lain': 0 }, 'bawaan Umum 1, Nakes 0,5, Apotek Lain 0');
  assert.equal(w.min_poin_tukar, 0);
  assert.equal(w.maks_persen_tukar, 100, '100 = tanpa batas tambahan, sama seperti perilaku lama');
  assert.equal(w.maks_tukar_per_hari, 0);
  assert.equal(w.maks_tukar_per_bulan, 0);

  // Kosong (undefined, '', null) diperlakukan sama seperti kolom tidak dikirim.
  const kosong = await b.req('poinSettingSave', valid({
    faktor_tipe_tukar: '', min_poin_tukar: null, maks_persen_tukar: undefined, maks_tukar_per_hari: '', maks_tukar_per_bulan: null
  }));
  assert.equal(kosong.body.ok, true, JSON.stringify(kosong.body));
  const w2 = b.tersimpan[1];
  assert.deepEqual(w2.faktor_tipe_tukar, { 'Umum': 1, 'Tenaga Kesehatan': 0.5, 'Apotek Lain': 0 });
  assert.deepEqual([w2.min_poin_tukar, w2.maks_persen_tukar, w2.maks_tukar_per_hari, w2.maks_tukar_per_bulan], [0, 100, 0, 0]);
  assert.equal(b.tersimpan.length, 2);
});

test('promo: poinTukarSimulasi hanya Owner', async () => {
  const b = backendPromo();
  for (const t of ['apoteker', 'kasir']) {
    assert.ok(ditolak(await b.req('poinTukarSimulasi', { reward_id: UUID_REWARD, nomor_wa: '62811', subtotal: 10000 }, t)), `poinTukarSimulasi harus ditolak untuk ${t}`);
  }
  assert.equal(b.calls.filter(c => c.table.startsWith('rpc/')).length, 0, 'penolakan tidak boleh menyentuh database');
});

test('promo: poinTukarSimulasi menolak reward_id dan nomor_wa yang tidak lengkap', async () => {
  const b = backendPromo();
  const bad = [
    [{ nomor_wa: '62811', subtotal: 10000 }, /Pilih reward yang mau disimulasikan/],
    [{ reward_id: '   ', nomor_wa: '62811', subtotal: 10000 }, /Pilih reward/],
    [{ reward_id: 'bukan-uuid', nomor_wa: '62811', subtotal: 10000 }, /Pilih reward/],
    [{ reward_id: 'x'.repeat(36), nomor_wa: '62811', subtotal: 10000 }, /Pilih reward/],
    [{ reward_id: 12345, nomor_wa: '62811', subtotal: 10000 }, /Pilih reward/],
    [{ reward_id: UUID_REWARD, subtotal: 10000 }, /Nomor WA pelanggan wajib diisi/],
    [{ reward_id: UUID_REWARD, nomor_wa: '   ', subtotal: 10000 }, /Nomor WA pelanggan wajib diisi/]
  ];
  for (const [d, re] of bad) {
    const r = await b.req('poinTukarSimulasi', d);
    assert.equal(r.body.ok, false, 'harus ditolak: ' + JSON.stringify(d));
    assert.match(r.body.error, re, JSON.stringify([d, r.body.error]));
  }
  assert.equal(b.tukar.length, 0, 'masukan tidak lengkap ditolak sebelum menyentuh database');
});

test('promo: poinTukarSimulasi meneruskan parameter ke loyalty_tukar_periksa tanpa menulis apa pun', async () => {
  const b = backendPromo();
  const r = await b.req('poinTukarSimulasi', { reward_id: UUID_REWARD, nomor_wa: '0811-2233', subtotal: '20000' });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  assert.equal(r.body.data.nilai_penukaran, 5000, 'hasil fungsi SQL diteruskan apa adanya');
  assert.deepEqual(b.tukar, [{
    p_cabang_id: 'KARLA', p_reward_id: UUID_REWARD, p_nomor_wa: '628112233', p_subtotal: 20000, p_diskon: 0
  }], 'cabang dari sesi, nomor WA dinormalkan, diskon kosong = 0');

  const denganDiskon = await b.req('poinTukarSimulasi', { reward_id: UUID_REWARD, nomor_wa: '62811', subtotal: 20000, diskon: 2500 });
  assert.equal(denganDiskon.body.ok, true, JSON.stringify(denganDiskon.body));
  assert.equal(b.tukar[1].p_diskon, 2500);
  assert.equal(b.calls.filter(c => c.method === 'POST' && !c.table.startsWith('rpc/')).length, 0, 'simulasi tidak boleh menulis apa pun');
});
