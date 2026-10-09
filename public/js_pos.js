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
  lebarStruk: '58',
  // Akses cepat "Sering dibeli" — daftarnya TIDAK menyimpan harga (lihat
  // catatan di style.css): harga baru diambil saat tile diklik.
  cepat: [],
  // true selama harga keranjang sedang diambil ulang dari server, supaya kasir
  // tidak menekan Simpan dengan harga tipe pembeli yang lama.
  sedangHitungHarga: false
};

// Riwayat klik kasir di perangkat ini; dipakai melengkapi daftar bila cabang
// belum punya cukup riwayat penjualan. Tidak berisi data pelanggan.
var POS_CEPAT_KEY = 'famitra.pos.cepat.v1';

// Jenis reward poin (loyalty_rewards.reward_type):
//   discount     -> potongan harga; harga jual BERKURANG sebesar nilai_berlaku
//   service      -> layanan gratis; harga jual TIDAK berkurang (nilai_manfaat)
//   free_product -> produk non farmasi gratis; harga jual TIDAK berkurang
// Untuk service/free_product, yang dihitung server adalah nilai manfaatnya
// (untuk laporan), bukan penghematan harga pelanggan.
var NAMA_JENIS_REWARD_POS = { discount: 'Diskon', service: 'Layanan', free_product: 'Produk non farmasi' };

/** Jenis reward yang sah; nilai tak dikenal dianggap `discount` (perilaku lama). */
function jenisRewardPOS_(r) {
  var j = String((r && r.reward_type) || '');
  return NAMA_JENIS_REWARD_POS[j] ? j : 'discount';
}

