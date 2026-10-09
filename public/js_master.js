/* ============================ Master Barang, Stok, Opname, CRM, User ====== */

/* ----------------------------------------------- Master Barang (Bab 4) --- */

var MARKUP_MASTER_ROWS = [];                    // barang yang termuat + harga baru yang diketik
var MARKUP_MASTER_TOTAL = 0;                    // total barang di server untuk pencarian aktif
var MARKUP_MASTER_Q = '';                       // pencarian yang sedang dipakai
var MARKUP_MASTER_OFFSET = 0;                   // offset halaman berikutnya
var MARKUP_MASTER_MUAT_KEY = '';                // tanda daftar termuat cocok dengan pencarian dan cfg
var MARKUP_MASTER_CFG = null;                   // markup bawaan cabang (kolom saran harga baru)
var MARKUP_MASTER_GOL = Object.create(null);    // kode obat -> golongan (dilengkapi dari barang.list)
var MARKUP_MASTER_GOL_HAL = 0;                  // halaman barang.list terakhir yang diambil
var MARKUP_MASTER_GOL_Q = null;                 // pemilik cache golongan
var MARKUP_MASTER_PREVIEW_REQUEST = 0;
var MARKUP_MASTER_SELECTED = Object.create(null);
var MARKUP_MASTER_SELECT_ALL = false;
var MARKUP_MASTER_SEARCH_TIMER = null;
var MARKUP_MASTER_SARAN = [];                   // daftar saran kolom pencarian yang sedang tampil
var MARKUP_MASTER_SARAN_Q = null;               // kata kunci yang sedang tampil di daftar saran
var MARKUP_MASTER_SARAN_INDEX = -1;             // sorotan papan tik (panah atas/bawah) di daftar saran
var MARKUP_MASTER_SARAN_REQUEST = 0;
var MARKUP_MASTER_SARAN_TIMER = null;           // jeda ketik sebelum saran dimuat ulang
var MARKUP_MASTER_SARAN_MUAT = null;            // kata kunci yang saran-nya sedang dimuat
var MARKUP_MASTER_SARAN_KLIK_LUAR = false;      // penjaga agar pendengar klik luar hanya dipasang sekali

VIEWS.barang = {
  title: 'Master Barang',
  render: function (el) {
    el.innerHTML =
      '<div class="card"><div class="card-head">' +
        '<h3>Katalog produk</h3>' +
        '<input id="bgCari" class="inp" style="max-width:230px" placeholder="Cari nama, kode, kategori">' +
        '<button id="bgTambah" class="btn btn-primary"><span class="hanya-desktop">Tambah barang</span><span class="hanya-hp">+ Barang</span></button>' + ((SESSION && SESSION.user && SESSION.user.role === 'Owner') ? '<button id="bgMarkup" class="btn">Terapkan markup</button>' : '') + '</div>' +
      // Di HP daftar tampil sebagai kartu (#bgKartu); tabel disembunyikan.
      '<div id="bgKartu" class="m-list hanya-hp"></div>' +
      '<div class="table-wrap hanya-desktop"><table data-tk-off="1"><thead><tr>' +
        '<th>Kode</th><th>Nama obat</th><th>Kategori</th><th class="c">Stok</th>' +
        '<th class="r" title="Modal dari pembelian terakhir, sudah termasuk PPN dan sudah dikurangi diskon pembelian.">Modal terakhir</th><th class="r">Jual umum</th><th class="r">Jual nakes</th>' +
        '<th class="r">Apotek lain</th><th class="c">PPN</th><th></th>' +
      '</tr></thead><tbody id="bgBody"></tbody></table></div>' +
      '<div id="bgPager" class="pager"></div></div>';

    document.getElementById('bgTambah').onclick = function () { formBarang(null); };
    var markup = document.getElementById('bgMarkup'); if (markup) markup.onclick = formMarkupMaster;
    var t = null;
    document.getElementById('bgCari').addEventListener('input', function () {
      clearTimeout(t); t = setTimeout(function () { muatBarang(1); }, 250);
    });
    muatBarang(1);
  }
};

/* Master Barang dibagi per halaman (100 barang/halaman) supaya tetap ringan.
   BARANG_HAL menyimpan halaman aktif; simpan/nonaktifkan memuat ulang halaman
   yang sama, pencarian kembali ke halaman 1. */
var BARANG_HAL = 1;

