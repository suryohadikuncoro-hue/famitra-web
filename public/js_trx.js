/* ================== Pembelian (Bab 5), Biaya (8.1), Laporan (Bab 7) ====== */

var BELI = { items: [] };
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
    TERLAMBAT: ['Terlambat', 'chip-bad']
  };
  var x = map[status] || [status || '—', ''];
  return '<span class="chip ' + x[1] + '">' + x[0] + '</span>';
}
function labelJatuhTempoHutang(r) {
  if (r.Status_Pembayaran === 'LUNAS') return '';
  if (r.jatuh_tempo_hari === null || r.jatuh_tempo_hari === undefined) return '';
  if (r.jatuh_tempo_hari < 0) return '<span class="kpi-sub">terlambat ' + Math.abs(r.jatuh_tempo_hari) + ' hari</span>';
  if (r.jatuh_tempo_hari === 0) return '<span class="kpi-sub">jatuh tempo hari ini</span>';
  return '<span class="kpi-sub">' + r.jatuh_tempo_hari + ' hari lagi</span>';
}


VIEWS.beli = {
  title: 'Pembelian',
  render: function (el) {
    el.innerHTML =
      '<div class="card"><div class="card-head"><h3>Faktur masuk dari PBF</h3>' +
        '<button id="blSupplierBaru" class="btn btn-sm">Tambah supplier</button></div>' +
        '<div class="grid g4">' +
          '<label class="field"><span>Nomor faktur PBF</span><input id="blFaktur" class="inp" placeholder="FK-2026-0012"></label>' +
          '<label class="field"><span>Supplier</span><select id="blSupplier" class="inp"></select></label>' +
          '<label class="field"><span>Kategori pembelian</span><select id="blKategori" class="inp">' +
            '<option>Berpajak</option><option>Tidak Berpajak</option><option>Konsinyasi</option>' +
          '</select></label>' +
          '<label class="field"><span>Tanggal faktur</span><input id="blTanggal" class="inp" type="date"></label>' +
          '<label class="field"><span>Jatuh tempo</span><input id="blTempo" class="inp" type="date"></label>' +
        '</div>' +
      '</div>' +

      '<div class="card"><div class="card-head"><h3>Rincian item</h3>' +
        '<button id="blTambahItem" class="btn btn-primary">Tambah baris</button></div>' +
        '<div class="table-wrap"><table><thead><tr>' +
          '<th>Kode obat</th><th>Kode batch</th><th>Kedaluwarsa</th><th class="c">Qty</th>' +
          '<th class="r">Netto</th><th class="c">PPN %</th><th class="r">Diskon</th>' +
          '<th class="r">Jual umum baru</th><th class="r">Subtotal</th><th></th>' +
        '</tr></thead><tbody id="blBody"></tbody></table></div>' +
        '<div id="beliSuggest" class="suggest beli-suggest" hidden></div>' +
        '<div class="pay-row total"><span id="blTotalItem">0 item</span>' +
          '<span id="blTotalTagihan" class="money">Rp0</span></div>' +
        '<button id="blSimpan" class="btn btn-primary btn-block">Simpan pembelian</button>' +
        '<p class="kpi-sub">Menyimpan faktur akan menambah stok per batch dan memperbarui harga modal ' +
          'serta harga jual umum. Harga khusus dan harga mutasi tidak ikut berubah.</p>' +
      '</div>' +

      '<div class="card"><div class="card-head"><h3>Riwayat faktur</h3></div>' +
        '<div class="table-wrap"><table><thead><tr><th>No. faktur</th><th>No. faktur PBF</th><th>Supplier</th>' +
          '<th>Kategori</th><th>Tanggal</th><th>Jatuh tempo</th><th class="c">Item</th>' +
          '<th class="r">Tagihan</th><th class="r">Dibayar</th><th class="r">Sisa hutang</th><th>Status</th><th>Aksi</th></tr></thead><tbody id="blRiwayat"></tbody></table></div></div>';

    document.getElementById('blTanggal').value = new Date().toISOString().substring(0, 10);
    document.getElementById('blTambahItem').onclick = function () { BELI.items.push(barisKosong()); gambarBeli(); };
    document.getElementById('blSimpan').onclick = simpanPembelian;
    document.getElementById('blSupplierBaru').onclick = formSupplier;

    BELI.items = [barisKosong()];
    muatSupplier();
    gambarBeli();
    muatRiwayatBeli();
  }
};

