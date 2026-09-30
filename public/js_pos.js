/* =========================================== Modul POS / Kasir (Bab 2) ====
   Layar sengaja gelap: kasir menatapnya sepanjang jam kerja, dan latar terang
   penuh tabel melelahkan mata. Angka kembalian dibuat sebesar mungkin karena
   itu satu-satunya angka yang dibaca sambil menghitung uang.
   ========================================================================= */

var POS = {
  customer: { wa: '', nama: '', tipe: 'Umum', terdaftar: false },
  items: [],
  diskon: 0,
  diskonMode: 'nominal',
  reward: null,
  rewardDiscount: 0,
  coupon: null,
  bundle: null,
  bayar: 0,
  lebarStruk: '58'
};

VIEWS.pos = {
  title: 'Kasir',
  render: function (el) {
    el.innerHTML = tataLetakPOS();
    pasangEventPOS();
    pasangEventPromoPOS();
    gambarKeranjang();
    gambarHeaderShift();
    muatPromoPOS();
    // Fokus otomatis ke pencarian begitu layar siap (tidak di HP: keyboard akan menutupi layar).
    var s = document.getElementById('posCari');
    if (s && !layarSentuh()) s.focus();
  }
};

function tataLetakPOS() {
  return '<div class="pos-dark"><div class="pos">' +
    '<div>' +

      /* Header ringkas — shift aktif, PJ, jam buka, pintasan keyboard. */
      '<div class="card pos-head">' +
        '<div class="pos-head-left">' +
          '<span id="posShiftChip" class="chip chip-brand">Memuat shift…</span>' +
          '<span id="posPJ" class="sub"></span>' +
        '</div>' +
        '<div class="pos-head-right">' +
          '<span class="kbd-hint">F2 cari · Esc tutup</span>' +
        '</div>' +
      '</div>' +

      /* Pelanggan — satu baris ringkas, mengembang saat nomor WA diisi. */
      '<div class="card">' +
        '<div class="pos-cust">' +
          '<input id="posWA" class="inp" type="tel" inputmode="numeric" ' +
            'placeholder="Nomor WhatsApp, lalu Enter">' +
          '<input id="posNama" class="inp" type="text" placeholder="Nama pembeli (Umum)">' +
          '<select id="posTipe" class="inp" style="max-width:190px">' +
            '<option>Umum</option><option>Tenaga Kesehatan</option><option>Apotek Lain</option>' +
          '</select>' +
          '<span id="posSegmen"></span>' +
        '</div>' +
        '<div id="posInfoCust" class="pos-customer-info" aria-live="polite"></div>' +
        '<div id="posPromoKupon" aria-live="polite"></div>' +
      '</div>' +

      /* Pencarian dan keranjang */
      '<div class="card">' +
        '<div class="pos-search">' +
          '<input id="posCari" class="inp" type="text" autocomplete="off" enterkeyhint="search" ' +
            'placeholder="Scan barcode atau ketik nama obat, lalu Enter">' +
          '<button type="button" id="posScan" class="pos-scan" aria-label="Pindai barcode dengan kamera">' +
            '<svg viewBox="0 0 24 24"><path d="M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M20 16v2a2 2 0 01-2 2h-2M8 20H6a2 2 0 01-2-2v-2"/><path d="M7 12h10"/></svg></button>' +
          '<div id="posSuggest" class="suggest" hidden></div>' +
        '</div>' +
        '<div class="card-head" style="margin-bottom:10px">' +
          '<h3>Keranjang</h3><span id="posJumlah" class="chip">0 item</span>' +
          '<button id="posKosong" class="btn btn-sm">Kosongkan</button>' +
        '</div>' +
        '<div id="posPromoRail" aria-live="polite"></div>' +
        '<div id="posCart" class="cart"></div>' +
      '</div>' +
    '</div>' +

    /* Panel pembayaran */
    '<div class="card pos-pay" id="posPayPanel">' +
      '<button type="button" class="pos-pay-grip" id="posPayToggle" aria-expanded="true" aria-controls="posPayPanel" aria-label="Buka / tutup panel pembayaran">' +
        '<span></span>' +
        // Ringkasan yang terlihat saat panel tertutup di HP: jumlah item + total + ajakan bayar.
        '<em class="pos-pay-ringkas"><small id="posPayRingkasItem">0 item</small>' +
          '<b id="posPayRingkasTotal">Rp0</b><i class="pos-pay-aksi">Bayar</i></em>' +
      '</button>' +
      '<div class="pos-pay-body">' +
        '<div class="pay-row"><span>Subtotal item</span><span id="paySub" class="money">Rp0</span></div>' +
        // Kupon & bundle kini muncul otomatis sebagai tiket; tombol manualnya diganti tautan kecil.

        '<input id="posDiskon" type="hidden" value="0"><select id="posDiskonMode" hidden><option value="nominal">Nominal (Rp)</option><option value="persen">Persentase (%)</option></select>' +
        '<input id="posCoupon" type="hidden"><input id="posBundle" type="hidden">' +
        '<div id="posCouponRow" class="pos-reward-row" hidden><span>Kupon: <strong id="posCouponName"></strong></span><span class="num" id="posCouponValue"></span><button type="button" class="btn btn-sm" id="posCouponClear">Batalkan</button></div>' +
        '<div id="posBundleRow" class="pos-reward-row" hidden><span>Bundle: <strong id="posBundleName"></strong></span><span class="num" id="posBundleValue"></span><button type="button" class="btn btn-sm" id="posBundleClear">Batalkan</button></div>' +
        '<div id="posRewardRow" class="pos-reward-row" hidden><span>Reward: <strong id="posRewardName"></strong></span><span class="num" id="posRewardValue"></span><button type="button" class="btn btn-sm" id="posRewardClear">Batalkan</button></div>' +
        '<div class="pay-row total"><span>Total bayar</span>' +
          '<span id="payTotal" class="pay-total">Rp0</span></div>' +
        '<div id="posHemat" class="pay-hemat" hidden></div>' +
        '<div id="posUndian"></div>' +
        '<div class="pay-link">' +
          '<button type="button" class="link-btn" id="posDiskonOpen">+ Diskon manual</button>' +
          '<button type="button" class="link-btn" id="posKodeOpen">Punya kode promo?</button>' +
        '</div>' +
        '<label class="field" style="margin-top:12px"><span>Uang tunai diterima</span>' +
          '<input id="posBayar" class="inp num" type="number" min="0" step="100" placeholder="0"></label>' +
        '<div class="cash-quick" id="posCashQuick"></div>' +
        '<div style="margin-top:12px">' +
          '<div class="sub">Kembalian</div>' +
          '<div id="payKembali" class="kembalian">Rp0</div>' +
        '</div>' +
        '<button id="posSimpan" class="btn-bayar">Simpan &amp; cetak struk</button>' +
        '<label class="field" style="margin:12px 0 0"><span>Lebar struk</span>' +
          '<select id="posLebar" class="inp"><option value="58">Thermal 58 mm</option>' +
          '<option value="80">Thermal 80 mm</option></select></label>' +
        '<button id="posPreviewOpen" class="btn btn-secondary" type="button" style="width:100%;margin-top:10px">Pratinjau struk</button>' +
        '<p class="sub" style="margin-top:10px">Harga mengikuti tipe pembeli. Batch dipilih ' +
          'otomatis dari kedaluwarsa terdekat.</p>' +
      '</div>' +
    '</div>' +
  '</div></div>';
}