function muatBarang(hal) {
  if (hal) BARANG_HAL = hal;
  var tb = document.getElementById('bgBody');
  if (!tb) return;
  tb.innerHTML = '<tr><td colspan="10" class="empty">Memuat…</td></tr>';
  api('barang.list', { q: val('bgCari'), halaman: BARANG_HAL, per_halaman: 100 }).then(function (res) {
    // Halaman di luar jangkauan (mis. setelah pencarian) → kembali ke halaman terakhir.
    if (!res.rows.length && res.total > 0 && BARANG_HAL > res.jumlah_halaman) {
      muatBarang(res.jumlah_halaman); return;
    }
    var rows = res.rows;
    gambarPagerBarang(res);
    var kartu = document.getElementById('bgKartu');
    if (kartu) {
      kartu.innerHTML = rows.length ? rows.map(function (b) {
        var habis = b.stok <= 0, menipis = !habis && b.stok <= b.Stok_Min;
        var tint = b.Aktif === 'TIDAK' ? 'mati' : (habis ? 'bad' : (menipis ? 'warn' : 'ok'));
        return '<div class="m-kartu' + (b.Aktif === 'TIDAK' ? ' nonaktif' : '') + '" role="button" tabindex="0" data-edit=\'' + esc(JSON.stringify(b)) + '\'>' +
          '<span class="m-av ' + tint + '">' + esc(String(b.Nama_Obat || '?').charAt(0).toUpperCase()) + '</span>' +
          '<div class="m-nm"><b>' + esc(b.Nama_Obat) + '</b><small>' + esc(b.Kode_Obat) + (b.Kategori ? ' · ' + esc(b.Kategori) : '') + '</small></div>' +
          '<div class="m-rt"><b>' + rupiah(b.Harga_Jual_Umum) + '</b>' +
            '<button type="button" class="chip ' + (habis ? 'chip-bad' : (menipis ? 'chip-warn' : 'chip-ok')) + '" data-stok=\'' + esc(JSON.stringify({ k: b.Kode_Obat, n: b.Nama_Obat })) + '\' aria-label="Ubah stok ' + esc(b.Nama_Obat) + '">' +
            (habis ? 'Habis' : angka(b.stok) + ' ' + esc(b.Satuan || 'pcs')) + ' ✎</button></div></div>';
      }).join('') : '<div class="empty">Belum ada barang.</div>';
      kartu.onclick = function (e) {
        var st = e.target.closest('[data-stok]');
        if (st) { formStokBarang(JSON.parse(st.dataset.stok)); return; }
        var ed = e.target.closest('[data-edit]');
        if (ed) formBarang(JSON.parse(ed.dataset.edit));
      };
    }
    if (!rows.length) { tb.innerHTML = tabelKosong('Belum ada barang. Tambahkan lewat tombol di atas.', 10); return; }
    tb.innerHTML = rows.map(function (b) {
      var stokKelas = b.stok <= b.Stok_Min ? 'chip-bad' : 'chip-ok';
      return '<tr' + (b.Aktif === 'TIDAK' ? ' style="opacity:.5"' : '') + '>' +
        '<td>' + esc(b.Kode_Obat) + '</td>' +
        '<td><strong>' + esc(b.Nama_Obat) + '</strong>' +
          (b.Barcode ? '<div class="cart-line-meta">' + esc(b.Barcode) + '</div>' : '') + '</td>' +
        '<td>' + esc(b.Kategori) + '</td>' +
        '<td class="c" style="white-space:nowrap"><span class="chip ' + stokKelas + '">' + angka(b.stok) + '</span> ' +
          '<button class="btn btn-sm" data-stok=\'' + esc(JSON.stringify({ k: b.Kode_Obat, n: b.Nama_Obat })) + '\' title="Ubah stok" aria-label="Ubah stok ' + esc(b.Nama_Obat) + '">✎</button></td>' +
        '<td class="r num">' + (b.Harga_Modal == null ? '—' : rupiah(b.Harga_Modal)) + '</td>' +
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
      var st = e.target.closest('[data-stok]');
      if (st) { formStokBarang(JSON.parse(st.dataset.stok)); return; }
      var hp = e.target.closest('[data-hapus]');
      if (hp) konfirmasiNonaktif(hp.dataset.hapus);
    };
  }).catch(function (e) {
    tb.innerHTML = '<tr><td colspan="10" class="empty">' + esc(e.message) + '</td></tr>';
  });
}

/* --- Daftar kerja markup (Owner) ------------------------------------------
   Dulu panel ini menerapkan satu aturan markup borongan ke banyak barang
   sekaligus. Sekarang bentuknya daftar kerja per barang: tiap barang dapat
   disunting di tempat, modal dan margin tampil berdampingan, dan margin
   dihitung ulang setiap kali pengguna mengetik. Sumber data tetap aksi lama
   harga.markupPreview; tidak ada aksi API baru yang ditambahkan.
   Markup tombol bantu diisi per tipe pelanggan (Umum / Nakes / Apotek lain)
   dan harga hasil hitungan dikirim per tingkat lewat harga.markupTerapkan,
   karena di apotek ini markup tiap tipe pelanggan memang berbeda. */

/** Label tingkat harga. 'mutasi' ditampilkan sebagai "Apotek lain" sesuai
 *  kolom harga_jual_mutasi di Master Barang. */
function labelMarkupMaster(t) { return t === 'umum' ? 'Umum' : (t === 'nakes' ? 'Nakes' : 'Apotek lain'); }
/** Id kolom markup tombol bantu; satu kolom untuk tiap tingkat supaya Umum,
 *  Nakes, dan Apotek lain bisa diisi persen yang berbeda. */
function idPersenMarkupMaster(t) { return t === 'umum' ? 'mkPersenUmum' : (t === 'nakes' ? 'mkPersenNakes' : (t === 'mutasi' ? 'mkPersenMutasi' : null)); }
/** Markup tombol bantu untuk SATU tingkat. Tanpa argumen tingkat hasilnya null
 *  supaya satu persen tidak pernah diam-diam dipakai untuk ketiga tingkat. */
function nilaiPersenMarkupMaster(t) {
  var v = val(idPersenMarkupMaster(t)); if (v === '') return null;
  var n = Number(v);
  return isFinite(n) && n >= 0 && n <= 1000 ? n : null;
}
/** Ringkasan ketiga markup tombol bantu, mis. "Umum 40% · Nakes 10% · Apotek lain 0%". */
function teksRingkasPersenMarkupMaster() {
  return tingkatMarkupMaster().map(function (t) {
    var persen = nilaiPersenMarkupMaster(t);
    return labelMarkupMaster(t) + ' ' + (persen === null ? '—' : angka(persen)) + '%';
  }).join(' · ');
}
function teksTombolMarkupMaster() { return 'Markup ' + teksRingkasPersenMarkupMaster(); }
/** Markup bawaan cabang; dipakai harga.markupPreview untuk kolom saran harga
 *  baru (angka abu-abu) supaya Owner tahu usulan sistem. */
function cfgMarkupMaster() {
  return MARKUP_MASTER_CFG || { mode: 'persen', umum: null, nakes: null, mutasi: null, pembulatan: 100 };
}
function tingkatMarkupMaster() { return ['umum', 'nakes', 'mutasi']; }
function markupMasterKey(cfg, q, tingkat) { return JSON.stringify({ cfg: cfg, q: q, tingkat: (tingkat || []).slice().sort() }); }
/** Ambang margin (%) yang dianggap aman; bawaan 20%. */
function ambangMarkupMaster() {
  var v = val('mkAmbang'); if (v === '') return 20;
  var n = Number(v);
  return isFinite(n) && n >= 0 ? n : 20;
}
/** Margin % = (harga jual − modal) ÷ harga jual, sama dengan modul lain. */
function marginMarkupMaster(harga, modal) {
  harga = Number(harga) || 0;
  return harga > 0 && modal != null && Number(modal) > 0 ? (harga - Number(modal)) / harga * 100 : null;
}
function golonganMarkupMaster(kode) { return MARKUP_MASTER_GOL[String(kode)] || ''; }
function cariBarisMarkupMaster(kode) {
  for (var i = 0; i < MARKUP_MASTER_ROWS.length; i++) if (MARKUP_MASTER_ROWS[i].kode === kode) return MARKUP_MASTER_ROWS[i];
  return null;
}
function nilaiMarkupMaster(x, t) {
  var v = x.nilai[t];
  if (v === undefined || v === null || v === '') return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}
/** Harga untuk menghitung margin: harga baru bila sudah diisi pengguna, bila
 *  belum harga jual yang berlaku sekarang supaya barang bermargin rendah
 *  langsung terlihat pada pengurutan bawaan. */
function hargaEfektifMarkupMaster(x, t) {
  var n = nilaiMarkupMaster(x, t);
  if (n !== null) return n;
  return x.harga[t] ? Number(x.harga[t].lama) : null;
}
function marginBarisMarkupMaster(x, t) { return marginMarkupMaster(hargaEfektifMarkupMaster(x, t), x.modal); }
/** Tingkat yang harganya diisi pengguna dan berbeda dari harga sekarang. */
function tingkatBerubahMarkupMaster(x) {
  return tingkatMarkupMaster().filter(function (t) {
    var n = nilaiMarkupMaster(x, t);
    if (n === null) return false;
    return x.harga[t] ? n !== Number(x.harga[t].lama) : true;
  });
}
function marginDiBawahAmbangMarkupMaster(x, t) {
  var m = marginBarisMarkupMaster(x, t);
  return m !== null && m < ambangMarkupMaster();
}
function barisMarkupMasterBerubah() {
  return MARKUP_MASTER_ROWS.filter(function (x) { return tingkatBerubahMarkupMaster(x).length > 0; });
}
/** Margin terburuk sebuah barang; dipakai pengurutan bawaan (terendah dulu).
 *  Barang yang modalnya belum diketahui ditaruh paling akhir. */
function marginTerendahMarkupMaster(x) {
  var m = null;
  tingkatMarkupMaster().forEach(function (t) {
    var n = marginBarisMarkupMaster(x, t);
    if (n !== null && (m === null || n < m)) m = n;
  });
  return m === null ? Infinity : m;
}
function htmlIsiMarginMarkupMaster(x, t) {
  var m = marginBarisMarkupMaster(x, t);
  if (m === null) return '<span class="kpi-sub">margin —</span>';
  var kelas = m >= ambangMarkupMaster() ? 'chip-ok' : 'chip-bad';
  var kini = nilaiMarkupMaster(x, t) === null ? '<span class="kpi-sub">kini </span>' : '';
  return kini + '<span class="chip ' + kelas + '">' + m.toFixed(1).replace('.', ',') + '%</span>';
}
function htmlTingkatMarkupMaster(x, t) {
  var h = x.harga[t] || {};
  var label = labelMarkupMaster(t);
  var nilai = x.nilai[t] === undefined ? '' : String(x.nilai[t]);
  var saran = h.baru == null ? '' : String(h.baru);
  return '<label class="field" style="margin-bottom:0"><span>' + label + ' · sekarang ' + (h.lama == null ? '—' : rupiah(h.lama)) + '</span>' +
    '<input class="inp num" type="number" min="0" step="any" data-markup-harga="' + t + '" data-markup-kode-baris="' + esc(x.kode) + '" value="' + esc(nilai) + '" placeholder="' + esc(saran) + '">' +
    '<small data-markup-margin="' + t + '">' + htmlIsiMarginMarkupMaster(x, t) + '</small></label>';
}
function htmlBarisMarkupMaster(x) {
  var kode = esc(x.kode);
  return '<div data-markup-baris="' + kode + '" style="border:1px solid var(--line);border-radius:14px;padding:12px;margin-bottom:10px">' +
    '<div class="pay-row" style="justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">' +
      '<label class="kpi-sub" style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;flex:1;min-width:190px">' +
        '<input type="checkbox" data-markup-kode value="' + kode + '" style="margin-top:3px" aria-label="Pilih ' + esc(x.nama) + '">' +
        '<span><strong>' + esc(x.nama) + '</strong><br>' + kode + ' · golongan ' + esc(golonganMarkupMaster(x.kode) || '—') + '</span>' +
      '</label>' +
      '<div class="kpi-sub" style="text-align:right">Modal terakhir <strong>' + (x.modal == null ? '—' : rupiah(x.modal)) + '</strong><br>' +
        '<button type="button" class="btn btn-sm" data-markup-isi="' + kode + '">' + esc(teksTombolMarkupMaster()) + '</button></div>' +
    '</div>' +
    '<div class="grid g3">' + tingkatMarkupMaster().map(function (t) { return htmlTingkatMarkupMaster(x, t); }).join('') + '</div>' +
  '</div>';
}
function urutkanMarkupMaster(daftar) {
  var mode = val('mkUrut') || 'margin';
  var salin = daftar.slice();
  if (mode === 'nama') salin.sort(function (a, b) { return String(a.nama || '').localeCompare(String(b.nama || ''), 'id'); });
  else if (mode === 'kode') salin.sort(function (a, b) { return String(a.kode).localeCompare(String(b.kode), 'id'); });
  else if (mode === 'modal') salin.sort(function (a, b) { return (Number(b.modal) || 0) - (Number(a.modal) || 0); });
  else salin.sort(function (a, b) { return marginTerendahMarkupMaster(a) - marginTerendahMarkupMaster(b); });
  return salin;
}
function barisMarkupMasterTampil() {
  var gol = val('mkGol');
  return urutkanMarkupMaster(MARKUP_MASTER_ROWS.filter(function (x) { return !gol || golonganMarkupMaster(x.kode) === gol; }));
}
function kodeMarkupMasterTerpilih() {
  var tampil = barisMarkupMasterTampil().map(function (x) { return x.kode; });
  if (MARKUP_MASTER_SELECT_ALL) return tampil;
  return tampil.filter(function (k) { return !!MARKUP_MASTER_SELECTED[k]; });
}
/** Pilihan golongan diambil dari data yang sedang termuat. */
function perbaruiGolonganMarkupMaster() {
  var sel = document.getElementById('mkGol'); if (!sel) return;
  var tetap = sel.value, urut = ['Bebas', 'Bebas Terbatas', 'Resep', 'Khusus'], unik = [];
  MARKUP_MASTER_ROWS.forEach(function (x) { var g = golonganMarkupMaster(x.kode); if (g && unik.indexOf(g) < 0) unik.push(g); });
  unik.sort(function (a, b) {
    var ia = urut.indexOf(a), ib = urut.indexOf(b);
    if (ia < 0 && ib < 0) return a.localeCompare(b, 'id');
    if (ia < 0) return 1;
    if (ib < 0) return -1;
    return ia - ib;
  });
  sel.innerHTML = '<option value="">Semua golongan</option>' + unik.map(function (g) { return '<option value="' + esc(g) + '">' + esc(g) + '</option>'; }).join('');
  sel.value = unik.indexOf(tetap) >= 0 ? tetap : '';
}
function perbaruiTombolBantuMarkupMaster() {
  var teks = teksTombolMarkupMaster();
  Array.prototype.forEach.call(document.querySelectorAll('[data-markup-isi]'), function (b) { b.textContent = teks; });
  var borongan = document.getElementById('mkBorongan');
  if (borongan) borongan.textContent = 'Terapkan markup ' + teksRingkasPersenMarkupMaster() + ' ke baris terpilih';
}
/** Menutup panel; harga baru yang belum disimpan tidak hilang diam-diam. */
function tutupMarkupMaster() {
  var berubah = barisMarkupMasterBerubah().length;
  if (berubah && !confirm('Ada ' + angka(berubah) + ' barang dengan harga baru yang belum disimpan. Tutup dan buang perubahan itu?')) return;
  modalTutup();
}
function gambarTombolMarkupMaster() {
  var foot = document.getElementById('modalFoot'); if (!foot) return;
  foot.innerHTML = '';
  [['Tutup', tutupMarkupMaster, ''], ['Simpan harga baru', simpanMarkupMaster, 'btn-primary', 'mkApply']].forEach(function (x) {
    var b = document.createElement('button'); b.className = 'btn ' + x[2]; b.textContent = x[0]; if (x[3]) b.id = x[3]; b.onclick = x[1]; foot.appendChild(b);
  });
  sinkronkanMarkupMaster();
}
function sinkronkanMarkupMaster() {
  var box = document.getElementById('mkPreview');
  if (box) Array.prototype.forEach.call(box.querySelectorAll('[data-markup-kode]'), function (el) { el.checked = MARKUP_MASTER_SELECT_ALL || !!MARKUP_MASTER_SELECTED[el.value]; });
  var semua = document.getElementById('mkPilihSemua'); if (semua) semua.checked = MARKUP_MASTER_SELECT_ALL;
  var berubah = barisMarkupMasterBerubah(), kolom = 0, dibawah = 0, termuatBawah = 0;
  berubah.forEach(function (x) {
    var t = tingkatBerubahMarkupMaster(x);
    kolom += t.length;
    if (t.some(function (k) { return marginDiBawahAmbangMarkupMaster(x, k); })) dibawah++;
  });
  MARKUP_MASTER_ROWS.forEach(function (x) { if (marginTerendahMarkupMaster(x) < ambangMarkupMaster()) termuatBawah++; });
  var ringkas = document.getElementById('mkRingkas');
  if (ringkas) ringkas.textContent = MARKUP_MASTER_MUAT_KEY
    ? 'Menampilkan ' + angka(MARKUP_MASTER_ROWS.length) + ' dari ' + angka(MARKUP_MASTER_TOTAL) + ' barang' +
      (MARKUP_MASTER_Q ? ' untuk pencarian "' + MARKUP_MASTER_Q + '"' : '') +
      ' · ' + angka(termuatBawah) + ' di antaranya marginnya masih di bawah ambang ' + angka(ambangMarkupMaster()) + '%' +
      ' · ' + angka(berubah.length) + ' barang disunting (' + angka(kolom) + ' kolom harga)' +
      (berubah.length ? ', ' + angka(dibawah) + ' di antaranya tetap di bawah ambang' : '') + '.'
    : 'Memuat daftar barang…';
  var apply = document.querySelector('#mkApply');
  if (apply) { apply.disabled = !berubah.length; apply.textContent = berubah.length ? 'Simpan ' + angka(berubah.length) + ' barang' : 'Simpan harga baru'; }
  var borongan = document.getElementById('mkBorongan');
  if (borongan) borongan.disabled = !MARKUP_MASTER_SELECT_ALL && !Object.keys(MARKUP_MASTER_SELECTED).length;
}
function gambarMarkupMaster() {
  var box = document.getElementById('mkPreview'); if (!box) return;
  var daftar = barisMarkupMasterTampil();
  box.innerHTML = daftar.length
    ? daftar.map(htmlBarisMarkupMaster).join('')
    : '<p class="kpi-sub">' + (MARKUP_MASTER_Q ? 'Tidak ada barang yang cocok dengan pencarian dan saringan ini.' : 'Belum ada barang aktif yang bisa ditinjau di cabang ini.') + '</p>';
  perbaruiGolonganMarkupMaster();
  perbaruiTombolBantuMarkupMaster();
  var lagi = document.getElementById('mkLagi');
  if (lagi) { lagi.hidden = MARKUP_MASTER_OFFSET >= MARKUP_MASTER_TOTAL; lagi.disabled = false; lagi.textContent = 'Muat 100 barang berikutnya'; }
  sinkronkanMarkupMaster();
}
/** Golongan tidak ikut dikembalikan harga.markupPreview, jadi dilengkapi dari
 *  aksi lama barang.list (200 baris per halaman) untuk kode yang tampil. Bila
 *  gagal, daftar tetap tampil dan golongan ditulis "—". */
function lengkapiGolonganMarkupMaster(q, offset, jumlah) {
  if (MARKUP_MASTER_GOL_Q !== q) { MARKUP_MASTER_GOL_Q = q; MARKUP_MASTER_GOL_HAL = 0; MARKUP_MASTER_GOL = Object.create(null); }
  var butuh = Math.ceil((offset + Math.max(jumlah, 1)) / 200), urutan = [];
  for (var i = MARKUP_MASTER_GOL_HAL; i < butuh; i++) urutan.push(i + 1);
  if (!urutan.length) return Promise.resolve();
  return urutan.reduce(function (p, h) {
    return p.then(function () {
      return api('barang.list', { q: q, halaman: h, per_halaman: 200 }).then(function (res) {
        (res.rows || []).forEach(function (b) { MARKUP_MASTER_GOL[String(b.Kode_Obat || b.kode_obat || '')] = b.Golongan || b.golongan || ''; });
        MARKUP_MASTER_GOL_HAL = Math.max(MARKUP_MASTER_GOL_HAL, h);
      });
    });
  }, Promise.resolve()).catch(function () { /* pelengkap saja, jangan hentikan daftar */ });
}
/** Muat daftar kerja dari halaman pertama untuk pencarian yang aktif. */
function previewMarkupMaster() {
  var box = document.getElementById('mkPreview'); if (!box) return;
  MARKUP_MASTER_Q = val('mkCari');
  MARKUP_MASTER_OFFSET = 0;
  MARKUP_MASTER_MUAT_KEY = markupMasterKey(cfgMarkupMaster(), MARKUP_MASTER_Q, tingkatMarkupMaster());
  box.innerHTML = '<p class="kpi-sub">Memuat daftar barang…</p>';
  muatHalamanMarkupMaster(0, false);
}
/** Satu halaman daftar kerja (100 barang) dari aksi harga.markupPreview.
 *  `tambah` = true untuk menyambung 100 barang berikutnya di bawah daftar. */
function muatHalamanMarkupMaster(offset, tambah) {
  var box = document.getElementById('mkPreview'); if (!box) return;
  var request = ++MARKUP_MASTER_PREVIEW_REQUEST;
  if (!tambah) { MARKUP_MASTER_ROWS = []; MARKUP_MASTER_TOTAL = 0; MARKUP_MASTER_SELECTED = Object.create(null); MARKUP_MASTER_SELECT_ALL = false; }
  var q = MARKUP_MASTER_Q || '';
  var lagi = document.getElementById('mkLagi'); if (lagi) { lagi.disabled = true; lagi.textContent = 'Memuat…'; }
  api('harga.markupPreview', { q: q, offset: offset, cfg: cfgMarkupMaster() }).then(function (r) {
    if (request !== MARKUP_MASTER_PREVIEW_REQUEST) return;
    var rows = (r.rows || []).map(function (x) {
      var h = {};
      (x.harga || []).forEach(function (y) { h[y.tingkat] = y; });
      return { kode: String(x.kode_obat || ''), nama: x.nama_obat, modal: x.modal == null ? null : Number(x.modal), harga: h, nilai: {} };
    });
    MARKUP_MASTER_ROWS = tambah ? MARKUP_MASTER_ROWS.concat(rows) : rows;
    MARKUP_MASTER_TOTAL = Number(r.total) || 0;
    MARKUP_MASTER_OFFSET = offset + rows.length;
    return lengkapiGolonganMarkupMaster(q, offset, rows.length).then(function () {
      if (request !== MARKUP_MASTER_PREVIEW_REQUEST) return;
      gambarMarkupMaster();
    });
  }).catch(function (e) {
    if (request !== MARKUP_MASTER_PREVIEW_REQUEST) return;
    if (lagi) { lagi.hidden = false; lagi.disabled = false; lagi.textContent = 'Coba muat lagi'; }
    box.innerHTML = '<p class="kpi-sub">' + esc(e.message) + '</p>';
  });
}
/** Tombol bantu per baris: tiap tingkat memakai persentasenya sendiri
 *  (Umum/Nakes/Apotek lain), bukan satu persen untuk ketiganya. Tingkat yang
 *  kolom markupnya dikosongkan dilewati supaya angka yang sudah diketik tidak
 *  ikut tertimpa. */
function isiMarkupMaster(kode) {
  var x = cariBarisMarkupMaster(kode); if (!x) return;
  if (!(Number(x.modal) > 0)) { toast('Modal ' + x.kode + ' belum diketahui, jadi markup tidak bisa dihitung.', true); return; }
  // Rumus markup dipakai bersama modul Pembelian supaya angkanya identik.
  var pembulatan = Number(val('mkRound')) || 0, terisi = [];
  Array.prototype.forEach.call(document.querySelectorAll('[data-markup-harga]'), function (el) {
    if (el.getAttribute('data-markup-kode-baris') !== kode) return;
    var t = el.getAttribute('data-markup-harga');
    var persen = nilaiPersenMarkupMaster(t);
    if (persen === null) return;
    var harga = hargaDariMarkupJS(x.modal, persen, pembulatan);
    if (harga === null) return;
    el.value = String(harga);
    x.nilai[t] = String(harga);
    terisi.push(t);
    var sel = el.parentNode.querySelector('[data-markup-margin]');
    if (sel) sel.innerHTML = htmlIsiMarginMarkupMaster(x, t);
  });
  if (!terisi.length) { toast('Isi minimal satu markup tombol bantu 0–1000% lebih dulu.', true); return; }
  sinkronkanMarkupMaster();
}
/** Tombol "Markup ___%" per baris hanya mengisi kolom, tidak mengunci harga. */
function boronganMarkupMaster() {
  var terpilih = kodeMarkupMasterTerpilih();
  if (!terpilih.length) { toast('Pilih minimal satu item obat.', true); return; }
  var ada = tingkatMarkupMaster().some(function (t) { return nilaiPersenMarkupMaster(t) !== null; });
  if (!ada) { toast('Isi minimal satu markup tombol bantu 0–1000% lebih dulu.', true); return; }
  terpilih.forEach(function (kode) { isiMarkupMaster(kode); });
  toast('Markup ' + teksRingkasPersenMarkupMaster() + ' diisikan ke ' + angka(terpilih.length) + ' barang. Sesuaikan bila perlu, lalu simpan.');
}
function ketikMarkupMaster(e) {
  var inp = e.target.closest('[data-markup-harga]');
  if (!inp) return;
  var x = cariBarisMarkupMaster(inp.getAttribute('data-markup-kode-baris'));
  if (!x) return;
  var t = inp.getAttribute('data-markup-harga');
  x.nilai[t] = inp.value;
  var sel = inp.parentNode.querySelector('[data-markup-margin]');
  if (sel) sel.innerHTML = htmlIsiMarginMarkupMaster(x, t);
  sinkronkanMarkupMaster();
}
function klikMarkupMaster(e) {
  var isi = e.target.closest('[data-markup-isi]');
  if (isi) { isiMarkupMaster(isi.getAttribute('data-markup-isi')); return; }
  var cb = e.target.closest('[data-markup-kode]');
  if (!cb) return;
  if (cb.checked) MARKUP_MASTER_SELECTED[cb.value] = true;
  else {
    // Baris lain yang tadinya ikut "pilih semua" tetap tercentang.
    if (MARKUP_MASTER_SELECT_ALL) { MARKUP_MASTER_SELECT_ALL = false; barisMarkupMasterTampil().forEach(function (x) { MARKUP_MASTER_SELECTED[x.kode] = true; }); }
    delete MARKUP_MASTER_SELECTED[cb.value];
  }
  sinkronkanMarkupMaster();
}
function ubahPenyaringMarkupMaster(e) {
  var id = e && e.target ? e.target.id : '';
  if (id === 'mkRound' || id.indexOf('mkPersen') === 0) { perbaruiTombolBantuMarkupMaster(); return; }
  gambarMarkupMaster();
}
function potongMarkupMaster(a, n) {
  var hasil = [];
  for (var i = 0; i < a.length; i += n) hasil.push(a.slice(i, i + n));
  return hasil;
}
/* Menyimpan harga baru. Aksi yang ada (harga.markupTerapkan) hanya menerima
   markup persen per tingkat, bukan harga jadi per barang, jadi harga yang
   diketik dibalik dulu menjadi persen terhadap modal dan dikirim tanpa
   pembulatan supaya angkanya tersimpan tepat. Barang tanpa modal dan harga di
   luar 0–1000% markup dilewati dan dilaporkan. */
function simpanMarkupMaster() {
  var berubah = barisMarkupMasterBerubah();
  if (!berubah.length) { toast('Belum ada harga baru yang diisi.', true); return; }
  var kolom = 0, dibawah = 0, dilewati = 0, urutan = [], kelompok = Object.create(null);
  berubah.forEach(function (x) {
    var tingkat = tingkatBerubahMarkupMaster(x), set = {}, sah = true;
    if (!(Number(x.modal) > 0)) { dilewati++; return; }
    tingkat.forEach(function (t) {
      var n = nilaiMarkupMaster(x, t), persen = (n / Number(x.modal) - 1) * 100;
      // Buang noise floating point (14,999999999999991 -> 15) supaya persen di
      // log_perubahan_harga rapi dan harga yang tersimpan tetap tepat.
      persen = Math.round(persen * 1e10) / 1e10;
      if (!isFinite(persen) || persen < 0 || persen > 1000) { sah = false; return; }
      set[t] = persen;
    });
    if (!sah || !Object.keys(set).length) { dilewati++; return; }
    if (tingkat.some(function (t) { return marginDiBawahAmbangMarkupMaster(x, t); })) dibawah++;
    kolom += Object.keys(set).length;
    var kunci = tingkatMarkupMaster().filter(function (t) { return set[t] !== undefined; }).map(function (t) { return t + ':' + set[t]; }).join('|');
    if (!kelompok[kunci]) { kelompok[kunci] = { set: set, kode: [] }; urutan.push(kunci); }
    kelompok[kunci].kode.push(x.kode);
  });
  if (!urutan.length) { toast('Harga baru belum bisa disimpan: modal barang belum diketahui atau markupnya di luar 0–1000%.', true); return; }
  var barang = urutan.reduce(function (n, k) { return n + kelompok[k].kode.length; }, 0);
  var ringkas = 'Anda akan mengubah ' + angka(barang) + ' barang (' + angka(kolom) + ' kolom harga).\n\n' +
    'Di antaranya ' + angka(dibawah) + ' barang marginnya masih di bawah ambang ' + angka(ambangMarkupMaster()) + '%.\n' +
    (dilewati ? angka(dilewati) + ' barang dilewati karena modalnya belum diketahui atau markupnya di luar 0–1000%.\n' : '') +
    'Pembulatan: tanpa pembulatan, supaya harga yang Anda ketik tersimpan tepat.\n\n' +
    'Lanjutkan?';
  if (!confirm(ringkas)) return;
  var hasil = { berubah: 0, dilewati: 0, gagal: 0 }, bagian = [];
  urutan.forEach(function (k) { potongMarkupMaster(kelompok[k].kode, 200).forEach(function (kode) { bagian.push({ kode: kode, set: kelompok[k].set }); }); });
  var apply = document.querySelector('#mkApply');
  if (apply) { apply.disabled = true; apply.textContent = 'Menyimpan…'; }
  bagian.reduce(function (p, b) {
    return p.then(function () {
      var tingkat = tingkatMarkupMaster().filter(function (t) { return b.set[t] !== undefined; });
      return api('harga.markupTerapkan', { kode_obat: b.kode, tingkat: tingkat, mode: 'persen', umum: b.set.umum === undefined ? null : b.set.umum, nakes: b.set.nakes === undefined ? null : b.set.nakes, mutasi: b.set.mutasi === undefined ? null : b.set.mutasi, pembulatan: 0, sumber: 'tinjau harga master' }).then(function (r) {
        hasil.berubah += Number(r && r.berubah) || 0;
        hasil.dilewati += Number(r && r.dilewati) || 0;
      }).catch(function (e) { hasil.gagal += 1; hasil.pesan = e.message; });
    });
  }, Promise.resolve()).then(function () {
    modalTutup();
    toast('Markup selesai. Harga berubah: ' + angka(hasil.berubah) + '; dilewati: ' + angka(hasil.dilewati) + '.' + (hasil.gagal ? ' ' + angka(hasil.gagal) + ' kiriman gagal: ' + hasil.pesan : ''));
    muatBarang();
  });
}
/** Bawaan markup cabang mengisi kolom saran dan markup tombol bantu tiap
 *  tingkat: Umum, Nakes, dan Apotek lain punya nilai tersendiri dari
 *  pengaturan_harga (markup_umum_persen, markup_nakes_persen,
 *  markup_mutasi_persen). */
function muatPengaturanMarkupMaster() {
  api('harga.pengaturan', {}).then(function (r) {
    if (!r.tersedia) throw new Error(r.pesan);
    var c = r.pengaturan || {}, bulat = Number(c.pembulatan);
    MARKUP_MASTER_CFG = { mode: 'persen', umum: c.markup_umum_persen == null ? null : Number(c.markup_umum_persen), nakes: c.markup_nakes_persen == null ? null : Number(c.markup_nakes_persen), mutasi: c.markup_mutasi_persen == null ? null : Number(c.markup_mutasi_persen), pembulatan: [0, 100, 500, 1000].indexOf(bulat) >= 0 ? bulat : 100 };
    tingkatMarkupMaster().forEach(function (t) {
      var el = document.getElementById(idPersenMarkupMaster(t));
      if (el && MARKUP_MASTER_CFG[t] != null) el.value = String(MARKUP_MASTER_CFG[t]);
    });
    var round = document.getElementById('mkRound'); if (round) round.value = String(MARKUP_MASTER_CFG.pembulatan);
    perbaruiTombolBantuMarkupMaster();
  }).catch(function (e) {
    MARKUP_MASTER_CFG = { mode: 'persen', umum: null, nakes: null, mutasi: null, pembulatan: 100 };
    toast(e.message, true);
  }).then(function () { previewMarkupMaster(); });
}
/* Pencarian barang bergaya kasir. Kolom "Cari nama atau kode" membuka daftar
   saran tepat di bawahnya begitu diklik — dan saat pengguna mengetik — jadi
   tidak perlu menunggu dua karakter seperti penyaring tabel di bawahnya.
   Fokus saja TIDAK membuka daftar: modalBuka() memfokuskan kolom pertama, jadi
   kalau fokus ikut membuka, daftar kerja barang tertutup saran begitu panel
   dibuka. Polanya disalin dari pencarian obat di kasir (posSuggest,
   js_pos.js:225-314) dan pencarian barang di Pembelian (beliSuggest,
   js_trx.js:275-314): wadah .suggest dengan tombol .s-name / .s-meta, panah
   atas-bawah, Enter, Esc, dan klik di luar. Sumber datanya aksi lama
   barang.list, jadi tidak ada aksi API baru. */
function kotakSaranMarkupMaster() { return document.getElementById('mkSuggest'); }
function tutupSaranMarkupMaster() {
  var box = kotakSaranMarkupMaster();
  if (box) box.hidden = true;
  MARKUP_MASTER_SARAN = [];
  MARKUP_MASTER_SARAN_Q = null;
  MARKUP_MASTER_SARAN_INDEX = -1;
}
/** Baris kerja sebuah saran. Bila barangnya sudah termuat di daftar kerja,
 *  pakai baris itu supaya modal dan marginnya sama dengan isi tabel —
 *  termasuk harga baru yang sedang diketik. */
function barisSaranMarkupMaster(b) {
  var kode = String(b.Kode_Obat || b.kode_obat || '');
  var ada = cariBarisMarkupMaster(kode);
  if (ada) return ada;
  var modal = b.Harga_Modal;
  return {
    kode: kode, nama: b.Nama_Obat || b.nama_obat || kode,
    modal: modal === null || modal === undefined || modal === '' ? null : Number(modal),
    harga: {
      umum: { lama: Number(b.Harga_Jual_Umum) || 0 },
      nakes: { lama: Number(b.Harga_Khusus) || 0 },
      mutasi: { lama: Number(b.Harga_Jual_Mutasi) || 0 }
    },
    nilai: {}
  };
}
function htmlSaranMarkupMaster(b, i) {
  var x = barisSaranMarkupMaster(b);
  var margin = marginTerendahMarkupMaster(x);
  var stok = b.stok;
  return '<button type="button" data-mk-saran="' + i + '"' + (i === MARKUP_MASTER_SARAN_INDEX ? ' class="is-cursor"' : '') + '>' +
    '<div class="s-name">' + esc(x.nama) + '</div>' +
    '<div class="s-meta"><span>' + esc(x.kode) + '</span>' +
      '<span>Stok ' + (stok === null || stok === undefined ? '—' : angka(stok)) + '</span>' +
      '<span>Modal terakhir ' + (x.modal === null ? '—' : rupiah(x.modal)) + '</span>' +
      '<span>Margin terendah ' + (isFinite(margin) ? margin.toFixed(1).replace('.', ',') + '%' : '—') + '</span>' +
    '</div></button>';
}
function tampilkanSaranMarkupMaster(rows, q) {
  var box = kotakSaranMarkupMaster(); if (!box) return;
  MARKUP_MASTER_SARAN = (rows || []).slice(0, 8);
  MARKUP_MASTER_SARAN_Q = q;
  MARKUP_MASTER_SARAN_INDEX = -1;
  box.innerHTML = MARKUP_MASTER_SARAN.length
    ? MARKUP_MASTER_SARAN.map(htmlSaranMarkupMaster).join('')
    : '<div class="empty">Tidak ada barang cocok.</div>';
  box.hidden = false;
}
/** Muat saran untuk isi kolom saat ini. Dipanggil saat kolom diklik (langsung)
 *  dan saat mengetik (lewat jeda jadwalkanSaranMarkupMaster). */
function muatSaranMarkupMaster() {
  var box = kotakSaranMarkupMaster(); if (!box) return;
  var q = val('mkCari');
  if (!box.hidden && MARKUP_MASTER_SARAN_Q === q) return;   // sudah tampil untuk kata kunci ini
  if (MARKUP_MASTER_SARAN_MUAT === q) return;               // permintaan yang sama masih jalan
  MARKUP_MASTER_SARAN_MUAT = q;
  var request = ++MARKUP_MASTER_SARAN_REQUEST;
  api('barang.list', { q: q }).then(function (rows) {
    if (request !== MARKUP_MASTER_SARAN_REQUEST) return;
    MARKUP_MASTER_SARAN_MUAT = null;
    tampilkanSaranMarkupMaster(rows, q);
  }).catch(function (e) {
    if (request !== MARKUP_MASTER_SARAN_REQUEST) return;
    MARKUP_MASTER_SARAN_MUAT = null;
    tutupSaranMarkupMaster();
    toast(e.message, true);
  });
}
function jadwalkanSaranMarkupMaster() {
  if (MARKUP_MASTER_SARAN_TIMER) { clearTimeout(MARKUP_MASTER_SARAN_TIMER); MARKUP_MASTER_SARAN_TIMER = null; }
  MARKUP_MASTER_SARAN_TIMER = setTimeout(function () { MARKUP_MASTER_SARAN_TIMER = null; muatSaranMarkupMaster(); }, 180);
}
/** Klik saran: kolom diisi kode barang, barisnya dimunculkan di daftar kerja,
 *  lalu daftar saran ditutup. */
function pilihSaranMarkupMaster(i) {
  var b = MARKUP_MASTER_SARAN[i]; if (!b) return;
  var kode = String(b.Kode_Obat || b.kode_obat || '');
  var inp = document.getElementById('mkCari');
  if (inp) inp.value = kode;
  tutupSaranMarkupMaster();
  previewMarkupMaster();
}
function klikSaranMarkupMaster(e) {
  var b = e && e.target && e.target.closest ? e.target.closest('[data-mk-saran]') : null;
  if (b) pilihSaranMarkupMaster(Number(b.dataset.mkSaran));
}
/** Papan tik saat daftar saran terbuka. Esc hanya menutup daftar saran dan
 *  tidak diteruskan, supaya panel tidak ikut tertutup oleh pintasan js_core. */
function tombolSaranMarkupMaster(e) {
  var box = kotakSaranMarkupMaster();
  if (!box || box.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!MARKUP_MASTER_SARAN.length) return;
    e.preventDefault();
    var n = MARKUP_MASTER_SARAN.length, d = e.key === 'ArrowDown' ? 1 : -1;
    MARKUP_MASTER_SARAN_INDEX = (MARKUP_MASTER_SARAN_INDEX + d + n) % n;
    var tombol = box.querySelectorAll ? box.querySelectorAll('[data-mk-saran]') : [];
    Array.prototype.forEach.call(tombol, function (t, i) { if (t.classList) t.classList.toggle('is-cursor', i === MARKUP_MASTER_SARAN_INDEX); });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    pilihSaranMarkupMaster(MARKUP_MASTER_SARAN_INDEX >= 0 ? MARKUP_MASTER_SARAN_INDEX : 0);
  } else if (e.key === 'Escape') {
    if (e.stopPropagation) e.stopPropagation();
    tutupSaranMarkupMaster();
  }
}
function formMarkupMaster() {
  MARKUP_MASTER_ROWS = [];
  MARKUP_MASTER_TOTAL = 0;
  MARKUP_MASTER_Q = '';
  MARKUP_MASTER_OFFSET = 0;
  MARKUP_MASTER_MUAT_KEY = '';
  MARKUP_MASTER_SELECTED = Object.create(null);
  MARKUP_MASTER_SELECT_ALL = false;
  MARKUP_MASTER_GOL = Object.create(null);
  MARKUP_MASTER_GOL_HAL = 0;
  MARKUP_MASTER_GOL_Q = null;
  if (MARKUP_MASTER_SEARCH_TIMER) { clearTimeout(MARKUP_MASTER_SEARCH_TIMER); MARKUP_MASTER_SEARCH_TIMER = null; }
  if (MARKUP_MASTER_SARAN_TIMER) { clearTimeout(MARKUP_MASTER_SARAN_TIMER); MARKUP_MASTER_SARAN_TIMER = null; }
  MARKUP_MASTER_SARAN_REQUEST++;
  MARKUP_MASTER_SARAN_MUAT = null;
  MARKUP_MASTER_SARAN = [];
  MARKUP_MASTER_SARAN_Q = null;
  MARKUP_MASTER_SARAN_INDEX = -1;
  var body = '<p class="kpi-sub">Harga jual berlaku per SKU dan tersimpan di Master Barang. Modal terakhir sudah termasuk PPN dan sudah dikurangi diskon pembelian. Isi kolom harga baru per tingkat; margin dihitung langsung dan hijau bila mencapai ambang. Angka abu-abu pada kolom harga baru adalah saran dari markup bawaan cabang dan baru tersimpan bila Anda mengisinya. Markup tombol bantu diisi terpisah untuk <strong>Umum</strong>, <strong>Nakes</strong>, dan <strong>Apotek lain</strong>, jadi tiap tingkat memakai persentasenya sendiri; kolom yang dikosongkan dilewati.</p>' +
    '<div class="grid g3">' +
      '<div class="field mk-cari"><span>Cari nama atau kode</span><input id="mkCari" class="inp" placeholder="Nama atau kode obat" autocomplete="off"><div id="mkSuggest" class="suggest mk-suggest" hidden></div></div>' +
      '<label class="field"><span>Golongan</span><select id="mkGol" class="inp"><option value="">Semua golongan</option></select></label>' +
      '<label class="field"><span>Ambang margin (%)</span><input id="mkAmbang" class="inp num" type="number" min="0" step="any" value="20"></label>' +
    '</div>' +
    '<div class="grid g3">' +
      '<label class="field"><span>Markup Umum (%)</span><input id="mkPersenUmum" class="inp num" type="number" min="0" max="1000" step="any" value="20"></label>' +
      '<label class="field"><span>Markup Nakes (%)</span><input id="mkPersenNakes" class="inp num" type="number" min="0" max="1000" step="any" value="20"></label>' +
      '<label class="field"><span>Markup Apotek lain (%)</span><input id="mkPersenMutasi" class="inp num" type="number" min="0" max="1000" step="any" value="20"></label>' +
    '</div>' +
    '<div class="grid g2">' +
      '<label class="field"><span>Pembulatan tombol bantu</span><select id="mkRound" class="inp"><option value="0">Tanpa pembulatan</option><option value="100" selected>Ke atas Rp100</option><option value="500">Ke atas Rp500</option><option value="1000">Ke atas Rp1.000</option></select></label>' +
      '<label class="field"><span>Urutkan</span><select id="mkUrut" class="inp"><option value="margin">Margin terendah lebih dulu</option><option value="nama">Nama A–Z</option><option value="kode">Kode A–Z</option><option value="modal">Modal terbesar</option></select></label>' +
    '</div>' +
    '<div class="pay-row" style="justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
      '<label class="kpi-sub" style="display:flex;align-items:center;gap:6px"><input id="mkPilihSemua" type="checkbox"> Pilih semua baris yang tampil</label>' +
      '<button id="mkBorongan" type="button" class="btn btn-sm" title="Terapkan item terpilih; harga masih bisa disesuaikan sebelum disimpan.">Terapkan markup Umum 20% · Nakes 20% · Apotek lain 20% ke baris terpilih</button>' +
    '</div>' +
    '<p class="kpi-sub" id="mkRingkas">Memuat…</p>' +
    '<div id="mkPreview"><p class="kpi-sub">Memuat daftar barang…</p></div>' +
    '<div class="pay-row" style="justify-content:center;margin-top:10px"><button id="mkLagi" type="button" class="btn btn-sm" hidden>Muat 100 barang berikutnya</button></div>';
  modalBuka('Barang perlu ditinjau', body, []);
  gambarTombolMarkupMaster();
  ['mkGol', 'mkUrut', 'mkRound', 'mkAmbang'].concat(tingkatMarkupMaster().map(idPersenMarkupMaster)).forEach(function (id) {
    var el = document.getElementById(id);
    if (el) { el.oninput = ubahPenyaringMarkupMaster; el.onchange = ubahPenyaringMarkupMaster; }
  });
  document.getElementById('mkCari').oninput = function () {
    if (MARKUP_MASTER_SEARCH_TIMER) { clearTimeout(MARKUP_MASTER_SEARCH_TIMER); MARKUP_MASTER_SEARCH_TIMER = null; }
    jadwalkanSaranMarkupMaster();     // daftar saran menyempit mengikuti ketikan
    var query = val('mkCari');
    if (query.length < 2 && query.length > 0) {
      var ringkas = document.getElementById('mkRingkas');
      if (ringkas) ringkas.textContent = 'Ketik minimal 2 karakter untuk mencari nama atau kode obat. Daftar di bawah belum disaring.';
      return;
    }
    MARKUP_MASTER_SEARCH_TIMER = setTimeout(function () { MARKUP_MASTER_SEARCH_TIMER = null; previewMarkupMaster(); }, 350);
  };
  // Klik pada kolom (atau ketikan) membuka daftar saran di bawahnya; fokus
  // saja tidak, supaya daftar kerja langsung terlihat saat panel dibuka.
  document.getElementById('mkCari').onclick = muatSaranMarkupMaster;
  document.getElementById('mkCari').onkeydown = tombolSaranMarkupMaster;
  document.getElementById('mkSuggest').onclick = klikSaranMarkupMaster;
  if (!MARKUP_MASTER_SARAN_KLIK_LUAR && document.addEventListener) {
    MARKUP_MASTER_SARAN_KLIK_LUAR = true;
    document.addEventListener('click', function (e) {
      var dalam = e && e.target && e.target.closest ? e.target.closest('.mk-cari') : null;
      if (!dalam) tutupSaranMarkupMaster();
    });
  }
  document.getElementById('mkPilihSemua').onchange = function () {
    MARKUP_MASTER_SELECT_ALL = this.checked;
    if (this.checked) MARKUP_MASTER_SELECTED = Object.create(null);
    sinkronkanMarkupMaster();
  };
  document.getElementById('mkBorongan').onclick = boronganMarkupMaster;
  document.getElementById('mkLagi').onclick = function () {
    // Penyaring atau pencarian berubah sejak daftar dimuat: muat ulang dari awal.
    if (markupMasterKey(cfgMarkupMaster(), MARKUP_MASTER_Q, tingkatMarkupMaster()) !== MARKUP_MASTER_MUAT_KEY) { previewMarkupMaster(); return; }
    muatHalamanMarkupMaster(MARKUP_MASTER_OFFSET, true);
  };
  document.getElementById('mkPreview').onclick = klikMarkupMaster;
  document.getElementById('mkPreview').oninput = ketikMarkupMaster;
  muatPengaturanMarkupMaster();
}

