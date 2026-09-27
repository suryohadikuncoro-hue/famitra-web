/* ============================ Master Barang, Stok, Opname, CRM, User ====== */

/* ----------------------------------------------- Master Barang (Bab 4) --- */

VIEWS.barang = {
  title: 'Master Barang',
  render: function (el) {
    el.innerHTML =
      '<div class="card"><div class="card-head">' +
        '<h3>Katalog produk</h3>' +
        '<input id="bgCari" class="inp" style="max-width:230px" placeholder="Cari nama, kode, kategori">' +
        '<button id="bgTambah" class="btn btn-primary">Tambah barang</button></div>' +
      '<div class="table-wrap"><table><thead><tr>' +
        '<th>Kode</th><th>Nama obat</th><th>Kategori</th><th class="c">Stok</th>' +
        '<th class="r">Modal</th><th class="r">Umum</th><th class="r">Nakes</th>' +
        '<th class="r">Apotek lain</th><th class="c">PPN</th><th></th>' +
      '</tr></thead><tbody id="bgBody"></tbody></table></div></div>';

    document.getElementById('bgTambah').onclick = function () { formBarang(null); };
    var t = null;
    document.getElementById('bgCari').addEventListener('input', function () {
      clearTimeout(t); t = setTimeout(muatBarang, 250);
    });
    muatBarang();
  }
};

function muatBarang() {
  var tb = document.getElementById('bgBody');
  if (!tb) return;
  tb.innerHTML = '<tr><td colspan="10" class="empty">Memuat…</td></tr>';
  Promise.all([
    api('barang.list', { q: val('bgCari') }),
    api('stok.list', { q: '', kritis: false })
  ]).then(function (result) {
    var rows = result[0];
    var batchRows = result[1];
    var stokPerKode = {};
    batchRows.forEach(function (batch) {
      var kode = String(batch.Kode_Obat || '');
      stokPerKode[kode] = (stokPerKode[kode] || 0) + (Number(batch.Stok_Real) || 0);
    });
    rows = rows.map(function (barang) {
      return Object.assign({}, barang, { stok: stokPerKode[String(barang.Kode_Obat || '')] || 0 });
    });
    if (!rows.length) { tb.innerHTML = tabelKosong('Belum ada barang. Tambahkan lewat tombol di atas.', 10); return; }
    tb.innerHTML = rows.map(function (b) {
      var stokKelas = b.stok <= b.Stok_Min ? 'chip-bad' : 'chip-ok';
      return '<tr' + (b.Aktif === 'TIDAK' ? ' style="opacity:.5"' : '') + '>' +
        '<td>' + esc(b.Kode_Obat) + '</td>' +
        '<td><strong>' + esc(b.Nama_Obat) + '</strong>' +
          (b.Barcode ? '<div class="cart-line-meta">' + esc(b.Barcode) + '</div>' : '') + '</td>' +
        '<td>' + esc(b.Kategori) + '</td>' +
        '<td class="c"><span class="chip ' + stokKelas + '">' + angka(b.stok) + '</span></td>' +
        '<td class="r num">' + rupiah(b.Harga_Modal) + '</td>' +
        '<td class="r num">' + rupiah(b.Harga_Jual_Umum) + '</td>' +
        '<td class="r num">' + rupiah(b.Harga_Khusus) + '</td>' +
        '<td class="r num">' + rupiah(b.Harga_Jual_Mutasi) + '</td>' +
        '<td class="c num">' + angka(b.PPN) + '%</td>' +
        '<td class="c" style="white-space:nowrap">' +
          '<button class="btn btn-sm" data-edit=\'' + esc(JSON.stringify(b)) + '\'>Ubah</button> ' +
          '<button class="btn btn-sm btn-danger" data-hapus="' + esc(b.Kode_Obat) + '">Nonaktifkan</button>' +
        '</td></tr>';
    }).join('');

    tb.onclick = function (e) {
      var ed = e.target.closest('[data-edit]');
      if (ed) { formBarang(JSON.parse(ed.dataset.edit)); return; }
      var hp = e.target.closest('[data-hapus]');
      if (hp) konfirmasiNonaktif(hp.dataset.hapus);
    };
  }).catch(function (e) {
    tb.innerHTML = '<tr><td colspan="10" class="empty">' + esc(e.message) + '</td></tr>';
  });
}

function formBarang(b) {
  var edit = !!b;
  b = b || {};
  modalBuka(edit ? 'Ubah ' + b.Nama_Obat : 'Tambah barang baru',
    '<div class="grid g2">' +
      '<label class="field"><span>Kode obat</span><input id="fbKode" class="inp" value="' +
        esc(b.Kode_Obat || '') + '"' + (edit ? ' readonly' : '') + '></label>' +
      '<label class="field"><span>Barcode</span><input id="fbBarcode" class="inp" value="' + esc(b.Barcode || '') + '"></label>' +
    '</div>' +
    '<label class="field"><span>Nama obat</span><input id="fbNama" class="inp" value="' + esc(b.Nama_Obat || '') + '"></label>' +
    '<div class="grid g3">' +
      '<label class="field"><span>Kategori</span><input id="fbKat" class="inp" value="' + esc(b.Kategori || '') + '"></label>' +
      '<label class="field"><span>Satuan</span><input id="fbSatuan" class="inp" value="' + esc(b.Satuan || 'Pcs') + '"></label>' +
      '<label class="field"><span>Stok minimum</span><input id="fbMin" class="inp num" type="number" value="' +
        (b.Stok_Min || 10) + '"></label>' +
    '</div>' +
    '<label class="field"><span>Golongan</span><select id="fbGol" class="inp">' +
      ['Bebas', 'Bebas Terbatas', 'Resep', 'Khusus'].map(function (g) {
        return '<option value="' + g + '"' + (b.Golongan === g ? ' selected' : '') + '>' + g + '</option>';
      }).join('') + '</select></label>' +
    '<div class="grid g2">' +
      '<label class="field"><span>Harga modal (beli)</span><input id="fbModal" class="inp num" type="number" value="' +
        (b.Harga_Modal || 0) + '"></label>' +
      '<label class="field"><span>Harga jual umum</span><input id="fbUmum" class="inp num" type="number" value="' +
        (b.Harga_Jual_Umum || 0) + '"></label>' +
      '<label class="field"><span>Harga khusus (nakes)</span><input id="fbKhusus" class="inp num" type="number" value="' +
        (b.Harga_Khusus || 0) + '"></label>' +
      '<label class="field"><span>Harga jual mutasi (apotek lain)</span><input id="fbMutasi" class="inp num" type="number" value="' +
        (b.Harga_Jual_Mutasi || 0) + '"></label>' +
    '</div>' +
    '<label class="field"><span>PPN (%)</span><input id="fbPPN" class="inp num" type="number" value="' + (b.PPN || 0) + '"></label>' +
    '<p class="kpi-sub">Harga khusus dan harga mutasi hanya berubah dari halaman ini — ' +
      'faktur pembelian tidak menimpanya.</p>',
    [
      { label: 'Batal', aksi: modalTutup },
      { label: edit ? 'Simpan perubahan' : 'Simpan barang', kelas: 'btn-primary', aksi: function () {
          api('barang.simpan', {
            mode: edit ? 'edit' : 'baru',
            Kode_Obat: val('fbKode'), Nama_Obat: val('fbNama'), Kategori: val('fbKat'),
            Satuan: val('fbSatuan'), Barcode: val('fbBarcode'), Stok_Min: numVal('fbMin'), Golongan: val('fbGol'),
            Harga_Modal: numVal('fbModal'), Harga_Jual_Umum: numVal('fbUmum'),
            Harga_Khusus: numVal('fbKhusus'), Harga_Jual_Mutasi: numVal('fbMutasi'),
            PPN: numVal('fbPPN')
          }).then(function () {
            modalTutup(); toast('Barang tersimpan.'); muatBarang();
          }).catch(function (e) { toast(e.message, true); });
        } }
    ]);
}