function barisKosong() {
  return { Kode_Obat: '', Kode_Batch: '', Expired_Date: '', Qty: 0, Harga_Netto: 0,
           PPN: 0, Diskon: 0, Harga_Jual_Umum_Baru: 0 };
}

function subtotalBaris(it) {
  return (Number(it.Harga_Netto) || 0) * (Number(it.Qty) || 0) *
    (1 + (Number(it.PPN) || 0) / 100) - (Number(it.Diskon) || 0);
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
      '<span>Modal ' + rupiah(b.Harga_Modal || 0) + '</span></div></button>';
  }).join('');
  posisikanSaranBeli(input); box.hidden = false;
}
function pilihSaranBeli(index) {
  var input = BELI_SUGGEST.input, b = BELI_SUGGEST.rows[index]; if (!input || !b) return;
  var i = Number(input.dataset.i), it = BELI.items[i]; if (!it) return;
  it.Kode_Obat = String(b.Kode_Obat || '').toUpperCase();
  if (!Number(it.Harga_Netto)) it.Harga_Netto = Number(b.Harga_Modal) || 0;
  if (!Number(it.PPN)) it.PPN = Number(b.PPN) || 0;
  if (!Number(it.Harga_Jual_Umum_Baru)) it.Harga_Jual_Umum_Baru = Number(b.Harga_Jual_Umum) || 0;
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
    function inp(field, tipe, lebar) {
      var extra = field === 'Kode_Obat' ? ' beli-kode-input' : '';
      var ac = field === 'Kode_Obat' ? ' autocomplete="off"' : '';
      return '<input class="inp num' + extra + '" style="min-width:' + lebar + 'px" type="' + tipe +
        '" data-i="' + i + '" data-f="' + field + '" value="' + esc(it[field]) + '"' + ac + '>';
    }
    return '<tr>' +
      '<td>' + inp('Kode_Obat', 'text', 90) + '</td>' +
      '<td>' + inp('Kode_Batch', 'text', 90) + '</td>' +
      '<td>' + inp('Expired_Date', 'date', 130) + '</td>' +
      '<td>' + inp('Qty', 'number', 66) + '</td>' +
      '<td>' + inp('Harga_Netto', 'number', 96) + '</td>' +
      '<td>' + inp('PPN', 'number', 60) + '</td>' +
      '<td>' + inp('Diskon', 'number', 84) + '</td>' +
      '<td>' + inp('Harga_Jual_Umum_Baru', 'number', 96) + '</td>' +
      '<td class="r num">' + rupiah(subtotalBaris(it)) + '</td>' +
      '<td class="c"><button class="icon-btn" data-del="' + i + '" aria-label="Hapus baris">✕</button></td>' +
    '</tr>';
  }).join('');

  tb.oninput = function (e) {
    var f = e.target.closest('[data-f]');
    if (!f) return;
    var it = BELI.items[Number(f.dataset.i)];
    it[f.dataset.f] = (f.type === 'number') ? Number(f.value) || 0 : f.value;
    // Hanya perbarui angka total agar fokus pengetikan tidak hilang.
    ringkasBeli();
    if (f.dataset.f === 'Kode_Obat') jadwalkanSaranBeli(f);
    var sel = f.closest('tr').children[8];
    if (sel) sel.textContent = rupiah(subtotalBaris(it));
  };
  tb.onclick = function (e) {
    var d = e.target.closest('[data-del]');
    if (!d) return;
    tutupSaranBeli(); BELI.items.splice(Number(d.dataset.del), 1);
    if (!BELI.items.length) BELI.items.push(barisKosong()); gambarBeli();
  };
  tb.onkeydown = function (e) {
    var input = e.target.closest('[data-f="Kode_Obat"]');
    var box = document.getElementById('beliSuggest');
    if (!input || !BELI_SUGGEST.input || !box || box.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); var d = e.key === 'ArrowDown' ? 1 : -1; BELI_SUGGEST.index = (BELI_SUGGEST.index + d + BELI_SUGGEST.rows.length) % BELI_SUGGEST.rows.length; document.querySelectorAll('#beliSuggest [data-beli-suggest]').forEach(function (b, j) { b.classList.toggle('is-cursor', j === BELI_SUGGEST.index); }); }
    else if (e.key === 'Enter' && BELI_SUGGEST.index >= 0) { e.preventDefault(); pilihSaranBeli(BELI_SUGGEST.index); }
    else if (e.key === 'Escape') tutupSaranBeli();
  };
  var suggest = document.getElementById('beliSuggest');
  if (suggest) suggest.onclick = function (e) { var b = e.target.closest('[data-beli-suggest]'); if (b) pilihSaranBeli(Number(b.dataset.beliSuggest)); };
  if (!window._beliSuggestViewportBound) {
    window._beliSuggestViewportBound = true;
    window.addEventListener('scroll', sinkronkanSaranBeli, true);
    window.addEventListener('resize', sinkronkanSaranBeli);
  }
  ringkasBeli();
}