/** Tampilkan shift aktif + PJ shift + jam buka di header POS. */
function gambarHeaderShift() {
  var chip = document.getElementById('posShiftChip');
  var pj = document.getElementById('posPJ');
  if (!chip || !pj) return;
  var now = new Date();
  var jam = now.getHours();               // 0–23 (integer), bukan string "09"
  var shift, jamShift, kelas;
  if (jam >= 7 && jam < 14) {
    shift = 'Shift Pagi'; jamShift = '07:00–14:00'; kelas = 'chip-ok';
  } else if (jam >= 14 && jam < 21) {
    shift = 'Shift Sore'; jamShift = '14:00–21:00'; kelas = 'chip-ok';
  } else if (jam >= 21) {
    shift = 'Luar Jam'; jamShift = 'Apotek tutup (jam buka 07:00–21:00)'; kelas = 'chip-warn';
  } else {
    // Sebelum 07:00: apotek belum buka
    shift = 'Pra-buka'; jamShift = 'Apotek buka pukul 07:00'; kelas = 'chip-warn';
  }
  chip.textContent = shift + ' · ' + jamShift;
  chip.className = 'chip ' + kelas;
  var role = (SESSION && SESSION.user && SESSION.user.role) || '';
  var nama = (SESSION && SESSION.user && SESSION.user.nama) || '';
  var jam12 = formatHM_(now);
  // Penanggung Jawab (PJ) hanya untuk role Kasir/Admin.
  // Owner/Apoteker yang masuk ke POS tampil dengan label peran, BUKAN sebagai PJ —
  // supaya audit jelas: PJ transaksi adalah admin yang bertanggung jawab saat itu.
  if (role === 'Kasir') {
    pj.textContent = 'PJ: ' + nama + ' · ' + jam12;
  } else if (nama) {
    var labelPeran = labelRole_(role) || role;
    pj.textContent = labelPeran + ': ' + nama + ' · ' + jam12;
  } else {
    pj.textContent = '· ' + jam12;
  }
}

/** Format jam:menit dari objek Date secara lokal (Asia/Jakarta dari server). */
function formatHM_(d) {
  var h = d.getHours();
  var m = d.getMinutes();
  return ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2);
}

/* -------------------------------------------------------------- Peristiwa */

function layarSentuh() {
  return !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
}

function pasangEventPOS() {
  var cari = document.getElementById('posCari');
  var scan = document.getElementById('posScan');
  if (scan) scan.onclick = function () { if (window.bukaScanner) window.bukaScanner(); };
  var timer = null, cursor = -1, hasil = [];

  function tutupSuggest() {
    document.getElementById('posSuggest').hidden = true;
    cursor = -1; hasil = [];
  }

  function tampilSuggest(list) {
    hasil = list;
    var box = document.getElementById('posSuggest');
    if (!list.length) {
      box.innerHTML = '<div class="empty">Obat tidak ditemukan.</div>';
      box.hidden = false; return;
    }
    box.innerHTML = list.map(function (b, i) {
      // Stok minimum diasumsikan 10 bila backend tidak mengembalikan nilai
      // itu (lihat posCariBarang_ yang mengembalikan stok agregat saja).
      var minAsumsi = Math.max(5, Math.round(b.stok * 0.2));
      var hampirHabis = b.stok > 0 && b.stok <= minAsumsi;
      var kelasStok = b.stok <= 0 ? 'chip-bad' : (hampirHabis ? 'chip-warn' : 'chip-ok');
      var labelStok = b.stok <= 0 ? 'habis' : ('stok ' + angka(b.stok));
      return '<button type="button" data-i="' + i + '">' +
        '<div class="s-name">' + esc(b.Nama_Obat) + (kodePaketSet()[b.Kode_Obat] ? '<span class="pp-badge">🏷 Paket</span>' : '') + '</div>' +
        '<div class="s-meta">' + esc(b.Kode_Obat) + ' · ' + rupiah(b.harga) + ' ' +
          '<span class="chip ' + kelasStok + '">' + labelStok + '</span>' +
        (b.expired ? ' ' + chipExpired(b.sisa_hari, b.expired) : '') + '</div></button>';
    }).join('');
    box.hidden = false;
  }

  function pilih(i) {
    var b = hasil[i];
    if (!b) return;
    if (b.stok <= 0) { toast('Stok ' + b.Nama_Obat + ' kosong.', true); return; }
    tambahKeKeranjang(b);
    cari.value = ''; tutupSuggest(); cari.focus();
  }

  cari.addEventListener('input', function () {
    clearTimeout(timer);
    var q = cari.value.trim();
    if (q.length < 2) { tutupSuggest(); return; }
    // Barcode scanner mengirim karakter cepat dan diakhiri Enter — tapi
    // untuk jaga-jaga, kalau semua karakter numeric ≥8 digit, perlakukan
    // sebagai barcode dan langsung cari tanpa debounce.
    var adalahBarcode = /^\d{8,}$/.test(q);
    var jalan = function () {
      api('pos.cariBarang', { q: q, tipe: document.getElementById('posTipe').value })
        .then(function (list) {
          if (adalahBarcode && list.length === 1 && list[0].exact) { hasil = list; pilih(0); return; }
          if (list.length === 1 && list[0].exact) { hasil = list; pilih(0); return; }
          tampilSuggest(list);
        })
        .catch(function (e) { toast(e.message, true); });
    };
    if (adalahBarcode) jalan(); else timer = setTimeout(jalan, 220);
  });

  cari.addEventListener('keydown', function (e) {
    var box = document.getElementById('posSuggest');
    if (box.hidden) return;
    var tombol = box.querySelectorAll('button');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      cursor += (e.key === 'ArrowDown' ? 1 : -1);
      if (cursor < 0) cursor = tombol.length - 1;
      if (cursor >= tombol.length) cursor = 0;
      tombol.forEach(function (t, i) { t.classList.toggle('is-cursor', i === cursor); });
      if (tombol[cursor]) tombol[cursor].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pilih(cursor >= 0 ? cursor : 0);
    } else if (e.key === 'Escape') { tutupSuggest(); }
  });

  document.getElementById('posSuggest').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-i]');
    if (b) pilih(Number(b.dataset.i));
  });

  if (!window.__posKlikLuar) window.__posKlikLuar = true, document.addEventListener('click', function (e) {
    if (!e.target.closest('.pos-search')) {
      var s = document.getElementById('posSuggest');
      if (s) s.hidden = true;
    }
  });

  var wa = document.getElementById('posWA');
  wa.addEventListener('keydown', function (e) { if (e.key === 'Enter') cariPelanggan(); });
  wa.addEventListener('blur', function () { if (wa.value.trim()) cariPelanggan(); });

  document.getElementById('posTipe').addEventListener('change', function () {
    POS.customer.tipe = this.value;
    if (POS.items.length) hitungUlangHarga();
    muatPromoPOS();
  });
  document.getElementById('posNama').addEventListener('input', function () {
    POS.customer.nama = this.value.trim();
  });
  document.getElementById('posRewardClear').onclick = function () { POS.reward = null; POS.rewardDiscount = 0; gambarRingkasan(); };
  document.getElementById('posDiskonOpen').onclick = bukaDiskonPOS;
  document.getElementById('posKodeOpen').onclick = bukaKodePromoPOS;
  document.getElementById('posCouponClear').onclick = function () { POS.coupon = null; document.getElementById('posCoupon').value = ''; gambarRingkasan(); };
  document.getElementById('posBundleClear').onclick = function () { POS.bundle = null; document.getElementById('posBundle').value = ''; gambarRingkasan(); };
  document.getElementById('posBayar').addEventListener('input', function () {
    POS.bayar = Number(this.value) || 0; gambarRingkasan();
  });
  document.getElementById('posLebar').addEventListener('change', function () {
    POS.lebarStruk = this.value;
  });
  document.getElementById('posPreviewOpen').onclick = bukaPreviewStruk;
  document.getElementById('posKosong').onclick = kosongkanKeranjang;
  document.getElementById('posSimpan').onclick = simpanTransaksi;

  // Toggle ringkasan bayar (mobile: tarik/tutup panel bawah).
  var grip = document.getElementById('posPayToggle');
  if (grip) {
    var panel = document.getElementById('posPayPanel');
    var breakpointPanelHP = window.matchMedia ? window.matchMedia('(max-width:1040px)') : null;
    var aturPanel = function (tutup) {
      panel.classList.toggle('is-collapsed', tutup);
      panel.classList.toggle('is-fullscreen', !!(breakpointPanelHP && breakpointPanelHP.matches && !tutup));
      grip.setAttribute('aria-expanded', tutup ? 'false' : 'true');
      grip.setAttribute('aria-label', tutup ? 'Buka panel pembayaran' : 'Tutup panel pembayaran');
    };
    grip.onclick = function () { aturPanel(!panel.classList.contains('is-collapsed')); };
    // Di HP panel bayar mulai TERTUTUP supaya keranjang & pencarian terlihat;
    // ringkasan total selalu tampil di bilah bawah, ketuk untuk membayar.
    if (breakpointPanelHP && breakpointPanelHP.matches) aturPanel(true);
    if (breakpointPanelHP) {
      var sinkronPanel = function (e) { aturPanel(!!e.matches); };
      if (breakpointPanelHP.addEventListener) breakpointPanelHP.addEventListener('change', sinkronPanel);
      else if (breakpointPanelHP.addListener) breakpointPanelHP.addListener(sinkronPanel);
    }
    // Salin total & jumlah item ke bilah ringkas setiap kali berubah.
    var salin = function () {
      var t = document.getElementById('payTotal'), n = document.getElementById('posJumlah');
      if (t) document.getElementById('posPayRingkasTotal').textContent = t.textContent;
      if (n) document.getElementById('posPayRingkasItem').textContent = n.textContent;
    };
    if (typeof MutationObserver !== 'undefined') {
      ['payTotal', 'posJumlah'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) new MutationObserver(salin).observe(el, { childList: true, characterData: true, subtree: true });
      });
    }
    salin();
  }

  // Pintasan keyboard level layar POS (dipasang SEKALI; sebelumnya bertambah tiap kali halaman Kasir dibuka).
  if (!window.__posPintasan) window.__posPintasan = true, document.addEventListener('keydown', function (e) {
    if (!document.getElementById('posCari')) return;
    var tag = (e.target && e.target.tagName) || '';
    var diInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (e.key === 'F2') {
      e.preventDefault();
      var s = document.getElementById('posCari'); if (s) s.focus();
    } else if (e.key === 'Escape' && !diInput) {
      // ESC di luar input: tutup suggest, atau kosongkan fokus pencarian.
      var sg = document.getElementById('posSuggest');
      if (sg && !sg.hidden) sg.hidden = true;
      else {
        var c = document.getElementById('posCari');
        if (c) { c.value = ''; c.focus(); }
      }
    }
  });

  var cart = document.getElementById('posCart');
  cart.addEventListener('click', function (e) {
    var t = e.target.closest('[data-aksi]');
    if (!t) return;
    var i = Number(t.dataset.i);
    if (t.dataset.aksi === 'plus') ubahQty(i, POS.items[i].qty + 1);
    if (t.dataset.aksi === 'minus') ubahQty(i, POS.items[i].qty - 1);
    if (t.dataset.aksi === 'hapus') { POS.items.splice(i, 1); gambarKeranjang(); }
  });
  cart.addEventListener('change', function (e) {
    var t = e.target.closest('[data-qty]');
    if (t) ubahQty(Number(t.dataset.qty), Number(t.value));
  });
}

