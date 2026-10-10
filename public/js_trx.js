/* ================== Pembelian (Bab 5), Biaya (8.1), Laporan (Bab 7) ====== */

var BELI = { items: [], riwayatQuery: '', riwayatOffset: 0, riwayatHasMore: false, riwayatOpen: false, riwayatRequest: 0, riwayatTimer: null, editNoFaktur: null, markup: { tersedia: false, valid: true, mode: 'persen', umum: null, nakes: null, mutasi: null, pembulatan: 100 } };
var BELI_SUGGEST = { timer: null, request: 0, rows: [], index: -1, input: null };
var HUTANG_FN_URL = 'https://xixhazawndmgqzstfjnq.supabase.co/functions/v1/hutang';
function apiHutang(action, data) {
  return fetch(HUTANG_FN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: action, data: data || {}, token: SESSION ? SESSION.token : null })
  }).then(function (r) { return r.json().then(function (x) {
    if (!r.ok || !x.ok) throw new Error(x.error || 'Gagal menghubungi modul hutang.');
    return x.data;
  }); });
}
function chipStatusHutang(status) {
  var map = {
    LUNAS: ['Lunas', 'chip-ok'],
    BELUM_DIBAYAR: ['Belum dibayar', 'chip-warn'],
    DIBAYAR_SEBAGIAN: ['Dibayar sebagian', 'chip-warn'],
    DIBAYAR_SEBAGIAN_TERLAMBAT: ['Sebagian · terlambat', 'chip-bad'],
    TERLAMBAT: ['Terlambat', 'chip-bad'],
    DIBATALKAN: ['Dibatalkan', 'chip-bad']
  };
  var x = map[status] || [status || '—', ''];
  return '<span class="chip ' + x[1] + '">' + x[0] + '</span>';
}
function labelJatuhTempoHutang(r) {
  if (r.Status_Pembayaran === 'LUNAS' || r.Status_Faktur === 'DIBATALKAN') return '';
  if (r.jatuh_tempo_hari === null || r.jatuh_tempo_hari === undefined) return '';
  if (r.jatuh_tempo_hari < 0) return '<span class="kpi-sub">terlambat ' + Math.abs(r.jatuh_tempo_hari) + ' hari</span>';
  if (r.jatuh_tempo_hari === 0) return '<span class="kpi-sub">jatuh tempo hari ini</span>';
  return '<span class="kpi-sub">' + r.jatuh_tempo_hari + ' hari lagi</span>';
}


VIEWS.beli = {
  title: 'Pembelian',
  render: function (el) {
    el.innerHTML =
      '<div class="card beli-meta-card">' +
        '<div class="beli-page-head"><div><div class="beli-eyebrow">PENERIMAAN BARANG</div><h3 id="blJudul">Faktur masuk dari PBF</h3><p>Catat faktur, supplier, dan jadwal pembayaran.</p></div>' +
          '<div class="beli-head-actions"><button id="blBatalUbah" class="btn btn-sm" hidden>Batal ubah</button>' +
          '<button id="blSupplierBaru" class="btn btn-sm">+ Supplier</button></div></div>' +
        '<div id="blInfoUbah" class="beli-edit-note" hidden></div>' +
        '<div class="grid beli-meta-grid">' +
          '<label class="field"><span>Nomor faktur PBF</span><input id="blFaktur" class="inp" placeholder="FK-2026-0012"></label>' +
          '<label class="field"><span>Supplier</span><select id="blSupplier" class="inp"></select></label>' +
          '<label class="field"><span>Kategori pembelian</span><select id="blKategori" class="inp"><option>Berpajak</option><option>Tidak Berpajak</option><option>Konsinyasi</option></select></label>' +
          '<label class="field"><span>Tanggal faktur</span><input id="blTanggal" class="inp" type="date"></label>' +
          '<label class="field"><span>Jatuh tempo</span><input id="blTempo" class="inp" type="date"></label>' +
        '</div>' +
      '</div>' +

      '<div class="card beli-markup-card" id="blMarkupCard">' +
        '<div class="beli-markup-head"><div><h3>Penetapan markup</h3><span id="blMarkupStatus" class="beli-markup-status">Memuat pengaturan…</span></div>' +
          '<button type="button" id="blMarkupToggle" class="btn btn-sm" aria-expanded="false">Atur markup harga <span aria-hidden="true">⌄</span></button></div>' +
        '<div id="blMarkupPanel" class="beli-markup-panel" hidden>' +
          '<div class="grid beli-markup-grid">' +
            '<label class="field"><span>Mode input</span><select id="blMarkupMode" class="inp"><option value="persen">Persen di atas modal</option><option value="rasio">Rasio pengali modal</option></select></label>' +
            '<label class="field"><span>Umum</span><input id="blMarkupUmum" class="inp num" type="number" step="0.01" placeholder="Nonaktif"><small id="blMarkupUmumPad" class="kpi-sub"></small></label>' +
            '<label class="field"><span>Nakes</span><input id="blMarkupNakes" class="inp num" type="number" step="0.01" placeholder="Nonaktif"><small id="blMarkupNakesPad" class="kpi-sub"></small></label>' +
            '<label class="field"><span>Apotek lain</span><input id="blMarkupMutasi" class="inp num" type="number" step="0.01" placeholder="Nonaktif"><small id="blMarkupMutasiPad" class="kpi-sub"></small></label>' +
            '<label class="field"><span>Pembulatan harga</span><select id="blMarkupPembulatan" class="inp"><option value="0">Tanpa pembulatan</option><option value="100">Ke atas Rp100</option><option value="500">Ke atas Rp500</option><option value="1000">Ke atas Rp1.000</option></select></label>' +
          '</div>' +
          '<div class="beli-markup-foot"><p>Pengaturan hanya berlaku untuk faktur ini. Harga yang diketik manual tidak ditimpa. Rasio 2,5 berarti markup 150%.</p>' +
            '<button id="blMarkupSimpan" class="btn btn-sm" hidden>Simpan sebagai bawaan</button></div>' +
        '</div>' +
      '</div>' +

      '<div class="card beli-items-card">' +
        '<div class="beli-section-head"><div><h3>Rincian item</h3><p>Masukkan produk, batch, jumlah, dan harga dalam satu kartu per barang.</p></div>' +
          '<button id="blTambahItem" class="btn btn-primary">+ Tambah baris</button></div>' +
        '<div id="blBody" class="beli-items-list"></div>' +
        '<div id="beliSuggest" class="suggest beli-suggest" hidden></div>' +
        '<div class="beli-total-bar">' +
          '<div class="beli-total-items"><span>Jumlah item</span><strong id="blTotalItem">0 item</strong></div>' +
          '<div class="beli-total-meta"><span>Rincian tagihan</span><strong id="blRingkasBeli">Total PPN Rp0 · total diskon Rp0</strong></div>' +
          '<div class="beli-total-grand"><span>Total tagihan</span><strong id="blTotalTagihan" class="money">Rp0</strong></div>' +
          '<button id="blSimpan" class="btn btn-primary beli-save-btn">Simpan pembelian</button>' +
        '</div>' +
        '<details class="beli-logic-note"><summary>Informasi pencatatan pembelian</summary><p>Menyimpan faktur akan menambah stok per batch dan memperbarui harga modal. Harga jual umum, khusus (nakes), dan mutasi (apotek lain) hanya berubah bila kolomnya diisi. Diskon disimpan sebagai persen dari nilai baris setelah PPN. Laba dihitung dari modal efektif per unit yang sudah termasuk PPN dan diskon. Harga jual yang diisi menjadi harga SKU di Master Barang, bukan harga per batch.</p></details>' +
      '</div>' +

      '<div class="card beli-history-card">' +
        '<div class="beli-history-collapsed-head"><div><h3>Riwayat faktur</h3><p>Telusuri riwayat supplier, harga pembelian, dan status pembayaran. Data dimuat saat Anda membukanya.</p></div>' +
          '<button type="button" id="blToggleRiwayat" class="btn btn-sm beli-history-toggle" aria-expanded="false">Tampilkan riwayat <span aria-hidden="true">⌄</span></button></div>' +
        '<div id="blRiwayatPanel" class="beli-history-panel" hidden>' +
          '<div class="beli-history-search-row"><label class="field beli-history-search"><span>Cari supplier, nomor faktur, atau nama obat</span>' +
            '<input id="blRiwayatCari" class="inp" placeholder="Ketik nama supplier, nomor faktur, atau obat"></label></div>' +
          '<div class="beli-history-list" id="blRiwayat"></div>' +
          '<div class="beli-history-pager"><span id="blPageInfo" class="kpi-sub"></span>' +
            '<div><button id="blPrev" class="btn btn-sm" disabled>Sebelumnya</button> <button id="blNext" class="btn btn-sm" disabled>Berikutnya</button></div></div>' +
        '</div>' +
      '</div>';

    document.getElementById('blTanggal').value = new Date().toISOString().substring(0, 10);
    document.getElementById('blTambahItem').onclick = function () { BELI.items.push(barisKosong()); gambarBeli(); };
    document.getElementById('blSimpan').onclick = simpanPembelian;
    document.getElementById('blMarkupToggle').onclick = function () {
      var panel = document.getElementById('blMarkupPanel');
      var tombol = document.getElementById('blMarkupToggle');
      if (!panel || !tombol) return;
      panel.hidden = !panel.hidden;
      tombol.setAttribute('aria-expanded', String(!panel.hidden));
      tombol.innerHTML = (panel.hidden ? 'Atur markup harga <span aria-hidden="true">⌄</span>' : 'Tutup pengaturan <span aria-hidden="true">⌃</span>');
    };
    document.getElementById('blMarkupMode').onchange = ubahModeMarkupBeli;
    [['blMarkupUmum','umum'],['blMarkupNakes','nakes'],['blMarkupMutasi','mutasi']].forEach(function (x) {
      var e = document.getElementById(x[0]); if (!e) return;
      e.oninput = function () { bacaMarkupBeli(x[1]); };
      e.onchange = function () { bacaMarkupBeli(x[1]); };
    });
    document.getElementById('blMarkupPembulatan').oninput = function () { bacaMarkupBeli(); };
    document.getElementById('blMarkupPembulatan').onchange = function () { bacaMarkupBeli(); };
    document.getElementById('blMarkupSimpan').onclick = simpanBawaanMarkupBeli;
    document.getElementById('blSupplierBaru').onclick = formSupplier;
    document.getElementById('blBatalUbah').onclick = batalUbahFaktur;
    document.getElementById('blToggleRiwayat').onclick = function () {
      var panel = document.getElementById('blRiwayatPanel');
      var tombol = document.getElementById('blToggleRiwayat');
      if (!panel || !tombol) return;
      BELI.riwayatOpen = !!panel.hidden;
      panel.hidden = !BELI.riwayatOpen;
      tombol.setAttribute('aria-expanded', String(BELI.riwayatOpen));
      tombol.innerHTML = BELI.riwayatOpen
        ? 'Tutup riwayat <span aria-hidden="true">⌃</span>'
        : 'Tampilkan riwayat <span aria-hidden="true">⌄</span>';
      if (BELI.riwayatOpen) {
        BELI.riwayatOffset = 0;
        muatRiwayatBeli();
      } else {
        // Abaikan respons yang masih berjalan saat panel ditutup.
        BELI.riwayatRequest++;
      }
    };
    document.getElementById('blRiwayatCari').oninput = function () {
      BELI.riwayatQuery = this.value.trim();
      BELI.riwayatOffset = 0;
      clearTimeout(BELI.riwayatTimer);
      BELI.riwayatTimer = setTimeout(muatRiwayatBeli, 250);
    };
    document.getElementById('blPrev').onclick = function () { BELI.riwayatOffset = Math.max(0, BELI.riwayatOffset - 50); muatRiwayatBeli(); };
    document.getElementById('blNext').onclick = function () { if (BELI.riwayatHasMore) { BELI.riwayatOffset += 50; muatRiwayatBeli(); } };

    BELI.riwayatQuery = '';
    BELI.riwayatOffset = 0;
    BELI.riwayatHasMore = false;
    BELI.riwayatOpen = false;
    BELI.riwayatRequest++;
    clearTimeout(BELI.riwayatTimer);
    BELI.editNoFaktur = null;
    BELI.items = [barisKosong()];
    aturModeUbahBeli(null);
    muatSupplier();
    muatPengaturanMarkup();
    gambarBeli();
    // Riwayat sengaja tidak dimuat otomatis. Data hanya diambil setelah user membukanya.
  }
};

function barisKosong() {
  return { Kode_Obat: '', Nama_Obat: '', Kode_Batch: '', Expired_Date: '', Qty: 0, Harga_Netto: 0,
           PPN: 0, Diskon: 0, Harga_Jual_Umum_Baru: 0, Harga_Khusus_Baru: 0, Harga_Jual_Mutasi_Baru: 0,
           Stok_Tersedia: null, Jual_Umum_Kini: 0, Jual_Khusus_Kini: 0, Jual_Mutasi_Kini: 0, _manual: {}, _markupOtomatis: {}, _tercatat: {} };
}