VIEWS.pos = {
  title: 'Kasir',
  render: function (el) {
    el.innerHTML = tataLetakPOS();
    pasangEventPOS();
    pasangEventPromoPOS();
    pasangEventAksesCepat();
    gambarKeranjang();
    gambarHeaderShift();
    muatPromoPOS();
    muatAksesCepat();
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
          '<div class="pos-cust-field"><input id="posWA" class="inp" type="tel" inputmode="numeric" autocomplete="off" ' +
            'placeholder="Nomor WhatsApp"><div id="posWASuggest" class="suggest pos-cust-suggest" hidden></div></div>' +
          '<div class="pos-cust-field"><input id="posNama" class="inp" type="text" autocomplete="off" placeholder="Nama pembeli (Umum)">' +
            '<div id="posNamaSuggest" class="suggest pos-cust-suggest" hidden></div></div>' +
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
        '<div class="pos-cart-scroll"><div id="posCart" class="cart"></div></div>' +

        /* Akses cepat "Sering dibeli" — satu kartu dengan keranjang. Tile tidak
           memuat harga; begitu diklik, produk diambil ulang dari server. */
        '<div class="pos-quick" id="posQuick">' +
          '<button type="button" class="pq-toggle" id="posQuickToggle" aria-expanded="false" aria-controls="posQuickGrid">' +
            '<strong>Sering dibeli</strong>' +
            '<span class="sub" id="posQuickRingkas">Lihat daftar produk</span>' +
            '<svg class="pq-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
          '</button>' +
          '<div class="pos-quick-head">' +
            '<div><h3>Sering dibeli</h3><p class="sub" id="posQuickSub">Memuat riwayat penjualan…</p></div>' +
            '<span class="sub pq-hint">Klik untuk menambah ke keranjang</span>' +
            '<button type="button" class="link-btn pq-more" id="posQuickMore">Lihat semua</button>' +
          '</div>' +
          '<div class="pq-grid" id="posQuickGrid"></div>' +
        '</div>' +
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
    if (!e.target.closest('.pos-cust-field')) {
      ['posWASuggest', 'posNamaSuggest'].forEach(function (id) {
        var box = document.getElementById(id);
        if (box) box.hidden = true;
      });
    }
  });

  var wa = document.getElementById('posWA');
  wa.addEventListener('keydown', function (e) { if (e.key === 'Enter') cariPelanggan(); });
  wa.addEventListener('blur', function () { if (wa.value.trim()) cariPelanggan(); });
  wa.addEventListener('input', function () { POS.customer.terdaftar = false; });

  function pasangSuggestCustomer(inputId, boxId, mode) {
    var input = document.getElementById(inputId), box = document.getElementById(boxId);
    var customerTimer = null, customerCursor = -1, customerRows = [], requestNo = 0;
    function tutup() { box.hidden = true; customerCursor = -1; customerRows = []; }
    function pilih(row) {
      if (!row) return;
      wa.value = row.Nomor_WA || '';
      document.getElementById('posNama').value = row.Nama || '';
      document.getElementById('posTipe').value = row.Tipe_Customer || 'Umum';
      tutup();
      if (row.Nomor_WA) {
        cariPelanggan();
      } else {
        POS.customer = { wa: '', nama: row.Nama || '', tipe: row.Tipe_Customer || 'Umum', terdaftar: true };
        document.getElementById('posSegmen').innerHTML = '';
        document.getElementById('posInfoCust').innerHTML = '<span>Pelanggan terdaftar, tetapi belum memiliki nomor WA.</span>';
        muatPromoPOS();
      }
    }
    function tampil(rows) {
      customerRows = rows;
      if (!rows.length) { tutup(); return; }
      box.innerHTML = rows.map(function (row, i) {
        return '<button type="button" data-customer-i="' + i + '">' +
          '<div class="s-name">' + esc(row.Nama || 'Tanpa nama') + '</div>' +
          '<div class="s-meta">' + esc(row.Nomor_WA || 'Nomor WA belum diisi') + ' · ' + esc(row.Tipe_Customer || 'Umum') + '</div></button>';
      }).join('');
      box.hidden = false;
    }
    input.addEventListener('input', function () {
      clearTimeout(customerTimer);
      var q = input.value.trim(), current = ++requestNo;
      if (q.length < 1) { tutup(); return; }
      customerTimer = setTimeout(function () {
        api('pos.suggestCustomer', { q: q, mode: mode }).then(function (rows) {
          if (current === requestNo && input.value.trim() === q) tampil(rows || []);
        }).catch(function (e) { if (current === requestNo) toast(e.message, true); });
      }, 160);
    });
    input.addEventListener('keydown', function (e) {
      var buttons = box.querySelectorAll('button[data-customer-i]');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (box.hidden || !buttons.length) return;
        e.preventDefault();
        customerCursor += e.key === 'ArrowDown' ? 1 : -1;
        if (customerCursor < 0) customerCursor = buttons.length - 1;
        if (customerCursor >= buttons.length) customerCursor = 0;
        buttons.forEach(function (b, i) { b.classList.toggle('is-cursor', i === customerCursor); });
      } else if (e.key === 'Enter' && !box.hidden && buttons.length) {
        e.preventDefault(); pilih(customerRows[customerCursor >= 0 ? customerCursor : 0]);
      } else if (e.key === 'Escape') { tutup(); }
    });
    box.addEventListener('mousedown', function (e) {
      var button = e.target.closest('button[data-customer-i]');
      if (button) { e.preventDefault(); pilih(customerRows[Number(button.dataset.customerI)]); }
    });
  }
  pasangSuggestCustomer('posWA', 'posWASuggest', 'wa');
  pasangSuggestCustomer('posNama', 'posNamaSuggest', 'nama');

  document.getElementById('posTipe').addEventListener('change', function () {
    POS.customer.tipe = this.value;
    if (POS.items.length) hitungUlangHarga();
    muatPromoPOS();
  });
  document.getElementById('posNama').addEventListener('input', function () {
    POS.customer.nama = this.value.trim();
    POS.customer.terdaftar = false;
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

/** Harga ikut berubah saat tipe pembeli diganti di tengah transaksi.
    Selama pengambilan ulang berjalan, tombol Simpan dikunci dan item yang tidak
    ketemu ditandai "harga perlu dicek" — jangan diam-diam memakai harga lama. */
function hitungUlangHarga() {
  var tipe = document.getElementById('posTipe').value;
  if (!POS.items.length) return;
  POS.sedangHitungHarga = true;
  gambarRingkasan();
  Promise.all(POS.items.map(function (it) {
    return api('pos.cariBarang', { q: it.kode, tipe: tipe }).then(function (list) {
      var m = list.filter(function (x) { return x.Kode_Obat === it.kode; })[0];
      if (m) { it.harga = m.harga; it.stok = m.stok; it.perluCek = false; }
      else it.perluCek = true;
    }).catch(function () { it.perluCek = true; });
  })).then(function () {
    POS.sedangHitungHarga = false;
    gambarKeranjang();
  });
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
            (it.perluCek ? '<span class="chip chip-cek">harga perlu dicek</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="cart-kanan">' +
          '<div class="qty">' +
            '<button data-aksi="minus" data-i="' + i + '" aria-label="Kurangi">−</button>' +
            '<input class="num" type="number" min="1" value="' + it.qty + '" data-qty="' + i + '">' +
            '<button data-aksi="plus" data-i="' + i + '" aria-label="Tambah">+</button>' +
          '</div>' +
          '<div class="cart-sub num' + (it.perluCek ? ' is-cek' : '') + '">' + rupiah(it.harga * it.qty) + '</div>' +
          '<button class="icon-btn" data-aksi="hapus" data-i="' + i + '" aria-label="Hapus">' +
            '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
        '</div>' +
      '</div></div>';
    }).join('');
  }

  var jml = POS.items.reduce(function (a, it) { return a + it.qty; }, 0);
  document.getElementById('posJumlah').textContent = angka(jml) + ' item';
  aturLipatAksesCepat();
  if (POS.diskonMode === 'persen') perbaruiDiskonPOS();
  else gambarRingkasan();
}