function kosongkanKeranjang() {
  POS.items = []; POS.diskon = 0; POS.diskonMode = 'nominal'; POS.reward = null; POS.rewardDiscount = 0; POS.coupon = null; POS.bundle = null; POS.bayar = 0;
  document.getElementById('posDiskon').value = 0;
  document.getElementById('posDiskonMode').value = 'nominal';
  document.getElementById('posDiskon').step = '500';
  document.getElementById('posDiskon').max = '';
  document.getElementById('posBayar').value = '';
  document.getElementById('posCoupon').value = '';
  document.getElementById('posBundle').value = '';
  gambarKeranjang();
}

/* -------------------------------------------------------------- Pelanggan */

function cariPelanggan() {
  var wa = document.getElementById('posWA').value.trim();
  if (!wa) return;
  api('pos.cariCustomer', { wa: wa }).then(function (c) {
    var info = document.getElementById('posInfoCust');
    var seg = document.getElementById('posSegmen');
    if (c.found) {
      POS.customer = { wa: c.Nomor_WA, nama: c.Nama, tipe: c.Tipe_Customer, terdaftar: true };
      document.getElementById('posNama').value = c.Nama;
      document.getElementById('posTipe').value = c.Tipe_Customer;
      seg.innerHTML = chipSegmen(c.Segment_CRM);
      info.innerHTML = '<div class="pos-customer-line"><span class="pos-customer-address">' +
        esc(c.Alamat || 'Alamat belum dicatat') + '</span><span>' + angka(c.Jumlah_Transaksi || 0) +
        ' transaksi</span><span>belanja ' + rupiah(c.Total_Belanja) + '</span>' +
        (c.Tanggal_Terakhir_Beli ? '<span>terakhir ' + tglIndo(c.Tanggal_Terakhir_Beli) + '</span>' : '') +
        '</div><div class="pos-loyalty-line"><span class="pos-loyalty-badge"><strong>✦ ' +
        angka(c.Total_Points || 0) + '</strong> poin terkumpul</span><span class="pos-tier-badge">Tier ' +
        esc(c.Tier || 'reguler') + '</span><button type="button" class="btn btn-sm pos-redeem-btn" id="posRedeemBtn">Tukar poin</button></div>';
      document.getElementById('posRedeemBtn').onclick = function () { bukaRewardPOS(c); };
      if (POS.items.length) hitungUlangHarga();
      muatPromoPOS();
    } else {
      POS.customer = { wa: c.Nomor_WA || wa, nama: '', tipe: document.getElementById('posTipe').value, terdaftar: false };
      seg.innerHTML = '<span class="chip chip-warn">Belum terdaftar</span>';
      info.innerHTML = 'Nomor ini belum ada di database. ' +
        '<button class="btn btn-sm" id="btnDaftarInline" style="margin-left:6px">Daftarkan</button>';
      document.getElementById('btnDaftarInline').onclick = formDaftarInline;
      muatPromoPOS();
    }
  }).catch(function (e) { toast(e.message, true); });
}

function formDaftarInline() {
  var wa = POS.customer.wa || document.getElementById('posWA').value.trim();
  modalBuka('Daftarkan pelanggan baru',
    '<label class="field"><span>Nomor WhatsApp</span><input id="dfWA" class="inp" value="' + esc(wa) + '"></label>' +
    '<label class="field"><span>Nama</span><input id="dfNama" class="inp" placeholder="Nama pasien, dokter, atau apotek"></label>' +
    '<label class="field"><span>Tipe customer</span><select id="dfTipe" class="inp" data-seg="1">' +
      '<option>Umum</option><option>Tenaga Kesehatan</option><option>Apotek Lain</option></select></label>' +
    '<label class="field"><span>Alamat</span><input id="dfAlamat" class="inp"></label>' +
    '<label class="field"><span>Nomor izin (SIP/SIA), bila ada</span><input id="dfIzin" class="inp"></label>',
    [
      { label: 'Batal', aksi: modalTutup },
      { label: 'Simpan pelanggan', kelas: 'btn-primary', aksi: function () {
          api('pos.daftarCustomer', {
            wa: val('dfWA'), nama: val('dfNama'), tipe: val('dfTipe'),
            alamat: val('dfAlamat'), izin: val('dfIzin')
          }).then(function () {
            modalTutup();
            document.getElementById('posWA').value = val('dfWA');
            toast('Pelanggan tersimpan.');
            cariPelanggan();
          }).catch(function (e) { toast(e.message, true); });
        } }
    ]);
}

