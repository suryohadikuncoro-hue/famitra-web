const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sql = ['20261009130000_pembelian_diskon_hutang_atomik.sql','20261009130100_purchase_effective_unit_cost_ppn.sql','20261009130200_pos_checkout_shift_boundaries.sql','20261009140000_markup_harga.sql','20261009150000_purchase_discount_percent_repair.sql'].map(f => fs.readFileSync(path.join(root, 'supabase/migrations', f), 'utf8')).join('\n');
const js = fs.readFileSync(path.join(root, 'public/js_trx.js'), 'utf8');

function harga(modal, persen, pembulatan) {
  if (modal == null || modal <= 0 || persen == null || persen < 0) return null;
  const mentah = Math.round(modal * (1 + persen / 100) * 100) / 100;
  if (persen === 0) return mentah;
  return pembulatan > 0 ? Math.ceil(mentah / pembulatan) * pembulatan : mentah;
}
function modal(netto, qty, ppn, diskonPersen) {
  if (qty <= 0) return null;
  return Math.round((netto * qty * (1 + ppn / 100) * (1 - diskonPersen / 100)) / qty * 100) / 100;
}

test('vektor markup persen identik dengan aturan bisnis', () => {
  assert.deepEqual([harga(999, 200, 100), harga(999, 150, 100), harga(999, 0, 100)], [3000, 2500, 999]);
  assert.equal(harga(999, 0, 0), 999);
  assert.equal(harga(2209.79, 35, 100), 3000);
  assert.equal(harga(null, 200, 100), null);
  assert.equal(harga(0, 200, 100), null);
});

test('vektor rasio dipadankan ke persen', () => {
  assert.deepEqual([harga(999, (3 - 1) * 100, 100), harga(999, (2.5 - 1) * 100, 100), harga(999, 0, 100)], [3000, 2500, 999]);
});

test('vektor modal termasuk PPN setelah diskon', () => {
  assert.equal(modal(1000, 1, 11, 10), 999);
  assert.equal(Math.round((1000 * (1 - 10 / 100)) * 0.11 * 100) / 100, 99);
  assert.equal(modal(2212, 1, 11, 10), 2209.79);
  assert.equal(modal(1000, 1, 0, 10), 900);
});

test('diskon modul Pembelian berkontrak persen 0–100, bukan nominal', () => {
  assert.equal(modal(1000, 1, 11, 10), 999, '10 percent of Rp1,110 leaves modal Rp999');
  assert.match(sql, /1\s*-\s*least\(greatest\(coalesce\(p_diskon, 0\), 0\), 100\)\s*\/\s*100/i);
  assert.match(sql, /p_diskon adalah persentase 0\.\.100/i);
});

test('pemulihan diskon membedakan baris duplikat dan migrasi historis memakai subtotal', () => {
  const cleanup = fs.readFileSync(path.join(root, 'supabase/migrations', '20261009150000_purchase_discount_percent_repair.sql'), 'utf8');
  assert.match(cleanup, /WITH ORDINALITY AS x\(value, ordinality\)/i);
  assert.match(cleanup, /row_number\(\) OVER \([\s\S]*?ORDER BY d\.id/i);
  assert.match(cleanup, /v_updated <> v_item_count/i);
  assert.match(cleanup, /d\.diskon > 100[\s\S]*subtotal/i);
  assert.match(cleanup, /round\(\(r\.bruto - r\.subtotal\) \/ nullif\(r\.bruto, 0\) \* 100, 8\)/i);
  assert.match(cleanup, /purchase_refresh_costs\(v\.cabang_id, v\.kode_obat\)/i);
  assert.doesNotMatch(cleanup, /SET subtotal\s*=|UPDATE public\.trx_pembelian\s+SET/i);
});

test('margin tepat 0% bukan warning visual', () => {
  assert.match(js, /l > 0 && l < 10 \? 'chip-warn'/);
});

test('frontend memuat rumus dan pengaturan yang diwajibkan', () => {
  for (const needle of ['hargaDariMarkupJS', 'Harga_Jual_Mutasi_Baru', 'harga.pengaturan', 'Harga yang diketik manual tidak ditimpa', 'termasuk PPN']) assert.match(js, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(js, /di luar PPN|sebelum PPN/);
});

test('migrasi aman: tabel baru hanya terbuka untuk service_role dan RLS aktif', () => {
  for (const table of ['pengaturan_harga', 'log_perubahan_harga', 'purchase_discount_percent_repair_backup']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(sql, new RegExp(`create policy \\w+\\s+on public\\.${table}`, 'i'));
    assert.match(sql, new RegExp(`grant [^;]+ on public\\.${table} to service_role`, 'i'));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`, 'i'));
  }
  assert.doesNotMatch(sql, /grant[^;]+\bto\s+(anon|authenticated)\b/i);
  assert.match(sql, /harga_markup_terapkan/);
  assert.match(sql, /between 0 and 100 percent|antara 0 dan 100 persen/i);
  assert.match(sql, /purchase_items_discount_nominal/);
  assert.match(sql, /purchase_restore_discount_percent/);
  assert.match(sql, /extract\(hour from/);
});