// Harga modal efektif termasuk PPN dan setelah diskon persentase pada baris.
function hargaModalEfektifBeli(it) {
  var qty = Number(it.Qty) || 0, ppn = Number(it.PPN) || 0;
  if (qty <= 0 || ppn < 0) return null;
  var modal = (Number(it.Harga_Netto) || 0) * qty * (1 + ppn / 100) - diskonRupiahBaris(it);
  return Math.round(modal / qty * 100) / 100;
}
function marginPersenBeli(harga, modal) {
  harga = Number(harga) || 0;
  return harga > 0 && modal !== null && modal > 0 ? (harga - modal) / harga * 100 : null;
}
function htmlLabaBeli(it) {
  var modal = hargaModalEfektifBeli(it);
  var levels = [['Umum', Number(it.Harga_Jual_Umum_Baru) || Number(it.Jual_Umum_Kini) || 0], ['Nakes', Number(it.Harga_Khusus_Baru) || Number(it.Jual_Khusus_Kini) || 0], ['Apotek', Number(it.Harga_Jual_Mutasi_Baru) || Number(it.Jual_Mutasi_Kini) || 0]];
  return levels.map(function (x) { var l = marginPersenBeli(x[1], modal); if (l === null) return '<div class="kpi-sub">' + x[0] + ': —</div>'; var kelas = l < 0 ? 'chip-bad' : (l > 0 && l < 10 ? 'chip-warn' : 'chip-ok'); return '<div><span class="kpi-sub">' + x[0] + ' </span><span class="chip ' + kelas + '">' + l.toFixed(1).replace('.', ',') + '%</span></div>'; }).join('');
}
function hargaDariMarkupJS(modal, persen, pembulatan) {
  if (modal === null || !isFinite(Number(modal)) || Number(modal) <= 0 || persen === null || persen === undefined || !isFinite(Number(persen)) || Number(persen) < 0 || Number(persen) > 1000) return null;
  var mentah = Math.round(Number(modal) * (1 + Number(persen) / 100) * 100) / 100;
  if (Number(persen) === 0) return mentah;
  return Number(pembulatan) > 0 ? Math.ceil(mentah / Number(pembulatan)) * Number(pembulatan) : mentah;
}
function markupInputBeliKePersen(v, mode) {
  if (v === null || v === undefined || v === '') return { valid: true, persen: null };
  var n = Number(v);
  if (!isFinite(n)) return { valid: false, persen: null };
  if (mode === 'rasio') {
    if (n < 1 || n > 11) return { valid: false, persen: null };
    return { valid: true, persen: (n - 1) * 100 };
  }
  if (n < 0 || n > 1000) return { valid: false, persen: null };
  return { valid: true, persen: n };
}
function markupPersenBeliKeInput(persen, mode) {
  if (persen === null || persen === undefined) return '';
  return mode === 'rasio' ? 1 + Number(persen) / 100 : Number(persen);
}
function terapkanMarkupBaris(it) {
  if (!BELI.markup.tersedia) return;
  var modal = hargaModalEfektifBeli(it), m = BELI.markup;
  it._markupOtomatis = it._markupOtomatis || {};
  [['umum','Harga_Jual_Umum_Baru'], ['nakes','Harga_Khusus_Baru'], ['mutasi','Harga_Jual_Mutasi_Baru']].forEach(function (x) {
    if (it._manual && it._manual[x[1]]) return;
    if (it._tercatat && it._tercatat[x[1]]) return;
    var harga = m.valid ? hargaDariMarkupJS(modal, m[x[0]], m.pembulatan) : null;
    if (harga !== null && harga > 0) {
      it[x[1]] = harga; it._markupOtomatis[x[1]] = true;
    } else if (it._markupOtomatis[x[1]]) {
      it[x[1]] = 0; delete it._markupOtomatis[x[1]];
    }
  });
}
function terapkanMarkupSemuaBaris() {
  BELI.items.forEach(function (it) { terapkanMarkupBaris(it); });
}
// Harga jual hasil muat faktur lama dikunci apa adanya: yang tampil adalah nilai
// yang tercatat di faktur itu, bukan hitungan markup saat ini. Kuncinya dilepas
// per tingkat oleh lepasKunciMarkupBeli begitu markup tingkat itu diubah, jadi
// setelah itu perilakunya sama dengan faktur baru.
function kunciHargaFakturBeli(items) {
  (items || []).forEach(function (it) {
    it._manual = it._manual || {};
    it._markupOtomatis = {};
    it._tercatat = { Harga_Jual_Umum_Baru: true, Harga_Khusus_Baru: true, Harga_Jual_Mutasi_Baru: true };
  });
}
// Mengubah satu kolom markup hanya menghitung ulang tingkat itu; harga tingkat
// lain tetap seperti yang tercatat di faktur (atau yang diketik manual).
function lepasKunciMarkupBeli(tingkat) {
  var medan = { umum: 'Harga_Jual_Umum_Baru', nakes: 'Harga_Khusus_Baru', mutasi: 'Harga_Jual_Mutasi_Baru' }[tingkat];
  if (!medan) return;
  BELI.items.forEach(function (it) { if (it._tercatat) delete it._tercatat[medan]; });
}
function sinkronkanHargaMarkupBaris(tr, it) {
  terapkanMarkupBaris(it);
  ['Harga_Jual_Umum_Baru','Harga_Khusus_Baru','Harga_Jual_Mutasi_Baru'].forEach(function (f) { var el = tr.querySelector('[data-f="' + f + '"]'); if (el && !(it._manual && it._manual[f])) el.value = it[f] || ''; });
  var lab = tr.querySelector('[data-laba]'); if (lab) lab.innerHTML = htmlLabaBeli(it);
}
function padananMarkupBeli() {
  [['Umum','blMarkupUmum','blMarkupUmumPad'],['Nakes','blMarkupNakes','blMarkupNakesPad'],['Mutasi','blMarkupMutasi','blMarkupMutasiPad']].forEach(function (x) {
    var v = val(x[1]), el = document.getElementById(x[2]); if (!el) return;
    var n = Number(v), ratioMode = BELI.markup.mode === 'rasio';
    var valid = v !== '' && isFinite(n) && (ratioMode ? n >= 1 && n <= 11 : n >= 0 && n <= 1000);
    el.textContent = !valid ? '' : ratioMode
      ? '= ' + ((n - 1) * 100).toFixed(2).replace(/\.00$/, '') + '%'
      : '= ' + (n / 100 + 1).toFixed(2).replace(/\.00$/, '') + '× rasio';
  });
}
function muatPengaturanMarkup() {
  api('harga.pengaturan', {}).then(function (res) {
    var status = document.getElementById('blMarkupStatus'), card = document.getElementById('blMarkupCard');
    if (!res.tersedia) { BELI.markup.tersedia = false; if (status) status.textContent = res.pesan; return; }
    var c = res.pengaturan || {}; BELI.markup.tersedia = true; BELI.markup.mode = c.mode === 'rasio' ? 'rasio' : 'persen'; BELI.markup.umum = c.markup_umum_persen == null ? null : Number(c.markup_umum_persen); BELI.markup.nakes = c.markup_nakes_persen == null ? null : Number(c.markup_nakes_persen); BELI.markup.mutasi = c.markup_mutasi_persen == null ? null : Number(c.markup_mutasi_persen); BELI.markup.pembulatan = Number(c.pembulatan) || 0;
    BELI.markup.valid = [BELI.markup.umum, BELI.markup.nakes, BELI.markup.mutasi].every(function (p) { return p === null || (isFinite(p) && p >= 0 && p <= 1000); });
    ['blMarkupMode','blMarkupPembulatan'].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = id === 'blMarkupMode' ? BELI.markup.mode : String(BELI.markup.pembulatan); });
    [['blMarkupUmum','umum'],['blMarkupNakes','nakes'],['blMarkupMutasi','mutasi']].forEach(function (x) { var el = document.getElementById(x[0]); if (el) el.value = markupPersenBeliKeInput(BELI.markup[x[1]], BELI.markup.mode); });
    if (status) status.textContent = !BELI.markup.valid ? 'Bawaan markup tidak valid; periksa nilai 0–1000% atau rasio 1–11' : (res.tersimpan ? 'Bawaan cabang dimuat' : 'Belum ada bawaan; isi untuk faktur ini');
    if (card) card.hidden = false; var save = document.getElementById('blMarkupSimpan'); if (save) save.hidden = !(SESSION && SESSION.user && SESSION.user.role === 'Owner');
    padananMarkupBeli(); terapkanMarkupSemuaBaris(); gambarBeli();
  }).catch(function (e) { var status = document.getElementById('blMarkupStatus'); if (status) status.textContent = e.message; });
}
function bacaMarkupBeli(tingkat) {
  var mode = val('blMarkupMode') === 'rasio' ? 'rasio' : 'persen';
  var values = [markupInputBeliKePersen(val('blMarkupUmum'), mode), markupInputBeliKePersen(val('blMarkupNakes'), mode), markupInputBeliKePersen(val('blMarkupMutasi'), mode)];
  BELI.markup.mode = mode; BELI.markup.valid = values.every(function (x) { return x.valid; });
  BELI.markup.umum = BELI.markup.valid ? values[0].persen : null;
  BELI.markup.nakes = BELI.markup.valid ? values[1].persen : null;
  BELI.markup.mutasi = BELI.markup.valid ? values[2].persen : null;
  BELI.markup.pembulatan = Number(val('blMarkupPembulatan')) || 0;
  var status = document.getElementById('blMarkupStatus');
  if (status) status.textContent = BELI.markup.valid ? 'Draf untuk faktur ini' : 'Nilai tidak valid: persen 0–1000 atau rasio 1–11';
  if (tingkat) lepasKunciMarkupBeli(tingkat);
  padananMarkupBeli(); terapkanMarkupSemuaBaris(); gambarBeli();
}
function ubahModeMarkupBeli() {
  var m = BELI.markup, mode = val('blMarkupMode') === 'rasio' ? 'rasio' : 'persen';
  if (!m.valid) { bacaMarkupBeli(); return; }
  m.mode = mode;
  [['blMarkupUmum','umum'],['blMarkupNakes','nakes'],['blMarkupMutasi','mutasi']].forEach(function (x) { var el = document.getElementById(x[0]); if (el) el.value = markupPersenBeliKeInput(m[x[1]], mode); });
  padananMarkupBeli(); terapkanMarkupSemuaBaris(); gambarBeli();
}
function simpanBawaanMarkupBeli() {
  var m = BELI.markup;
  if (!m.valid) { toast('Periksa markup: persen harus 0–1000 atau rasio 1–11.', true); return; }
  api('harga.simpanPengaturan', { mode: m.mode, markup_umum_persen: m.umum, markup_nakes_persen: m.nakes, markup_mutasi_persen: m.mutasi, pembulatan: m.pembulatan }).then(function () { toast('Bawaan markup tersimpan.'); }).catch(function (e) { toast(e.message, true); });
}

// Nilai baris sebelum diskon: netto x qty + PPN.
function brutoBaris(it) {
  return (Number(it.Harga_Netto) || 0) * (Number(it.Qty) || 0) *
    (1 + (Number(it.PPN) || 0) / 100);
}

// Kolom "Diskon (%)" dan trx_pembelian_detail.diskon sama-sama menyimpan
// persentase. Persen dihitung dari nilai baris setelah PPN.
function diskonRupiahBaris(it) {
  var persen = Number(it.Diskon) || 0;
  if (persen <= 0) return 0;
  var bruto = brutoBaris(it);
  if (bruto <= 0) return 0;
  // Dibatas 100% supaya subtotal tidak pernah negatif.
  var nilai = bruto * Math.min(persen, 100) / 100;
  return Math.round(nilai * 100) / 100;
}

function subtotalBaris(it) {
  return brutoBaris(it) - diskonRupiahBaris(it);
}