/* -------------------------------------------------------------- Keranjang */

function tambahKeKeranjang(b) {
  for (var i = 0; i < POS.items.length; i++) {
    if (POS.items[i].kode === b.Kode_Obat) { ubahQty(i, POS.items[i].qty + 1); return; }
  }
  POS.items.push({
    kode: b.Kode_Obat, nama: b.Nama_Obat, satuan: b.Satuan, harga: b.harga,
    qty: 1, stok: b.stok, batch: b.batch_terdekat, expired: b.expired, sisa_hari: b.sisa_hari
  });
  gambarKeranjang();
}

function ubahQty(i, qty) {
  var it = POS.items[i];
  if (!it) return;
  qty = Math.max(0, Math.floor(Number(qty) || 0));
  if (qty === 0) { POS.items.splice(i, 1); gambarKeranjang(); return; }
  if (qty > it.stok) { toast('Stok ' + it.nama + ' hanya ' + it.stok + '.', true); qty = it.stok; }
  it.qty = qty;
  gambarKeranjang();
}

/** Harga ikut berubah saat tipe pembeli diganti di tengah transaksi. */
function bukaDiskonPOS() {
  var currentMode = POS.diskonMode || 'nominal';
  var currentValue = currentMode === 'persen' && subtotalPOS() ? (POS.diskon / subtotalPOS() * 100) : (POS.diskon || 0);
  var html = '<div class="field"><span>Jenis diskon</span><select id="posModalDiskonMode" class="inp"><option value="nominal"'+(currentMode==='nominal'?' selected':'')+'>Nominal (Rp)</option><option value="persen"'+(currentMode==='persen'?' selected':'')+'>Persentase (%)</option></select></div>' +
    '<label class="field"><span>Nilai diskon</span><input id="posModalDiskonValue" class="inp num" type="number" min="0" value="'+currentValue.toFixed(currentMode==='persen'?0:0)+'"></label>' +
    '<div class="pos-discount-preview" id="posModalDiskonPreview"></div>';
  modalBuka('Diskon transaksi', html, [{ label: 'Batal', aksi: modalTutup }, { label: 'Terapkan diskon', kelas: 'btn-primary', aksi: function () {
    var mode = document.getElementById('posModalDiskonMode').value;
    var value = Math.max(0, Number(document.getElementById('posModalDiskonValue').value) || 0);
    if (mode === 'persen') value = Math.min(100, value);
    document.getElementById('posDiskonMode').value = mode;
    document.getElementById('posDiskon').value = value;
    POS.diskonMode = mode; POS.diskon = mode === 'persen' ? subtotalPOS() * value / 100 : Math.min(subtotalPOS(), value);
    modalTutup(); gambarRingkasan();
  }}]);
  var mode = document.getElementById('posModalDiskonMode'), value = document.getElementById('posModalDiskonValue'), preview = document.getElementById('posModalDiskonPreview');
  function refresh() { var v=Math.max(0,Number(value.value)||0), d=mode.value==='persen'?subtotalPOS()*Math.min(100,v)/100:Math.min(subtotalPOS(),v); preview.innerHTML='<div class="pay-row"><span>Subtotal</span><span>'+rupiah(subtotalPOS())+'</span></div><div class="pay-row"><span>Potongan</span><span class="num">-'+rupiah(d)+'</span></div><div class="pay-row total"><span>Total baru</span><span>'+rupiah(Math.max(0,subtotalPOS()-d))+'</span></div>'; }
  if (mode) mode.onchange=refresh; if (value) value.oninput=refresh; refresh();
}

function bukaKuponPOS() {
  if (!POS.customer.terdaftar) { toast('Pilih pelanggan terdaftar terlebih dahulu.', true); return; }
  var html='<label class="field"><span>Kode kupon promo</span><input id="posModalCoupon" class="inp" placeholder="Contoh: HEMAT10" value="'+esc(document.getElementById('posCoupon').value||'')+'"></label><p class="sub">Kupon akan divalidasi berdasarkan pelanggan dan total belanja saat ini.</p>';
  modalBuka('Kupon diskon', html, [{label:'Batal',aksi:modalTutup},{label:'Validasi & terapkan',kelas:'btn-primary',aksi:function(){
    var code=(document.getElementById('posModalCoupon').value||'').trim(); if(!code){toast('Masukkan kode kupon terlebih dahulu.',true);return;}
    promoApi('validate',{code:code,nomor_wa:POS.customer.wa,tipe_customer:document.getElementById('posTipe').value,subtotal:subtotalPOS()}).then(function(r){if(POS.bundle){POS.bundle=null;document.getElementById('posBundle').value='';}POS.coupon=r;document.getElementById('posCoupon').value=code;modalTutup();gambarRingkasan();toast('Kupon '+r.code+' aktif: potongan '+rupiah(r.discount)+'.');}).catch(function(e){toast(e.message,true);});
  }}]);
}

function bukaBundlePOS() {
  var html='<label class="field"><span>Kode fixed bundle SKU</span><input id="posModalBundle" class="inp" placeholder="Contoh: BUNDLE-LUKA" value="'+esc(document.getElementById('posBundle').value||'')+'"></label><p class="sub">Masukkan kode bundle setelah SKU dan kuantitas yang disyaratkan berada di keranjang.</p>';
  modalBuka('Fixed bundle', html, [{label:'Batal',aksi:modalTutup},{label:'Validasi & terapkan',kelas:'btn-primary',aksi:function(){
    var code=(document.getElementById('posModalBundle').value||'').trim(); if(!code){toast('Masukkan kode fixed bundle terlebih dahulu.',true);return;}
    promoApi('bundleValidate',{code:code,tipe_customer:document.getElementById('posTipe').value,items:POS.items.map(function(it){return {kode:it.kode,qty:it.qty};})}).then(function(r){if(POS.coupon){POS.coupon=null;document.getElementById('posCoupon').value='';}POS.bundle=r;document.getElementById('posBundle').value=code;modalTutup();gambarRingkasan();toast('Bundle '+r.code+' aktif: hemat '+rupiah(r.discount)+'.');}).catch(function(e){toast(e.message,true);});
  }}]);
}

function terapkanKuponPOS() {
  var code = (document.getElementById('posCoupon').value || '').trim();
  if (!code) { toast('Masukkan kode kupon terlebih dahulu.', true); return; }
  if (POS.bundle) { POS.bundle = null; document.getElementById('posBundle').value = ''; }
  if (!POS.customer.terdaftar) { toast('Pilih pelanggan terdaftar terlebih dahulu.', true); return; }
  promoApi('validate', { code: code, nomor_wa: POS.customer.wa, tipe_customer: document.getElementById('posTipe').value, subtotal: subtotalPOS() }).then(function (r) {
    POS.coupon = r; gambarRingkasan(); toast('Kupon ' + r.code + ' aktif: potongan ' + rupiah(r.discount) + '.');
  }).catch(function (e) { POS.coupon = null; gambarRingkasan(); toast(e.message, true); });
}

function terapkanBundlePOS() {
  var code=(document.getElementById('posBundle').value||'').trim();
  if(!code){toast('Masukkan kode fixed bundle terlebih dahulu.',true);return;}
  if(POS.coupon){POS.coupon=null;document.getElementById('posCoupon').value='';}
  promoApi('bundleValidate',{code:code,tipe_customer:document.getElementById('posTipe').value,items:POS.items.map(function(it){return {kode:it.kode,qty:it.qty};})}).then(function(r){POS.bundle=r;gambarRingkasan();toast('Bundle '+r.code+' aktif: hemat '+rupiah(r.discount)+'.');}).catch(function(e){POS.bundle=null;gambarRingkasan();toast(e.message,true);});
}