function bukaRewardPOS(c) {
  // Aturan siapa yang boleh menukar (termasuk Apotek Lain) ditentukan pengaturan
  // penukaran per cabang dan diperiksa server; di sini cukup tampilkan daftar reward.
  api('reward.list', { wa: c.Nomor_WA }).then(function (rows) {
    var html = '<p class="sub">Saldo pelanggan: <strong>' + angka(c.Total_Points || 0) + ' poin</strong></p><div class="pos-reward-list">' + (rows.length ? rows.map(function (r) {
      // Nilai potongan datang dari server (nilai_berlaku) dan sudah memperhitungkan
      // faktor tipe pelanggan dari pengaturan penukaran cabang. Frontend TIDAK lagi
      // memotong setengah sendiri, supaya angka di layar sama dengan yang ditagih
      // pos_checkout walau Owner mengubah faktornya.
      // Cadangan `reward_value` dipakai bila server belum mengirim nilai_berlaku
      // (mis. Edge Function `api` belum ter-deploy). Tanpa cadangan ini, seluruh
      // reward akan tampil Rp0 di kasir.
      var nilai = Number(r.nilai_berlaku == null ? (r.reward_value || 0) : r.nilai_berlaku);
      // Jenis reward: hanya `discount` yang mengurangi harga jual. Untuk
      // service/free_product server mengirim nilai_berlaku 0 dan nilai manfaat
      // penuh di nilai_manfaat; cadangan reward_value bila kolomnya belum ada.
      var jenis = jenisRewardPOS_(r);
      var manfaat = Number(r.nilai_manfaat == null ? (r.reward_value || 0) : r.nilai_manfaat);
      var tampil = Object.assign({}, r, { nilai_berlaku: nilai, reward_type: jenis, nilai_manfaat: manfaat });
      var label = r.eligible ? 'Pilih' : (Number(r.faktor_tipe) <= 0 ? 'Tidak bisa' : 'Belum cukup');
      var nilaiTeks = jenis === 'discount'
        ? 'potongan ' + rupiah(nilai)
        : 'senilai ' + rupiah(manfaat) + ' · harga tidak berkurang';
      return '<div class="pos-reward-item"><div><strong>' + esc(r.name) + '</strong><span>' + angka(r.points_required) + ' poin · ' + esc(NAMA_JENIS_REWARD_POS[jenis]) + ' · ' + nilaiTeks + '</span></div><button class="btn btn-sm" data-reward=\'' + esc(JSON.stringify(tampil)) + '\'' + (r.eligible ? '' : ' disabled') + '>' + label + '</button></div>';
    }).join('') : '<div class="empty">Belum ada reward aktif.</div>') + '</div>';
    modalBuka('Tukar poin pelanggan', html, [{ label: 'Tutup', aksi: modalTutup }]);
    var body = document.querySelector('.modal-body') || document.querySelector('.modal');
    // POS.rewardDiscount tetap diisi dari nilai_berlaku: 0 untuk service /
    // free_product, jadi total bayar tidak berubah — memang itu yang diinginkan.
    // reward_type & nilai_manfaat ikut disimpan supaya bisa ditampilkan di baris
    // ringkasan dan struk.
    if (body) body.onclick = function (e) { var b = e.target.closest('[data-reward]'); if (!b) return; var r = JSON.parse(b.dataset.reward); POS.reward = r; POS.rewardDiscount = Number(r.nilai_berlaku || 0); modalTutup(); gambarRingkasan(); toast(r.name + ' dipilih.'); };
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
  if (rr) {
    rr.hidden = !POS.reward;
    if (POS.reward) {
      var namaReward = document.getElementById('posRewardName');
      var nilaiReward = document.getElementById('posRewardValue');
      var jenisReward = jenisRewardPOS_(POS.reward);
      if (jenisReward === 'discount') {
        namaReward.textContent = POS.reward.name;
        nilaiReward.textContent = '-' + rupiah(POS.rewardDiscount);
      } else {
        // Layanan / produk non farmasi: harga jual tidak berkurang, jadi yang
        // ditampilkan nilai manfaatnya — bukan potongan (yang memang Rp0).
        var manfaatReward = Number(POS.reward.nilai_manfaat == null ? 0 : POS.reward.nilai_manfaat);
        namaReward.textContent = POS.reward.name + ' — senilai ' + rupiah(manfaatReward) + ' (tidak mengurangi harga)';
        nilaiReward.textContent = '';
      }
    }
  }
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
  // Tombol Simpan juga dikunci saat harga sedang diambil ulang dari server,
  // supaya tidak ada nota yang memakai harga tipe pembeli yang lama.
  document.getElementById('posSimpan').disabled = (!POS.items.length || kembali < 0 || POS.sedangHitungHarga);

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

/* ----------------------------------------------------------- Akses cepat
   "Sering dibeli" memakai agregat penjualan cabang (action pos.seringDibeli).
   Tile sengaja tidak memuat harga; harga diambil dari server saat tile diklik,
   jadi harga yang tampil di keranjang selalu harga otoritatif untuk tipe
   pembeli yang sedang aktif. */

function bacaRiwayatCepat_() {
  try { return JSON.parse(localStorage.getItem(POS_CEPAT_KEY) || '[]') || []; }
  catch (e) { return []; }
}

function catatRiwayatCepat_(kode, nama) {
  try {
    var arr = bacaRiwayatCepat_().filter(function (x) { return x.kode !== kode; });
    arr.unshift({ kode: kode, nama: nama });
    localStorage.setItem(POS_CEPAT_KEY, JSON.stringify(arr.slice(0, 24)));
  } catch (e) { /* localStorage bisa diblokir; abaikan saja */ }
}

/** Tambal daftar dari riwayat klik kasir di perangkat ini (tanpa backend). */
function lengkapiDariRiwayat_() {
  if (POS.cepat.length >= 12) return;
  var ada = {};
  POS.cepat.forEach(function (x) { ada[x.kode] = true; });
  bacaRiwayatCepat_().forEach(function (h) {
    if (POS.cepat.length >= 12 || ada[h.kode]) return;
    ada[h.kode] = true;
    POS.cepat.push({ kode: h.kode, nama: h.nama, stok: null, sumber: 'riwayat' });
  });
}

function muatAksesCepat() {
  var grid = document.getElementById('posQuickGrid');
  if (!grid) return;
  var q = document.getElementById('posQuick');
  if (q) q.classList.remove('is-penuh');
  grid.innerHTML = '<div class="pq-muat">Memuat…</div>';
  api('pos.seringDibeli', { hari: 30, limit: 12 }).then(function (rows) {
    POS.cepat = (rows || []).map(function (r) {
      return { kode: r.Kode_Obat, nama: r.Nama_Obat, stok: Number(r.stok || 0),
        expired: r.expired || '', sisa_hari: r.sisa_hari, sumber: 'server' };
    });
    lengkapiDariRiwayat_();
    gambarAksesCepat();
  }).catch(function () {
    POS.cepat = [];
    lengkapiDariRiwayat_();
    gambarAksesCepat();
  });
}

function gambarAksesCepat() {
  var grid = document.getElementById('posQuickGrid');
  if (!grid) return;
  var cabang = (document.getElementById('sbCabang') || {}).textContent || '';
  var sub = document.getElementById('posQuickSub');
  if (sub) {
    sub.textContent = POS.cepat.length
      ? '30 hari terakhir' + (cabang && cabang !== '—' ? ' · ' + cabang : '')
      : 'Belum ada riwayat penjualan';
  }
  var ringkas = document.getElementById('posQuickRingkas');
  if (ringkas) ringkas.textContent = POS.cepat.length + ' produk teratas · klik untuk membuka';
  var more = document.getElementById('posQuickMore');
  if (more) more.textContent = 'Lihat semua ' + POS.cepat.length + ' produk →';
  if (!POS.cepat.length) {
    grid.innerHTML = '<div class="empty" style="padding:14px 0">Belum ada riwayat penjualan di cabang ini. ' +
      'Daftar terisi otomatis setelah ada transaksi.</div>';
    return;
  }
  grid.innerHTML = POS.cepat.map(function (t) {
    var habis = t.stok !== null && Number(t.stok) <= 0;
    var badge = t.stok === null
      ? '<span class="chip">riwayat</span>'
      : (habis ? '<span class="chip chip-bad">habis</span>' : '<span class="chip">stok ' + angka(t.stok) + '</span>');
    var ed = (t.sisa_hari !== null && t.sisa_hari !== undefined && t.sisa_hari <= 90)
      ? chipExpired(t.sisa_hari, t.expired) : '';
    return '<button type="button" class="pq-tile' + (habis ? ' is-habis' : '') + '" data-cepat="' + esc(t.kode) + '"' +
      (t.nama ? ' title="' + esc(t.nama) + '"' : '') + '>' +
      '<span class="pq-nama">' + esc(t.nama || t.kode) + '</span>' +
      '<span class="pq-meta">' + badge + ed + '</span></button>';
  }).join('');
}

/** Klik tile: produk diambil ulang dari server (harga & stok terbaru), lalu masuk
    keranjang lewat jalur yang sama dengan hasil scan. */
function tambahDariAksesCepat(kode) {
  if (!kode) return;
  var tipe = document.getElementById('posTipe').value;
  api('pos.cariBarang', { q: kode, tipe: tipe }).then(function (list) {
    var m = list.filter(function (x) { return x.Kode_Obat === kode; })[0];
    if (!m) throw new Error('Produk ' + kode + ' tidak ditemukan atau nonaktif.');
    if (Number(m.stok) <= 0) throw new Error('Stok ' + m.Nama_Obat + ' kosong.');
    tambahKeKeranjang(m);
    catatRiwayatCepat_(m.Kode_Obat, m.Nama_Obat);
  }).catch(function (e) { toast(e.message, true); });
}

/** Keranjang kosong = daftar terbuka; keranjang berisi = melipat jadi satu baris. */
function aturLipatAksesCepat() {
  var q = document.getElementById('posQuick');
  if (!q) return;
  var lipat = POS.items.length > 0;
  q.classList.toggle('is-lipat', lipat);
  if (!lipat) q.classList.remove('is-buka');
  var tog = document.getElementById('posQuickToggle');
  if (tog) tog.setAttribute('aria-expanded', q.classList.contains('is-buka') ? 'true' : 'false');
}

function pasangEventAksesCepat() {
  var tog = document.getElementById('posQuickToggle');
  if (tog) tog.onclick = function () {
    var buka = document.getElementById('posQuick').classList.toggle('is-buka');
    this.setAttribute('aria-expanded', buka ? 'true' : 'false');
  };
  var more = document.getElementById('posQuickMore');
  if (more) more.onclick = function () {
    document.getElementById('posQuick').classList.add('is-penuh');
  };
  var grid = document.getElementById('posQuickGrid');
  if (grid) grid.onclick = function (e) {
    var b = e.target.closest('[data-cepat]');
    if (b) tambahDariAksesCepat(b.dataset.cepat);
  };
  // Saat kasir kembali ke tab ini, stok bisa sudah berubah → ambil ulang daftarnya.
  if (!window.__posAksesCepatMuatan) {
    window.__posAksesCepatMuatan = true;
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && document.getElementById('posQuickGrid')) muatAksesCepat();
    });
  }
}