function konfirmasiNonaktif(kode) {
  modalBuka('Nonaktifkan barang',
    '<p>Barang <strong>' + esc(kode) + '</strong> akan disembunyikan dari katalog dan POS. ' +
    'Riwayat nota lama tetap utuh.</p>',
    [
      { label: 'Batal', aksi: modalTutup },
      { label: 'Nonaktifkan', kelas: 'btn-danger', aksi: function () {
          api('barang.hapus', { Kode_Obat: kode }).then(function () {
            modalTutup(); toast('Barang dinonaktifkan.'); muatBarang();
          }).catch(function (e) { toast(e.message, true); });
        } }
    ]);
}

/* ------------------------------------------------------- Stok & batch --- */

VIEWS.stok = {
  title: 'Stok & Batch',
  render: function (el) {
    el.innerHTML =
      '<div class="card"><div class="card-head">' +
        '<h3>Stok per batch</h3>' +
        '<input id="stCari" class="inp" style="max-width:220px" placeholder="Cari obat atau batch">' +
        '<label class="chip" style="cursor:pointer"><input id="stKritis" type="checkbox" style="margin-right:5px">' +
          'Hanya yang mendesak</label>' +
        '<button id="stTambah" class="btn btn-primary">Tambah batch</button></div>' +
      '<div class="table-wrap"><table><thead><tr>' +
        '<th>Obat</th><th>Kode batch</th><th>Kedaluwarsa</th><th>Sisa waktu</th>' +
        '<th class="c">Stok</th><th class="r">Modal batch</th><th></th>' +
      '</tr></thead><tbody id="stBody"></tbody></table></div></div>';

    document.getElementById('stTambah').onclick = function () { formBatch(null); };
    document.getElementById('stKritis').onchange = muatStok;
    var t = null;
    document.getElementById('stCari').addEventListener('input', function () {
      clearTimeout(t); t = setTimeout(muatStok, 250);
    });
    muatStok();
  }
};

function muatStok() {
  var tb = document.getElementById('stBody');
  if (!tb) return;
  tb.innerHTML = '<tr><td colspan="7" class="empty">Memuat…</td></tr>';
  api('stok.list', { q: val('stCari'), kritis: document.getElementById('stKritis').checked })
    .then(function (rows) {
      if (!rows.length) { tb.innerHTML = tabelKosong('Tidak ada batch yang cocok.', 7); return; }
      tb.innerHTML = rows.map(function (s) {
        return '<tr>' +
          '<td><strong>' + esc(s.Nama_Obat) + '</strong>' +
            '<div class="cart-line-meta">' + esc(s.Kode_Obat) + '</div></td>' +
          '<td>' + esc(s.Kode_Batch) + '</td>' +
          '<td>' + tglIndo(s.Expired_Date) + '</td>' +
          '<td>' + chipExpired(s.sisa_hari, s.Expired_Date) + '</td>' +
          '<td class="c num">' + angka(s.Stok_Real) + '</td>' +
          '<td class="r num">' + rupiah(s.Harga_Modal_Batch) + '</td>' +
          '<td class="c"><button class="btn btn-sm" data-batch=\'' + esc(JSON.stringify(s)) + '\'>Ubah</button></td>' +
        '</tr>';
      }).join('');
      tb.onclick = function (e) {
        var b = e.target.closest('[data-batch]');
        if (b) formBatch(JSON.parse(b.dataset.batch));
      };
    }).catch(function (e) {
      tb.innerHTML = '<tr><td colspan="7" class="empty">' + esc(e.message) + '</td></tr>';
    });
}

function formBatch(s) {
  var edit = !!s;
  s = s || {};
  modalBuka(edit ? 'Ubah batch ' + s.Kode_Batch : 'Tambah batch',
    '<div class="grid g2">' +
      '<label class="field"><span>Kode obat</span><input id="fsKode" class="inp" value="' +
        esc(s.Kode_Obat || '') + '"' + (edit ? ' readonly' : '') + '></label>' +
      '<label class="field"><span>Kode batch</span><input id="fsBatch" class="inp" value="' +
        esc(s.Kode_Batch || '') + '"' + (edit ? ' readonly' : '') + '></label>' +
      '<label class="field"><span>Tanggal kedaluwarsa</span><input id="fsExp" class="inp" type="date" value="' +
        esc(s.Expired_Date || '') + '"></label>' +
      '<label class="field"><span>Stok fisik</span><input id="fsStok" class="inp num" type="number" value="' +
        (s.Stok_Real || 0) + '"></label>' +
    '</div>' +
    '<label class="field"><span>Harga modal batch ini</span><input id="fsModal" class="inp num" type="number" value="' +
      (s.Harga_Modal_Batch || 0) + '"></label>',
    [
      { label: 'Batal', aksi: modalTutup },
      { label: 'Simpan batch', kelas: 'btn-primary', aksi: function () {
          var kodeObat = val('fsKode').toUpperCase();
          var kodeBatch = val('fsBatch');
          var expired = val('fsExp');
          var stok = numVal('fsStok');
          var modal = numVal('fsModal');
          if (!kodeObat || !kodeBatch || !expired) { toast('Kode obat, kode batch, dan tanggal kedaluwarsa wajib diisi.', true); return; }
          if (stok < 0 || modal < 0) { toast('Stok dan harga modal tidak boleh negatif.', true); return; }
          api('stok.simpanBatch', {
            ID_Batch: s.ID_Batch || '', Kode_Obat: kodeObat, Kode_Batch: kodeBatch, Expired_Date: expired,
            Stok_Real: stok, Harga_Modal_Batch: modal
          }).then(function () {
            modalTutup(); toast('Batch tersimpan.'); muatStok();
          }).catch(function (e) { toast(e.message, true); });
        } }
    ]);
}

/* --------------------------------------------------- Stokopname (8.2) --- */