function tutupSaranBeli() {
  var box = document.getElementById('beliSuggest');
  if (box) box.hidden = true;
  BELI_SUGGEST.rows = []; BELI_SUGGEST.index = -1; BELI_SUGGEST.input = null;
}
function posisikanSaranBeli(input) {
  var box = document.getElementById('beliSuggest'); if (!box || !input) return;
  var r = input.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) { tutupSaranBeli(); return; }
  box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 328)) + 'px';
  box.style.minWidth = Math.max(r.width, 280) + 'px';
  var top = r.bottom + 5, height = Math.min(box.scrollHeight || 280, 280);
  if (top + height > window.innerHeight && r.top > height) top = r.top - height - 5;
  box.style.top = Math.max(8, top) + 'px';
}
function sinkronkanSaranBeli() {
  var box = document.getElementById('beliSuggest');
  if (box && !box.hidden && BELI_SUGGEST.input) posisikanSaranBeli(BELI_SUGGEST.input);
}
function tampilkanSaranBeli(rows, input) {
  var box = document.getElementById('beliSuggest');
  if (!box || !input || !rows.length) { tutupSaranBeli(); return; }
  BELI_SUGGEST.rows = rows.slice(0, 8); BELI_SUGGEST.index = -1; BELI_SUGGEST.input = input;
  box.innerHTML = BELI_SUGGEST.rows.map(function (b, i) {
    return '<button type="button" data-beli-suggest="' + i + '"><div class="s-name">' +
      esc(b.Kode_Obat) + ' · ' + esc(b.Nama_Obat) + '</div><div class="s-meta"><span>' +
      esc(b.Kategori || 'Tanpa kategori') + '</span>' + (b.Barcode ? '<span>Barcode ' + esc(b.Barcode) + '</span>' : '') +
      '<span>Modal ' + (b.Harga_Modal == null ? '—' : rupiah(b.Harga_Modal)) + '</span>' +
      '<span>Stok ' + angka(b.stok || 0) + '</span></div></button>';
  }).join('');
  posisikanSaranBeli(input); box.hidden = false;
}
function pilihSaranBeli(index) {
  var input = BELI_SUGGEST.input, b = BELI_SUGGEST.rows[index]; if (!input || !b) return;
  var i = Number(input.dataset.i), it = BELI.items[i]; if (!it) return;
  it.Kode_Obat = String(b.Kode_Obat || '').toUpperCase();
  it.Nama_Obat = b.Nama_Obat || '';
  it.Stok_Tersedia = Number(b.stok || 0);
  it.Jual_Umum_Kini = Number(b.Harga_Jual_Umum) || 0;
  it.Jual_Khusus_Kini = Number(b.Harga_Khusus) || 0;
  it.Jual_Mutasi_Kini = Number(b.Harga_Jual_Mutasi) || 0;
  if (!Number(it.Harga_Netto)) it.Harga_Netto = Number(b.Harga_Modal) || 0;
  if (!Number(it.PPN)) it.PPN = Number(b.PPN) || 0;
  if (!Number(it.Harga_Jual_Umum_Baru)) it.Harga_Jual_Umum_Baru = Number(b.Harga_Jual_Umum) || 0;
  terapkanMarkupBaris(it);
  tutupSaranBeli(); gambarBeli();
  var next = document.querySelector('#blBody input[data-i="' + i + '"][data-f="Kode_Obat"]');
  if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
}
function jadwalkanSaranBeli(input) {
  clearTimeout(BELI_SUGGEST.timer); var q = String(input.value || '').trim();
  if (!q) { tutupSaranBeli(); return; }
  var request = ++BELI_SUGGEST.request;
  BELI_SUGGEST.timer = setTimeout(function () {
    api('barang.list', { q: q }).then(function (rows) {
      if (request === BELI_SUGGEST.request && document.activeElement === input) tampilkanSaranBeli(rows, input);
    }).catch(function (e) { if (request === BELI_SUGGEST.request) { tutupSaranBeli(); toast(e.message, true); } });
  }, 180);
}
function gambarBeli() {
  var tb = document.getElementById('blBody');
  if (!tb) return;
  tb.innerHTML = BELI.items.map(function (it, i) {
    function inp(field, tipe, placeholder) {
      var extra = field === 'Kode_Obat' ? ' beli-kode-input' : '';
      var ac = field === 'Kode_Obat' ? ' autocomplete="off"' : '';
      var range = (field === 'PPN' || field === 'Diskon') ? ' min="0" max="100" step="0.01"' : '';
      var ph = placeholder ? ' placeholder="' + esc(placeholder) + '"' : '';
      return '<input class="inp beli-field-input' + extra + '" type="' + tipe +
        '" data-i="' + i + '" data-f="' + field + '" value="' + esc(it[field] == null ? '' : it[field]) + '"' + ac + range + ph + '>';
    }
    function field(label, key, type, placeholder, cls) {
      return '<label class="field beli-input-field' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span>' +
        inp(key, type, placeholder) + '</label>';
    }
    var nomor = String(i + 1).padStart(2, '0');
    return '<article class="beli-item" data-beli-item="' + i + '">' +
      '<div class="beli-item-ident">' +
        '<div class="beli-item-number">ITEM ' + nomor + '</div>' +
        field('Kode obat', 'Kode_Obat', 'text', 'Cari kode obat', 'beli-field-code') +
        '<div class="beli-product-name"><span>Nama obat</span><strong>' + (it.Nama_Obat ? esc(it.Nama_Obat) : 'Pilih obat dari saran') + '</strong></div>' +
        field('Kode batch', 'Kode_Batch', 'text', 'Kode batch') +
        field('Kedaluwarsa', 'Expired_Date', 'date', '') +
        field('Qty', 'Qty', 'number', '0', 'beli-field-qty') +
        '<button type="button" class="icon-btn beli-remove-btn" data-del="' + i + '" aria-label="Hapus baris item ' + (i+1) + '" title="Hapus baris">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M5 7l1 14h12l1-14"/><path d="M9 7V4h6v3"/></svg></button>' +
      '</div>' +
      '<div class="beli-item-pricing">' +
        '<div class="beli-subsection-label">Nilai pembelian</div>' +
        '<div class="beli-purchase-grid">' +
          field('Harga netto / unit', 'Harga_Netto', 'number', '0') +
          field('PPN (%)', 'PPN', 'number', '0') +
          field('Diskon (%)', 'Diskon', 'number', '0') +
        '</div>' +
        '<div class="beli-subsection-label beli-selling-label">Harga jual baru <span>Opsional — isi hanya bila harga SKU ingin diperbarui</span></div>' +
        '<div class="beli-selling-grid">' +
          field('Umum', 'Harga_Jual_Umum_Baru', 'number', 'Tidak diubah') +
          field('Khusus / nakes', 'Harga_Khusus_Baru', 'number', 'Tidak diubah') +
          field('Mutasi / apotek lain', 'Harga_Jual_Mutasi_Baru', 'number', 'Tidak diubah') +
        '</div>' +
      '</div>' +
      '<div class="beli-item-summary">' +
        '<div class="beli-summary-box beli-margin-box"><span class="beli-summary-label">Laba per segmen</span><div class="beli-margin-list" data-laba>' + htmlLabaBeli(it) + '</div></div>' +
        '<div class="beli-summary-box"><span class="beli-summary-label">Stok saat ini</span><strong class="beli-stock-value" data-stok>' +
          (it.Stok_Tersedia === null || it.Stok_Tersedia === undefined ? '—' : angka(it.Stok_Tersedia)) + '</strong></div>' +
        '<div class="beli-summary-box beli-subtotal-box"><span class="beli-summary-label">Subtotal item</span><strong data-subtotal>' + rupiah(subtotalBaris(it)) + '</strong></div>' +
      '</div>' +
    '</article>';
  }).join('');

  tb.oninput = function (e) {
    var f = e.target.closest('[data-f]');
    if (!f) return;
    var it = BELI.items[Number(f.dataset.i)];
    if (!it) return;
    it[f.dataset.f] = (f.type === 'number') ? Number(f.value) || 0 : f.value;
    if (['Harga_Jual_Umum_Baru','Harga_Khusus_Baru','Harga_Jual_Mutasi_Baru'].indexOf(f.dataset.f) >= 0) {
      it._manual = it._manual || {};
      it._manual[f.dataset.f] = true;
    } else {
      terapkanMarkupBaris(it);
    }
    ringkasBeli();
    if (f.dataset.f === 'Kode_Obat') jadwalkanSaranBeli(f);
    var itemCard = f.closest('.beli-item');
    var subtotal = itemCard && itemCard.querySelector('[data-subtotal]');
    if (subtotal) subtotal.textContent = rupiah(subtotalBaris(it));
    if (itemCard) sinkronkanHargaMarkupBaris(itemCard, it);
  };
  tb.onchange = function (e) {
    var f = e.target.closest('[data-f="Kode_Obat"]');
    if (!f) return;
    var i = Number(f.dataset.i), it = BELI.items[i];
    if (!it || !it.Kode_Obat || it.Nama_Obat) return;
    api('barang.list', { q: it.Kode_Obat }).then(function (rows) {
      var b = (rows || []).filter(function (x) { return String(x.Kode_Obat).toUpperCase() === String(it.Kode_Obat).toUpperCase(); })[0];
      if (!b) return;
      it.Nama_Obat = b.Nama_Obat || '';
      it.Stok_Tersedia = Number(b.stok || 0);
      it.Jual_Umum_Kini = Number(b.Harga_Jual_Umum) || 0;
      it.Jual_Khusus_Kini = Number(b.Harga_Khusus) || 0;
      it.Jual_Mutasi_Kini = Number(b.Harga_Jual_Mutasi) || 0;
      if (!Number(it.Harga_Netto)) it.Harga_Netto = Number(b.Harga_Modal) || 0;
      if (!Number(it.PPN)) it.PPN = Number(b.PPN) || 0;
      if (!Number(it.Harga_Jual_Umum_Baru)) it.Harga_Jual_Umum_Baru = Number(b.Harga_Jual_Umum) || 0;
      terapkanMarkupBaris(it);
      gambarBeli();
    }).catch(function () { /* nama barang opsional; abaikan bila gagal */ });
  };
  tb.onclick = function (e) {
    var d = e.target.closest('[data-del]');
    if (!d) return;
    tutupSaranBeli();
    BELI.items.splice(Number(d.dataset.del), 1);
    if (!BELI.items.length) BELI.items.push(barisKosong());
    gambarBeli();
  };
  tb.onkeydown = function (e) {
    var input = e.target.closest('[data-f="Kode_Obat"]');
    var box = document.getElementById('beliSuggest');
    if (!input || !BELI_SUGGEST.input || !box || box.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var d = e.key === 'ArrowDown' ? 1 : -1;
      BELI_SUGGEST.index = (BELI_SUGGEST.index + d + BELI_SUGGEST.rows.length) % BELI_SUGGEST.rows.length;
      document.querySelectorAll('#beliSuggest [data-beli-suggest]').forEach(function (b, j) { b.classList.toggle('is-cursor', j === BELI_SUGGEST.index); });
    } else if (e.key === 'Enter' && BELI_SUGGEST.index >= 0) {
      e.preventDefault(); pilihSaranBeli(BELI_SUGGEST.index);
    } else if (e.key === 'Escape') {
      tutupSaranBeli();
    }
  };
  var suggest = document.getElementById('beliSuggest');
  if (suggest) suggest.onclick = function (e) {
    var b = e.target.closest('[data-beli-suggest]');
    if (b) pilihSaranBeli(Number(b.dataset.beliSuggest));
  };
  if (!window._beliSuggestViewportBound) {
    window._beliSuggestViewportBound = true;
    window.addEventListener('scroll', sinkronkanSaranBeli, true);
    window.addEventListener('resize', sinkronkanSaranBeli);
  }
  ringkasBeli();
}

function ringkasBeli() {
  var qty = 0, bruto = 0, ppn = 0, diskon = 0;
  BELI.items.forEach(function (it) {
    var q = Number(it.Qty) || 0, n = Number(it.Harga_Netto) || 0;
    var p = Number(it.PPN) || 0;
    qty += q;
    var setelahDiskon = n * q - diskonRupiahBaris(it) / (1 + p / 100);
    ppn += setelahDiskon * p / 100;
    diskon += diskonRupiahBaris(it);
    bruto += brutoBaris(it);
  });
  var elItem = document.getElementById('blTotalItem');
  var elTotal = document.getElementById('blTotalTagihan');
  var elRingkas = document.getElementById('blRingkasBeli');
  if (elItem) elItem.textContent = angka(qty) + ' item masuk';
  if (elTotal) elTotal.textContent = rupiah(bruto - diskon);
  if (elRingkas) elRingkas.textContent = 'Total PPN ' + rupiah(ppn) + ' · total diskon ' + rupiah(diskon);
}

function muatSupplier() {
  api('beli.supplier', {}).then(function (rows) {
    var sel = document.getElementById('blSupplier');
    if (!sel) return;
    sel.innerHTML = rows.length
      ? rows.map(function (s) { return '<option>' + esc(s.Nama_Supplier) + '</option>'; }).join('')
      : '<option value="">Belum ada supplier</option>';
  }).catch(function (e) { toast(e.message, true); });
}

function formSupplier() {
  modalBuka('Tambah supplier',
    '<label class="field"><span>Nama supplier</span><input id="fspNama" class="inp"></label>' +
    '<label class="field"><span>Telepon</span><input id="fspTelp" class="inp"></label>' +
    '<label class="field"><span>Alamat</span><input id="fspAlamat" class="inp"></label>',
    [
      { label: 'Batal', aksi: modalTutup },
      { label: 'Simpan supplier', kelas: 'btn-primary', aksi: function () {
          api('beli.simpanSupplier', {
            Nama_Supplier: val('fspNama'), Telepon: val('fspTelp'), Alamat: val('fspAlamat')
          }).then(function () {
            modalTutup(); toast('Supplier tersimpan.'); muatSupplier();
          }).catch(function (e) { toast(e.message, true); });
        } }
    ]);
}

function simpanPembelian() {
  var isi = BELI.items.filter(function (it) { return it.Kode_Obat && Number(it.Qty) > 0; });
  if (!isi.length) { toast('Isi minimal satu baris item dengan qty.', true); return; }
  if (isi.some(function (it) { return Number(it.PPN) < 0 || Number(it.PPN) > 100 || Number(it.Diskon) < 0 || Number(it.Diskon) > 100; })) {
    toast('PPN dan diskon harus berada di antara 0 dan 100 persen.', true); return;
  }

  // Peringatan margin negatif memeriksa semua tingkat yang terisi; margin 0% aman.
  var kurang = isi.filter(function (it) {
    var modal = hargaModalEfektifBeli(it);
    return [['Harga_Jual_Umum_Baru','Jual_Umum_Kini'],['Harga_Khusus_Baru','Jual_Khusus_Kini'],['Harga_Jual_Mutasi_Baru','Jual_Mutasi_Kini']].some(function (x) { var jual = Number(it[x[0]]) || Number(it[x[1]]) || 0; return jual > 0 && modal !== null && modal > jual; });
  });
  if (kurang.length) {
    var daftar = kurang.map(function (it) {
      var jual = Number(it.Harga_Jual_Umum_Baru) || Number(it.Jual_Umum_Kini) || 0;
      return '<li>' + esc(it.Nama_Obat || it.Kode_Obat) + ' — modal termasuk PPN ' + rupiah(hargaModalEfektifBeli(it)) + ', umum ' + rupiah(jual) + '</li>';
    }).join('');
    modalBuka('Harga beli di atas harga jual',
      '<p>Baris berikut akan membuat margin negatif:</p><ul>' + daftar + '</ul>' +
      '<p class="kpi-sub">Modal per unit sudah termasuk PPN dan diskon. Periksa umum, nakes, dan apotek lain.</p>',
      [
        { label: 'Periksa lagi', aksi: modalTutup },
        { label: 'Tetap simpan', kelas: 'btn-danger', aksi: function () { modalTutup(); kirimPembelian(isi); } }
      ]);
    return;
  }
  kirimPembelian(isi);
}