/* --------------------------------------------------------- Simpan & cetak */

function cariItemPOS_(kode) {
  for (var i = 0; i < POS.items.length; i++) if (POS.items[i].kode === kode) return POS.items[i];
  return null;
}

/** Ambil harga otoritatif dari server TANPA menulis apa pun (pos.cekTotal).
    pos_checkout tetap menghitung ulang sendiri, jadi ini murni pencegahan:
    kasir tahu total sebenarnya sebelum uang diterima. */
function cekHargaOtoritatif_() {
  return api('pos.cekTotal', {
    tipe_customer: document.getElementById('posTipe').value,
    items: POS.items.map(function (it) { return { kode: it.kode, qty: it.qty }; })
  }).then(function (r) {
    if (r.tidak_ada && r.tidak_ada.length) {
      var err = new Error('Barang ini tidak ditemukan atau nonaktif: ' + r.tidak_ada.join(', ') +
        '. Hapus dari keranjang sebelum menyimpan.');
      // Penanda: masalah datanya pasti, jadi penyimpanan harus dihentikan.
      err.blokir = true;
      throw err;
    }
    var beda = [];
    (r.items || []).forEach(function (x) {
      var it = cariItemPOS_(x.kode);
      if (it && Number(x.harga) !== Number(it.harga)) {
        beda.push({ kode: x.kode, nama: x.nama, lama: Number(it.harga), baru: Number(x.harga) });
      }
    });
    return { beda: beda, subtotal: Number(r.subtotal || 0) };
  });
}