VIEWS.opname = {
  title: 'Stokopname',
  render: function (el) {
    el.innerHTML =
      '<div class="card"><div class="card-head"><h3>Penyesuaian stok fisik</h3></div>' +
      '<p class="kpi-sub" style="margin-top:0">Masukkan hasil hitung fisik di rak. Sistem menimpa stok ' +
        'dan menyimpan selisihnya sebagai riwayat audit.</p>' +
      '<div class="grid g4" style="margin-top:10px">' +
        '<label class="field"><span>Kode obat</span><input id="opKode" class="inp"></label>' +
        '<label class="field"><span>Kode batch</span><input id="opBatch" class="inp"></label>' +
        '<label class="field"><span>Stok fisik hasil hitung</span><input id="opFisik" class="inp num" type="number"></label>' +
        '<label class="field"><span>Keterangan</span><input id="opKet" class="inp" placeholder="Rusak, hilang, salah catat"></label>' +
      '</div>' +
      '<button id="opSimpan" class="btn btn-primary">Simpan penyesuaian</button></div>' +

      '<div class="card"><div class="card-head"><h3>Riwayat penyesuaian</h3></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Obat</th><th>Batch</th>' +
        '<th class="c">Sistem</th><th class="c">Fisik</th><th class="c">Selisih</th>' +
        '<th>Keterangan</th><th>Petugas</th></tr></thead><tbody id="opBody"></tbody></table></div></div>';

    document.getElementById('opSimpan').onclick = function () {
      api('opname.simpan', {
        Kode_Obat: val('opKode'), Kode_Batch: val('opBatch'),
        Stok_Fisik: numVal('opFisik'), Keterangan: val('opKet')
      }).then(function (r) {
        toast('Stok disesuaikan. Selisih ' + (r.Selisih > 0 ? '+' : '') + r.Selisih + '.');
        ['opKode', 'opBatch', 'opFisik', 'opKet'].forEach(function (id) {
          document.getElementById(id).value = '';
        });
        muatOpname();
      }).catch(function (e) { toast(e.message, true); });
    };
    muatOpname();
  }
};

function muatOpname() {
  var tb = document.getElementById('opBody');
  if (!tb) return;
  api('opname.list', {}).then(function (rows) {
    tb.innerHTML = rows.length ? rows.map(function (r) {
      var cls = r.Selisih < 0 ? 'chip-bad' : (r.Selisih > 0 ? 'chip-warn' : 'chip-ok');
      return '<tr><td>' + tglIndo(r.Tanggal) + '</td><td>' + esc(r.Kode_Obat) + '</td>' +
        '<td>' + esc(r.Kode_Batch) + '</td>' +
        '<td class="c num">' + angka(r.Stok_Sistem) + '</td>' +
        '<td class="c num">' + angka(r.Stok_Fisik) + '</td>' +
        '<td class="c"><span class="chip ' + cls + '">' + (r.Selisih > 0 ? '+' : '') + r.Selisih + '</span></td>' +
        '<td>' + esc(r.Keterangan) + '</td><td>' + esc(r.Petugas) + '</td></tr>';
    }).join('') : tabelKosong('Belum ada riwayat stokopname.', 8);
  }).catch(function (e) {
    tb.innerHTML = '<tr><td colspan="8" class="empty">' + esc(e.message) + '</td></tr>';
  });
}

/* --------------------------------------------------- Pelanggan / CRM ---- */

var CRM_ROWS = [];
var CRM_FILTER = { q: '', tipe: '', segment: '', tier: '' };

function crmDays(c) {
  if (!c.Tanggal_Terakhir_Beli) return null;
  var t = new Date(String(c.Tanggal_Terakhir_Beli).substring(0, 10) + 'T00:00:00');
  return Math.max(0, Math.floor((Date.now() - t.getTime()) / 86400000));
}
function crmSegment(c) {
  var d = crmDays(c), n = Number(c.Jumlah_Transaksi || 0), spend = Number(c.Total_Belanja || 0);
  if (!c.Tanggal_Terakhir_Beli || n === 0) return 'Baru';
  if (d > 180) return 'Dormant';
  if (d > 60) return 'At-Risk';
  if (spend >= 2000000 || n >= 8) return 'VIP';
  return 'Active Routine';
}
function crmBadge(value, type) {
  var v = String(value || 'Baru'), cls = '';
  if (type === 'segment') cls = v === 'VIP' ? 'chip-brand' : (v === 'Active Routine' ? 'chip-ok' : (v === 'At-Risk' || v === 'Dormant' ? 'chip-bad' : 'chip-warn'));
  if (type === 'tier') cls = v === 'gold' ? 'chip-brand' : (v === 'silver' ? 'chip-ok' : '');
  return '<span class="chip ' + cls + '">' + esc(v) + '</span>';
}
function crmBar(label, count, total, color) {
  var pct = total ? Math.max(3, count / total * 100) : 0;
  return '<div class="crm-bar-row"><div class="crm-bar-label"><span>' + esc(label) + '</span><strong>' + count + '</strong></div><div class="crm-bar-track"><i style="width:' + pct.toFixed(1) + '%;background:' + color + '"></i></div></div>';
}
function crmMoney(n) { return rupiah(n); }

VIEWS.crm = {
  title: 'CRM Pelanggan',
  render: function (el) {
    el.innerHTML =
      '<div class="crm-shell">' +
      '<div class="crm-head"><div><div class="eyebrow">CUSTOMER INTELLIGENCE</div><h2>Hubungan pelanggan</h2><p class="sub">Pantau nilai, kebiasaan belanja, loyalti, dan pelanggan yang perlu ditindaklanjuti.</p></div>' +
      '<button id="crTambah" class="btn btn-primary">+ Tambah pelanggan</button></div>' +
      '<div id="crmKpi" class="crm-kpi-grid"></div>' +
      '<div class="crm-grid-main"><div class="card crm-chart-card"><div class="card-head"><div><h3>Segmen pelanggan</h3><p class="sub">Dihitung dari recency, frekuensi, dan nilai belanja per cabang.</p></div></div><div id="crmSegments"></div></div>' +
      '<div class="card crm-chart-card"><div class="card-head"><div><h3>Tier loyalti</h3><p class="sub">Distribusi berdasarkan total belanja bulanan.</p></div></div><div id="crmTiers"></div></div></div>' +
      '<div class="card crm-priority"><div class="card-head"><div><h3>Prioritas hari ini</h3><p class="sub">Pelanggan yang paling membutuhkan perhatian.</p></div><span id="crmBranchChip" class="chip chip-brand"></span></div><div id="crmPriorityList" class="crm-priority-list"></div></div>' +
      ''+'<div class="card crm-refill"><div class="card-head"><div><h3>Refill & Notifikasi</h3><p class="sub">Atur pengingat isi ulang per pelanggan. Pesan masuk antrean sebelum dikirim.</p></div><button id="crmGenerateRefill" class="btn btn-primary">Buat antrean reminder</button></div><div id="crmRefillForm" class="crm-refill-form"><select id="crmRefillCustomer" class="inp"><option value="">Pilih pelanggan</option></select><input id="crmRefillObat" class="inp" placeholder="Kode obat"><input id="crmRefillCycle" class="inp" type="number" min="1" value="30" placeholder="Siklus hari"><input id="crmRefillNext" class="inp" type="date"><button id="crmSaveRefill" class="btn">+ Simpan program</button></div><div id="crmRefillList" class="crm-refill-list"></div></div>' + '<div class="card crm-directory"><div class="card-head"><div><h3>Eksplorasi pelanggan</h3><p class="sub">Cari dan filter profil pelanggan secara menyeluruh.</p></div><div class="crm-tools"><input id="crCari" class="inp" placeholder="Cari nama atau nomor WA"><select id="crSegment" class="inp"><option value="">Semua segmen</option><option>Baru</option><option>Active Routine</option><option>VIP</option><option>At-Risk</option><option>Dormant</option></select><select id="crTier" class="inp"><option value="">Semua tier</option><option value="reguler">Reguler</option><option value="silver">Silver</option><option value="gold">Gold</option></select><select id="crTipe" class="inp"><option value="">Semua tipe</option><option>Umum</option><option>Tenaga Kesehatan</option><option>Apotek Lain</option></select></div></div><div class="table-wrap"><table><thead><tr><th>Pelanggan</th><th>Segmen</th><th>Tier</th><th class="r">Poin</th><th class="r">Belanja bulan ini</th><th class="r">Lifetime value</th><th class="c">Transaksi</th><th>Aktivitas terakhir</th><th></th></tr></thead><tbody id="crBody"></tbody></table></div></div></div>';
    document.getElementById('crTambah').onclick = function () { formCustomer(null); };
    ['crCari','crSegment','crTier','crTipe'].forEach(function (id) { document.getElementById(id).oninput = crmRender; });
    muatCRM();
  }
};