function hitungUlangHarga() {
  var tipe = document.getElementById('posTipe').value;
  Promise.all(POS.items.map(function (it) {
    return api('pos.cariBarang', { q: it.kode, tipe: tipe }).then(function (list) {
      var m = list.filter(function (x) { return x.Kode_Obat === it.kode; })[0];
      if (m) it.harga = m.harga;
    });
  })).then(gambarKeranjang).catch(function () {});
}

function gambarKeranjang() {
  if (POS.bundle) { POS.bundle = null; var bi = document.getElementById('posBundle'); if (bi) bi.value = ''; }
  var box = document.getElementById('posCart');
  if (!box) return;
  var paketSet = kodePaketSet();

  if (!POS.items.length) {
    box.innerHTML = '<div class="empty">Keranjang kosong. Scan barcode atau ketik nama obat di atas.</div>';
  } else {
    box.innerHTML = POS.items.map(function (it, i) {
      return '<div class="ci-wrap"><button type="button" class="ci-del" data-aksi="hapus" data-i="' + i + '" aria-label="Hapus ' + esc(it.nama) + '">' +
        '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>Hapus</button>' +
        '<div class="cart-item">' +
        '<div>' +
          '<div class="cart-nama">' + esc(it.nama) + (paketSet[it.kode] ? '<span class="pp-badge">🏷 Paket</span>' : '') + '</div>' +
          '<div class="cart-meta">' +
            '<span>' + esc(it.kode) + '</span>' +
            (it.batch ? '<span>batch ' + esc(it.batch) + '</span>' : '') +
            chipExpired(it.sisa_hari, it.expired) +
            '<span>' + rupiah(it.harga) + ' / ' + esc(it.satuan || 'pcs') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="cart-kanan">' +
          '<div class="qty">' +
            '<button data-aksi="minus" data-i="' + i + '" aria-label="Kurangi">−</button>' +
            '<input class="num" type="number" min="1" value="' + it.qty + '" data-qty="' + i + '">' +
            '<button data-aksi="plus" data-i="' + i + '" aria-label="Tambah">+</button>' +
          '</div>' +
          '<div class="cart-sub num">' + rupiah(it.harga * it.qty) + '</div>' +
          '<button class="icon-btn" data-aksi="hapus" data-i="' + i + '" aria-label="Hapus">' +
            '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
        '</div>' +
      '</div></div>';
    }).join('');
  }

  var jml = POS.items.reduce(function (a, it) { return a + it.qty; }, 0);
  document.getElementById('posJumlah').textContent = angka(jml) + ' item';
  if (POS.diskonMode === 'persen') perbaruiDiskonPOS();
  else gambarRingkasan();
}

function bukaRewardPOS(c) {
  if (c.Tipe_Customer === 'Apotek Lain') { toast('Pelanggan Apotek Lain tidak memiliki poin atau reward.', true); return; }
  api('reward.list', { wa: c.Nomor_WA }).then(function (rows) {
    var html = '<p class="sub">Saldo pelanggan: <strong>' + angka(c.Total_Points || 0) + ' poin</strong></p><div class="pos-reward-list">' + (rows.length ? rows.map(function (r) { var nilai = c.Tipe_Customer === 'Tenaga Kesehatan' ? Math.floor(Number(r.reward_value || 0) / 2) : Number(r.reward_value || 0); var tampil = Object.assign({}, r, { reward_value: nilai, name: c.Tipe_Customer === 'Tenaga Kesehatan' ? 'Diskon ' + rupiah(nilai) : r.name }); return '<div class="pos-reward-item"><div><strong>' + esc(tampil.name) + '</strong><span>' + angka(tampil.points_required) + ' poin · ' + rupiah(nilai) + '</span></div><button class="btn btn-sm" data-reward=\'' + esc(JSON.stringify(tampil)) + '\'' + (r.eligible ? '' : ' disabled') + '>' + (r.eligible ? 'Pilih' : 'Belum cukup') + '</button></div>'; }).join('') : '<div class="empty">Belum ada reward aktif.</div>') + '</div>';
    modalBuka('Tukar poin pelanggan', html, [{ label: 'Tutup', aksi: modalTutup }]);
    var body = document.querySelector('.modal-body') || document.querySelector('.modal');
    if (body) body.onclick = function (e) { var b = e.target.closest('[data-reward]'); if (!b) return; var r = JSON.parse(b.dataset.reward); POS.reward = r; POS.rewardDiscount = Number(r.reward_value || 0); modalTutup(); gambarRingkasan(); toast(r.name + ' dipilih.'); };
  }).catch(function (e) { toast(e.message, true); });
}

function subtotalPOS() {
  return POS.items.reduce(function (a, it) { return a + it.harga * it.qty; }, 0);
}

function perbaruiDiskonPOS() {
  var input = document.getElementById('posDiskon');
  var raw = Math.max(0, Number(input.value) || 0);
  if (POS.diskonMode === 'persen') raw = Math.min(100, raw);
  POS.diskon = POS.diskonMode === 'persen' ? subtotalPOS() * raw / 100 : raw;
  gambarRingkasan();
}

function gambarRingkasan() {
  var elSub = document.getElementById('paySub');
  if (!elSub) return;
  var sub = subtotalPOS();
  var total = Math.max(0, sub - (POS.diskon || 0) - (POS.rewardDiscount || 0) - (POS.coupon ? Number(POS.coupon.discount || 0) : 0) - (POS.bundle ? Number(POS.bundle.discount || 0) : 0));
  var kembali = (POS.bayar || 0) - total;

  elSub.textContent = rupiah(sub);
  var rr = document.getElementById('posRewardRow');
  if (rr) { rr.hidden = !POS.reward; if (POS.reward) { document.getElementById('posRewardName').textContent = POS.reward.name; document.getElementById('posRewardValue').textContent = '-' + rupiah(POS.rewardDiscount); } }
  var br = document.getElementById('posBundleRow');
  if (br) { br.hidden = !POS.bundle; if (POS.bundle) { document.getElementById('posBundleName').textContent = POS.bundle.name; document.getElementById('posBundleValue').textContent = '-' + rupiah(POS.bundle.discount); } }
  var cr = document.getElementById('posCouponRow');
  if (cr) { cr.hidden = !POS.coupon; if (POS.coupon) { document.getElementById('posCouponName').textContent = POS.coupon.code; document.getElementById('posCouponValue').textContent = '-' + rupiah(POS.coupon.discount); } }
  document.getElementById('payTotal').textContent = rupiah(total);
  var k = document.getElementById('payKembali');
  k.textContent = rupiah(kembali);
  // Tiga kelas: kurang (negatif), nol/belum bayar (abu), cukup (positif).
  var kelasKembali = 'kembalian';
  if (kembali < 0) kelasKembali += ' is-kurang';
  else if (kembali === 0 && POS.bayar > 0) kelasKembali += ' is-pas';
  else if (kembali > 0) kelasKembali += ' is-ada';
  k.className = kelasKembali;
  document.getElementById('posSimpan').disabled = (!POS.items.length || kembali < 0);

  var quick = document.getElementById('posCashQuick');
  if (quick) {
    // Pecahan khas Indonesia yang paling sering dipakai, plus pembulatan ke atas.
    var pilihan = [total];
    var pas = Math.ceil(total / 500) * 500;
    if (pas > total) pilihan.push(pas);
    pilihan = pilihan.concat([50000, 100000, 200000]
      .filter(function (v) { return v > total; }));
    var unik = pilihan.filter(function (v, i, arr) {
      return v > 0 && arr.indexOf(v) === i;
    }).slice(0, 5);
    quick.innerHTML = unik.map(function (v) {
      var label = (v === total) ? 'Uang Pas' : rupiah(v);
      return '<button type="button" data-cash="' + v + '"' +
        (v === total ? ' class="is-pas"' : '') + '>' + label + '</button>';
    }).join('');
    quick.onclick = function (e) {
      var b = e.target.closest('[data-cash]');
      if (!b) return;
      POS.bayar = Number(b.dataset.cash);
      document.getElementById('posBayar').value = POS.bayar;
      gambarRingkasan();
    };
  }
  gambarPromoPOS();
}