function ringkasBeli() {
  var qty = BELI.items.reduce(function (a, it) { return a + (Number(it.Qty) || 0); }, 0);
  var total = BELI.items.reduce(function (a, it) { return a + subtotalBaris(it); }, 0);
  document.getElementById('blTotalItem').textContent = angka(qty) + ' item masuk';
  document.getElementById('blTotalTagihan').textContent = rupiah(total);
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

  var btn = document.getElementById('blSimpan');
  btn.disabled = true; btn.textContent = 'Menyimpan…';
  api('beli.simpan', {
    No_Faktur: val('blFaktur'), Supplier: val('blSupplier'), Kategori: val('blKategori'),
    Tanggal_Faktur: val('blTanggal'), Jatuh_Tempo: val('blTempo'), items: isi
  }).then(function (r) {
    toast('Faktur ' + r.No_Faktur + ' tersimpan, ' + angka(r.Total_Item) + ' item masuk.');
    document.getElementById('blFaktur').value = '';
    BELI.items = [barisKosong()];
    gambarBeli();
    muatRiwayatBeli();
  }).catch(function (e) {
    toast(e.message, true);
  }).then(function () {
    btn.disabled = false; btn.textContent = 'Simpan pembelian';
  });
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
  if (!tb) return;
  apiHutang('list', {}).then(function (rows) {
    tb.innerHTML = rows.length ? rows.map(function (r) {
      var bayar = r.Status_Pembayaran === 'LUNAS' ? '<button class="btn btn-sm" data-riwayat-hutang="' + esc(r.No_Faktur) + '">Riwayat</button>' : '<button class="btn btn-sm btn-primary" data-bayar-hutang="' + esc(r.No_Faktur) + '">Bayar</button> <button class="btn btn-sm" data-riwayat-hutang="' + esc(r.No_Faktur) + '">Riwayat</button>';
      return '<tr><td>' + esc(r.No_Faktur) + '</td><td>' + esc(r.No_Faktur_Supplier || '') + '</td><td>' + esc(r.Supplier) + '</td>' +
        '<td>' + esc(r.Kategori) + '</td><td>' + tglIndo(r.Tanggal_Faktur) + '</td>' +
        '<td>' + (r.Jatuh_Tempo ? tglIndo(r.Jatuh_Tempo) + '<br>' + labelJatuhTempoHutang(r) : '—') + '</td>' +
        '<td class="c num">' + angka(r.Total_Item) + '</td>' +
        '<td class="r num">' + rupiah(r.Total_Tagihan) + '</td><td class="r num">' + rupiah(r.Total_Dibayar) + '</td>' +
        '<td class="r num">' + rupiah(r.Sisa_Hutang) + '</td><td>' + chipStatusHutang(r.Status_Pembayaran) + '</td><td class="c">' + bayar + '</td></tr>';
    }).join('') : tabelKosong('Belum ada faktur tercatat.', 12);
    tb.onclick = function (e) {
      var bayar = e.target.closest('[data-bayar-hutang]');
      var riwayat = e.target.closest('[data-riwayat-hutang]');
      var r = rows.filter(function (x) { return x.No_Faktur === (bayar || riwayat).dataset[(bayar ? 'bayar' : 'riwayat') + 'Hutang']; })[0];
      if (bayar) bukaBayarHutang(r);
      if (riwayat) bukaRiwayatHutang(r.No_Faktur);
    };
  }).catch(function (e) { tb.innerHTML = '<tr><td colspan="12" class="empty">' + esc(e.message) + '</td></tr>'; });
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

var RETUR = { tab: 'jual', jual: { items: [], notaAsal: null }, beli: { items: [], fakturAsal: null } };

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
        '<label class="field"><span>Cari nota (nomor/nama pelanggan)</span>' +
          '<input id="rjCari" class="inp" placeholder="INV20260909 atau Ibu Sari"></label>' +
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
  document.getElementById('rjCari').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') muatNotaUntukRetur();
  });
  muatRiwayatReturJual();
}