VIEWS.marketing = {
  title: 'Marketing',
  render: function (el) {
    el.innerHTML =
      '<div class="crm-shell">' +
      '<div class="crm-head"><div><div class="eyebrow">MARKETING PERFORMANCE</div><h2>Marketing</h2><p class="sub">Kelola kampanye, kupon, fixed bundle, dan ukur efektivitas promosi per cabang.</p></div>' +
      '<button id="lotOpen" class="btn btn-primary">Kupon Undian</button></div>' +
      '<div id="crmPromoCard" class="card crm-refill" style="display:none"><div class="card-head"><div><h3>Manajemen Promo</h3><p class="sub">Buat kupon berdasarkan segmen pelanggan.</p></div><button id="crmBundleTambah" class="btn btn-sm">+ Bundle</button><button id="crmPromoTambah" class="btn btn-primary">+ Kampanye</button></div><div id="crmPromoForm" class="crm-refill-form" hidden></div><div id="crmPromoList" class="crm-refill-list"></div><div id="crmBundleList" class="crm-refill-list"></div></div>'  + '<div id=\"crmPromoReportCard\" class=\"card crm-directory\" style=\"display:none\"><div class=\"card-head\"><div><h3>Efektivitas kampanye</h3><p class=\"sub\">Pantau penggunaan kupon, pelanggan unik, dan total subsidi promo.</p></div><button id=\"crmPromoReportRefresh\" class=\"btn btn-sm\">Muat ulang</button></div><div id=\"crmPromoReportKpi\" class=\"crm-kpi-grid\"></div><div id=\"crmPromoCampaignSummary\" style=\"margin:14px 0\"></div><div class=\"table-wrap\"><table><thead><tr><th>Tanggal</th><th>Kampanye</th><th>Kupon</th><th>Pelanggan</th><th>Invoice</th><th class=\"r\">Diskon</th><th>Status</th></tr></thead><tbody id=\"crmPromoReportBody\"></tbody></table></div></div>' +
      '</div>';
    var lotBtn = document.getElementById('lotOpen');
    if (lotBtn) lotBtn.onclick = function () {
      el.innerHTML = '<div id="lottery-root" style="padding:16px;"></div>';
      if (window.MarketingLottery) window.MarketingLottery.mount('lottery-root');
    };
    muatPromo();
    muatPromoReport();
  }
};
function muatCRM() {
  var body = document.getElementById('crBody');
  if (body) body.innerHTML = '<tr><td colspan="9" class="empty">Memuat data pelanggan…</td></tr>';
  api('crm.list', {}).then(function (rows) { CRM_ROWS = rows || []; crmRender(); muatRefill(); }).catch(function (e) { if (body) body.innerHTML = '<tr><td colspan="9" class="empty">' + esc(e.message) + '</td></tr>'; });
}
function crmRender() {
  var q = String(val('crCari') || '').toLowerCase(), seg = val('crSegment'), tier = val('crTier'), tipe = val('crTipe');
  var rows = CRM_ROWS.map(function (c) { c._segment = crmSegment(c); c._days = crmDays(c); return c; }).filter(function (c) {
    return (!q || String(c.Nama || '').toLowerCase().indexOf(q) >= 0 || String(c.Nomor_WA || '').indexOf(q) >= 0) && (!seg || c._segment === seg) && (!tier || String(c.Tier || 'reguler') === tier) && (!tipe || c.Tipe_Customer === tipe);
  });
  var total = CRM_ROWS.length, spend = CRM_ROWS.reduce(function (n,c){return n+Number(c.Total_Belanja||0);},0), mtd = CRM_ROWS.reduce(function (n,c){return n+Number(c.Total_Spend_MTD||0);},0), points = CRM_ROWS.reduce(function (n,c){return n+Number(c.Total_Points||0);},0);
  var atRisk = CRM_ROWS.filter(function(c){return c._segment === 'At-Risk';}), vip = CRM_ROWS.filter(function(c){return c._segment === 'VIP';});
  var avg = total ? spend / total : 0;
  var kpi = document.getElementById('crmKpi');
  if (kpi) kpi.innerHTML = '<div class="crm-kpi"><span class="crm-kpi-icon">◉</span><div><small>Total pelanggan</small><strong>' + angka(total) + '</strong><em>Profil di cabang aktif</em></div></div>' +
    '<div class="crm-kpi"><span class="crm-kpi-icon crm-green">↗</span><div><small>Lifetime value</small><strong>' + crmMoney(spend) + '</strong><em>Rata-rata ' + crmMoney(avg) + '</em></div></div>' +
    '<div class="crm-kpi"><span class="crm-kpi-icon crm-gold">✦</span><div><small>Poin beredar</small><strong>' + angka(points) + '</strong><em>Saldo loyalti pelanggan</em></div></div>' +
    '<div class="crm-kpi crm-alert"><span class="crm-kpi-icon crm-red">!</span><div><small>Perlu perhatian</small><strong>' + angka(atRisk.length) + '</strong><em>' + angka(vip.length) + ' pelanggan VIP aktif</em></div></div>';
  var counts = {}; CRM_ROWS.forEach(function(c){counts[c._segment]=(counts[c._segment]||0)+1;});
  var segEl=document.getElementById('crmSegments'); if(segEl) segEl.innerHTML=crmBar('Active Routine',counts['Active Routine']||0,total,'#2e8b78')+crmBar('VIP',counts.VIP||0,total,'#a57b27')+crmBar('At-Risk',counts['At-Risk']||0,total,'#c45c5c')+crmBar('Baru',counts.Baru||0,total,'#7d8795')+crmBar('Dormant',counts.Dormant||0,total,'#b5a99b');
  var tierCounts={reguler:0,silver:0,gold:0}; CRM_ROWS.forEach(function(c){tierCounts[String(c.Tier||'reguler')]++;});
  var tierEl=document.getElementById('crmTiers'); if(tierEl) tierEl.innerHTML=crmBar('Gold',tierCounts.gold,total,'#b4872b')+crmBar('Silver',tierCounts.silver,total,'#5c9c91')+crmBar('Reguler',tierCounts.reguler,total,'#8c96a3')+'<div class="crm-tier-note">Belanja bulan berjalan: <strong>'+crmMoney(mtd)+'</strong></div>';
  var branch=document.getElementById('crmBranchChip'); if(branch) branch.textContent=(SESSION&&SESSION.user&&SESSION.user.cabang_id)||'—';
  var priorities=atRisk.slice().sort(function(a,b){return (b._days||0)-(a._days||0);}).slice(0,4).concat(vip.slice(0,2));
  var pl=document.getElementById('crmPriorityList'); if(pl) pl.innerHTML=priorities.length ? priorities.map(function(c){return '<div class="crm-priority-item"><div class="crm-avatar">'+esc(String(c.Nama||'?').charAt(0).toUpperCase())+'</div><div class="crm-priority-main"><strong>'+esc(c.Nama)+'</strong><span>'+crmBadge(c._segment,'segment')+' <span class="cart-line-meta">'+(c._days===null?'Belum transaksi':c._days+' hari lalu')+'</span></span></div><div class="crm-priority-value">'+crmMoney(c.Total_Belanja)+'</div><button class="btn btn-sm" data-cust-detail="'+esc(JSON.stringify(c))+'">Detail</button></div>';}).join('') : '<div class="empty">Belum ada pelanggan yang perlu ditindaklanjuti.</div>';
  var tb=document.getElementById('crBody'); if(!tb)return;
  if(!rows.length){tb.innerHTML=tabelKosong('Belum ada pelanggan yang cocok.',9);return;}
  tb.innerHTML=rows.map(function(c){return '<tr><td><div class="crm-person"><div class="crm-avatar small">'+esc(String(c.Nama||'?').charAt(0).toUpperCase())+'</div><div><strong>'+esc(c.Nama)+'</strong><span>'+esc(c.Nomor_WA)+'</span></div></div></td><td>'+crmBadge(c._segment,'segment')+'</td><td>'+crmBadge(c.Tier||'reguler','tier')+'</td><td class="r num">'+angka(c.Total_Points||0)+'</td><td class="r num">'+crmMoney(c.Total_Spend_MTD||0)+'</td><td class="r num">'+crmMoney(c.Total_Belanja||0)+'</td><td class="c num">'+angka(c.Jumlah_Transaksi||0)+'</td><td>'+(c._days===null?'Belum transaksi':tglIndo(c.Tanggal_Terakhir_Beli)+'<span class="cart-line-meta">'+c._days+' hari lalu</span>')+'</td><td><button class="btn btn-sm" data-cust-detail=\''+esc(JSON.stringify(c))+'\'>Lihat</button> <button class="btn btn-sm" data-cust-edit=\''+esc(JSON.stringify(c))+'\'>Ubah</button></td></tr>';}).join('');
  tb.onclick=function(e){var edit=e.target.closest('[data-cust-edit]');if(edit){formCustomer(JSON.parse(edit.dataset.custEdit));return;}var b=e.target.closest('[data-cust-detail]');if(b)crmDetail(JSON.parse(b.dataset.custDetail));};
  if(pl) pl.onclick=function(e){var b=e.target.closest('[data-cust-detail]');if(b)crmDetail(JSON.parse(b.dataset.custDetail));};
}
function crmDetail(c) {
  var seg=c._segment||crmSegment(c), days=c._days===null?null:c._days;
  modalBuka('Profil pelanggan', '<div class="crm-detail-head"><div class="crm-avatar large">'+esc(String(c.Nama||'?').charAt(0).toUpperCase())+'</div><div><h3>'+esc(c.Nama)+'</h3><p class="sub">'+esc(c.Nomor_WA)+' · '+esc(c.Tipe_Customer||'Umum')+'</p></div></div><div class="crm-detail-grid"><div><small>Segmen</small><strong>'+crmBadge(seg,'segment')+'</strong></div><div><small>Tier</small><strong>'+crmBadge(c.Tier||'reguler','tier')+'</strong></div><div><small>Saldo poin</small><strong>'+angka(c.Total_Points||0)+'</strong></div><div><small>Belanja bulan ini</small><strong>'+crmMoney(c.Total_Spend_MTD||0)+'</strong></div><div><small>Lifetime value</small><strong>'+crmMoney(c.Total_Belanja||0)+'</strong></div><div><small>Transaksi</small><strong>'+angka(c.Jumlah_Transaksi||0)+'</strong></div></div><div class="crm-detail-note">'+(days===null?'Pelanggan belum memiliki transaksi.':days>60?'Perlu follow-up: tidak bertransaksi selama '+days+' hari.':'Aktif terakhir '+days+' hari yang lalu.')+'</div>', [{label:'Tutup',aksi:modalTutup},{label:'WhatsApp',kelas:'btn-primary',aksi:function(){window.open('https://wa.me/'+encodeURIComponent(c.Nomor_WA),'_blank');}}]);
}