function kirimPembelian(isi) {
  var btn = document.getElementById('blSimpan');
  if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan…'; }
  // Diskon dikirim dan disimpan sebagai persentase.
  var kirim = isi.map(function (it) {
    return {
      Kode_Obat: it.Kode_Obat, Kode_Batch: it.Kode_Batch, Expired_Date: it.Expired_Date,
      Qty: it.Qty, Harga_Netto: it.Harga_Netto, PPN: it.PPN,
      Diskon: Math.min(100, Math.max(0, Number(it.Diskon) || 0)),
      Harga_Jual_Umum_Baru: it.Harga_Jual_Umum_Baru,
      Harga_Khusus_Baru: it.Harga_Khusus_Baru,
      Harga_Jual_Mutasi_Baru: it.Harga_Jual_Mutasi_Baru
    };
  });
  api('beli.simpan', {
    mode: BELI.editNoFaktur ? 'edit' : 'baru',
    No_Faktur_Sistem: BELI.editNoFaktur || '',
    No_Faktur: val('blFaktur'), Supplier: val('blSupplier'), Kategori: val('blKategori'),
    Tanggal_Faktur: val('blTanggal'), Jatuh_Tempo: val('blTempo'), items: kirim
  }).then(function (r) {
    toast(BELI.editNoFaktur
      ? 'Faktur ' + r.No_Faktur + ' diperbarui, ' + angka(r.Total_Item) + ' item.'
      : 'Faktur ' + r.No_Faktur + ' tersimpan, ' + angka(r.Total_Item) + ' item masuk.');
    batalUbahFaktur();
    muatRiwayatBeli();
  }).catch(function (e) {
    toast(e.message, true);
  }).then(function () {
    if (btn) {
      btn.disabled = false;
      btn.textContent = BELI.editNoFaktur ? 'Simpan perubahan faktur' : 'Simpan pembelian';
    }
  });
}

// Menandai form sedang mengubah faktur lama (atau kembali ke mode faktur baru).
function aturModeUbahBeli(h) {
  var judul = document.getElementById('blJudul');
  var info = document.getElementById('blInfoUbah');
  var tombol = document.getElementById('blSimpan');
  var batal = document.getElementById('blBatalUbah');
  if (h) {
    if (judul) judul.textContent = 'Ubah faktur ' + h.No_Faktur;
    if (info) {
      info.hidden = false;
      info.innerHTML = 'Mengubah faktur <strong>' + esc(h.No_Faktur) + '</strong> · PBF ' +
        esc(h.No_Faktur_Supplier || '—') + ' · ' + tglIndo(h.Tanggal_Faktur) +
        (h.Diedit_At ? ' · pernah diubah oleh ' + esc(h.Diedit_Oleh || '-') : '');
    }
    if (tombol) tombol.textContent = 'Simpan perubahan faktur';
    if (batal) batal.hidden = false;
  } else {
    if (judul) judul.textContent = 'Faktur masuk dari PBF';
    if (info) { info.hidden = true; info.innerHTML = ''; }
    if (tombol) tombol.textContent = 'Simpan pembelian';
    if (batal) batal.hidden = true;
  }
}

function batalUbahFaktur() {
  BELI.editNoFaktur = null;
  BELI.items = [barisKosong()];
  var f = document.getElementById('blFaktur'); if (f) f.value = '';
  var t = document.getElementById('blTempo'); if (t) t.value = '';
  var g = document.getElementById('blTanggal'); if (g) g.value = new Date().toISOString().substring(0, 10);
  aturModeUbahBeli(null);
  gambarBeli();
}

function bukaUbahFaktur(no) {
  api('beli.detail', { No_Faktur: no }).then(function (d) {
    var h = d.Header || {};
    BELI.editNoFaktur = h.No_Faktur;
    BELI.items = (d.items && d.items.length) ? d.items : [barisKosong()];
    // Diskon tersimpan sebagai persentase, sama seperti kolom form.
    BELI.items.forEach(function (it) {
      it.Diskon = Math.min(100, Math.max(0, Number(it.Diskon) || 0));
    });
    // Faktur dibuka apa adanya: harga jual yang tampil adalah nilai tercatat di
    // faktur, bukan hitungan markup saat ini.
    kunciHargaFakturBeli(BELI.items);
    var f = document.getElementById('blFaktur'); if (f) f.value = h.No_Faktur_Supplier || '';
    var k = document.getElementById('blKategori'); if (k) k.value = h.Kategori || 'Tidak Berpajak';
    var g = document.getElementById('blTanggal'); if (g) g.value = h.Tanggal_Faktur || '';
    var t = document.getElementById('blTempo'); if (t) t.value = h.Jatuh_Tempo || '';
    var sel = document.getElementById('blSupplier');
    if (sel) {
      var ketemu = false;
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === h.Supplier) { sel.selectedIndex = i; ketemu = true; break; }
      }
      if (!ketemu) {
        sel.innerHTML = '<option>' + esc(h.Supplier || '') + '</option>' + sel.innerHTML;
        sel.selectedIndex = 0;
      }
    }
    aturModeUbahBeli(h);
    gambarBeli();
    toast('Faktur ' + h.No_Faktur + ' dimuat ke form di bagian atas halaman.');
    // Konten digulir di dalam panel #view, bukan di jendela (lihat js_core.js:
    // "Konten di-scroll di dalam panel (#view)"). window.scrollTo tidak
    // berpengaruh di sini, sehingga perubahan tadi tidak terlihat.
    var panel = document.getElementById('view');
    if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }).catch(function (e) { toast(e.message, true); });
}

function konfirmasiBatalFaktur(r) {
  modalBuka('Batalkan faktur ' + r.No_Faktur,
    '<p>Faktur <strong>' + esc(r.No_Faktur) + '</strong> (' + esc(r.Supplier) + ', ' + rupiah(r.Total_Tagihan) +
      ') akan dibatalkan.</p>' +
    '<p class="kpi-sub">Stok yang pernah ditambahkan akan dikurangi kembali. Faktur tidak dihapus — tetap ' +
      'tersimpan sebagai catatan dibatalkan. Pembatalan ditolak kalau stoknya sudah terjual atau fakturnya ' +
      'sudah ada pembayaran.</p>' +
    '<label class="field"><span>Alasan pembatalan</span><textarea id="blAlasanBatal" class="inp" rows="3" ' +
      'placeholder="Contoh: salah input, faktur dobel, barang tidak jadi dikirim"></textarea></label>',
    [
      { label: 'Kembali', aksi: modalTutup },
      { label: 'Batalkan faktur', kelas: 'btn-danger', aksi: function () {
          var alasan = val('blAlasanBatal');
          if (!alasan) { toast('Alasan pembatalan wajib diisi.', true); return; }
          api('beli.batal', { No_Faktur: r.No_Faktur, Alasan: alasan }).then(function () {
            modalTutup();
            toast('Faktur ' + r.No_Faktur + ' dibatalkan.');
            if (BELI.editNoFaktur === r.No_Faktur) batalUbahFaktur();
            muatRiwayatBeli();
          }).catch(function (e) { toast(e.message, true); });
        } }
    ]);
}