function contohNotaPreview_() {
  return { Apotek:'Apotek Fa-Mitra', No_Nota:'CONTOH-PREVIEW', Tanggal:'24/09/2026', Jam:'15:00', Petugas:'Kasir', Shift:'Sore', Nama_Pelanggan:'Pelanggan Contoh', Subtotal:38500, Diskon:3500, Harga_Akhir:35000, Bayar:50000, Kembalian:15000, items:[{Nama_Obat:'Acifar Cream',Qty:1,Harga_Satuan:8500,Subtotal:8500},{Nama_Obat:'Paracetamol 500 mg',Qty:2,Harga_Satuan:5000,Subtotal:10000},{Nama_Obat:'Vitamin C 500 mg Tablet',Qty:2,Harga_Satuan:10000,Subtotal:20000}] };
}

function htmlStrukPreview_(nota, lebar) {
  var rows=nota.items.map(function(it){return '<tr><td colspan="2">'+esc(it.Nama_Obat)+'</td></tr><tr><td>'+it.Qty+' x '+angka(it.Harga_Satuan)+'</td><td class="r">'+angka(it.Subtotal)+'</td></tr>';}).join('');
  return '<div class="preview-receipt '+(lebar==='80'?'w80':'w58')+'" id="previewReceiptSheet"><div class="ctr"><strong>'+esc(nota.Apotek)+'</strong><br>Nota '+esc(nota.No_Nota)+'</div><hr><div>'+esc(nota.Tanggal)+' '+esc(nota.Jam)+'</div><div>Kasir: '+esc(nota.Petugas)+' ('+esc(nota.Shift)+')</div><div>Pembeli: '+esc(nota.Nama_Pelanggan)+'</div><hr><table>'+rows+'</table><hr><table><tr><td>Subtotal</td><td class="r">'+angka(nota.Subtotal)+'</td></tr><tr><td>Diskon</td><td class="r">-'+angka(nota.Diskon)+'</td></tr><tr><td><strong>TOTAL</strong></td><td class="r"><strong>'+angka(nota.Harga_Akhir)+'</strong></td></tr><tr><td>Tunai</td><td class="r">'+angka(nota.Bayar)+'</td></tr><tr><td>Kembali</td><td class="r">'+angka(nota.Kembalian)+'</td></tr></table><hr><div class="ctr">Terima kasih atas kunjungan Anda<br>Semoga lekas sembuh</div></div>';
}

function bukaPreviewStruk() {
  var lebar=(document.getElementById('posLebar')||{}).value || POS.lebarStruk || '58';
  var nota=contohNotaPreview_();
  modalBuka('Pratinjau struk — '+lebar+' mm','<div class="preview-toolbar"><label class="field"><span>Ukuran preview</span><select id="previewWidth" class="inp"><option value="58" '+(lebar==='58'?'selected':'')+'>Thermal 58 mm</option><option value="80" '+(lebar==='80'?'selected':'')+'>Thermal 80 mm</option></select></label><p class="sub">Ini hanya data contoh. Tidak membuat transaksi dan tidak mengurangi stok.</p></div><div id="previewReceiptWrap">'+htmlStrukPreview_(nota,lebar)+'</div>',[{label:'Tutup',aksi:modalTutup},{label:'Cetak contoh',kelas:'btn-primary',aksi:function(){var sheet=document.getElementById('previewReceiptSheet');var old=document.getElementById('struk');old.className='struk'+(document.getElementById('previewWidth').value==='80'?' w80':'');old.innerHTML=sheet.innerHTML;setTimeout(function(){window.print();},120);}}]);
  document.getElementById('previewWidth').onchange=function(){var x=this.value;document.getElementById('modalTitle').textContent='Pratinjau struk — '+x+' mm';document.getElementById('previewReceiptWrap').innerHTML=htmlStrukPreview_(nota,x);};
}

/* --------------------------------------------------------- Simpan & cetak */

function simpanTransaksi() {
  if (!POS.items.length) { toast('Keranjang masih kosong.', true); return; }
  var total = Math.max(0, subtotalPOS() - (POS.diskon || 0) - (POS.rewardDiscount || 0) - (POS.coupon ? Number(POS.coupon.discount || 0) : 0) - (POS.bundle ? Number(POS.bundle.discount || 0) : 0));
  if ((POS.bayar || 0) < total) { toast('Uang tunai belum mencukupi total belanja.', true); return; }
  var btn = document.getElementById('posSimpan');
  btn.disabled = true; btn.textContent = 'Menyimpan…';
  var payload = {
    nomor_wa: document.getElementById('posWA').value.trim(),
    nama_pelanggan: document.getElementById('posNama').value.trim() || 'Umum',
    tipe_customer: document.getElementById('posTipe').value,
    items: POS.items.map(function (it) { return { kode: it.kode, qty: it.qty, harga: it.harga }; }),
    diskon: POS.diskon || 0,
    reward_id: POS.reward ? POS.reward.id : null,
    bayar: POS.bayar || 0
  };
  var request = POS.bundle ? promoApi('bundleCheckout', Object.assign({}, payload, { bundle_code: POS.bundle.code })) : (POS.coupon ? promoApi('checkout', Object.assign({}, payload, { coupon_code: POS.coupon.code })) : api('pos.simpanTransaksi', payload));
  request.then(function (nota) {
    toast('Nota ' + nota.No_Nota + ' tersimpan.');
    cetakStruk(nota);
    kosongkanKeranjang();
    if (!layarSentuh()) document.getElementById('posCari').focus();
    if (window.haptik) window.haptik([20, 40, 20]);
  }).catch(function (e) {
    toast(e.message, true);
  }).then(function () {
    btn.textContent = 'Simpan & cetak struk';
    gambarRingkasan();
  });
}

function cetakStruk(nota) {
  var baris = nota.items.map(function (it) {
    return '<tr><td colspan="2">' + esc(it.Nama_Obat) + '</td></tr>' +
      '<tr><td>' + it.Qty + ' x ' + angka(it.Harga_Satuan) + '</td>' +
      '<td class="r">' + angka(it.Subtotal) + '</td></tr>';
  }).join('');

  var el = document.getElementById('struk');
  el.className = 'struk' + (POS.lebarStruk === '80' ? ' w80' : '');
  el.innerHTML =
    '<div class="ctr"><strong>' + esc(nota.Apotek) + '</strong><br>Nota ' + esc(nota.No_Nota) + '</div>' +
    '<hr>' +
    '<div>' + esc(nota.Tanggal) + ' ' + esc(nota.Jam) + '</div>' +
    '<div>Kasir: ' + esc(nota.Petugas) + ' (' + esc(nota.Shift) + ')</div>' +
    '<div>Pembeli: ' + esc(nota.Nama_Pelanggan) + '</div>' +
    '<hr>' +
    '<table>' + baris + '</table>' +
    '<hr>' +
    '<table>' +
      '<tr><td>Subtotal</td><td class="r">' + angka(nota.Subtotal) + '</td></tr>' +
      (nota.Diskon ? '<tr><td>Diskon</td><td class="r">-' + angka(nota.Diskon) + '</td></tr>' : '') +
      '<tr><td><strong>TOTAL</strong></td><td class="r"><strong>' + angka(nota.Harga_Akhir) + '</strong></td></tr>' +
      '<tr><td>Tunai</td><td class="r">' + angka(nota.Bayar) + '</td></tr>' +
      '<tr><td>Kembali</td><td class="r">' + angka(nota.Kembalian) + '</td></tr>' +
    '</table>' +
    '<hr>' +
    (Number(nota.Diskon) > 0 ? '<div class="ctr"><strong>Anda hemat Rp' + angka(nota.Diskon) + '</strong></div><hr>' : '') +
    '<div class="ctr">Terima kasih atas kunjungan Anda<br>Semoga lekas sembuh</div>';

  setTimeout(function () { window.print(); }, 120);
}