/** Kupon/paket divalidasi ulang memakai subtotal otoritatif, bukan subtotal layar. */
function sinkronPromoOtoritatif_(sub) {
  var tipe = document.getElementById('posTipe').value;
  if (POS.bundle) {
    return promoApi('bundleValidate', { code: POS.bundle.code, tipe_customer: tipe,
      items: POS.items.map(function (it) { return { kode: it.kode, qty: it.qty }; }) })
      .then(function (r) { POS.bundle = r; })
      .catch(function () { POS.bundle = null; var i = document.getElementById('posBundle'); if (i) i.value = ''; });
  }
  if (POS.coupon && POS.customer && POS.customer.terdaftar) {
    return promoApi('validate', { code: POS.coupon.code, nomor_wa: POS.customer.wa,
      tipe_customer: tipe, subtotal: sub })
      .then(function (r) { r._sub = sub; POS.coupon = r; })
      .catch(function () { POS.coupon = null; var i = document.getElementById('posCoupon'); if (i) i.value = ''; });
  }
  return Promise.resolve();
}

/** Tampilkan selisih harga dan minta kasir memastikan sebelum nota tersimpan. */
function konfirmasiHargaBerubah_(beda, totalLama, totalBaru, btn) {
  var bayar = POS.bayar || 0;
  var kembaliLama = Math.max(0, bayar - totalLama);
  var kembaliBaru = Math.max(0, bayar - totalBaru);
  var html = '<p class="pos-diff-lead">Harga master berubah sejak item masuk keranjang. ' +
    'Periksa uang tunai dan kembalian sebelum menyimpan.</p>' +
    '<div class="pos-diff">' + beda.map(function (d) {
      return '<div class="pos-diff-row"><span class="pos-diff-nama">' + esc(d.kode) + ' · ' + esc(d.nama) + '</span>' +
        '<span class="pos-diff-lama">' + rupiah(d.lama) + '</span>' +
        '<span class="pos-diff-baru">' + rupiah(d.baru) + '</span></div>';
    }).join('') + '</div>' +
    '<div class="pos-diff-total">' +
      '<div class="pos-diff-baris"><span>Total di layar</span><span>' + rupiah(totalLama) + '</span></div>' +
      '<div class="pos-diff-baris"><span>Total sekarang</span><strong>' + rupiah(totalBaru) + '</strong></div>' +
    '</div>' +
    '<div class="pos-diff-kembali"><span>Kembalian: ' + rupiah(kembaliLama) + ' <b>→ ' + rupiah(kembaliBaru) + '</b></span>' +
      '<span>Selisih ' + rupiah(Math.abs(totalBaru - totalLama)) + '</span></div>';
  modalBuka('Harga berubah sebelum simpan', html, [
    { label: 'Batal', aksi: function () {
        modalTutup();
        btn.disabled = false; btn.textContent = 'Simpan & cetak struk';
        gambarKeranjang();
      } },
    { label: 'Sesuaikan & bayar', kelas: 'btn-primary', aksi: function () {
        modalTutup();
        var total = totalBayarPOS();
        if ((POS.bayar || 0) < total) {
          btn.disabled = false; btn.textContent = 'Simpan & cetak struk';
          gambarKeranjang();
          toast('Uang tunai belum mencukupi total baru ' + rupiah(total) + '. Tambahkan dulu.', true);
          return;
        }
        kirimTransaksi_(total, btn);
      } }
  ]);
}