function muatRefill() {
  var list = document.getElementById('crmRefillList');
  if (!list) return;
  var sel = document.getElementById('crmRefillCustomer');
  sel.innerHTML = '<option value="">Pilih pelanggan</option>' + CRM_ROWS.filter(function(c){return c.Nomor_WA;}).map(function(c){return '<option value="'+esc(c.ID||'')+'">'+esc(c.Nama)+' · '+esc(c.Nomor_WA)+'</option>';}).join('');
  api('refill.list', {}).then(function(rows) {
    list.innerHTML = rows.length ? rows.map(function(r){return '<div class="crm-refill-item"><div class="crm-avatar small">↻</div><div class="crm-refill-main"><strong>'+esc(r.Nama||'Pelanggan')+'</strong><span>'+esc(r.Kode_Obat)+' · setiap '+angka(r.Cycle_Days)+' hari · reminder '+tglIndo(r.Next_Reminder)+'</span></div><span class="chip '+(r.Status==='ACTIVE'?'chip-ok':'chip-warn')+'">'+esc(r.Status)+'</span><button class="btn btn-sm" data-refill-id="'+esc(r.ID)+'" data-refill-status="'+esc(r.Status)+'">'+(r.Status==='ACTIVE'?'Jeda':'Aktifkan')+'</button></div>';}).join('') : '<div class="empty">Belum ada program refill aktif.</div>';
    list.onclick=function(e){var b=e.target.closest('[data-refill-id]');if(!b)return;api('refill.status',{id:b.dataset.refillId,status:b.dataset.refillStatus}).then(function(){toast('Status program diperbarui.');muatRefill();}).catch(function(err){toast(err.message,true);});};
  }).catch(function(e){list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';});
  document.getElementById('crmGenerateRefill').onclick=function(){api('refill.generate',{}).then(function(r){toast('Antrean reminder dibuat: '+angka(r.queued||0));}).catch(function(e){toast(e.message,true);});};
  document.getElementById('crmSaveRefill').onclick=function(){var c=CRM_ROWS.filter(function(x){return String(x.ID||'')===val('crmRefillCustomer');})[0]; if(!c){toast('Pilih pelanggan terlebih dahulu.',true);return;} api('refill.simpan',{customer_id:c.ID,kode_obat:val('crmRefillObat'),cycle_days:Number(val('crmRefillCycle')||30),next_reminder_date:val('crmRefillNext')}).then(function(){toast('Program refill tersimpan.');muatRefill();}).catch(function(e){toast(e.message,true);});};
}

function formCustomer(c) {
  var edit = !!c;
  c = c || {};
  modalBuka(edit ? 'Ubah ' + c.Nama : 'Tambah pelanggan',
    '<label class="field"><span>Nomor WhatsApp</span><input id="fcWA" class="inp" value="' +
      esc(c.Nomor_WA || '') + '"' + (edit ? ' readonly' : '') + '></label>' +
    '<label class="field"><span>Nama</span><input id="fcNama" class="inp" value="' + esc(c.Nama || '') + '"></label>' +
    '<label class="field"><span>Tipe customer</span><select id="fcTipe" class="inp">' +
      ['Umum', 'Tenaga Kesehatan', 'Apotek Lain'].map(function (t) {
        return '<option' + (c.Tipe_Customer === t ? ' selected' : '') + '>' + t + '</option>';
      }).join('') + '</select></label>' +
    '<label class="field"><span>Alamat</span><input id="fcAlamat" class="inp" value="' + esc(c.Alamat || '') + '"></label>' +
    '<label class="field"><span>Nomor izin (SIP/SIA)</span><input id="fcIzin" class="inp" value="' +
      esc(c.Nomor_Izin || '') + '"></label>',
    [
      { label: 'Batal', aksi: modalTutup },
      { label: 'Simpan', kelas: 'btn-primary', aksi: function () {
          if (!val('fcWA') || !val('fcNama')) { toast('Nomor WhatsApp dan nama wajib diisi.', true); return; }
          api('crm.simpan', {
            Nomor_WA: val('fcWA'), Nama: val('fcNama'), Tipe_Customer: val('fcTipe'),
            Alamat: val('fcAlamat'), Nomor_Izin: val('fcIzin')
          }).then(function () {
            modalTutup(); toast('Data pelanggan tersimpan.'); muatCRM();
          }).catch(function (e) { toast(e.message, true); });
        } }
    ]);
}

/* ------------------------------------------------------ Manajemen user -- */

VIEWS.user = {
  title: 'Manajemen User',
  render: function (el) {
    el.innerHTML =
      '<div class="card"><div class="card-head"><h3>Akun pengguna</h3>' +
        '<button id="usTambah" class="btn btn-primary">Tambah user</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Username</th><th>Nama</th>' +
        '<th>Role</th><th>Cabang</th><th>Status</th><th>Dibuat</th><th></th></tr></thead>' +
        '<tbody id="usBody"></tbody></table></div></div>';
    document.getElementById('usTambah').onclick = function () { formUser(null); };
    muatUser();
  }
};

function muatUser() {
  var tb = document.getElementById('usBody');
  if (!tb) return;
  api('user.list', {}).then(function (rows) {
    tb.innerHTML = rows.map(function (u) {
      var aktif = String(u.Aktif).toUpperCase() === 'YA';
      return '<tr' + (aktif ? '' : ' style="opacity:.5"') + '>' +
        '<td>' + esc(u.Username) + '</td><td>' + esc(u.Nama) + '</td>' +
        '<td><span class="chip">' + esc(labelRole_(u.Role)) + '</span></td>' +
        '<td>' + esc({ KARLA: 'Karla', PUCUK: 'Pucuk', KENDAL: 'Kendal', PULE: 'Pule' }[u.Cabang_ID] || u.Cabang_ID || 'Karla') + '</td>' +
        '<td>' + (aktif ? '<span class="chip chip-ok">Aktif</span>' :
                          '<span class="chip chip-bad">Nonaktif</span>') + '</td>' +
        '<td>' + esc(String(u.Created_At).substring(0, 10)) + '</td>' +
        '<td class="c" style="white-space:nowrap">' +
          '<button class="btn btn-sm" data-user=\'' + esc(JSON.stringify(u)) + '\'>Ubah</button> ' +
          (aktif ? '<button class="btn btn-sm btn-danger" data-off="' + esc(u.Username) + '">Nonaktifkan</button>' : '') +
        '</td></tr>';
    }).join('');
    tb.onclick = function (e) {
      var ed = e.target.closest('[data-user]');
      if (ed) { formUser(JSON.parse(ed.dataset.user)); return; }
      var off = e.target.closest('[data-off]');
      if (off) {
        api('user.hapus', { Username: off.dataset.off })
          .then(function () { toast('Akun dinonaktifkan.'); muatUser(); })
          .catch(function (er) { toast(er.message, true); });
      }
    };
  }).catch(function (e) {
    tb.innerHTML = '<tr><td colspan="7" class="empty">' + esc(e.message) + '</td></tr>';
  });
}

async function formUser(u) {
  var edit = !!u;
  u = u || {};
  var cabangList = [];
  try { cabangList = await api('cabang.list', {}); } catch (e) { toast(e.message, true); return; }
  var cabangSelect = '<select id="fuCabang" class="inp">' + cabangList.map(function (c) {
    return '<option value="' + esc(c.kode_cabang) + '"' + (u.Cabang_ID === c.kode_cabang ? ' selected' : '') + '>' + esc(c.nama_cabang) + '</option>';
  }).join('') + '</select>';
  modalBuka(edit ? 'Ubah akun ' + u.Username : 'Tambah user',
    '<label class="field"><span>Username</span><input id="fuUser" class="inp" value="' +
      esc(u.Username || '') + '"' + (edit ? ' readonly' : '') + '></label>' +
    '<label class="field"><span>Nama lengkap</span><input id="fuNama" class="inp" value="' + esc(u.Nama || '') + '"></label>' +
    '<label class="field"><span>Role</span><select id="fuRole" class="inp">' +
      ['Owner', 'Apoteker', 'Kasir'].map(function (r) {
        return '<option value="' + r + '"' + (u.Role === r ? ' selected' : '') + '>' + labelRole_(r) + '</option>';
      }).join('') + '</select></label>' +
    '<label class="field"><span>Cabang</span>' + cabangSelect + '</label>' +
    '<label class="field"><span>Password' + (edit ? ' baru (kosongkan bila tidak diubah)' : '') +
      '</span><input id="fuPass" class="inp" type="password" placeholder="Minimal 6 karakter"></label>' +
    '<label class="field"><span>Status</span><select id="fuAktif" class="inp">' +
      '<option value="YA"' + (u.Aktif !== 'TIDAK' ? ' selected' : '') + '>Aktif</option>' +
      '<option value="TIDAK"' + (u.Aktif === 'TIDAK' ? ' selected' : '') + '>Nonaktif</option></select></label>',
    [
      { label: 'Batal', aksi: modalTutup },
      { label: 'Simpan akun', kelas: 'btn-primary', aksi: function () {
          api('user.simpan', {
            Username: val('fuUser'), Nama: val('fuNama'), Role: val('fuRole'),
            Password: val('fuPass'), Aktif: val('fuAktif'),
            Cabang: val('fuCabang'),
            mode: edit ? 'edit' : 'create'
          }).then(function () {
            modalTutup(); toast('Akun tersimpan.'); muatUser();
          }).catch(function (e) { toast(e.message, true); });
        } }
    ]
  );
}

function muatCabang() {
  if (typeof window.G_BRANCHES === 'undefined') window.G_BRANCHES = {};
  api('cabang.list', {}).then(function (rows) {
    rows.forEach(function (c) { window.G_BRANCHES[c.kode_cabang] = c.nama_cabang; });
  }).catch(function () {});
}

function muatPromo() {
  var card=document.getElementById('crmPromoCard'), list=document.getElementById('crmPromoList'); if(!card||!list)return; card.style.display='block';
  document.getElementById('crmPromoTambah').onclick=function(){formPromoKampanye();};
  document.getElementById('crmBundleTambah').onclick=function(){formFixedBundle();};
  muatBundle();
  promoApi('campaignList',{}).then(function(rows){list.innerHTML=rows.length?rows.map(function(c){var targets=(c.promo_segment_targets||[]).map(function(t){return t.segment;}).join(', ');var coupons=(c.promo_coupons||[]).map(function(x){return x.code+' · '+(x.discount_type==='PERCENT'?x.discount_value+'%':rupiah(x.discount_value));}).join(' | ');return '<div class="crm-refill-item"><div class="crm-avatar small">%</div><div class="crm-refill-main"><strong>'+esc(c.name)+'</strong><span>'+esc(targets||'Tanpa target')+' · '+esc(coupons||'Belum ada kupon')+'</span></div><span class="chip '+(c.status==='ACTIVE'?'chip-ok':'chip-warn')+'">'+esc(c.status)+'</span><button class="btn btn-sm" data-promo-status="'+esc(c.id)+'" data-status="'+(c.status==='ACTIVE'?'PAUSED':'ACTIVE')+'">'+(c.status==='ACTIVE'?'Jeda':'Aktifkan')+'</button></div>';}).join(''):'<div class="empty">Belum ada kampanye promo.</div>';list.onclick=function(e){var b=e.target.closest('[data-promo-status]');if(!b)return;promoApi('campaignStatus',{id:b.dataset.promoStatus,status:b.dataset.status}).then(function(){toast('Status kampanye diperbarui.');muatPromo();}).catch(function(err){toast(err.message,true);});};}).catch(function(e){list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';});
}
function muatPromoReport() {
  var card=document.getElementById('crmPromoReportCard'), kpi=document.getElementById('crmPromoReportKpi'), summary=document.getElementById('crmPromoCampaignSummary'), body=document.getElementById('crmPromoReportBody');
  if(!card||!kpi||!summary||!body)return; card.style.display='block';
  var refresh=document.getElementById('crmPromoReportRefresh'); if(refresh) refresh.onclick=muatPromoReport;
  body.innerHTML='<tr><td colspan="7" class="empty">Memuat analitik promo…</td></tr>';
  promoApi('report',{}).then(function(r){
    kpi.innerHTML='<div class="crm-kpi"><span class="crm-kpi-icon">↗</span><div><small>Pendapatan promo & bundle</small><strong>'+rupiah(r.revenue||0)+'</strong><em>Kupon dan fixed bundle</em></div></div><div class="crm-kpi"><span class="crm-kpi-icon crm-green">✦</span><div><small>Laba kotor setelah promo</small><strong>'+rupiah(r.profit_after_promo||0)+'</strong><em>Pendapatan dikurangi HPP</em></div></div><div class="crm-kpi"><span class="crm-kpi-icon crm-gold">%</span><div><small>ROI subsidi diskon (proxy)</small><strong>'+(r.roi_direct===null||r.roi_direct===undefined?'—':r.roi_direct.toFixed(1)+'%')+'</strong><em>Kupon dan bundle</em></div></div><div class="crm-kpi"><span class="crm-kpi-icon crm-red">◉</span><div><small>ROAS promo & bundle</small><strong>'+(r.roas===null||r.roas===undefined?'—':r.roas.toFixed(2)+'x')+'</strong><em>Pendapatan per Rp1 diskon</em></div></div>';
    var campaigns=r.campaigns||[], bundles=r.bundles||[];
    var campaignHtml=campaigns.length?'<h4 style="margin:0 0 8px">ROI proxy per kampanye kupon</h4><div class="table-wrap"><table><thead><tr><th>Kampanye</th><th class="c">Redemption</th><th class="c">Pelanggan</th><th class="r">Pendapatan</th><th class="r">Diskon</th><th class="r">Laba</th><th class="r">Margin</th><th class="r">ROAS</th><th class="r">ROI</th></tr></thead><tbody>'+campaigns.map(function(x){return '<tr><td><strong>'+esc(x.name)+'</strong><span class="cart-line-meta">AOV '+rupiah(x.average_order_value||0)+'</span></td><td class="c">'+angka(x.redemptions||0)+'</td><td class="c">'+angka(x.unique_customers||0)+'</td><td class="r num">'+rupiah(x.revenue||0)+'</td><td class="r num">'+rupiah(x.discount_total||0)+'</td><td class="r num">'+rupiah(x.profit_after_promo||0)+'</td><td class="r">'+(x.margin_after_promo===null?'—':x.margin_after_promo.toFixed(1)+'%')+'</td><td class="r">'+(x.roas===null?'—':x.roas.toFixed(2)+'x')+'</td><td class="r">'+(x.roi_direct===null?'—':x.roi_direct.toFixed(1)+'%')+'</td></tr>';}).join('')+'</tbody></table></div>':'<div class="empty">Belum ada data kampanye kupon.</div>';
    var bundleHtml=bundles.length?'<h4 style="margin:16px 0 8px">ROI proxy per fixed bundle</h4><div class="table-wrap"><table><thead><tr><th>Bundle</th><th class="c">Transaksi</th><th class="c">Pelanggan</th><th class="r">Pendapatan</th><th class="r">Diskon</th><th class="r">Laba</th><th class="r">Margin</th><th class="r">ROAS</th><th class="r">ROI</th></tr></thead><tbody>'+bundles.map(function(x){return '<tr><td><strong>'+esc(x.name)+'</strong><span class="cart-line-meta">AOV '+rupiah(x.average_order_value||0)+'</span></td><td class="c">'+angka(x.redemptions||0)+'</td><td class="c">'+angka(x.unique_customers||0)+'</td><td class="r num">'+rupiah(x.revenue||0)+'</td><td class="r num">'+rupiah(x.discount_total||0)+'</td><td class="r num">'+rupiah(x.profit_after_promo||0)+'</td><td class="r">'+(x.margin_after_promo===null?'—':x.margin_after_promo.toFixed(1)+'%')+'</td><td class="r">'+(x.roas===null?'—':x.roas.toFixed(2)+'x')+'</td><td class="r">'+(x.roi_direct===null?'—':x.roi_direct.toFixed(1)+'%')+'</td></tr>';}).join('')+'</tbody></table></div>':'<div class="empty">Belum ada transaksi fixed bundle.</div>';
    summary.innerHTML='<div class="crm-detail-note" style="margin-bottom:12px"><strong>Interpretasi metrik:</strong> ROI proxy berbasis subsidi diskon = laba kotor setelah promo ÷ total diskon × 100. Ringkasan ini sekarang mencakup redemption kupon dan transaksi fixed bundle; angka ini belum mengukur uplift inkremental.</div>'+campaignHtml+bundleHtml;
    var details=(r.rows||[]).map(function(x){var c=x.master_customer||{};return '<tr><td>'+tglIndo(x.redeemed_at)+'</td><td>'+esc((x.promo_campaigns&&x.promo_campaigns.name)||'—')+'</td><td><span class="chip chip-brand">'+esc((x.promo_coupons&&x.promo_coupons.code)||'—')+'</span></td><td><strong>'+esc(c.nama||'Pelanggan')+'</strong><span class="cart-line-meta">'+esc(c.nomor_wa||'')+'</span></td><td>'+esc(x.invoice_no||'—')+'</td><td class="r num">'+rupiah(x.discount_amount||0)+'</td><td><span class="chip '+(x.status==='APPLIED'?'chip-ok':'chip-warn')+'">'+esc(x.status||'—')+'</span></td></tr>';});
    details=details.concat((r.bundle_rows||[]).map(function(x){return '<tr><td>'+tglIndo(x.timestamp||x.tanggal)+'</td><td>Fixed bundle</td><td><span class="chip chip-brand">'+esc(x.bundle_code||'—')+'</span></td><td><strong>'+esc(x.nama_pelanggan||'Pelanggan')+'</strong><span class="cart-line-meta">'+esc(x.nomor_wa||'')+'</span></td><td>'+esc(x.no_nota||'—')+'</td><td class="r num">'+rupiah(x.bundle_discount||0)+'</td><td><span class="chip chip-ok">BUNDLE</span></td></tr>'; }));
    body.innerHTML=details.length?details.join(''):'<tr><td colspan="7" class="empty">Belum ada transaksi promo atau bundle.</td></tr>';
  }).catch(function(e){kpi.innerHTML='';summary.innerHTML='';body.innerHTML='<tr><td colspan="7" class="empty">'+esc(e.message)+'</td></tr>';});
}

function muatBundle(){var box=document.getElementById('crmBundleList');if(!box)return;promoApi('bundleList',{}).then(function(rows){box.innerHTML=rows.length?'<h4 style="margin:16px 0 8px">Fixed bundle SKU</h4>'+rows.map(function(b){var items=(b.promo_bundle_items||[]).map(function(i){return i.kode_obat+' ×'+i.qty;}).join(', ');return '<div class="crm-refill-item"><div class="crm-avatar small">B</div><div class="crm-refill-main"><strong>'+esc(b.name)+'</strong><span>'+esc(b.code)+' · '+rupiah(b.bundle_price)+' · '+esc(items)+'</span></div><span class="chip '+(b.status==='ACTIVE'?'chip-ok':'chip-warn')+'">'+esc(b.status)+'</span><button class="btn btn-sm" data-bundle-status="'+esc(b.id)+'" data-status="'+(b.status==='ACTIVE'?'PAUSED':'ACTIVE')+'">'+(b.status==='ACTIVE'?'Jeda':'Aktifkan')+'</button></div>';}).join(''):'<div class="empty">Belum ada fixed bundle.</div>';box.onclick=function(e){var b=e.target.closest('[data-bundle-status]');if(!b)return;promoApi('bundleStatus',{id:b.dataset.bundleStatus,status:b.dataset.status}).then(function(){toast('Status bundle diperbarui.');muatBundle();}).catch(function(err){toast(err.message,true);});};}).catch(function(e){box.innerHTML='<div class="empty">'+esc(e.message)+'</div>';});}
function formFixedBundle(){modalBuka('Buat fixed bundle SKU','<label class="field"><span>Nama bundle</span><input id="fbNama" class="inp" placeholder="Paket perawatan luka"></label><label class="field"><span>Kode bundle</span><input id="fbKode" class="inp" placeholder="BUNDLE-LUKA"></label><label class="field"><span>SKU dan kuantitas</span><input id="fbItems" class="inp" placeholder="SKU001:1, SKU002:1"><small class="sub">Pisahkan dengan koma. Server hanya menerima produk aktif golongan Bebas.</small></label><label class="field"><span>Harga paket</span><input id="fbHarga" class="inp num" type="number" min="0"></label><div class="grid g2"><label class="field"><span>Mulai</span><input id="fbMulai" class="inp" type="datetime-local"></label><label class="field"><span>Selesai</span><input id="fbSelesai" class="inp" type="datetime-local"></label></div><label class="field"><span>Deskripsi</span><input id="fbDesc" class="inp" placeholder="Bundle produk non-resep"></label>',[{label:'Batal',aksi:modalTutup},{label:'Simpan bundle',kelas:'btn-primary',aksi:function(){var items=val('fbItems').split(',').map(function(x){var p=x.trim().split(':');return {kode_obat:p[0].trim(),qty:Number(p[1]||1)};}).filter(function(x){return x.kode_obat;});promoApi('bundleSave',{name:val('fbNama'),code:val('fbKode'),items:items,bundle_price:numVal('fbHarga'),starts_at:val('fbMulai')?val('fbMulai')+':00+07:00':'',ends_at:val('fbSelesai')?val('fbSelesai')+':00+07:00':'',description:val('fbDesc'),status:'ACTIVE'}).then(function(){modalTutup();toast('Fixed bundle tersimpan.');muatBundle();}).catch(function(e){toast(e.message,true);});}}]);}

function formPromoKampanye(){
  modalBuka('Buat kampanye promo','<label class="field"><span>Nama kampanye</span><input id="pmNama" class="inp" placeholder="Promo pelanggan aktif"></label><label class="field"><span>Segmen sasaran</span><select id="pmSeg" class="inp" multiple size="5"><option>Baru</option><option>Active Routine</option><option>VIP</option><option>At-Risk</option><option>Dormant</option></select></label><div class="grid g2"><label class="field"><span>Mulai</span><input id="pmMulai" class="inp" type="datetime-local"></label><label class="field"><span>Selesai</span><input id="pmSelesai" class="inp" type="datetime-local"></label></div><label class="field"><span>Kode kupon</span><input id="pmKode" class="inp" placeholder="VIPHEMAT"></label><div class="grid g3"><label class="field"><span>Jenis</span><select id="pmJenis" class="inp"><option value="FIXED">Nominal</option><option value="PERCENT">Persentase</option></select></label><label class="field"><span>Nilai</span><input id="pmNilai" class="inp num" type="number" min="1"></label><label class="field"><span>Min. belanja</span><input id="pmMin" class="inp num" type="number" min="0" value="0"></label></div><label class="field"><span>Batas diskon persen (opsional)</span><input id="pmMax" class="inp num" type="number" min="0"></label>',[{label:'Batal',aksi:modalTutup},{label:'Simpan kampanye',kelas:'btn-primary',aksi:function(){var seg=Array.prototype.slice.call(document.getElementById('pmSeg').selectedOptions).map(function(x){return x.value;});promoApi('campaignSave',{name:val('pmNama'),segments:seg,starts_at:val('pmMulai') ? val('pmMulai') + ':00+07:00' : '',ends_at:val('pmSelesai') ? val('pmSelesai') + ':00+07:00' : '',status:'ACTIVE'}).then(function(c){return promoApi('couponSave',{campaign_id:c.id,code:val('pmKode'),discount_type:val('pmJenis'),discount_value:numVal('pmNilai'),min_purchase:numVal('pmMin'),max_discount:val('pmMax')});}).then(function(){modalTutup();toast('Kampanye dan kupon tersimpan.');muatPromo();}).catch(function(e){toast(e.message,true);});}}]);
}