/* ======================================================= Promo interaktif
   Kupon (otomatis untuk pelanggan terdaftar), paket/bundle (hanya SARAN,
   kasir ketuk Pakai), saran tambah item, progres undian, badge paket, dan
   ringkasan hemat. Data dari promo action `posPromo`; validasi akhir tetap
   di server (validate / bundleValidate / checkout). Satu promo per transaksi. */
POS.promo = { bundles: [], kupon: [], undian: [] };

function muatPromoPOS() {
  var wa = POS.customer && POS.customer.terdaftar ? POS.customer.wa : '';
  var tipe = (document.getElementById('posTipe') || {}).value || 'Umum';
  promoApi('posPromo', { nomor_wa: wa, tipe_customer: tipe }).then(function (d) {
    POS.promo = { bundles: d.bundles || [], kupon: d.kupon || [], undian: d.undian || [] };
    gambarPromoPOS();
  }).catch(function () { POS.promo = { bundles: [], kupon: [], undian: [] }; gambarPromoPOS(); });
}

function kodePaketSet() {
  var set = {};
  (POS.promo.bundles || []).forEach(function (b) { b.items.forEach(function (i) { set[i.kode] = true; }); });
  return set;
}

function totalBayarPOS() {
  return Math.max(0, subtotalPOS() - (POS.diskon || 0) - (POS.rewardDiscount || 0) -
    (POS.coupon ? Number(POS.coupon.discount || 0) : 0) - (POS.bundle ? Number(POS.bundle.discount || 0) : 0));
}

function singkatRpPOS(n) {
  n = Math.round(Number(n) || 0);
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + 'jt';
  if (n >= 1e3) return (n / 1e3).toFixed(n % 1000 && n < 1e4 ? 1 : 0).replace('.', ',') + 'rb';
  return String(n);
}

function evaluasiPaket() {
  var tipe = (document.getElementById('posTipe') || {}).value || 'Umum';
  var diKeranjang = {};
  POS.items.forEach(function (it) { diKeranjang[it.kode] = (diKeranjang[it.kode] || 0) + it.qty; });
  return (POS.promo.bundles || []).map(function (b) {
    var dasar = 0, terpenuhi = 0, kurang = [], relevan = false;
    b.items.forEach(function (i) {
      dasar += (i.harga[tipe] || 0) * i.qty;
      var ada = diKeranjang[i.kode] || 0;
      if (ada > 0) relevan = true;
      if (ada >= i.qty) terpenuhi++; else kurang.push({ kode: i.kode, nama: i.nama, qty: i.qty - ada });
    });
    return { b: b, hemat: dasar - b.bundle_price, terpenuhi: terpenuhi, total: b.items.length, kurang: kurang, relevan: relevan };
  }).filter(function (x) {
    // tampil jika cocok, atau hampir (ada isinya di keranjang & kurang 1 jenis produk)
    return x.hemat > 0 && x.relevan && (x.kurang.length === 0 || x.kurang.length === 1);
  }).sort(function (a, b) { return (a.kurang.length - b.kurang.length) || (b.hemat - a.hemat); }).slice(0, 4);
}

function potonganKupon(k, sub) {
  if (k.discount_type === 'PERCENT') return Math.min(sub * k.discount_value / 100, k.max_discount == null ? sub : k.max_discount);
  return Math.min(k.discount_value, sub);
}

function tiketHtml(o) {
  return '<div class="tk' + (o.kelas ? ' ' + o.kelas : '') + '">' +
    (o.terbaik ? '<span class="tk-terbaik">Paling hemat</span>' : '') +
    '<div class="tk-stub"><small>' + esc(o.stubKecil) + '</small><b>' + esc(o.stubBesar) + '</b></div>' +
    '<div class="tk-isi"><div class="tk-nama" title="' + esc(o.nama) + '">' + esc(o.nama) + '</div>' +
      '<div class="tk-syarat">' + o.syarat + '</div>' +
      '<button type="button" class="tk-btn" ' + o.aksi + (o.nonaktif ? ' disabled' : '') + '>' + esc(o.tombol) + '</button></div></div>';
}

var _revalidasiKupon = null;
function gambarPromoPOS() {
  var rail = document.getElementById('posPromoRail');
  var kup = document.getElementById('posPromoKupon');
  if (!rail || !kup) return;
  var sub = subtotalPOS();

  // Kupon lama dihitung pada subtotal lama → validasi ulang saat keranjang berubah.
  if (POS.coupon && POS.coupon._sub !== sub && POS.items.length) {
    clearTimeout(_revalidasiKupon);
    var kode = POS.coupon.code;
    _revalidasiKupon = setTimeout(function () { terapkanKodeKupon(kode, true); }, 400);
  }

  var paket = POS.items.length ? evaluasiPaket() : [];
  var kupon = POS.customer && POS.customer.terdaftar ? (POS.promo.kupon || []) : [];
  var hematKupon = kupon.map(function (k) { return sub >= k.min_purchase && sub > 0 ? potonganKupon(k, sub) : 0; });
  var terbaik = Math.max.apply(null, [0].concat(paket.filter(function (p) { return !p.kurang.length; }).map(function (p) { return p.hemat; }), hematKupon));

  // Tiket paket di keranjang
  rail.innerHTML = paket.length ? '<div class="tk-head"><span>Promo untuk keranjang ini</span><span>🏷 ' + paket.length + '</span></div>' +
    '<div class="tk-rail">' + paket.map(function (p, i) {
      var dots = '<span class="tk-dots">' + p.b.items.map(function (_, j) { return '<i' + (j < p.terpenuhi ? ' class="on"' : '') + '></i>'; }).join('') + '</span>';
      var dipakai = POS.bundle && POS.bundle.code === p.b.code;
      if (!p.kurang.length) {
        return tiketHtml({ stubKecil: 'HEMAT', stubBesar: singkatRpPOS(p.hemat), nama: p.b.name,
          syarat: dots + ' ' + p.total + '/' + p.total + ' produk', tombol: dipakai ? 'Terpasang ✓' : 'Pakai paket',
          aksi: 'data-paket="' + esc(p.b.code) + '"', nonaktif: dipakai, kelas: dipakai ? 'terpasang' : '', terbaik: !dipakai && p.hemat === terbaik });
      }
      var k = p.kurang[0];
      return tiketHtml({ kelas: 'hampir', stubKecil: 'HEMAT', stubBesar: singkatRpPOS(p.hemat), nama: p.b.name,
        syarat: dots + ' kurang ' + k.qty + '× ' + esc(k.nama), tombol: '+ ' + k.nama.split(' ')[0] + ' & pakai',
        aksi: 'data-lengkapi="' + esc(p.b.code) + '"' });
    }).join('') + '</div>' : '';

  // Tiket kupon di kartu pelanggan
  kup.innerHTML = kupon.length ? '<div class="tk-head"><span>Kupon untuk pelanggan ini</span><span>' + kupon.length + ' kupon</span></div>' +
    '<div class="tk-rail">' + kupon.map(function (k, i) {
      var dipakai = POS.coupon && POS.coupon.code === k.code;
      var syaratDasar = (k.discount_type === 'PERCENT' ? k.discount_value + '%' + (k.max_discount ? ' · maks ' + singkatRpPOS(k.max_discount) : '') : 'potongan ' + singkatRpPOS(k.discount_value));
      if (sub < k.min_purchase || sub <= 0) {
        var pct = k.min_purchase ? Math.min(100, sub / k.min_purchase * 100) : 0;
        return tiketHtml({ kelas: 'kecil hampir', stubKecil: 'KURANG', stubBesar: singkatRpPOS(k.min_purchase - sub), nama: k.name,
          syarat: '<span class="tk-kurang"><i style="width:' + pct.toFixed(0) + '%"></i></span> ' + syaratDasar,
          tombol: 'Tambah belanja', aksi: 'data-fokus-cari="1"' });
      }
      return tiketHtml({ kelas: 'kecil' + (dipakai ? ' terpasang' : ''), stubKecil: 'HEMAT', stubBesar: singkatRpPOS(hematKupon[i]), nama: k.name,
        syarat: syaratDasar, tombol: dipakai ? 'Terpasang ✓' : 'Pakai', aksi: 'data-kupon="' + esc(k.code) + '"', nonaktif: dipakai,
        terbaik: !dipakai && hematKupon[i] === terbaik && terbaik > 0 });
    }).join('') + '</div>' : '';

  // Hemat & undian di panel bayar
  var hemat = (POS.diskon || 0) + (POS.rewardDiscount || 0) + (POS.coupon ? Number(POS.coupon.discount || 0) : 0) + (POS.bundle ? Number(POS.bundle.discount || 0) : 0);
  var elHemat = document.getElementById('posHemat');
  if (elHemat) { elHemat.hidden = !(hemat > 0 && POS.items.length); elHemat.textContent = '🎉 Pembeli hemat ' + rupiah(hemat); }
  var elUndian = document.getElementById('posUndian');
  if (elUndian) {
    var u = (POS.promo.undian || [])[0];
    if (!u || !POS.items.length) { elUndian.innerHTML = ''; }
    else {
      var total = totalBayarPOS(), min = u.min_belanja || 0;
      var pct = min ? Math.min(1, total / min) : 1, r = 15, kel = 2 * Math.PI * r;
      elUndian.innerHTML = '<div class="pay-undian' + (pct >= 1 ? ' lolos' : '') + '">' +
        '<svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="' + r + '" class="u-dasar"/>' +
        '<circle cx="18" cy="18" r="' + r + '" class="u-isi" stroke-dasharray="' + kel.toFixed(1) + '" stroke-dashoffset="' + (kel * (1 - pct)).toFixed(1) + '" transform="rotate(-90 18 18)"/>' +
        '<text x="18" y="22" text-anchor="middle" font-size="11">🎁</text></svg>' +
        '<div>' + (pct >= 1 ? '✓ Ikut <b>' + esc(u.nama) + '</b>' : rupiah(min - total) + ' lagi ikut <b>' + esc(u.nama) + '</b>') + '</div></div>';
    }
  }
}

