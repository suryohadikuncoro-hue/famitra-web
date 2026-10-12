// Offline regression checks for the focused POS / branch-isolation safeguards.
// Run: node --test tests/pos-shift-expired-batch.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const migration = read('supabase/migrations/20261012090000_pos_shift_expired_batch_reward_guard.sql');
const pos = read('public/js_pos.js');
const promo = read('supabase/functions/promo/index.ts');
const api = read('supabase/functions/api/index.ts');
const dashboard = read('public/js_dashboard.js');
const lottery = read('supabase/functions/lottery/index.ts');
const lotteryUi = read('public/js_marketing_lottery.js');

test('migration repairs shift boundaries without editing historical sales', () => {
  assert.match(migration, /between 8 and 14/);
  assert.match(migration, /between 15 and 20/);
  assert.match(migration, />= 7 AND extract\(hour/);
  assert.match(migration, />= 14 AND extract\(hour/);
  assert.match(migration, /does NOT rewrite historical sales/i);
});

test('expired batch requires an explicit physical-verification confirmation', () => {
  assert.match(migration, /EXPIRED_BATCH_CONFIRM_REQUIRED/);
  assert.match(migration, /v_batch\.expired_date < v_tanggal/);
  assert.match(migration, /confirm_expired/);
  assert.match(pos, /confirm_expired: konfirmasiBatchKedaluwarsa/);
  assert.match(pos, /Saya sudah verifikasi fisik/);
  assert.match(pos, /Batal transaksi/);
  assert.match(pos, /if \(menungguKonfirmasiBatch\) return/);
});

test('reward rule errors are not swallowed into weaker fallback rules', () => {
  assert.match(migration, /A configuration\/eligibility error must not fall back/);
  assert.match(migration, /v_hasil_tukar := public\.loyalty_tukar_periksa/);
  assert.match(migration, /Validasi reward tidak menghasilkan hasil/);
});

test('dashboard promo widget hides results when backend and signed-in branches differ', () => {
  assert.match(promo, /return \{ cabang_id: branch, item:/);
  assert.match(dashboard, /expectedBranch !== responseBranch/);
  assert.match(dashboard, /promo disembunyikan untuk mencegah salah cabang/);
});

test('anonymous sales remain in sales totals but are not merged as one identifiable customer', () => {
  assert.match(api, /ss\.filter\(\(x\) => String\(x\.nomor_wa \|\| ""\)\.trim\(\)\)/);
  assert.match(promo, /t\.nomor_wa \? "w:" \+ normWA\(t\.nomor_wa\) : null/);
  assert.match(promo, /if \(p\) pelanggan\.add\(p\)/);
});

test('lottery API rejects requested branches that differ from the login session', () => {
  assert.match(lottery, /function cabangSesi\(s, requested\)/);
  assert.match(lottery, /if \(requested && String\(requested\)\.trim\(\) !== branch\) fail\("Akses cabang ditolak", 403\)/);
  assert.match(lotteryUi, /kode_cabang: SESS\.user\.cabang_id \|\| null/);
  assert.doesNotMatch(lotteryUi, /Semua cabang/);
});