function bukaBayarHutang(r) {
  if (!r || r.Status_Pembayaran === 'LUNAS') return;
  var today = new Date().toISOString().substring(0, 10);
  modalBuka('Bayar hutang · ' + r.No_Faktur,
    '<div class="kpi-sub">Supplier: <strong>' + esc(r.Supplier) + '</strong></div>' +
    '<div class="grid g2" style="margin:10px 0 14px">' +
      '<div><div class="sat-label">Total tagihan</div><strong>' + rupiah(r.Total_Tagihan) + '</strong></div>' +
      '<div><div class="sat-label">Sisa hutang</div><strong>' + rupiah(r.Sisa_Hutang) + '</strong></div>' +
    '</div>' +
    '<div class="grid g2">' +
      '<label class="field"><span>Tanggal bayar</span><input id="phTanggal" class="inp" type="date" value="' + today + '"></label>' +
      '<label class="field"><span>Jumlah bayar</span><input id="phJumlah" class="inp num" type="number" min="1" max="' + r.Sisa_Hutang + '" value="' + r.Sisa_Hutang + '"></label>' +
    '</div>' +
    '<label class="field"><span>Metode pembayaran</span><select id="phMetode" class="inp">' +
      ['Tunai','Transfer Bank','QRIS','E-wallet','Kartu Debit','Kartu Kredit','Cek/Giro','Lainnya'].map(function (x) { return '<option>' + x + '</option>'; }).join('') +
    '</select></label>' +
    '<label class="field"><span>Referensi</span><input id="phReferensi" class="inp" placeholder="No. transfer / bukti pembayaran (opsional)"></label>' +
    '<label class="field"><span>Catatan</span><textarea id="phCatatan" class="inp" rows="2" placeholder="Wajib diisi jika memilih Lainnya"></textarea></label>',
    [
      { label: 'Batal', aksi: modalTutup },
      { label: 'Simpan pembayaran', kelas: 'btn-primary', aksi: function () {
          var jumlah = numVal('phJumlah');
          if (jumlah <= 0 || jumlah > Number(r.Sisa_Hutang)) { toast('Jumlah harus lebih dari Rp0 dan tidak melebihi sisa hutang.', true); return; }
          var metode = val('phMetode'), catatan = val('phCatatan');
          if (metode === 'Lainnya' && !catatan) { toast('Catatan wajib diisi untuk metode Lainnya.', true); return; }
          apiHutang('pay', { no_faktur: r.No_Faktur, tanggal_bayar: val('phTanggal'), jumlah_bayar: jumlah, metode_bayar: metode, referensi: val('phReferensi'), catatan: catatan })
            .then(function () { modalTutup(); toast('Pembayaran tersimpan.'); muatRiwayatBeli(); })
            .catch(function (e) { toast(e.message, true); });
        } }
    ]);
}
function bukaRiwayatHutang(noFaktur) {
  apiHutang('history', { no_faktur: noFaktur }).then(function (d) {
    var rows = d.pembayaran || [];
    var body = rows.length ? '<div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Jumlah</th><th>Metode</th><th>Status</th><th>Dicatat oleh</th><th></th></tr></thead><tbody>' +
      rows.map(function (x) {
        var batal = x.status === 'AKTIF' ? '<button class="btn btn-sm" data-batal-pembayaran="' + esc(x.id) + '">Batalkan</button>' : '<span class="kpi-sub">' + esc(x.alasan_pembatalan || 'Dibatalkan') + '</span>';
        return '<tr><td>' + tglIndo(x.tanggal_bayar) + '</td><td class="r num">' + rupiah(x.jumlah_bayar) + '</td><td>' + esc(x.metode_bayar) + '</td><td>' + (x.status === 'AKTIF' ? chipStatusHutang('DIBAYAR_SEBAGIAN') : '<span class="chip chip-bad">Dibatalkan</span>') + '</td><td>' + esc(x.dibayar_oleh || '-') + '</td><td class="c">' + batal + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="empty">Belum ada pembayaran untuk faktur ini.</div>';
    modalBuka('Riwayat pembayaran · ' + noFaktur, body, [{ label: 'Tutup', aksi: modalTutup }]);
    document.getElementById('modalBody').onclick = function (e) {
      var b = e.target.closest('[data-batal-pembayaran]');
      if (!b) return;
      var id = b.dataset.batalPembayaran;
      modalBuka('Batalkan pembayaran', '<p>Pembayaran ini tidak akan dihapus.</p><label class="field"><span>Alasan pembatalan</span><textarea id="phAlasan" class="inp" rows="3" placeholder="Contoh: salah nominal atau salah rekening"></textarea></label>', [
        { label: 'Kembali', aksi: function () { bukaRiwayatHutang(noFaktur); } },
        { label: 'Konfirmasi pembatalan', kelas: 'btn-primary', aksi: function () {
            var alasan = val('phAlasan');
            if (!alasan) { toast('Alasan pembatalan wajib diisi.', true); return; }
            apiHutang('cancel', { id: id, alasan_pembatalan: alasan }).then(function () { modalTutup(); toast('Pembayaran dibatalkan.'); muatRiwayatBeli(); }).catch(function (er) { toast(er.message, true); });
          } }
      ]);
    };
  }).catch(function (e) { toast(e.message, true); });
}
function muatRiwayatBeli() {
  var tb = document.getElementById('blRiwayat');
  if (!tb || !BELI.riwayatOpen) return;
  var q = BELI.riwayatQuery || '';
  var offset = BELI.riwayatOffset || 0;
  var request = ++BELI.riwayatRequest;
  apiHutang('list', { q: q, limit: 50, offset: offset }).then(function (result) {
    if (!BELI.riwayatOpen || request !== BELI.riwayatRequest || q !== BELI.riwayatQuery || offset !== BELI.riwayatOffset) return;
    var rows = result.rows || [];
    BELI.riwayatHasMore = !!result.has_more;
    if (!tb.isConnected) return;
    tb.innerHTML = rows.length ? rows.map(function (r) {
      var batal = r.Status_Faktur === 'DIBATALKAN';
      var aksi;
      if (batal) {
        aksi = '<span class="beli-cancelled-label">Faktur dibatalkan</span>';
      } else {
        var ubah = '<button class="btn btn-sm beli-history-icon" data-ubah-faktur="' + esc(r.No_Faktur) + '" title="Ubah faktur" aria-label="Ubah faktur ' + esc(r.No_Faktur) + '">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg></button>';
        var bayar = r.Status_Pembayaran === 'LUNAS'
          ? ''
          : '<button class="btn btn-sm btn-primary beli-history-pay" data-bayar-hutang="' + esc(r.No_Faktur) + '">Bayar</button>';
        var riwayat = '<button class="btn btn-sm beli-history-icon" data-riwayat-hutang="' + esc(r.No_Faktur) + '" title="Riwayat pembayaran" aria-label="Riwayat pembayaran ' + esc(r.No_Faktur) + '">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg></button>';
        var batalkan = '<button class="btn btn-sm btn-danger beli-history-icon" data-batal-faktur="' + esc(r.No_Faktur) + '" title="Batalkan faktur" aria-label="Batalkan faktur ' + esc(r.No_Faktur) + '">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg></button>';
        aksi = '<div class="beli-history-actions">' + ubah + bayar + riwayat + batalkan + '</div>';
      }
      var statusSel = batal
        ? chipStatusHutang('DIBATALKAN')
        : chipStatusHutang(r.Status_Pembayaran) + (r.Diedit_At ? ' <span class="kpi-sub">pernah diubah</span>' : '');
      var tempo = r.Jatuh_Tempo
        ? '<strong>' + tglIndo(r.Jatuh_Tempo) + '</strong>' + labelJatuhTempoHutang(r)
        : '<strong>—</strong>';
      return '<article class="beli-history-item' + (batal ? ' is-cancelled' : '') + '">' +
        '<div class="beli-history-top"><div class="beli-history-ref"><strong>' + esc(r.No_Faktur) + '</strong><span>Faktur sistem</span></div>' +
          '<div class="beli-history-status">' + statusSel + '</div></div>' +
        '<div class="beli-history-supplier"><strong>' + esc(r.Supplier) + '</strong><span>' + esc(r.Kategori || '—') + '</span></div>' +
        '<div class="beli-history-doc-info">' +
          '<div><span>No. faktur PBF</span><strong>' + esc(r.No_Faktur_Supplier || '—') + '</strong></div>' +
          '<div><span>Tanggal faktur</span><strong>' + tglIndo(r.Tanggal_Faktur) + '</strong></div>' +
          '<div class="beli-history-tempo"><span>Jatuh tempo</span>' + tempo + '</div>' +
          '<div><span>Jumlah item</span><strong>' + angka(r.Total_Item) + '</strong></div>' +
        '</div>' +
        '<div class="beli-history-finance">' +
          '<div><span>Total tagihan</span><strong>' + rupiah(r.Total_Tagihan) + '</strong></div>' +
          '<div><span>Sudah dibayar</span><strong>' + rupiah(r.Total_Dibayar) + '</strong></div>' +
          '<div class="beli-history-outstanding"><span>Sisa hutang</span><strong>' + rupiah(r.Sisa_Hutang) + '</strong></div>' +
        '</div>' +
        '<div class="beli-history-bottom">' + aksi + '</div>' +
      '</article>';
    }).join('') : '<div class="beli-empty"><strong>' + (q ? 'Tidak ada faktur yang cocok' : 'Belum ada faktur tercatat') + '</strong><span>' + (q ? 'Coba kata kunci lain.' : 'Faktur yang disimpan akan muncul di sini.') + '</span></div>';
    var pageInfo = document.getElementById('blPageInfo');
    var prev = document.getElementById('blPrev'), next = document.getElementById('blNext');
    if (pageInfo) pageInfo.textContent = rows.length ? 'Faktur ' + (offset + 1) + '–' + (offset + rows.length) + (q ? ' · hasil pencarian' : '') : (q ? 'Tidak ada faktur yang cocok.' : 'Belum ada faktur tercatat.');
    if (prev) prev.disabled = offset <= 0;
    if (next) next.disabled = !BELI.riwayatHasMore;
    tb.onclick = function (e) {
      var b = e.target.closest('[data-bayar-hutang],[data-riwayat-hutang],[data-ubah-faktur],[data-batal-faktur]');
      if (!b) return;
      var no = b.dataset.bayarHutang || b.dataset.riwayatHutang || b.dataset.ubahFaktur || b.dataset.batalFaktur;
      var r = rows.filter(function (x) { return x.No_Faktur === no; })[0];
      if (!r) return;
      if (b.dataset.ubahFaktur) bukaUbahFaktur(r.No_Faktur);
      else if (b.dataset.batalFaktur) konfirmasiBatalFaktur(r);
      else if (b.dataset.bayarHutang) bukaBayarHutang(r);
      else bukaRiwayatHutang(r.No_Faktur);
    };
  }).catch(function (e) {
    if (!BELI.riwayatOpen || request !== BELI.riwayatRequest || q !== BELI.riwayatQuery || offset !== BELI.riwayatOffset) return;
    tb.innerHTML = '<div class="beli-empty beli-empty-error">' + esc(e.message) + '</div>';
  });
}
/* ------------------------------------------------- Biaya operasional ---- */

VIEWS.biaya = {
  title: 'Biaya Operasional',
  render: function (el) {
    el.innerHTML =
      '<div class="card"><div class="card-head"><h3>Catat pengeluaran</h3></div>' +
        '<div class="grid g3">' +
          '<label class="field"><span>Tanggal</span><input id="byTanggal" class="inp" type="date"></label>' +
          '<label class="field"><span>Keterangan</span><input id="byKet" class="inp" ' +
            'placeholder="Gaji karyawan, token listrik, plastik"></label>' +
          '<label class="field"><span>Nominal (Rp)</span><input id="byNominal" class="inp num" type="number"></label>' +
        '</div>' +
        '<button id="bySimpan" class="btn btn-primary">Simpan pengeluaran</button></div>' +
      filterBarHtml('by') +
      '<div class="card"><div class="card-head"><h3>Daftar pengeluaran</h3>' +
        '<span id="byTotal" class="chip"></span></div>' +
        '<div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Keterangan</th>' +
          '<th class="r">Nominal</th><th>Shift</th><th>Petugas</th><th></th></tr></thead>' +
          '<tbody id="byBody"></tbody></table></div></div>';

    document.getElementById('byTanggal').value = new Date().toISOString().substring(0, 10);
    document.getElementById('bySimpan').onclick = function () {
      api('biaya.simpan', {
        Tanggal: val('byTanggal'), Keterangan: val('byKet'), Nominal: numVal('byNominal')
      }).then(function () {
        toast('Pengeluaran tercatat.');
        document.getElementById('byKet').value = '';
        document.getElementById('byNominal').value = '';
        muatBiaya();
      }).catch(function (e) { toast(e.message, true); });
    };
    pasangFilter('by', muatBiaya, 'bulanan');
    muatBiaya();
  }
};

function muatBiaya() {
  var tb = document.getElementById('byBody');
  if (!tb) return;
  api('biaya.list', { filter: bacaFilter('by') }).then(function (d) {
    document.getElementById('byTotal').textContent = d.rentang.label + ' · ' + rupiah(d.total);
    tb.innerHTML = d.rows.length ? d.rows.map(function (r) {
      return '<tr><td>' + tglIndo(r.Tanggal) + '</td><td>' + esc(r.Keterangan) + '</td>' +
        '<td class="r num">' + rupiah(r.Nominal) + '</td><td>' + esc(r.Shift) + '</td>' +
        '<td>' + esc(r.Petugas) + '</td>' +
        '<td class="c"><button class="icon-btn" data-del="' + esc(r.ID) + '" aria-label="Hapus">✕</button></td></tr>';
    }).join('') : tabelKosong('Belum ada pengeluaran pada rentang ini.', 6);

    tb.onclick = function (e) {
      var d2 = e.target.closest('[data-del]');
      if (!d2) return;
      api('biaya.hapus', { ID: d2.dataset.del })
        .then(function () { toast('Catatan dihapus.'); muatBiaya(); })
        .catch(function (er) { toast(er.message, true); });
    };
  }).catch(function (e) {
    tb.innerHTML = '<tr><td colspan="6" class="empty">' + esc(e.message) + '</td></tr>';
  });
}

/* ============================================================ Retur ====== */

var RETUR = { tab: 'jual', jual: { items: [], notaAsal: null }, beli: { items: [], fakturAsal: null, searchTimer: null, searchRequest: 0 } };
var RETUR_JUAL_SEARCH = { timer: null, request: 0 };

VIEWS.retur = {
  title: 'Retur',
  render: function (el) {
    var role = SESSION.user.role;
    var tabsAktif = role === 'Owner'
      ? '<button class="tab-btn is-active" data-rtab="jual">Retur Jual</button>' +
        '<button class="tab-btn" data-rtab="beli">Retur Beli</button>'
      : '<button class="tab-btn is-active" data-rtab="jual">Retur Jual</button>';
    el.innerHTML =
      '<div class="tabbar-inner">' + tabsAktif + '</div>' +
      '<div id="returJual"></div><div id="returBeli" hidden></div>';

    el.querySelectorAll('[data-rtab]').forEach(function (b) {
      b.onclick = function () {
        el.querySelectorAll('[data-rtab]').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        document.getElementById('returJual').hidden = b.dataset.rtab !== 'jual';
        document.getElementById('returBeli').hidden = b.dataset.rtab !== 'beli';
        RETUR.tab = b.dataset.rtab;
        if (RETUR.tab === 'jual') gambarReturJual();
        else gambarReturBeli();
      };
    });

    gambarReturJual();
    if (role === 'Owner') gambarReturBeli();
  }
};

/* ----------------------------------------------- Retur Jual (semua role) --- */

function gambarReturJual() {
  var el = document.getElementById('returJual');
  if (!el) return;
  el.innerHTML =
    '<div class="card"><div class="card-head"><h3>Pilih nota asal</h3></div>' +
      '<div class="grid g2">' +
        '<label class="field"><span>Cari nota (nomor/nama pelanggan/obat)</span>' +
          '<input id="rjCari" class="inp" placeholder="Nomor nota, nama pelanggan, atau obat"></label>' +
        '<label class="field"><span>Rentang hari terakhir</span>' +
          '<input id="rjBatas" class="inp" type="number" min="1" max="365" value="60"></label>' +
      '</div>' +
      '<button id="rjMuat" class="btn">Muat daftar nota</button></div>' +

    '<div class="card"><div class="card-head"><h3>Buat retur jual</h3></div>' +
      '<div id="rjForm">Pilih nota terlebih dahulu untuk mengisi item retur.</div>' +
    '</div>' +

    '<div class="card"><div class="card-head"><h3>Riwayat retur jual</h3></div>' +
      '<div class="table-wrap"><table><thead><tr><th>No. retur</th><th>No. nota asal</th>' +
        '<th>Tanggal</th><th>Pelanggan</th><th>Petugas</th><th class="r">Refund</th><th>Alasan</th>' +
      '</tr></thead><tbody id="rjRiwayat"></tbody></table></div></div>';

  document.getElementById('rjMuat').onclick = muatNotaUntukRetur;
  document.getElementById('rjCari').oninput = function () {
    clearTimeout(RETUR_JUAL_SEARCH.timer);
    RETUR_JUAL_SEARCH.timer = setTimeout(muatNotaUntukRetur, 300);
  };
  document.getElementById('rjCari').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { clearTimeout(RETUR_JUAL_SEARCH.timer); muatNotaUntukRetur(); }
  });
  muatRiwayatReturJual();
}

function muatNotaUntukRetur() {
  var container = document.getElementById('rjForm');
  var request = ++RETUR_JUAL_SEARCH.request;
  memuat(container);
  api('retur.jualList', {
    q: val('rjCari'), limit: numVal('rjBatas') || 60
  }).then(function (rows) {
    if (request !== RETUR_JUAL_SEARCH.request || !container.isConnected) return;
    if (!rows.length) {
      container.innerHTML = '<div class="empty">Tidak ada nota pada rentang ini.</div>';
      return;
    }
    container.innerHTML =
      '<label class="field"><span>Nota asal</span><select id="rjNota" class="inp"></select></label>' +
      '<div id="rjItemArea" class="empty">Pilih nota untuk memuat item.</div>';
    var sel = document.getElementById('rjNota');
    sel.innerHTML = rows.map(function (r) {
      return '<option value="' + esc(r.No_Nota) + '">' + esc(r.No_Nota) + ' · ' +
        esc(r.Tanggal) + ' · ' + esc(r.Nama_Pelanggan) +
        (r.sudah_retur > 0 ? ' (sudah diretur ' + rupiah(r.sudah_retur) + ')' : '') +
        '</option>';
    }).join('');
    RETUR.jual.notaAsal = rows[0];
    sel.onchange = function () {
      RETUR.jual.notaAsal = rows.filter(function (r) { return r.No_Nota === sel.value; })[0];
      gambarItemReturJual();
    };
    gambarItemReturJual();
  }).catch(function (e) {
    if (request !== RETUR_JUAL_SEARCH.request || !container.isConnected) return;
    container.innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
  });
}