function muatNotaUntukRetur() {
  var container = document.getElementById('rjForm');
  memuat(container);
  api('retur.jualList', {
    q: val('rjCari'), limit: numVal('rjBatas') || 60
  }).then(function (rows) {
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
    var sisa = Math.round(it.Qty * (1 - proporsi));
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
      sub.textContent = rupiah(ref.Harga_Satuan * (Number(f.value) || 0));
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
    totalRefund += ref.Harga_Satuan * q;
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
}

function muatFakturUntukRetur() {
  api('retur.beliList', {}).then(function (d) {
    var sel = document.getElementById('rbFaktur');
    if (!d.faktur.length) {
      sel.innerHTML = '<option>Belum ada faktur pembelian</option>';
      return;
    }
    sel.innerHTML = d.faktur.map(function (f) {
      return '<option value="' + esc(f.No_Faktur) + '">' + esc(f.No_Faktur) + ' · ' +
        (f.No_Faktur_Supplier ? esc(f.No_Faktur_Supplier) + ' · ' : '') +
        esc(f.Supplier) + ' · ' + esc(f.Tanggal_Faktur) +
        (f.sudah_retur > 0 ? ' (sudah diretur ' + rupiah(f.sudah_retur) + ')' : '') +
      '</option>';
    }).join('');
    RETUR.beli.daftarFaktur = d.faktur;
    RETUR.beli.fakturAsal = d.faktur[0];
    document.getElementById('rbFaktur').onchange = function () {
      RETUR.beli.fakturAsal = d.faktur.filter(function (x) { return x.No_Faktur === sel.value; })[0];
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
  var totalNetto = f.items.reduce(function (a, it) { return a + it.Harga_Netto * it.Qty; }, 0);
  var proporsi = totalNetto > 0 ? Math.min(1, sudah / totalNetto) : 0;
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
    var sisa = Math.round(it.Qty * (1 - proporsi));
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
  api('retur.beliList', { status: status }).then(function (d) {
    tb.innerHTML = d.retur.length ? d.retur.map(function (r) {
      var statusChip = '<span class="chip ' +
        (r.Status === 'APPROVED' ? 'chip-ok' :
         r.Status === 'REJECTED' ? 'chip-bad' : 'chip-warn') +
        '">' + esc(r.Status.replace('_', ' ')) + '</span>';
      var aksi = '';
      if (r.Status === 'PENDING_APPROVAL' && r.Created_By !== SESSION.user.nama) {
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
          barisLap('Total HPP / modal terjual', -d.total_hpp) +
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
      barisLap('Total HPP / modal terjual', -d.total_hpp) +
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