function terapkanKodePaket(code) {
  promoApi('bundleValidate', { code: code, tipe_customer: document.getElementById('posTipe').value,
    items: POS.items.map(function (it) { return { kode: it.kode, qty: it.qty }; }) }).then(function (r) {
    if (POS.coupon) { POS.coupon = null; document.getElementById('posCoupon').value = ''; }
    POS.bundle = r; document.getElementById('posBundle').value = code;
    gambarRingkasan(); toast('"' + r.name + '" terpasang: hemat ' + rupiah(r.discount) + '.');
  }).catch(function (e) { toast(e.message, true); });
}

function terapkanKodeKupon(code, diam) {
  if (!POS.customer.terdaftar) { toast('Kupon hanya untuk pelanggan terdaftar. Masukkan nomor WA dulu.', true); return; }
  promoApi('validate', { code: code, nomor_wa: POS.customer.wa, tipe_customer: document.getElementById('posTipe').value, subtotal: subtotalPOS() }).then(function (r) {
    if (POS.bundle) { POS.bundle = null; document.getElementById('posBundle').value = ''; }
    r._sub = subtotalPOS();
    POS.coupon = r; document.getElementById('posCoupon').value = code;
    gambarRingkasan();
    if (!diam) toast('Kupon ' + r.code + ' terpasang: potongan ' + rupiah(r.discount) + '.');
  }).catch(function (e) {
    if (diam) { POS.coupon = null; document.getElementById('posCoupon').value = ''; gambarRingkasan(); }
    toast(diam ? 'Kupon dilepas: ' + e.message : e.message, true);
  });
}

/* Lengkapi paket: tambah produk yang kurang ke keranjang lalu pasang paketnya. */
function lengkapiPaket(code) {
  var p = evaluasiPaket().filter(function (x) { return x.b.code === code; })[0];
  if (!p) return;
  var tipe = document.getElementById('posTipe').value;
  Promise.all(p.kurang.map(function (k) {
    return api('pos.cariBarang', { q: k.kode, tipe: tipe }).then(function (list) {
      var m = list.filter(function (x) { return x.Kode_Obat === k.kode; })[0];
      if (!m) throw new Error(k.nama + ' tidak ditemukan.');
      if (m.stok < k.qty) throw new Error('Stok ' + k.nama + ' tidak cukup.');
      return { m: m, qty: k.qty };
    });
  })).then(function (hasil) {
    hasil.forEach(function (h) {
      var idx = -1;
      POS.items.forEach(function (it, i) { if (it.kode === h.m.Kode_Obat) idx = i; });
      if (idx >= 0) POS.items[idx].qty += h.qty;
      else POS.items.push({ kode: h.m.Kode_Obat, nama: h.m.Nama_Obat, satuan: h.m.Satuan, harga: h.m.harga,
        qty: h.qty, stok: h.m.stok, batch: h.m.batch_terdekat, expired: h.m.expired, sisa_hari: h.m.sisa_hari });
    });
    gambarKeranjang();
    terapkanKodePaket(code);
  }).catch(function (e) { toast(e.message, true); });
}

/* Cadangan: pembeli membawa kode yang tidak muncul otomatis. */
function bukaKodePromoPOS() {
  modalBuka('Kode promo', '<label class="field"><span>Kode kupon atau kode paket</span>' +
    '<input id="posModalKode" class="inp" placeholder="Contoh: VIPOKT atau BUNDLE-LUKA"></label>' +
    '<p class="sub">Kupon hanya untuk pelanggan terdaftar. Paket perlu isi keranjang yang sesuai.</p>',
    [{ label: 'Batal', aksi: modalTutup }, { label: 'Pakai', kelas: 'btn-primary', aksi: function () {
      var code = (val('posModalKode') || '').trim().toUpperCase();
      if (!code) { toast('Masukkan kode promo.', true); return; }
      modalTutup();
      var paket = (POS.promo.bundles || []).some(function (b) { return String(b.code).toUpperCase() === code; });
      if (paket || !POS.customer.terdaftar) terapkanKodePaket(code); else terapkanKodeKupon(code);
    } }]);
  setTimeout(function () { var i = document.getElementById('posModalKode'); if (i) i.focus(); }, 50);
}

// Klik tiket (satu pendengar per wadah; wadah dibuat ulang tiap render halaman).
function pasangEventPromoPOS() {
  ['posPromoRail', 'posPromoKupon'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.onclick = function (e) {
      var b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.paket) terapkanKodePaket(b.dataset.paket);
      else if (b.dataset.lengkapi) lengkapiPaket(b.dataset.lengkapi);
      else if (b.dataset.kupon) terapkanKodeKupon(b.dataset.kupon);
      else if (b.dataset.fokusCari) { var c = document.getElementById('posCari'); if (c) c.focus(); }
    };
  });
}