function gambarItemReturJual() {
  var area = document.getElementById('rjItemArea');
  if (!area || !RETUR.jual.notaAsal) return;
  var nota = RETUR.jual.notaAsal;
  var ref = nota.sudah_retur || 0;
  var sudah = nota.sudah_retur || 0;
  var proporsi = nota.subtotal > 0 ? sudah / nota.subtotal : 0;
  // Refund mengikuti harga yang dibayar (diskon nota dibagi proporsional).
  var faktor = nota.subtotal > 0 ? Number(nota.harga_akhir || 0) / nota.subtotal : 1;
  area.innerHTML =
    '<div class="kpi-sub">Nota <strong>' + esc(nota.No_Nota) + '</strong> · ' +
      esc(nota.Tanggal) + ' ' + esc(nota.Jam) + ' · ' + esc(nota.Nama_Pelanggan) +
      ' · subtotal ' + rupiah(nota.subtotal) +
      (sudah > 0 ? ' · sudah diretur ' + rupiah(sudah) : '') +
    '</div>' +
    '<div class="table-wrap"><table><thead><tr>' +
      '<th>Kode obat</th><th>Nama</th><th>Batch</th><th class="c">Qty jual</th>' +
      '<th class="c">Sisa retur</th><th class="c">Qty retur</th><th>Harga</th>' +
      '<th class="r">Subtotal</th><th>Kondisi</th>' +
    '</tr></thead><tbody id="rjBody"></tbody></table></div>' +
    '<label class="field" style="margin-top:10px"><span>Alasan retur</span>' +
      '<textarea id="rjAlasan" class="inp" rows="2" placeholder="Obat rusak, salah input, efek samping, dll."></textarea></label>' +
    '<div class="pay-row total"><span id="rjTotalItem">0 item diretur</span>' +
      '<span id="rjTotalRefund" class="money">Rp0</span></div>' +
    '<button id="rjSimpan" class="btn btn-primary btn-block">Simpan retur</button>';

  document.getElementById('rjBody').innerHTML = nota.items.map(function (it, i) {
    var sisa = (it.Sudah_Retur_Qty !== undefined)
      ? Math.max(0, it.Qty - it.Sudah_Retur_Qty)
      : Math.round(it.Qty * (1 - proporsi));
    return '<tr>' +
      '<td>' + esc(it.Kode_Obat) + '</td>' +
      '<td>' + esc(it.Nama_Obat) + '</td>' +
      '<td>' + esc(it.Kode_Batch) + '</td>' +
      '<td class="c num">' + angka(it.Qty) + '</td>' +
      '<td class="c num">' + angka(sisa) + '</td>' +
      '<td><input class="inp num" type="number" min="0" max="' + sisa +
        '" data-i="' + i + '" data-f="Qty" value="0"></td>' +
      '<td class="num">' + rupiah(it.Harga_Satuan) + '</td>' +
      '<td class="r num" data-sub="' + i + '">Rp0</td>' +
      '<td><select class="inp" data-i="' + i + '" data-f="Kondisi">' +
        '<option>Baik</option><option>Rusak</option><option>Kedaluwarsa</option>' +
      '</select></td>' +
    '</tr>';
  }).join('');

  RETUR.jual.items = nota.items.map(function (it) {
    return { Kode_Obat: it.Kode_Obat, Kode_Batch: it.Kode_Batch, Qty: 0, Kondisi: 'Baik' };
  });

  var body = document.getElementById('rjBody');
  body.oninput = function (e) {
    var f = e.target.closest('[data-f]');
    if (!f) return;
    var it = RETUR.jual.items[Number(f.dataset.i)];
    it[f.dataset.f] = (f.type === 'number') ? Number(f.value) || 0 : f.value;
    ringkasReturJual();
    var row = f.closest('tr');
    var ref = nota.items[Number(f.dataset.i)];
    var sub = row.children[7];
    if (sub && f.dataset.f === 'Qty') {
      sub.textContent = rupiah(Math.round(ref.Harga_Satuan * faktor * (Number(f.value) || 0)));
    }
  };

  document.getElementById('rjSimpan').onclick = simpanReturJual;
  ringkasReturJual();
}

function ringkasReturJual() {
  var nota = RETUR.jual.notaAsal;
  if (!nota) return;
  var totalQty = 0, totalRefund = 0;
  RETUR.jual.items.forEach(function (it, i) {
    var ref = nota.items[i];
    var q = Number(it.Qty) || 0;
    totalQty += q;
    totalRefund += Math.round(ref.Harga_Satuan * (nota.subtotal > 0 ? Number(nota.harga_akhir || 0) / nota.subtotal : 1) * q);
  });
  document.getElementById('rjTotalItem').textContent = angka(totalQty) + ' item diretur';
  document.getElementById('rjTotalRefund').textContent = rupiah(totalRefund);
}

function simpanReturJual() {
  if (!RETUR.jual.notaAsal) { toast('Pilih nota terlebih dahulu.', true); return; }
  var alasan = val('rjAlasan');
  if (!alasan) { toast('Alasan retur wajib diisi.', true); return; }
  var isi = RETUR.jual.items.filter(function (it) { return Number(it.Qty) > 0; });
  if (!isi.length) { toast('Isi minimal satu item dengan qty retur.', true); return; }
  var btn = document.getElementById('rjSimpan');
  btn.disabled = true; btn.textContent = 'Menyimpan…';
  api('retur.jualSimpan', {
    No_Nota_Asal: RETUR.jual.notaAsal.No_Nota,
    Alasan: alasan, items: isi
  }).then(function (r) {
    toast('Retur ' + r.No_Retur + ' tersimpan, refund ' + rupiah(r.Total_Refund) + '.');
    RETUR.jual.notaAsal = null;
    RETUR.jual.items = [];
    gambarReturJual();
    muatRiwayatReturJual();
  }).catch(function (e) { toast(e.message, true); })
    .then(function () { btn.disabled = false; btn.textContent = 'Simpan retur'; });
}

function muatRiwayatReturJual() {
  var tb = document.getElementById('rjRiwayat');
  if (!tb) return;
  // Endpoint retur jual mengembalikan array ringkasan retur yang sudah
  // diproses ketika dipanggil dengan mode='riwayat'. `api()` otomatis
  // membungkus respons jadi {ok, data}, jadi di sini `rows` adalah array.
  api('retur.jualList', { mode: 'riwayat' }).then(function (rows) {
    tb.innerHTML = rows && rows.length ? rows.map(function (r) {
      return '<tr><td>' + esc(r.No_Retur) + '</td><td>' + esc(r.No_Nota_Asal) + '</td>' +
        '<td>' + tglIndo(r.Tanggal) + ' ' + esc(r.Jam) + '</td>' +
        '<td>' + esc(r.Nama_Pelanggan) + '</td><td>' + esc(r.Petugas) + '</td>' +
        '<td class="r num">' + rupiah(r.Total_Refund) + '</td>' +
        '<td>' + esc(r.Alasan) + '</td></tr>';
    }).join('') : tabelKosong('Belum ada retur jual.', 7);
  }).catch(function (e) {
    tb.innerHTML = '<tr><td colspan="7" class="empty">' + esc(e.message) + '</td></tr>';
  });
}

/* ----------------------------------------------- Retur Beli (Owner saja) -- */

function gambarReturBeli() {
  var el = document.getElementById('returBeli');
  if (!el) return;
  el.innerHTML =
    '<div class="card"><div class="card-head"><h3>Pengajuan retur beli</h3>' +
      '<span class="kpi-sub">Membuat retur langsung berstatus PENDING_APPROVAL. Stok belum berubah sampai Owner kedua menyetujui.</span></div>' +
      '<div class="grid g2">' +
        '<label class="field"><span>Cari faktur / nama obat</span><input id="rbCari" class="inp" placeholder="Nomor faktur atau nama obat"></label>' +
        '<label class="field"><span>Faktur asal</span><select id="rbFaktur" class="inp"></select></label>' +
        '<label class="field"><span>Filter riwayat</span><select id="rbFilter" class="inp">' +
          '<option value="">Semua status</option>' +
          '<option value="PENDING_APPROVAL">Menunggu approval</option>' +
          '<option value="APPROVED">Disetujui</option>' +
          '<option value="REJECTED">Ditolak</option>' +
        '</select></label>' +
      '</div>' +
      '<div id="rbForm" class="empty">Pilih faktur untuk memuat item.</div>' +
    '</div>' +

    '<div class="card"><div class="card-head"><h3>Riwayat retur beli</h3></div>' +
      '<div class="table-wrap"><table><thead><tr><th>No. retur</th><th>Faktur</th>' +
        '<th>Supplier</th><th>Tanggal</th><th>Status</th><th>Diajukan oleh</th>' +
        '<th>Disetujui oleh</th><th class="r">Refund</th><th></th>' +
      '</tr></thead><tbody id="rbRiwayat"></tbody></table></div></div>';

  muatFakturUntukRetur();
  muatRiwayatReturBeli();
  document.getElementById('rbFilter').onchange = muatRiwayatReturBeli;
  document.getElementById('rbCari').oninput = function () {
    clearTimeout(RETUR.beli.searchTimer);
    RETUR.beli.searchTimer = setTimeout(muatFakturUntukRetur, 250);
  };
}

function gambarPilihanFakturReturBeli() {
  var sel = document.getElementById('rbFaktur');
  if (!sel || !RETUR.beli.daftarFaktur) return;
  var q = (val('rbCari') || '').trim().toLocaleLowerCase();
  var rows = RETUR.beli.daftarFaktur.filter(function (f) {
    var fields = [f.No_Faktur, f.No_Faktur_Supplier, f.Supplier];
    (f.items || []).forEach(function (i) { fields.push(i.Nama_Obat, i.Kode_Obat); });
    return !q || fields.some(function (v) { return String(v || '').toLocaleLowerCase().indexOf(q) >= 0; });
  });
  sel.innerHTML = rows.length ? rows.map(function (f) {
    return '<option value="' + esc(f.No_Faktur) + '">' + esc(f.No_Faktur) + ' · ' +
      (f.No_Faktur_Supplier ? esc(f.No_Faktur_Supplier) + ' · ' : '') + esc(f.Supplier) + ' · ' + esc(f.Tanggal_Faktur) +
      (f.sudah_retur > 0 ? ' (sudah diretur ' + rupiah(f.sudah_retur) + ')' : '') + '</option>';
  }).join('') : '<option value="">Tidak ada faktur yang cocok</option>';
  RETUR.beli.fakturAsal = rows[0] || null;
  if (rows.length) muatItemFakturRetur();
  else document.getElementById('rbForm').innerHTML = '<div class="empty">Tidak ada faktur yang cocok.</div>';
}

function muatFakturUntukRetur() {
  var request = ++RETUR.beli.searchRequest;
  var q = val('rbCari') || '';
  api('retur.beliList', { q: q, faktur_only: true }).then(function (d) {
    if (request !== RETUR.beli.searchRequest || !document.getElementById('rbFaktur')) return;
    var sel = document.getElementById('rbFaktur');
    if (!d.faktur.length) {
      RETUR.beli.daftarFaktur = [];
      sel.innerHTML = '<option>Belum ada faktur pembelian</option>';
      document.getElementById('rbForm').innerHTML = '<div class="empty">' + (q ? 'Tidak ada faktur yang cocok.' : 'Belum ada faktur pembelian.') + '</div>';
      return;
    }
    RETUR.beli.daftarFaktur = d.faktur;
    gambarPilihanFakturReturBeli();
    document.getElementById('rbFaktur').onchange = function () {
      RETUR.beli.fakturAsal = RETUR.beli.daftarFaktur.filter(function (x) { return x.No_Faktur === sel.value; })[0];
      muatItemFakturRetur();
    };
    muatItemFakturRetur();
  }).catch(function (e) { toast(e.message, true); });
}