/* Ubah stok langsung dari Master Barang. Perubahan disimpan lewat stokopname
   (opname.simpan), bukan menimpa batch diam-diam, supaya setiap koreksi tercatat
   di riwayat Stokopname: stok sistem, stok fisik, selisih, alasan, petugas. */
function formStokBarang(info) {
  var kode = String(info.k || '');
  var nama = info.n || kode;
  modalBuka('Ubah stok ' + nama, '<p class="kpi-sub">Memuat…</p>', [{ label: 'Tutup', aksi: modalTutup }]);
  api('stok.list', { kode_obat: kode, semua: true, kritis: false }).then(function (res) {
    var rows = res.rows || [];
    var batch = rows.filter(function (r) { return !r.Belum_Ada_Batch && String(r.Kode_Obat || '') === kode; });
    if (!batch.length) {
      modalBuka('Ubah stok ' + nama,
        '<p class="kpi-sub">Barang ini belum punya batch, jadi stoknya 0. ' +
        'Tambahkan batch dulu lewat menu <strong>Stok &amp; Batch</strong>.</p>',
        [{ label: 'Tutup', aksi: modalTutup }]);
      return;
    }
    var body =
      '<p class="kpi-sub" style="margin-top:0">Isi stok fisik tiap batch. Hanya batch yang berubah yang disimpan, ' +
        'dan setiap perubahan tercatat di riwayat Stokopname.</p>' +
      '<div class="table-wrap"><table><thead><tr><th>Kode batch</th><th>Kedaluwarsa</th>' +
        '<th class="c">Stok sistem</th><th class="c">Stok fisik</th><th class="c">Selisih</th></tr></thead><tbody>' +
      batch.map(function (s, i) {
        var sistem = Number(s.Stok_Real) || 0;
        return '<tr>' +
          '<td><strong>' + esc(s.Kode_Batch) + '</strong></td>' +
          '<td>' + tglIndo(s.Expired_Date) + '</td>' +
          '<td class="c num">' + angka(sistem) + '</td>' +
          '<td class="c"><input id="stkV' + i + '" class="inp num" type="number" min="0" step="1" style="width:90px" ' +
            'value="' + sistem + '" data-sistem="' + sistem + '" data-batch="' + esc(s.Kode_Batch) + '" ' +
            'aria-label="Stok fisik batch ' + esc(s.Kode_Batch) + '"></td>' +
          '<td class="c num" id="stkS' + i + '">0</td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<label class="field" style="margin-top:10px"><span>Alasan perubahan</span>' +
        '<input id="stkAlasan" class="inp" placeholder="cth: hitung ulang rak, barang rusak, salah input"></label>';
    modalBuka('Ubah stok ' + nama, body, [
      { label: 'Batal', aksi: modalTutup },
      { label: 'Simpan stok', kelas: 'btn-primary', aksi: function () { simpanStokBarang(kode, this); } }
    ]);
    document.getElementById('modalBody').oninput = function (e) {
      var inp = e.target.closest('input[id^="stkV"]');
      if (!inp) return;
      var sel = (Number(inp.value) || 0) - Number(inp.dataset.sistem);
      var sel_el = document.getElementById('stkS' + inp.id.slice(4));
      sel_el.textContent = (sel > 0 ? '+' : '') + angka(sel);
      sel_el.style.color = sel < 0 ? 'var(--bad)' : (sel > 0 ? 'var(--ok)' : '');
    };
  }).catch(function (e) {
    modalBuka('Ubah stok ' + nama, '<p class="kpi-sub">' + esc(e.message) + '</p>', [{ label: 'Tutup', aksi: modalTutup }]);
  });
}

function simpanStokBarang(kode, tombol) {
  var inputs = [].slice.call(document.querySelectorAll('#modalBody input[id^="stkV"]'));
  var ubah = [];
  for (var i = 0; i < inputs.length; i++) {
    var n = Number(inputs[i].value);
    if (inputs[i].value === '' || !isFinite(n) || n < 0 || Math.floor(n) !== n) {
      toast('Stok fisik harus bilangan bulat nol atau lebih.', true); inputs[i].focus(); return;
    }
    if (n !== Number(inputs[i].dataset.sistem)) ubah.push({ batch: inputs[i].dataset.batch, fisik: n });
  }
  if (!ubah.length) { modalTutup(); toast('Tidak ada stok yang berubah.'); return; }
  var alasan = val('stkAlasan');
  if (!alasan) { toast('Alasan perubahan wajib diisi.', true); document.getElementById('stkAlasan').focus(); return; }
  if (tombol) { tombol.disabled = true; tombol.textContent = 'Menyimpan…'; }
  // Disimpan satu per satu supaya kalau ada yang gagal, jelas batch mana.
  var selesai = 0;
  ubah.reduce(function (p, u) {
    return p.then(function () {
      return api('opname.simpan', {
        Kode_Obat: kode, Kode_Batch: u.batch, Stok_Fisik: u.fisik,
        Keterangan: 'Ubah stok dari Master Barang: ' + alasan
      }).then(function () { selesai++; });
    });
  }, Promise.resolve()).then(function () {
    modalTutup(); toast('Stok diperbarui (' + selesai + ' batch).'); muatBarang();
  }).catch(function (e) {
    toast('Gagal di batch ke-' + (selesai + 1) + ': ' + e.message +
      (selesai ? ' (' + selesai + ' batch sebelumnya sudah tersimpan)' : ''), true);
    if (tombol) { tombol.disabled = false; tombol.textContent = 'Simpan stok'; }
    if (selesai) muatBarang();
  });
}

function gambarPagerBarang(res) {
  var el = document.getElementById('bgPager');
  if (!el) return;
  if (!res.total) { el.innerHTML = ''; return; }
  var hal = res.halaman, n = res.jumlah_halaman;
  var awal = (hal - 1) * res.per_halaman + 1;
  var akhir = Math.min(hal * res.per_halaman, res.total);
  // Nomor halaman: 1, …, sekitar halaman aktif, …, terakhir
  var nomor = [];
  for (var i = 1; i <= n; i++) {
    if (i === 1 || i === n || Math.abs(i - hal) <= 1) nomor.push(i);
    else if (nomor[nomor.length - 1] !== '…') nomor.push('…');
  }
  el.innerHTML =
    '<span class="sub">' + angka(awal) + '–' + angka(akhir) + ' dari ' + angka(res.total) + ' barang</span>' +
    '<span class="pager-tombol">' +
      '<button class="btn btn-sm" data-hal="' + (hal - 1) + '"' + (hal <= 1 ? ' disabled' : '') + '>‹ Sebelumnya</button>' +
      nomor.map(function (x) {
        return x === '…'
          ? '<span class="sub">…</span>'
          : '<button class="btn btn-sm' + (x === hal ? ' btn-primary' : '') + '" data-hal="' + x + '">' + x + '</button>';
      }).join('') +
      '<button class="btn btn-sm" data-hal="' + (hal + 1) + '"' + (hal >= n ? ' disabled' : '') + '>Berikutnya ›</button>' +
    '</span>';
  el.onclick = function (e) {
    var b = e.target.closest('[data-hal]');
    if (!b || b.disabled) return;
    muatBarang(Number(b.dataset.hal));
    var tabel = document.getElementById('bgBody');
    if (tabel && tabel.closest('.card')) tabel.closest('.card').scrollIntoView({ block: 'start' });
  };
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
    // Golongan kosong ditampilkan apa adanya ("belum diisi"), bukan otomatis
    // terlihat "Bebas" — sebelumnya menyesatkan karena browser memilih opsi pertama.
    '<label class="field"><span>Golongan</span><select id="fbGol" class="inp" data-seg="1">' +
      (['Bebas', 'Bebas Terbatas', 'Resep', 'Khusus'].indexOf(b.Golongan) < 0
        ? '<option value="" selected disabled>— Belum diisi, pilih golongan —</option>' : '') +
      ['Bebas', 'Bebas Terbatas', 'Resep', 'Khusus'].map(function (g) {
        return '<option value="' + g + '"' + (b.Golongan === g ? ' selected' : '') + '>' + g + '</option>';
      }).join('') + '</select></label>' +
    '<div class="grid g2">' +
      '<label class="field"><span>Harga modal (beli)</span><input id="fbModal" class="inp num" type="number" value="' +
        (b.Harga_Modal == null ? '' : b.Harga_Modal) + '"></label>' +
      '<label class="field"><span>Harga jual umum</span><input id="fbUmum" class="inp num" type="number" value="' +
        (b.Harga_Jual_Umum || 0) + '"></label>' +
      '<label class="field"><span>Harga khusus (nakes)</span><input id="fbKhusus" class="inp num" type="number" value="' +
        (b.Harga_Khusus || 0) + '"></label>' +
      '<label class="field"><span>Harga jual mutasi (apotek lain)</span><input id="fbMutasi" class="inp num" type="number" value="' +
        (b.Harga_Jual_Mutasi || 0) + '"></label>' +
    '</div>' +
    '<label class="field"><span>PPN (%)</span><input id="fbPPN" class="inp num" type="number" value="' + (b.PPN || 0) + '"></label>' +
    '<p class="kpi-sub">Harga khusus dan harga mutasi juga bisa diisi dari faktur pembelian — ' +
      'nilainya hanya ditimpa bila kolom itu diisi (lebih dari 0) pada faktur.</p>' +
    (edit ? '<p class="kpi-sub">Status barang: ' +
      (b.Aktif === 'TIDAK'
        ? '<span class="chip chip-bad">Nonaktif</span> — tidak muncul di kasir.'
        : '<span class="chip chip-ok">Aktif</span> — muncul di kasir.') +
      ' Menyimpan perubahan <strong>tidak</strong> mengubah status ini.</p>' : '') +
    (edit ? '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">' +
      (b.Aktif === 'TIDAK'
        ? '<button type="button" class="btn btn-sm" id="fbAktifkan">Aktifkan kembali</button>'
        : '<button type="button" class="btn btn-sm btn-danger" id="fbNonaktif">Nonaktifkan barang</button>') +
      '<button type="button" class="btn btn-sm btn-danger" id="fbHapus">Hapus permanen</button>' +
      '</div>' : ''),
    [
      { label: 'Batal', aksi: modalTutup },
      { label: edit ? 'Simpan perubahan' : 'Simpan barang', kelas: 'btn-primary', aksi: function () {
          if (!val('fbGol')) { toast('Pilih golongan obat terlebih dahulu.', true); return; }
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
  var nonaktif = document.getElementById('fbNonaktif');
  if (nonaktif) nonaktif.onclick = function () { modalTutup(); konfirmasiNonaktif(b.Kode_Obat); };
  var aktifkan = document.getElementById('fbAktifkan');
  if (aktifkan) aktifkan.onclick = function () { modalTutup(); konfirmasiAktifkan(b.Kode_Obat, b.Nama_Obat); };
  var hapus = document.getElementById('fbHapus');
  if (hapus) hapus.onclick = function () { modalTutup(); konfirmasiHapusPermanen(b.Kode_Obat, b.Nama_Obat); };
}

function konfirmasiAktifkan(kode, nama) {
  modalBuka('Aktifkan kembali barang',
    '<p>Barang <strong>' + esc(nama || kode) + '</strong> akan muncul kembali di katalog dan kasir.</p>',
    [
      { label: 'Batal', aksi: modalTutup },
      { label: 'Aktifkan', kelas: 'btn-primary', aksi: function () {
          api('barang.aktifkan', { Kode_Obat: kode }).then(function () {
            modalTutup(); toast('Barang diaktifkan kembali.'); muatBarang();
          }).catch(function (e) { toast(e.message, true); });
        } }
    ]);
}

function konfirmasiHapusPermanen(kode, nama) {
  modalBuka('Hapus permanen',
    '<p>Barang <strong>' + esc(nama || kode) + '</strong> akan <strong>dihapus dari master</strong>, bukan sekadar dinonaktifkan.</p>' +
    '<p class="kpi-sub">Hanya bisa dilakukan kalau barang belum pernah dipakai: tidak ada stok, ' +
      'tidak ada riwayat penjualan, pembelian, retur, paket promo, maupun program refill. ' +
      'Kalau sudah dipakai, pakai <strong>Nonaktifkan</strong> supaya catatan lama tetap utuh.</p>',
    [
      { label: 'Batal', aksi: modalTutup },
      { label: 'Hapus permanen', kelas: 'btn-danger', aksi: function () {
          api('barang.hapusPermanen', { Kode_Obat: kode }).then(function () {
            modalTutup(); toast('Barang dihapus permanen.'); muatBarang();
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

var STOK_OFFSET = 0;
var STOK_LIMIT = 50;

VIEWS.stok = {
  title: 'Stok & Batch',
  render: function (el) {
    el.innerHTML =
      '<div class="card"><div class="card-head">' +
        '<h3>Stok per batch</h3>' +
        '<select id="stCariJenis" class="inp" aria-label="Jenis pencarian stok"><option value="barang">Nama/kode barang</option><option value="batch">Kode batch</option></select>' +
        '<input id="stCari" class="inp st-filter-search" placeholder="Cari nama atau kode barang">' +
        '<select id="stStatus" class="inp st-filter-select" aria-label="Filter status stok">' +
          '<option value="semua">Semua status</option><option value="tersedia">Ada stok</option><option value="habis">Stok habis</option>' +
        '</select>' +
        '<select id="stUrut" class="inp st-filter-select" aria-label="Urutkan stok">' +
          '<option value="nama">Nama A–Z</option><option value="stok_asc">Stok paling sedikit</option>' +
          '<option value="stok_desc">Stok paling banyak</option><option value="expired_asc">Kedaluwarsa terdekat</option>' +
          '<option value="terbaru">Batch terbaru</option>' +
        '</select>' +
        '<label class="chip st-filter-check" style="cursor:pointer"><input id="stKritis" type="checkbox" style="margin-right:5px">' +
          'Segera kedaluwarsa</label>' +
        '<label class="chip st-filter-check" style="cursor:pointer" title="Baris dengan stok 0 tidak ditampilkan"><input id="stKosong" type="checkbox" checked style="margin-right:5px">' +
          'Sembunyikan stok kosong</label>' +
        '<button id="stTambah" class="btn btn-primary">Tambah batch</button></div>' +
      '<p id="stHint" class="kpi-sub st-filter-hint" style="margin-top:0">Semua barang master cabang ini ditampilkan; barang tanpa batch memiliki stok 0.</p>' +
      '<div class="st-legend" aria-label="Keterangan margin"><span><i class="st-dot st-dot-ok"></i>Margin tersedia</span><span><i class="st-dot st-dot-bad"></i>Margin negatif</span><span><i class="st-dot st-dot-muted"></i>Belum tersedia</span></div>' +
      '<div class="table-wrap"><table data-tk="1" data-stok-table="1"><thead><tr>' +
        '<th>Obat</th><th>Kode batch / status</th><th>Kedaluwarsa</th><th>Sisa waktu</th>' +
        '<th class="c">Stok</th><th class="r" title="Biaya modal efektif untuk batch ini setelah PPN dan diskon">Modal efektif batch</th><th class="r" title="(Harga jual SKU − modal batch) ÷ harga jual SKU">Margin batch</th><th></th>' +
      '</tr></thead><tbody id="stBody"></tbody></table></div><div id="stPager" class="pager"></div></div>';

    document.getElementById('stTambah').onclick = function () { formBatch(null); };
    document.getElementById('stKritis').onchange = function () { muatStok(0); };
    document.getElementById('stKosong').onchange = function () { muatStok(0); };
    document.getElementById('stStatus').onchange = function () { muatStok(0); };
    document.getElementById('stUrut').onchange = function () { muatStok(0); };
    document.getElementById('stCariJenis').onchange = function () {
      document.getElementById('stCari').placeholder = val('stCariJenis') === 'batch' ? 'Cari kode batch' : 'Cari nama atau kode barang';
      muatStok(0);
    };
    var t = null;
    document.getElementById('stCari').addEventListener('input', function () {
      clearTimeout(t); t = setTimeout(function () { muatStok(0); }, 250);
    });
    muatStok(0);
  }
};

function muatStok(offset) {
  if (typeof offset === 'number') STOK_OFFSET = Math.max(0, offset);
  var tb = document.getElementById('stBody');
  if (!tb) return;
  var status = val('stStatus') || 'semua', sort = val('stUrut') || 'nama';
  var hint = document.getElementById('stHint');
  if (hint) hint.textContent = sort === 'nama' && status === 'semua' && !document.getElementById('stKritis').checked
    ? 'Semua barang master cabang ini ditampilkan; barang tanpa batch memiliki stok 0.'
    : 'Filter dan urutan diterapkan pada seluruh hasil batch, bukan hanya halaman yang terlihat.';
  tb.innerHTML = '<tr><td colspan="9" class="empty">Memuat…</td></tr>';
  api('stok.list', { q: val('stCari'), jenis: val('stCariJenis') || 'barang', kritis: document.getElementById('stKritis').checked, status: status, sort: sort, limit: STOK_LIMIT, offset: STOK_OFFSET })
    .then(function (res) {
      var rows = res.rows || [];
      if (!rows.length && res.total > 0 && STOK_OFFSET >= res.total) {
        muatStok(Math.floor((res.total - 1) / STOK_LIMIT) * STOK_LIMIT); return;
      }
      var sembunyikanKosong = document.getElementById('stKosong').checked;
      var tersembunyi = 0;
      var baris = rows.filter(function (s) {
        if (!sembunyikanKosong) return true;
        var kosong = Number(s.Stok_Real || 0) <= 0;
        if (kosong) tersembunyi++;
        return !kosong;
      });
      if (!baris.length) {
        if (tersembunyi && res.has_more) {
          muatStok(Number(res.next_offset || STOK_OFFSET + STOK_LIMIT)); return;
        }
        gambarPagerStok(res, tersembunyi, true);
        tb.innerHTML = tabelKosong(tersembunyi
          ? 'Semua baris di halaman ini berstok 0 dan disembunyikan. Matikan "Sembunyikan stok kosong" untuk melihatnya.'
          : 'Tidak ada barang atau batch yang cocok.', 9);
        return;
      }
      gambarPagerStok(res, tersembunyi);
      tb.innerHTML = baris.map(function (s, posisi) {
        var belumAdaBatch = s.Belum_Ada_Batch;
        return '<tr>' +
          '<td><strong>' + esc(s.Nama_Obat) + '</strong>' +
            '<div class="cart-line-meta">' + esc(s.Kode_Obat) + (s.Aktif === 'TIDAK' ? ' · Nonaktif' : '') + '</div></td>' +
          '<td data-label="Batch / status">' + (belumAdaBatch ? '<span class="chip chip-warn">Belum ada batch</span>' : esc(s.Kode_Batch)) + '</td>' +
          '<td data-label="Kedaluwarsa">' + (belumAdaBatch ? '—' : tglIndo(s.Expired_Date)) + '</td>' +
          '<td data-label="Sisa waktu">' + (belumAdaBatch ? '—' : chipExpired(s.sisa_hari, s.Expired_Date)) + '</td>' +
          '<td data-label="Stok" class="c num">' + angka(s.Stok_Real || 0) + '</td>' +
          '<td data-label="Modal efektif" class="r num">' + (belumAdaBatch || s.Harga_Modal_Batch == null ? '—' : rupiah(s.Harga_Modal_Batch)) + '</td>' +
          '<td data-label="Margin batch" class="r num">' + marginStokCell(s) + '</td>' +
          '<td class="c tk-aksi">' + (belumAdaBatch
            ? '<button class="btn btn-sm btn-primary" data-produk-index="' + posisi + '">Tambah batch</button>'
            : '<button class="btn btn-sm" data-batch=\'' + esc(JSON.stringify(s)) + '\'>Ubah</button>') + '</td>' +
        '</tr>';
      }).join('');
      tb.onclick = function (e) {
        var p = e.target.closest('[data-produk-index]');
        if (p) {
          var produk = baris[Number(p.dataset.produkIndex)];
          if (produk) formBatch(null, { Kode_Obat: produk.Kode_Obat, Nama_Obat: produk.Nama_Obat });
          return;
        }
        var b = e.target.closest('[data-batch]');
        if (b) formBatch(JSON.parse(b.dataset.batch));
      };
    }).catch(function (e) {
      tb.innerHTML = '<tr><td colspan="9" class="empty">' + esc(e.message) + '</td></tr>';
    });
}

function marginStok(v) { return v == null ? '—' : Number(v).toFixed(1).replace('.', ',') + '%'; }
function marginStokChip(v) {
  if (v == null) return '<span class="st-margin-empty">—</span>';
  return '<span class="chip ' + (Number(v) < 0 ? 'chip-bad' : 'chip-ok') + '">' + marginStok(v) + '</span>';
}
function marginStokCell(s) {
  return '<div class="st-margin-list" aria-label="Margin batch"><div><span>Umum</span>' + marginStokChip(s.Margin_Umum) + '</div>' +
    '<div><span>Nakes</span>' + marginStokChip(s.Margin_Nakes) + '</div>' +
    '<div><span>Mutasi</span>' + marginStokChip(s.Margin_Mutasi) + '</div></div>';
}

function gambarPagerStok(res, tersembunyi, semuaTersembunyi) {
  var el = document.getElementById('stPager');
  if (!el) return;
  var sembunyikanKosong = document.getElementById('stKosong').checked;
  var catatan = '';
  if (sembunyikanKosong && (tersembunyi || semuaTersembunyi)) {
    catatan = tersembunyi
      ? '<span class="sub">' + angka(tersembunyi) + ' baris berstok 0 disembunyikan.</span>'
      : '<span class="sub">Semua baris di halaman ini berstok 0.</span>';
  }
  var total = Number(res.total) || 0, limit = Number(res.limit) || STOK_LIMIT, offset = Number(res.offset) || 0;
  if (!total) { el.innerHTML = ''; return; }
  var halaman = Math.floor(offset / limit) + 1, jumlahHalaman = Math.ceil(total / limit);
  var jumlahDiHalaman = Number(res.page_count) || res.rows.length;
  var awal = offset + 1, akhir = Math.min(offset + jumlahDiHalaman, total);
  var label = res.pagination_unit === 'barang' ? 'barang' : 'hasil';
  el.innerHTML = '<span class="sub">' + angka(awal) + '–' + angka(akhir) + ' dari ' + angka(total) + ' ' + label + '</span>' +
    '<span class="pager-tombol"><button class="btn btn-sm" data-stoffset="' + Math.max(0, offset - limit) + '"' + (offset <= 0 ? ' disabled' : '') + '>‹ Sebelumnya</button>' +
    '<span class="sub">Halaman ' + angka(halaman) + ' dari ' + angka(jumlahHalaman) + '</span>' +
    '<button class="btn btn-sm" data-stoffset="' + Number(res.next_offset || offset + limit) + '"' + (!res.has_more ? ' disabled' : '') + '>Berikutnya ›</button></span>' + catatan;
  el.onclick = function (e) {
    var b = e.target.closest('[data-stoffset]');
    if (!b || b.disabled) return;
    muatStok(Number(b.dataset.stoffset));
  };
}

function formBatch(s, produk) {
  var edit = !!s;
  s = s || {};
  produk = produk || {};
  var kodeBatchKosong = edit && !String(s.Kode_Batch || '').trim();
  var kodeAwal = edit ? (s.Kode_Obat || '') : (produk.Kode_Obat || '');
  var kodeObatTerkunci = !!produk.Kode_Obat;
  modalBuka(edit ? 'Ubah batch ' + s.Kode_Batch : (produk.Kode_Obat ? 'Tambah batch barang' : 'Tambah batch'),
    '<div class="grid g2">' +
      '<label class="field"><span>Kode obat</span><input id="fsKode" class="inp" value="' +
        esc(kodeAwal) + '"' + (kodeObatTerkunci ? ' readonly' : '') + '></label>' +
      '<label class="field"><span>Kode batch</span><input id="fsBatch" class="inp" value="' +
        esc(s.Kode_Batch || '') + '"' + (edit && !kodeBatchKosong ? ' readonly' : '') + '></label>' +
      '<label class="field"><span>Tanggal kedaluwarsa</span><input id="fsExp" class="inp" type="date" value="' +
        esc(s.Expired_Date || '') + '"></label>' +
      '<label class="field"><span>Stok fisik</span><input id="fsStok" class="inp num" type="number" value="' +
        (s.Stok_Real || 0) + '"></label>' +
    '</div>' +
    (kodeBatchKosong ? '<p class="kpi-sub" style="margin:0 0 12px">Kode batch pada data ini kosong. Isi kode batch yang benar untuk memperbaiki data.</p>' : '') +
    '<label class="field"><span>Modal efektif batch ini</span><input id="fsModal" class="inp num" type="number" value="' +
      (s.Harga_Modal_Batch == null ? '' : s.Harga_Modal_Batch) + '"></label>',
    [
      { label: 'Batal', aksi: modalTutup },
      { label: 'Simpan batch', kelas: 'btn-primary', aksi: function () {
          var kodeObat = val('fsKode').toUpperCase();
          var kodeBatch = val('fsBatch').trim();
          var expired = val('fsExp');
          var stok = numVal('fsStok');
          var modal = numVal('fsModal');
          if (!kodeObat || !kodeBatch || !expired) { toast('Kode obat, kode batch, dan tanggal kedaluwarsa wajib diisi.', true); return; }
          if (stok < 0 || modal < 0) { toast('Stok dan harga modal tidak boleh negatif.', true); return; }
          if (edit) {
            var kodeObatLama = String(s.Kode_Obat || '').toUpperCase();
            var kodeBatchLama = String(s.Kode_Batch || '').trim();
            if (kodeObat !== kodeObatLama || kodeBatch !== kodeBatchLama) {
              var pesan = 'Kode obat berubah: ' + (kodeObatLama || '—') + ' → ' + kodeObat + '.\n' +
                'Kode batch berubah: ' + (kodeBatchLama || '—') + ' → ' + kodeBatch + '.\n\n' +
                'Stok batch ini akan berpindah barang. Pastikan kode baru benar. Lanjutkan?';
              if (!confirm(pesan)) return;
            }
          }
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
    var isOwner = SESSION && SESSION.user && SESSION.user.role === 'Owner';
    el.innerHTML =
      '<div class="crm-shell marketing-shell">' +
        '<section class="marketing-hero">' +
          '<div class="marketing-hero-copy">' +
            '<div class="marketing-eyebrow"><span class="marketing-live-dot"></span> MARKETING WORKSPACE</div>' +
            '<h2>Marketing &amp; Promosi</h2>' +
            '<p>Kelola kampanye, kupon, bundle, dan loyalitas pelanggan dari satu tempat. Pantau hasilnya agar setiap promo punya tujuan yang jelas.</p>' +
            '<div class="marketing-hero-meta"><span>◷ Performa promo</span><span>↗ Aktivasi pelanggan</span><span>◎ Loyalitas</span></div>' +
          '</div>' +
          '<div class="marketing-hero-actions">' +
            '<button id="crmPromoTambahHero" class="btn btn-primary"><span aria-hidden="true">＋</span> Buat kampanye</button>' +
            '<button id="lotOpen" class="btn marketing-btn-ghost">Kupon undian <span aria-hidden="true">↗</span></button>' +
          '</div>' +
          '<div class="marketing-hero-orb marketing-orb-one"></div><div class="marketing-hero-orb marketing-orb-two"></div>' +
        '</section>' +
        '<section class="marketing-shortcuts" aria-label="Akses cepat">' +
          '<button type="button" class="marketing-shortcut" data-marketing-jump="marketing-campaign-section"><span class="marketing-shortcut-icon icon-promo">%</span><span><strong>Promo &amp; bundle</strong><small>Buat dan kelola penawaran</small></span><span class="marketing-shortcut-arrow">→</span></button>' +
          '<button type="button" class="marketing-shortcut" data-marketing-jump="marketing-report-section"><span class="marketing-shortcut-icon icon-report">↗</span><span><strong>Efektivitas promo</strong><small>Pantau omzet dan ROI</small></span><span class="marketing-shortcut-arrow">→</span></button>' +
          '<button type="button" class="marketing-shortcut" id="marketingShortcutLottery"><span class="marketing-shortcut-icon icon-lottery">✦</span><span><strong>Kupon undian</strong><small>Campaign, peserta, pemenang</small></span><span class="marketing-shortcut-arrow">→</span></button>' +
          (isOwner ? '<button type="button" class="marketing-shortcut" data-marketing-jump="mpCard"><span class="marketing-shortcut-icon icon-loyalty">♡</span><span><strong>Poin &amp; reward</strong><small>Program loyalitas pelanggan</small></span><span class="marketing-shortcut-arrow">→</span></button>' : '') +
          (isOwner && MENU.some(function (m) { return m.id === 'targetOmset'; }) ? '<button type="button" class="marketing-shortcut" id="marketingShortcutTarget"><span class="marketing-shortcut-icon icon-target">◎</span><span><strong>Target omset</strong><small>Target dan laba setelah target</small></span><span class="marketing-shortcut-arrow">→</span></button>' : '') +
        '</section>' +
        '<div class="marketing-section-heading"><div><span class="marketing-section-kicker">KELOLA AKTIVITAS</span><h3>Promo yang sedang berjalan</h3><p class="sub">Atur penawaran untuk pelanggan dan evaluasi dampaknya.</p></div>' +
          '<button id="crmPromoTambah" class="btn btn-primary">＋ Kampanye baru</button>' +
        '</div>' +
        '<section id="marketing-campaign-section" class="marketing-panel-wrap">' +
          '<div id="crmPromoCard" class="card crm-refill marketing-panel" style="display:none">' +
            '<div class="card-head"><div><h3>Manajemen promo</h3><p class="sub">Kelola kupon berdasarkan segmen pelanggan serta fixed bundle.</p></div><div class="marketing-panel-actions"><button id="crmBundleTambah" class="btn btn-sm">＋ Bundle</button></div></div>' +
            '<div id="crmPromoForm" class="crm-refill-form" hidden></div>' +
            '<div id="crmPromoList" class="crm-refill-list"></div>' +
            '<div id="crmBundleList" class="crm-refill-list"></div>' +
          '</div>' +
        '</section>' +
        '<section id="marketing-report-section" class="marketing-panel-wrap">' +
          '<div class="marketing-section-heading marketing-report-heading"><div><span class="marketing-section-kicker">HASIL &amp; ANALITIK</span><h3>Efektivitas kampanye</h3><p class="sub">Lihat pendapatan, subsidi diskon, laba, ROAS, dan ROI promo.</p></div><button id="crmPromoReportRefresh" class="btn btn-sm">↻ Muat ulang</button></div>' +
          '<div id="crmPromoReportCard" class="card crm-directory marketing-panel" style="display:none">' +
            '<div id="crmPromoReportKpi" class="crm-kpi-grid"></div>' +
            '<div id="crmPromoCampaignSummary" class="marketing-campaign-summary"></div>' +
            '<div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Kampanye</th><th>Kupon</th><th>Pelanggan</th><th>Invoice</th><th class="r">Diskon</th><th>Status</th></tr></thead><tbody id="crmPromoReportBody"></tbody></table></div>' +
          '</div>' +
        '</section>' +
      '</div>';
    var tambah = document.getElementById('crmPromoTambah');
    var tambahHero = document.getElementById('crmPromoTambahHero');
    if (tambah) tambah.onclick = function () { formPromoKampanye(); };
    if (tambahHero) tambahHero.onclick = function () { formPromoKampanye(); };
    el.querySelectorAll('[data-marketing-jump]').forEach(function (b) {
      b.onclick = function () {
        var target = document.getElementById(b.getAttribute('data-marketing-jump'));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
    var lotBtn = document.getElementById('lotOpen');
    var lotShortcut = document.getElementById('marketingShortcutLottery');
    function bukaLottery() {
      el.innerHTML = '<div class="crm-shell marketing-shell marketing-subpage"><button type="button" class="btn marketing-back" id="marketingBack">← Kembali ke Marketing</button><div class="marketing-subpage-heading"><span class="marketing-section-kicker">MARKETING WORKSPACE</span><h2>Kupon Undian</h2><p class="sub">Kelola campaign, peserta, hadiah, dan laporan undian.</p></div><div id="lottery-root"></div></div>';
      var back = document.getElementById('marketingBack');
      if (back) back.onclick = function () { gantiHalaman('marketing'); };
      if (window.MarketingLottery) window.MarketingLottery.mount('lottery-root');
    }
    if (lotBtn) lotBtn.onclick = bukaLottery;
    if (lotShortcut) lotShortcut.onclick = bukaLottery;
    var targetBtn = document.getElementById('marketingShortcutTarget');
    if (targetBtn) targetBtn.onclick = function () { gantiHalaman('targetOmset'); };
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