/** Pemeriksaan harga gagal (jaringan / action belum tersedia) — kasir yang
    memutuskan, bukan terkunci, supaya POS tetap bisa melayani pembeli. */
function konfirmasiCekGagal_(e, total, btn) {
  var pesan = (e && e.message) || 'Tidak bisa menghubungi server.';
  modalBuka('Pemeriksaan harga gagal',
    '<p class="pos-diff-lead">Harga tidak bisa diperiksa ke server: ' + esc(pesan) + '</p>' +
    '<p class="sub">Total di layar <strong>' + rupiah(total) + '</strong>. Harga pada nota tetap dihitung ' +
    'ulang oleh server, dan kalau berbeda kasir akan diberi peringatan setelah nota tersimpan.</p>',
    [
      { label: 'Batal', aksi: modalTutup },
      { label: 'Tetap simpan', kelas: 'btn-primary', aksi: function () { modalTutup(); kirimTransaksi_(total, btn); } }
    ]);
}

function kirimTransaksi_(totalLayar, btn) {
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
  var request = POS.bundle ? promoApi('bundleCheckout', Object.assign({}, payload, { bundle_code: POS.bundle.code }))
    : (POS.coupon ? promoApi('checkout', Object.assign({}, payload, { coupon_code: POS.coupon.code }))
    : api('pos.simpanTransaksi', payload));
  return request.then(function (nota) {
    var totalNota = Number(nota.Harga_Akhir);
    toast('Nota ' + nota.No_Nota + ' tersimpan.');
    // Jaring terakhir: harga bisa berubah tepat di antara pemeriksaan dan simpan.
    // Kalau total nota berbeda dari layar, kasir harus tahu untuk cek kembalian.
    if (isFinite(totalNota) && Math.abs(totalNota - Number(totalLayar)) >= 1) {
      if (window.console && console.warn) console.warn('[POS] total nota tidak sama dengan total layar', { nota: totalNota, layar: totalLayar });
      setTimeout(function () {
        toast('Nota tersimpan dengan total ' + rupiah(totalNota) + ' (layar ' + rupiah(totalLayar) +
          '). Periksa kembalian: ' + rupiah(Number(nota.Kembalian) || 0) + '.', true);
      }, 2600);
    }
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

function simpanTransaksi() {
  if (!POS.items.length) { toast('Keranjang masih kosong.', true); return; }
  var total = totalBayarPOS();
  if ((POS.bayar || 0) < total) { toast('Uang tunai belum mencukupi total belanja.', true); return; }
  var btn = document.getElementById('posSimpan');
  btn.disabled = true; btn.textContent = 'Memeriksa harga…';
  cekHargaOtoritatif_().then(function (hasil) {
    if (!hasil.beda.length) return kirimTransaksi_(total, btn);
    // Pakai harga server lebih dulu, baru minta konfirmasi kasir.
    hasil.beda.forEach(function (d) {
      var it = cariItemPOS_(d.kode);
      if (it) { it.harga = d.baru; it.perluCek = false; }
    });
    if (POS.coupon) POS.coupon._sub = hasil.subtotal;
    return sinkronPromoOtoritatif_(hasil.subtotal).then(function () {
      gambarKeranjang();
      var totalBaru = totalBayarPOS();
      if (totalBaru === total) return kirimTransaksi_(totalBaru, btn);
      return konfirmasiHargaBerubah_(hasil.beda, total, totalBaru, btn);
    });
  }).catch(function (e) {
    btn.textContent = 'Simpan & cetak struk';
    btn.disabled = false;
    gambarRingkasan();
    if (e && e.blokir) { toast(e.message, true); return; }
    // Pemeriksaan harga gagal (jaringan / action belum ter-deploy). Jangan sampai
    // POS tidak bisa menyimpan sama sekali: pos_checkout tetap otoritatif dan
    // total nota masih dibandingkan setelah tersimpan.
    konfirmasiCekGagal_(e, total, btn);
  });
}

function cetakStruk(nota) {
  var baris = nota.items.map(function (it) {
    return '<tr><td colspan="2">' + esc(it.Nama_Obat) + '</td></tr>' +
      '<tr><td>' + it.Qty + ' x ' + angka(it.Harga_Satuan) + '</td>' +
      '<td class="r">' + angka(it.Subtotal) + '</td></tr>';
  }).join('');

  // Reward layanan / produk non farmasi TIDAK mengurangi harga jual, jadi
  // ditulis sebagai keterangan tersendiri dan baris TOTAL tidak diubah.
  // Sumber utama `nota` dari pos_checkout (Reward_Jenis/Reward_Manfaat);
  // POS.reward dipakai sebagai cadangan bila server belum mengirim kolomnya.
  var jenisReward = (nota.Reward_Jenis || (POS.reward && POS.reward.reward_type) || 'discount');
  var barisReward = '';
  if (jenisReward !== 'discount') {
    var namaReward = (POS.reward && POS.reward.name) || 'Reward';
    var manfaatReward = Number(nota.Reward_Manfaat != null ? nota.Reward_Manfaat
      : (POS.reward && POS.reward.nilai_manfaat != null ? POS.reward.nilai_manfaat : 0));
    barisReward = '<div class="ctr">' + esc(namaReward) + ' — senilai ' + rupiah(manfaatReward) + ' (tidak mengurangi harga)</div>';
  }

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
    (barisReward ? '<hr>' + barisReward : '') +
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

  // Hemat & undian di panel bayar.
  // Hanya potongan HARGA yang dihitung hemat: diskon manual, reward `discount`,
  // kupon, dan bundle. Nilai manfaat reward layanan / produk non farmasi TIDAK
  // masuk ke sini karena bukan penghematan harga bagi pelanggan (hanya dicatat
  // untuk laporan).
  var hemat = (POS.diskon || 0) + (POS.rewardDiscount || 0) + (POS.coupon ? Number(POS.coupon.discount || 0) : 0) + (POS.bundle ? Number(POS.bundle.discount || 0) : 0);
  var elHemat = document.getElementById('posHemat');
  if (elHemat) { elHemat.hidden = !(hemat > 0 && POS.items.length); elHemat.textContent = '🎉 Pembeli hemat ' + rupiah(hemat); }
  var elUndian = document.getElementById('posUndian');
  if (elUndian) {
    // Muncul begitu pelanggan terdaftar dipilih, tanpa menunggu barang masuk
    // keranjang. Statusnya dihitung server memakai aturan yang sama dengan
    // penentuan pemenang, jadi tidak mungkin berbeda dari daftar peserta.
    var u = (POS.promo.undian || [])[0];
    if (!u || u.memenuhi === null || u.memenuhi === undefined || !POS.customer || !POS.customer.terdaftar) {
      elUndian.innerHTML = '';
    } else {
      elUndian.innerHTML = '<div class="pay-undian' + (u.memenuhi ? ' lolos' : '') + '">' +
        '<div>🎁 ' + (u.memenuhi ? 'Memenuhi syarat <b>' + esc(u.nama) + '</b>'
                                 : 'Belum memenuhi syarat <b>' + esc(u.nama) + '</b>') + '</div></div>';
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