function muatItemFakturRetur() {
  var f = RETUR.beli.fakturAsal;
  var area = document.getElementById('rbForm');
  if (!f) return;
  area.classList.remove('empty');
  if (!f.items || !f.items.length) {
    area.innerHTML = '<div class="empty">Faktur ini belum memiliki detail item.</div>';
    return;
  }
  var sudah = f.sudah_retur || 0;
  area.innerHTML =
    '<div class="kpi-sub">Faktur <strong>' + esc(f.No_Faktur) + '</strong>' +
      (f.No_Faktur_Supplier ? ' · PBF: ' + esc(f.No_Faktur_Supplier) : '') + ' · ' +
      esc(f.Supplier) + ' · tagihan ' + rupiah(f.Total_Tagihan) +
      (sudah > 0 ? ' · sudah diretur ' + rupiah(sudah) : '') +
    '</div>' +
    '<div class="table-wrap"><table><thead><tr>' +
      '<th>Kode obat</th><th>Nama</th><th>Batch</th><th class="c">Qty beli</th>' +
      '<th class="c">Sisa retur</th><th class="c">Qty retur</th><th>Netto</th><th class="r">Subtotal</th>' +
      '<th>Kondisi</th>' +
    '</tr></thead><tbody id="rbBody"></tbody></table></div>' +
    '<label class="field" style="margin-top:10px"><span>Alasan retur</span>' +
      '<textarea id="rbAlasan" class="inp" rows="2" placeholder="Barang rusak, kedaluwarsa, salah kirim, dll."></textarea></label>' +
    '<div class="pay-row total"><span id="rbTotalItem">0 item diretur</span>' +
      '<span id="rbTotalRefund" class="money">Rp0</span></div>' +
    '<button id="rbSimpan" class="btn btn-primary btn-block">Simpan pengajuan retur</button>';

  document.getElementById('rbBody').innerHTML = f.items.map(function (it, i) {
    var sisa = Math.max(0, Number(it.Qty || 0) - Number(it.Sudah_Retur_Qty || 0));
    return '<tr>' +
      '<td>' + esc(it.Kode_Obat) + '</td>' +
      '<td>' + esc(it.Nama_Obat) + '</td>' +
      '<td>' + esc(it.Kode_Batch) + '</td>' +
      '<td class="c num">' + angka(it.Qty) + '</td>' +
      '<td class="c num">' + angka(sisa) + '</td>' +
      '<td><input class="inp num" type="number" min="0" max="' + sisa +
        '" data-i="' + i + '" data-f="Qty" value="0"></td>' +
      '<td class="num">' + rupiah(it.Harga_Netto) + '</td>' +
      '<td class="r num" data-sub="' + i + '">Rp0</td>' +
      '<td><select class="inp" data-i="' + i + '" data-f="Kondisi">' +
        '<option>Baik</option><option>Rusak</option><option>Kedaluwarsa</option>' +
      '</select></td>' +
    '</tr>';
  }).join('');

  RETUR.beli.items = f.items.map(function (it) {
    return { Kode_Obat: it.Kode_Obat, Kode_Batch: it.Kode_Batch, Qty: 0, Kondisi: 'Baik' };
  });

  var body = document.getElementById('rbBody');
  body.oninput = function (e) {
    var inp = e.target.closest('[data-f]');
    if (!inp) return;
    var it = RETUR.beli.items[Number(inp.dataset.i)];
    it[inp.dataset.f] = (inp.type === 'number') ? Number(inp.value) || 0 : inp.value;
    ringkasReturBeli();
    var row = inp.closest('tr');
    var ref = f.items[Number(inp.dataset.i)];
    var sub = row.children[7];
    if (sub && inp.dataset.f === 'Qty') {
      sub.textContent = rupiah(ref.Harga_Netto * (Number(inp.value) || 0));
    }
  };

  document.getElementById('rbSimpan').onclick = simpanReturBeli;
  ringkasReturBeli();
}

function ringkasReturBeli() {
  var f = RETUR.beli.fakturAsal;
  if (!f || !f.items) return;
  var totalQty = 0, totalRefund = 0;
  RETUR.beli.items.forEach(function (it, i) {
    var ref = f.items[i];
    var q = Number(it.Qty) || 0;
    totalQty += q;
    totalRefund += ref.Harga_Netto * q;
  });
  document.getElementById('rbTotalItem').textContent = angka(totalQty) + ' item diretur';
  document.getElementById('rbTotalRefund').textContent = rupiah(totalRefund);
}

function simpanReturBeli() {
  if (!RETUR.beli.fakturAsal) { toast('Pilih faktur terlebih dahulu.', true); return; }
  var alasan = val('rbAlasan');
  if (!alasan) { toast('Alasan retur wajib diisi.', true); return; }
  var isi = RETUR.beli.items.filter(function (it) { return Number(it.Qty) > 0; });
  if (!isi.length) { toast('Isi minimal satu item dengan qty retur.', true); return; }
  var btn = document.getElementById('rbSimpan');
  btn.disabled = true; btn.textContent = 'Mengajukan…';
  api('retur.beliSimpan', {
    No_Faktur_Asal: RETUR.beli.fakturAsal.No_Faktur,
    Alasan: alasan, items: isi
  }).then(function (r) {
    toast('Pengajuan ' + r.No_Retur + ' tersimpan (' + r.Status + '). Menunggu approval Owner lain.');
    RETUR.beli.fakturAsal = null;
    RETUR.beli.items = [];
    gambarReturBeli();
  }).catch(function (e) { toast(e.message, true); })
    .then(function () { btn.disabled = false; btn.textContent = 'Simpan pengajuan retur'; });
}

function muatRiwayatReturBeli() {
  var tb = document.getElementById('rbRiwayat');
  if (!tb) return;
  var status = val('rbFilter');
  api('retur.beliList', { status: status, history_only: true }).then(function (d) {
    tb.innerHTML = d.retur.length ? d.retur.map(function (r) {
      var statusChip = '<span class="chip ' +
        (r.Status === 'APPROVED' ? 'chip-ok' :
         r.Status === 'REJECTED' ? 'chip-bad' : 'chip-warn') +
        '">' + esc(r.Status.replace('_', ' ')) + '</span>';
      var aksi = '';
      if (r.Status === 'PENDING_APPROVAL' && r.Created_By !== SESSION.user.username) {
        aksi = '<button class="btn btn-sm" data-acc="' + esc(r.No_Retur) + '">Setujui</button> ' +
               '<button class="btn btn-sm" data-rej="' + esc(r.No_Retur) + '">Tolak</button>';
      } else if (r.Status === 'PENDING_APPROVAL') {
        aksi = '<span class="kpi-sub">Menunggu Owner lain</span>';
      }
      return '<tr><td>' + esc(r.No_Retur) + '</td><td>' + esc(r.No_Faktur_Asal) + '</td>' +
        '<td>' + esc(r.Supplier) + '</td><td>' + tglIndo(r.Tanggal) + '</td>' +
        '<td>' + statusChip + '</td>' +
        '<td>' + esc(r.Created_By) + '</td>' +
        '<td>' + (r.Approved_By ? esc(r.Approved_By) + ' (' + tglIndo(r.Tanggal_Approval) + ')' : '—') + '</td>' +
        '<td class="r num">' + rupiah(r.Total_Refund) + '</td>' +
        '<td class="c">' + aksi + '</td></tr>';
    }).join('') : tabelKosong('Belum ada retur beli pada filter ini.', 9);

    tb.onclick = function (e) {
      var acc = e.target.closest('[data-acc]');
      var rej = e.target.closest('[data-rej]');
      if (!acc && !rej) return;
      var noRetur = (acc || rej).dataset.acc || rej.dataset.rej;
      var keputusan = acc ? 'SETUJU' : 'TOLAK';
      var label = acc ? 'menyetujui' : 'menolak';
      modalBuka('Konfirmasi approval',
        '<p>Anda akan ' + label + ' retur <strong>' + esc(noRetur) + '</strong>.</p>' +
        '<p class="kpi-sub">Pemisahan pembuat dan penyetuju: Owner yang mengajukan tidak ' +
          'dapat menyetujui retur yang sama.</p>',
        [
          { label: 'Batal', aksi: modalTutup },
          { label: 'Yakin ' + label, kelas: 'btn-primary', aksi: function () {
              modalTutup();
              api('retur.beliApprove', { No_Retur: noRetur, keputusan: keputusan })
                .then(function (r) { toast('Retur ' + r.No_Retur + ' → ' + r.Status + '.'); muatRiwayatReturBeli(); })
                .catch(function (er) { toast(er.message, true); });
            } }
        ]);
    };
  }).catch(function (e) {
    tb.innerHTML = '<tr><td colspan="9" class="empty">' + esc(e.message) + '</td></tr>';
  });
}

/* -------------------------------------------------- Laporan laba-rugi --- */

VIEWS.laporan = {
  title: 'Laporan Laba-Rugi',
  render: function (el) {
    el.innerHTML = filterBarHtml('lp') + '<div id="lpIsi"></div>';
    pasangFilter('lp', muatLaporan, 'bulanan');
    muatLaporan();
  }
};

function muatLaporan() {
  var isi = document.getElementById('lpIsi');
  memuat(isi);
  api('laporan.labaRugi', { filter: bacaFilter('lp') }).then(function (d) {
    isi.innerHTML =
      '<div class="grid g4" style="margin-bottom:14px">' +
        kpi('Omzet kotor', rupiah(d.omzet_kotor), angka(d.jumlah_nota) + ' nota · ' + d.rentang.label) +
        kpi('Laba kotor', rupiah(d.laba_kotor), 'Margin ' + d.margin.toFixed(1) + '%') +
        kpi('Biaya operasional', rupiah(d.total_biaya), 'Pengurang laba kotor') +
        kpi('Laba bersih', rupiah(d.laba_bersih),
            'Rata-rata nota ' + rupiah(d.rata_nota), d.laba_bersih < 0 ? 'is-bad' : '') +
      '</div>' +

      '<div class="card"><div class="card-head"><h3>Ringkasan finansial</h3>' +
        '<button id="lpCetak" class="btn btn-sm">Cetak</button></div>' +
        '<div class="table-wrap"><table>' +
          barisLap('Omzet kotor (gross sales)', d.omzet_kotor) +
          barisLap('Total diskon diberikan', -d.total_diskon) +
          barisLap('Retur penjualan (' + angka(d.jumlah_retur || 0) + ' retur)', -(d.total_retur || 0)) +
          barisLap('Total HPP batch efektif terjual (bersih retur)', -d.total_hpp) +
          barisLap('<strong>Laba kotor</strong>', d.laba_kotor) +
          barisLap('Total biaya operasional', -d.total_biaya) +
          barisLap('<strong>Laba bersih</strong>', d.laba_bersih) +
        '</table></div></div>' +

      '<div class="grid g2" style="margin-top:14px">' +
        '<div class="card"><div class="card-head"><h3>Kontribusi per tipe customer</h3></div>' +
          '<div class="table-wrap"><table><thead><tr><th>Tipe</th><th class="c">Nota</th>' +
            '<th class="r">Omzet</th><th class="r">Laba</th></tr></thead><tbody>' +
            (d.per_tipe.length ? d.per_tipe.map(function (t) {
              return '<tr><td>' + esc(t.tipe) + '</td><td class="c num">' + angka(t.nota) + '</td>' +
                '<td class="r num">' + rupiah(t.omzet) + '</td>' +
                '<td class="r num">' + rupiah(t.laba) + '</td></tr>';
            }).join('') : tabelKosong('Belum ada penjualan.', 4)) +
          '</tbody></table></div></div>' +
        '<div class="card"><div class="card-head"><h3>Rincian biaya</h3></div>' +
          '<div class="table-wrap"><table><thead><tr><th>Keterangan</th>' +
            '<th class="r">Nominal</th></tr></thead><tbody>' +
            (d.rincian_biaya.length ? d.rincian_biaya.map(function (b) {
              return '<tr><td>' + esc(b.keterangan) + '</td>' +
                '<td class="r num">' + rupiah(b.nominal) + '</td></tr>';
            }).join('') : tabelKosong('Belum ada biaya tercatat.', 2)) +
          '</tbody></table></div></div>' +
      '</div>';

    var cetak = document.getElementById('lpCetak');
    if (cetak) cetak.onclick = function () { cetakLaporan(d); };
  }).catch(function (e) {
    isi.innerHTML = '<div class="card"><p>' + esc(e.message) + '</p></div>';
  });
}

/** Satu kartu ringkas angka kunci untuk Laporan Laba-Rugi.
 *  kelas 'is-bad' mewarnai nilainya merah (dipakai untuk laba bersih minus). */
function kpi(label, nilai, sub, kelas) {
  return '<div class="card">' +
    '<div class="sat-label">' + esc(label) + '</div>' +
    '<div class="sat-nilai' + (kelas === 'is-bad' ? ' minus' : '') +
      '" style="font-size:20px; margin-top:3px">' + esc(nilai) + '</div>' +
    (sub ? '<div class="sub" style="margin-top:5px">' + esc(sub) + '</div>' : '') +
  '</div>';
}

function barisLap(label, nilai) {
  return '<tr><td>' + label + '</td><td class="r num">' + rupiah(nilai) + '</td></tr>';
}

/** Susun versi cetak laporan pada area khusus, lalu buka dialog cetak. */
function cetakLaporan(d) {
  var el = document.getElementById('struk');
  el.className = 'struk lebar';
  el.innerHTML =
    '<h2>Laporan Laba-Rugi</h2>' +
    '<div>' + esc(document.getElementById('sbApotek').textContent) + ' — ' + esc(d.rentang.label) +
      ' · shift ' + esc(d.shift_filter) + '</div>' +
    '<div>Dicetak ' + new Date().toLocaleString('id-ID') + ' oleh ' +
      esc(SESSION.user.nama) + '</div>' +
    '<table style="width:100%; margin-top:12px">' +
      barisLap('Omzet kotor', d.omzet_kotor) +
      barisLap('Total diskon diberikan', -d.total_diskon) +
      barisLap('Retur penjualan', -(d.total_retur || 0)) +
      barisLap('Total HPP batch efektif terjual (bersih retur)', -d.total_hpp) +
      barisLap('<strong>Laba kotor</strong>', d.laba_kotor) +
      barisLap('Total biaya operasional', -d.total_biaya) +
      barisLap('<strong>Laba bersih</strong>', d.laba_bersih) +
    '</table>' +
    '<p>Jumlah nota ' + angka(d.jumlah_nota) + ' · rata-rata ' + rupiah(d.rata_nota) +
      ' · margin ' + d.margin.toFixed(1) + '%</p>' +
    (d.rincian_biaya.length ?
      '<h2 style="margin-top:14px">Rincian biaya</h2><table style="width:100%">' +
      d.rincian_biaya.map(function (b) {
        return '<tr><td>' + esc(b.keterangan) + '</td><td class="r">' + rupiah(b.nominal) + '</td></tr>';
      }).join('') + '</table>' : '');
  setTimeout(function () { window.print(); }, 120);
}


/* ------------------------------------------- Riwayat Nota (read-only) --- */
var RIWAYAT_NOTA_UI = { jenis: 'penjualan', rows: [], offset: 0, hasMore: false, request: 0, busy: false, error: '' };
var RIWAYAT_NOTA_LABEL_UI = {
  penjualan: 'Penjualan', pembelian: 'Pembelian', retur_jual: 'Retur Penjualan', retur_beli: 'Retur Pembelian'
};
var RIWAYAT_NOTA_OPTIONS_UI = {
  Owner: ['penjualan', 'pembelian', 'retur_jual', 'retur_beli'],
  Apoteker: ['penjualan', 'pembelian', 'retur_jual'],
  Kasir: ['penjualan', 'retur_jual']
};
var RIWAYAT_NOTA_SHIFT_TYPES_UI = { penjualan: true, retur_jual: true };

function aturFilterShiftRiwayat() {
  var jenis = val('rnJenis') || RIWAYAT_NOTA_UI.jenis;
  var field = document.getElementById('rnShiftWrap');
  var select = document.getElementById('rnShift');
  if (!field || !select) return;
  var aktif = !!RIWAYAT_NOTA_SHIFT_TYPES_UI[jenis];
  field.hidden = !aktif;
  if (!aktif) select.value = '';
}

VIEWS.riwayat = {
  title: 'Riwayat Nota',
  render: function (el) {
    var role = SESSION && SESSION.user ? SESSION.user.role : '';
    var jenis = RIWAYAT_NOTA_OPTIONS_UI[role] || [];
    RIWAYAT_NOTA_UI = { jenis: jenis[0] || 'penjualan', rows: [], offset: 0, hasMore: false, request: 0, busy: false, error: '' };
    el.innerHTML =
      '<div class="card"><div class="card-head"><div><h3>Riwayat Nota</h3>' +
        '<p class="kpi-sub">Cari nota penjualan, faktur pembelian, atau retur. Detail hanya-baca dan mengikuti cabang akun Anda.</p></div>' +
        '<span class="chip">Cabang ' + esc(SESSION.user.cabang_id || '—') + '</span></div>' +
        '<div class="grid g4">' +
          '<label class="field"><span>Jenis dokumen</span><select id="rnJenis" class="inp">' +
            jenis.map(function (x) { return '<option value="' + esc(x) + '">' + esc(RIWAYAT_NOTA_LABEL_UI[x]) + '</option>'; }).join('') +
          '</select></label>' +
          '<label class="field"><span>Nomor dokumen / nama obat</span><input id="rnCari" class="inp" placeholder="Ketik nomor atau nama obat"></label>' +
          '<label class="field"><span>Dari tanggal</span><input id="rnDari" class="inp" type="date"></label>' +
          '<label class="field"><span>Sampai tanggal</span><input id="rnSampai" class="inp" type="date"></label>' +
          '<label class="field" id="rnShiftWrap"><span>Shift</span><select id="rnShift" class="inp">' +
            '<option value="">Semua shift</option><option value="Pagi">Pagi</option><option value="Sore">Sore</option>' +
            '<option value="Luar Jam">Luar Jam</option></select></label>' +
        '</div>' +
        '<button id="rnFilter" class="btn btn-primary">Cari riwayat</button>' +
      '</div>' +
      '<div class="card"><div class="card-head"><h3 id="rnJudul">Daftar nota</h3><span id="rnJumlah" class="kpi-sub"></span></div>' +
        '<div class="table-wrap"><table><thead><tr><th>Nomor dokumen</th><th>Tanggal</th><th>Referensi asal</th>' +
          '<th>Pelanggan / supplier</th><th>Petugas</th><th>Shift</th><th class="r">Total</th><th>Status / kategori</th><th>Aksi</th>' +
        '</tr></thead><tbody id="rnBody"></tbody></table></div>' +
        '<div class="c" style="padding-top:12px"><button id="rnMore" class="btn" hidden>Muat lebih banyak</button></div>' +
      '</div>';

    var sel = document.getElementById('rnJenis');
    sel.onchange = function () { aturFilterShiftRiwayat(); muatRiwayatNota(true); };
    document.getElementById('rnShift').onchange = function () { muatRiwayatNota(true); };
    aturFilterShiftRiwayat();
    document.getElementById('rnFilter').onclick = function () { muatRiwayatNota(true); };
    document.getElementById('rnCari').oninput = function () {
      clearTimeout(RIWAYAT_NOTA_UI.searchTimer);
      RIWAYAT_NOTA_UI.searchTimer = setTimeout(function () { muatRiwayatNota(true); }, 300);
    };
    document.getElementById('rnCari').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { clearTimeout(RIWAYAT_NOTA_UI.searchTimer); muatRiwayatNota(true); }
    });
    document.getElementById('rnMore').onclick = function () { muatRiwayatNota(false); };
    document.getElementById('rnBody').onclick = function (e) {
      var b = e.target.closest('[data-rn-detail]');
      if (!b) return;
      var r = RIWAYAT_NOTA_UI.rows[Number(b.dataset.rnDetail)];
      if (r) bukaDetailRiwayatNota(r);
    };
    muatRiwayatNota(true);
  }
};

function muatRiwayatNota(reset) {
  var jenis = val('rnJenis') || RIWAYAT_NOTA_UI.jenis;
  if (reset) {
    RIWAYAT_NOTA_UI.jenis = jenis;
    RIWAYAT_NOTA_UI.rows = [];
    RIWAYAT_NOTA_UI.offset = 0;
    RIWAYAT_NOTA_UI.error = '';
  }
  var request = ++RIWAYAT_NOTA_UI.request;
  RIWAYAT_NOTA_UI.busy = true;
  var tb = document.getElementById('rnBody');
  if (tb && reset) tb.innerHTML = tabelKosong('Memuat riwayat nota…', 9);
  var more = document.getElementById('rnMore');
  if (more) { more.disabled = true; more.hidden = true; }
  var limit = 50;
  api('riwayat.notaList', {
    jenis: jenis, q: val('rnCari'), dari: val('rnDari'), sampai: val('rnSampai'),
    shift: RIWAYAT_NOTA_SHIFT_TYPES_UI[jenis] ? val('rnShift') : '',
    limit: limit, offset: reset ? 0 : RIWAYAT_NOTA_UI.offset
  }).then(function (result) {
    if (request !== RIWAYAT_NOTA_UI.request) return;
    RIWAYAT_NOTA_UI.jenis = jenis;
    RIWAYAT_NOTA_UI.rows = (reset ? [] : RIWAYAT_NOTA_UI.rows).concat(result.rows || []);
    RIWAYAT_NOTA_UI.offset = Number(result.next_offset || 0);
    RIWAYAT_NOTA_UI.hasMore = !!result.has_more;
    RIWAYAT_NOTA_UI.error = '';
  }).catch(function (e) {
    if (request !== RIWAYAT_NOTA_UI.request) return;
    RIWAYAT_NOTA_UI.error = e.message || 'Riwayat nota gagal dimuat.';
    if (reset) RIWAYAT_NOTA_UI.rows = [];
  }).then(function () {
    if (request !== RIWAYAT_NOTA_UI.request) return;
    RIWAYAT_NOTA_UI.busy = false;
    gambarRiwayatNota();
  });
}

function gambarRiwayatNota() {
  var tb = document.getElementById('rnBody');
  if (!tb) return;
  var rows = RIWAYAT_NOTA_UI.rows;
  if (RIWAYAT_NOTA_UI.error) tb.innerHTML = tabelKosong(RIWAYAT_NOTA_UI.error, 9);
  else if (!rows.length) tb.innerHTML = tabelKosong('Tidak ada nota yang cocok.', 9);
  else tb.innerHTML = rows.map(function (r, i) {
    var referensi = r.No_Asal ? esc(r.No_Asal) : '—';
    var tanggal = tglIndo(r.Tanggal) + (r.Jam ? ' ' + esc(r.Jam) : '');
    return '<tr>' +
      '<td><strong>' + esc(r.No_Dokumen) + '</strong></td>' +
      '<td>' + tanggal + '</td><td>' + referensi + '</td>' +
      '<td>' + esc(r.Pihak || '—') + '</td><td>' + esc(r.Petugas || '—') + '</td><td>' + esc(r.Shift || '—') + '</td>' +
      '<td class="r num">' + rupiah(r.Total) + '</td><td>' + esc(r.Status || '—') + '</td>' +
      '<td><button type="button" class="btn btn-sm btn-primary" data-rn-detail="' + i + '" aria-label="Lihat detail ' + esc(r.No_Dokumen) + '">Detail</button></td>' +
    '</tr>';
  }).join('');
  var title = document.getElementById('rnJudul');
  if (title) title.textContent = 'Riwayat ' + (RIWAYAT_NOTA_LABEL_UI[RIWAYAT_NOTA_UI.jenis] || 'Nota');
  var count = document.getElementById('rnJumlah');
  if (count) count.textContent = rows.length ? angka(rows.length) + ' nota dimuat' : '';
  var more = document.getElementById('rnMore');
  if (more) {
    more.hidden = !RIWAYAT_NOTA_UI.hasMore;
    more.disabled = RIWAYAT_NOTA_UI.busy;
    more.textContent = RIWAYAT_NOTA_UI.busy ? 'Memuat…' : 'Muat lebih banyak';
  }
}

function bukaDetailRiwayatNota(row) {
  var jenis = RIWAYAT_NOTA_UI.jenis;
  var judul = 'Detail ' + (RIWAYAT_NOTA_LABEL_UI[jenis] || 'Nota') + ' · ' + row.No_Dokumen;
  modalBuka(judul, '<div class="empty">Memuat rincian nota…</div>', [{ label: 'Tutup', aksi: modalTutup }]);
  api('riwayat.notaDetail', { jenis: jenis, no: row.No_Dokumen }).then(function (nota) {
    if (document.getElementById('modal').hidden) return;
    document.getElementById('modalBody').innerHTML = htmlDetailRiwayatNota(nota);
  }).catch(function (e) {
    if (document.getElementById('modal').hidden) return;
    document.getElementById('modalBody').innerHTML = '<div class="empty">' + esc(e.message || 'Detail nota gagal dimuat.') + '</div>';
  });
}

function htmlDetailRiwayatNota(nota) {
  var h = nota.header || {}, meta = [];
  function tambah(label, value, formatted) {
    if (value === null || value === undefined || String(value) === '') return;
    meta.push('<div class="rn-meta-item"><span>' + esc(label) + '</span><strong>' + esc(formatted === undefined ? value : formatted) + '</strong></div>');
  }
  tambah('Nomor dokumen', h.No_Dokumen);
  if (nota.jenis === 'retur_jual' || nota.jenis === 'retur_beli') tambah('Nota / faktur asal', h.No_Asal);
  tambah('Tanggal', tglIndo(h.Tanggal) + (h.Jam ? ' ' + h.Jam : ''));
  tambah(nota.jenis === 'pembelian' || nota.jenis === 'retur_beli' ? 'Supplier' : 'Pelanggan', h.Pihak);
  tambah('Petugas', h.Petugas);
  tambah('Shift', h.Shift);
  tambah('Kategori', h.Kategori);
  tambah('No. faktur PBF', nota.jenis === 'pembelian' ? h.No_Asal : '');
  tambah('Jatuh tempo', h.Jatuh_Tempo ? tglIndo(h.Jatuh_Tempo) : '');
  tambah('Jumlah item', h.Jumlah_Item, h.Jumlah_Item === undefined ? undefined : angka(h.Jumlah_Item));
  tambah('Status', h.Status);
  tambah('Disetujui oleh', h.Disetujui_Oleh);
  tambah('Tanggal persetujuan', h.Tanggal_Approval ? tglIndo(h.Tanggal_Approval) : '');
  tambah('Alasan', h.Alasan);
  if (h.Subtotal !== undefined) tambah('Subtotal', h.Subtotal, rupiah(h.Subtotal));
  if (h.Diskon !== undefined) tambah('Diskon', h.Diskon, rupiah(h.Diskon));
  if (h.Total !== undefined) tambah(nota.jenis.indexOf('retur_') === 0 ? 'Total refund' : 'Total', h.Total, rupiah(h.Total));
  var items = (nota.items || []).map(function (it) {
    var harga = it.Harga_Satuan === null || it.Harga_Satuan === undefined ? '—' : rupiah(it.Harga_Satuan);
    var subtotal = it.Subtotal === null || it.Subtotal === undefined ? '—' : rupiah(it.Subtotal);
    return '<tr><td>' + esc(it.Kode_Obat || '—') + '</td><td>' + esc(it.Nama_Obat || '—') + '</td>' +
      '<td>' + esc(it.Kode_Batch || '—') + '</td><td class="c num">' + esc(angka(it.Qty)) + '</td>' +
      '<td class="r num">' + esc(harga) + '</td><td class="r num">' + esc(subtotal) + '</td>' +
      '<td>' + esc(it.Kondisi || '—') + '</td></tr>';
  }).join('');
  return '<div class="riwayat-nota-detail"><div class="rn-meta">' + meta.join('') + '</div>' +
    '<h4>Rincian barang (' + angka((nota.items || []).length) + ' baris)</h4>' +
    '<div class="table-wrap"><table><thead><tr><th>Kode</th><th>Nama barang</th><th>Batch</th><th class="c">Qty</th>' +
      '<th class="r">Harga / unit</th><th class="r">Subtotal</th><th>Kondisi</th></tr></thead><tbody>' +
      (items || tabelKosong('Tidak ada rincian barang pada nota ini.', 7)) + '</tbody></table></div></div>';
}
