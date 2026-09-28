/* ============================================================ Mobile app UI ===
   Perilaku khusus HP (≤880px) supaya terasa seperti aplikasi, tanpa mengubah
   logika halaman lain:
   - bilah bawah per peran (Owner/Apoteker: Beranda di tengah; Kasir: Kasir di tengah)
   - menu sebagai lembar dari bawah (menggantikan menu samping)
   - formulir/dialog sebagai lembar bawah yang bisa diseret turun
   - tabel otomatis jadi kartu (label kolom diambil dari <thead>)
   - keyboard yang sesuai (inputmode), pilihan segmen untuk select kecil
   - tarik-untuk-muat-ulang, transisi halaman, getar ringan
   - scan barcode lewat kamera (Kasir) dan geser-untuk-hapus di keranjang
   Semua ini murni tampilan; validasi & data tetap di server. */
(function () {
  var HP = window.matchMedia ? window.matchMedia('(max-width:880px)') : { matches: false };
  function adalahHP() { return !!HP.matches; }

  /* ---------------------------------------------------------------- Getar */
  window.haptik = function (pola) {
    try { if (navigator.vibrate) navigator.vibrate(pola); } catch (e) { /* tidak didukung */ }
  };

  function ikonSvg(path, kelas) {
    return '<svg class="' + (kelas || 'menu-ikon') + '" viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg>';
  }
  var PATH_MENU = '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/>' +
    '<rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>';
  function pathMenu(id) { return (typeof IKON_MENU !== 'undefined' && IKON_MENU[id]) || '<circle cx="12" cy="12" r="3"/>'; }

  /* ------------------------------------------------- Bilah bawah per peran
     Owner/Apoteker: [Kasir, Barang, BERANDA(tengah), Stok, Menu]
     Kasir         : [Retur, KASIR(tengah), Biaya, Menu]                     */
  var LABEL_PENDEK = { dashboard: 'Beranda', pos: 'Kasir', barang: 'Barang', stok: 'Stok', beli: 'Beli', crm: 'Pelanggan',
    biaya: 'Biaya', retur: 'Retur', opname: 'Opname', laporan: 'Laporan', marketing: 'Promo', user: 'Pengguna', targetOmset: 'Target' };

  function bangunTabbarHP() {
    var tab = document.getElementById('tabbar');
    if (!tab || typeof MENU === 'undefined') return;
    var ada = {};
    MENU.forEach(function (m) { ada[m.id] = m; });
    var role = (typeof SESSION !== 'undefined' && SESSION && SESSION.user) ? SESSION.user.role : '';
    var tengah = role === 'Kasir' ? 'pos' : (ada.dashboard ? 'dashboard' : 'pos');
    var kandidat = role === 'Kasir' ? ['retur', 'biaya'] : ['pos', 'barang', 'stok', 'crm', 'beli', 'opname'];
    var lain = kandidat.filter(function (id) { return ada[id] && id !== tengah; });
    var kiri = role === 'Kasir' ? lain.slice(0, 1) : lain.slice(0, 2);
    var kanan = role === 'Kasir' ? lain.slice(1, 2) : lain.slice(2, 3);

    function tombol(id, jadiTengah) {
      var m = ada[id];
      var b = document.createElement('button');
      b.type = 'button'; b.dataset.id = id;
      if (jadiTengah) b.className = 'tab-tengah';
      var ik = ikonSvg(pathMenu(id));
      b.innerHTML = (jadiTengah ? '<span class="tab-fab">' + ik + '</span>' : ik) +
        '<span class="menu-label"></span>';
      b.querySelector('.menu-label').textContent = LABEL_PENDEK[id] || m.label.split(' ')[0];
      b.setAttribute('aria-label', m.label);
      b.onclick = function () { window.haptik(8); gantiHalaman(id); };
      return b;
    }
    tab.innerHTML = '';
    kiri.forEach(function (id) { tab.appendChild(tombol(id)); });
    if (ada[tengah]) tab.appendChild(tombol(tengah, true));
    kanan.forEach(function (id) { tab.appendChild(tombol(id)); });
    var mb = document.createElement('button');
    mb.type = 'button'; mb.dataset.id = '__menu';
    mb.innerHTML = ikonSvg(PATH_MENU) + '<span class="menu-label">Menu</span>';
    mb.setAttribute('aria-label', 'Buka menu');
    mb.onclick = function () { window.haptik(8); bukaMenuSheet(); };
    tab.appendChild(mb);
    tab.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.id === window.__halamanAktif);
    });
    var av = document.getElementById('topAvatar');
    if (av && SESSION && SESSION.user) {
      av.textContent = String(SESSION.user.nama || '?').trim().split(/\s+/).slice(0, 2)
        .map(function (x) { return x.charAt(0); }).join('').toUpperCase() || '?';
    }
  }

  var _bangunNav = window.bangunNav;
  window.bangunNav = function () { _bangunNav.apply(this, arguments); bangunTabbarHP(); };

  /* ---------------------------------------------------- Ganti halaman + efek */
  var _ganti = window.gantiHalaman;
  window.gantiHalaman = function (id) {
    var boleh = typeof VIEWS !== 'undefined' && VIEWS[id] && MENU.some(function (m) { return m.id === id; });
    _ganti.apply(this, arguments);
    if (!boleh) return;
    window.__halamanAktif = id;
    tutupMenuSheet();
    var v = document.getElementById('view');
    if (v && adalahHP()) { v.classList.remove('pindah'); void v.offsetWidth; v.classList.add('pindah'); }
  };

  /* ---------------------------------------------------------- Seret-untuk-tutup */
  function pasangSeret(kotak, area, tutup) {
    var y0 = null, dy = 0;
    area.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      y0 = e.touches[0].clientY; dy = 0; kotak.style.transition = 'none';
    }, { passive: true });
    area.addEventListener('touchmove', function (e) {
      if (y0 === null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      kotak.style.transform = 'translateY(' + dy + 'px)';
    }, { passive: true });
    area.addEventListener('touchend', function () {
      if (y0 === null) return;
      kotak.style.transition = '';
      var tutupSekarang = dy > 110;
      kotak.style.transform = '';
      y0 = null;
      if (tutupSekarang) tutup();
    }, { passive: true });
  }

  /* ------------------------------------------------------------ Menu (lembar) */
  function tutupMenuSheet() {
    var el = document.getElementById('menuSheet');
    if (!el) return;
    el.classList.remove('buka');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
  }

  function bukaMenuSheet() {
    if (document.getElementById('menuSheet')) return;
    var u = (SESSION && SESSION.user) || {};
    var ini = String(u.nama || '?').trim().split(/\s+/).slice(0, 2).map(function (x) { return x.charAt(0); }).join('').toUpperCase() || '?';
    var cab = (document.getElementById('sbCabang') || {}).textContent || u.cabang_id || '';
    var el = document.createElement('div');
    el.id = 'menuSheet'; el.className = 'sheet-wadah';
    el.innerHTML =
      '<div class="sheet-dim" data-tutup="1"></div>' +
      '<div class="sheet" role="dialog" aria-modal="true" aria-label="Menu">' +
        '<div class="sheet-handle" id="menuHandle"></div>' +
        '<div class="sheet-user"><span class="sheet-avatar">' + esc(ini) + '</span>' +
          '<div class="sheet-user-teks"><b>' + esc(u.nama || '-') + '</b><small>' + esc(labelRole_(u.role) + ' · Cabang ' + cab) + '</small></div>' +
          '<button type="button" class="sheet-keluar" id="menuKeluar">Keluar</button></div>' +
        '<div class="sheet-grid">' + MENU.map(function (m) {
          return '<button type="button" class="sheet-tile' + (m.id === window.__halamanAktif ? ' on' : '') + '" data-id="' + esc(m.id) + '">' +
            '<i>' + ikonSvg(pathMenu(m.id), 'menu-ikon') + '</i><span>' + esc(m.label) + '</span></button>';
        }).join('') + '</div>' +
      '</div>';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('buka'); });
    el.addEventListener('click', function (e) {
      if (e.target.dataset && e.target.dataset.tutup) { tutupMenuSheet(); return; }
      var t = e.target.closest('.sheet-tile');
      if (t) { window.haptik(8); gantiHalaman(t.dataset.id); }
    });
    document.getElementById('menuKeluar').onclick = function () { tutupMenuSheet(); document.getElementById('logoutBtn').click(); };
    var sheet = el.querySelector('.sheet');
    pasangSeret(sheet, document.getElementById('menuHandle'), tutupMenuSheet);
    pasangSeret(sheet, el.querySelector('.sheet-user'), tutupMenuSheet);
  }
  window.bukaMenuSheet = bukaMenuSheet;

  /* -------------------------------------------- Dialog jadi lembar bawah (seret) */
  (function () {
    var head = document.querySelector('#modal .modal-head');
    var box = document.querySelector('#modal .modal-box');
    if (head && box) pasangSeret(box, head, function () { modalTutup(); });
  })();

  /* ----------------------------- Tabel → kartu, keyboard, pilihan segmen (observer) */
  function tandaiTabel() {
    document.querySelectorAll('#view table, #modalBody table').forEach(function (t) {
      if (!t.hasAttribute('data-tk')) {
        var ths = [].slice.call(t.querySelectorAll('thead th'));
        var mati = t.closest('.struk, .preview-receipt, .db-tabel, .pos-pay') || ths.length < 3 || t.getAttribute('data-tk-off') === '1';
        t.setAttribute('data-tk', mati ? 'off' : '1');
        if (!mati) t._label = ths.map(function (th) { return th.textContent.trim(); });
      }
      if (t.getAttribute('data-tk') !== '1') return;
      [].slice.call(t.querySelectorAll('tbody tr:not([data-tkr])')).forEach(function (tr) {
        tr.setAttribute('data-tkr', '1');
        [].slice.call(tr.children).forEach(function (td, i) {
          if (td.colSpan > 1) { tr.classList.add('tk-penuh'); return; }
          var l = (t._label || [])[i] || '';
          if (l) td.setAttribute('data-label', l);
          else if (td.querySelector('button, a')) td.classList.add('tk-aksi');
        });
      });
    });
  }

  function aturKeyboard() {
    document.querySelectorAll('input:not([inputmode])').forEach(function (i) {
      var tipe = (i.getAttribute('type') || 'text').toLowerCase();
      if (tipe === 'number') {
        var step = String(i.getAttribute('step') || '1');
        i.setAttribute('inputmode', (step === 'any' || step.indexOf('.') >= 0) ? 'decimal' : 'numeric');
      } else if (tipe === 'text' && /(^|[^a-z])(wa|telp|hp|phone)([^a-z]|$)/i.test((i.id || '') + ' ' + (i.name || ''))) {
        i.setAttribute('inputmode', 'tel');
      }
    });
  }

  function segmentasi(sel) {
    sel.setAttribute('data-seg-ok', '1');
    var wadah = document.createElement('div');
    wadah.className = 'seg-ctl';
    function gambar() {
      wadah.innerHTML = '';
      var idx = sel.selectedIndex;
      [].slice.call(sel.options).forEach(function (o) {
        if (o.disabled) return;
        var b = document.createElement('button');
        b.type = 'button'; b.textContent = o.textContent;
        b.setAttribute('aria-pressed', (idx >= 0 && !sel.options[idx].disabled && sel.value === o.value) ? 'true' : 'false');
        b.onclick = function () {
          sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
          window.haptik(8); gambar();
        };
        wadah.appendChild(b);
      });
    }
    gambar();
    sel.parentNode.insertBefore(wadah, sel.nextSibling);
    sel.classList.add('seg-asal');
  }
  function segmentasiSemua() {
    document.querySelectorAll('#modalBody select[data-seg]:not([data-seg-ok])').forEach(segmentasi);
  }

  var _antri = false;
  function rapikan() {
    if (_antri) return;
    _antri = true;
    requestAnimationFrame(function () {
      _antri = false;
      tandaiTabel(); aturKeyboard(); segmentasiSemua();
    });
  }
  ['view', 'modalBody'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el && typeof MutationObserver !== 'undefined') new MutationObserver(rapikan).observe(el, { childList: true, subtree: true });
  });

  /* ----------------------------------------------------------- Bilah atas (HP) */
  (function () {
    var tb = document.querySelector('.topbar');
    var meta = document.querySelector('.topbar-meta');
    if (!tb || !meta) return;
    var logo = document.createElement('span');
    logo.className = 'logo tb-logo'; logo.setAttribute('aria-hidden', 'true');
    tb.insertBefore(logo, tb.firstChild);
    var av = document.createElement('button');
    av.type = 'button'; av.id = 'topAvatar'; av.className = 'top-avatar';
    av.setAttribute('aria-label', 'Menu pengguna'); av.textContent = '?';
    av.onclick = bukaMenuSheet;
    meta.appendChild(av);
    var mt = document.getElementById('menuToggle');
    if (mt) mt.onclick = function () { if (adalahHP()) bukaMenuSheet(); else document.querySelector('.sidebar').classList.toggle('is-open'); };
  })();

  /* ------------------------------------------------- Tarik ke bawah untuk muat ulang */
  (function () {
    var ind = document.createElement('div');
    ind.id = 'ptr'; ind.setAttribute('aria-hidden', 'true'); ind.innerHTML = '<span></span>';
    document.body.appendChild(ind);
    var y0 = null, dy = 0;
    function diAtas() {
      return (window.scrollY || 0) <= 0 && (document.body.scrollTop || 0) <= 0 && (document.documentElement.scrollTop || 0) <= 0;
    }
    function reset() { ind.classList.remove('lihat', 'siap'); ind.style.transform = ''; }
    document.addEventListener('touchstart', function (e) {
      y0 = null;
      var app = document.getElementById('appScreen');
      if (!adalahHP() || !app || app.hidden || e.touches.length !== 1 || !diAtas()) return;
      if (window.__halamanAktif === 'pos') return;   // jangan ganggu transaksi berjalan
      if (e.target.closest && e.target.closest('input,textarea,select,.tk-rail,.car,#dbGrafikArea,.db-pil,.db-tabs,.sheet-wadah,#modal:not([hidden]),#scanner,.ci-wrap')) return;
      y0 = e.touches[0].clientY; dy = 0;
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (y0 === null) return;
      dy = e.touches[0].clientY - y0;
      if (dy <= 8) { reset(); return; }
      ind.classList.add('lihat'); ind.classList.toggle('siap', dy > 110);
      ind.style.transform = 'translate(-50%,' + Math.min(dy * 0.45, 64) + 'px)';
    }, { passive: true });
    document.addEventListener('touchend', function () {
      if (y0 === null) return;
      var id = window.__halamanAktif;
      if (dy > 110 && id) {
        window.haptik(12); ind.classList.add('muat');
        setTimeout(function () { gantiHalaman(id); ind.classList.remove('muat'); reset(); }, 450);
      } else reset();
      y0 = null; dy = 0;
    }, { passive: true });
  })();

  /* ---------------------------------------------------------------- Kasir */
  if (typeof tambahKeKeranjang === 'function') {
    var _tambah = tambahKeKeranjang;
    window.tambahKeKeranjang = tambahKeKeranjang = function (b) { var r = _tambah(b); window.haptik(12); return r; };
  }

  // Geser item keranjang ke kiri → tombol Hapus; geser jauh → langsung hapus.
  (function () {
    var LEBAR = 88, x0 = 0, y0 = 0, awal = 0, off = 0, sumbu = null, wrap = null, item = null;
    function tutupLain(kecuali) {
      document.querySelectorAll('.ci-wrap.buka').forEach(function (w) {
        if (w === kecuali) return;
        w.classList.remove('buka');
        var it = w.querySelector('.cart-item'); if (it) it.style.transform = '';
      });
    }
    document.addEventListener('touchstart', function (e) {
      wrap = (e.target.closest && e.target.closest('.ci-wrap')) || null;
      if (!wrap || !adalahHP() || e.touches.length !== 1 || e.target.closest('.qty, .ci-del')) { wrap = null; tutupLain(null); return; }
      item = wrap.querySelector('.cart-item');
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; sumbu = null;
      awal = wrap.classList.contains('buka') ? -LEBAR : 0; off = awal;
      tutupLain(wrap); item.style.transition = 'none';
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (!wrap) return;
      var dx = e.touches[0].clientX - x0, dy = e.touches[0].clientY - y0;
      if (sumbu === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) sumbu = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (sumbu !== 'x') return;
      off = Math.max(-LEBAR - 90, Math.min(0, awal + dx));
      item.style.transform = 'translateX(' + off + 'px)';
    }, { passive: true });
    document.addEventListener('touchend', function () {
      if (!wrap) return;
      item.style.transition = '';
      if (sumbu === 'x') {
        if (off < -(LEBAR + 60)) { var d = wrap.querySelector('.ci-del'); window.haptik([10, 30, 10]); if (d) d.click(); }
        else if (off < -LEBAR / 2) { wrap.classList.add('buka'); item.style.transform = 'translateX(-' + LEBAR + 'px)'; window.haptik(8); }
        else { wrap.classList.remove('buka'); item.style.transform = ''; }
      }
      wrap = null; item = null;
    }, { passive: true });
  })();

  /* ------------------------------------------------- Scan barcode lewat kamera */
  var ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
  var SCAN = { stream: null, reader: null, raf: 0, jumlah: 0, terakhir: '', waktu: 0, jalan: false };

  function tutupScanner() {
    SCAN.jalan = false;
    cancelAnimationFrame(SCAN.raf);
    if (SCAN.reader) { try { SCAN.reader.reset(); } catch (e) { /* abaikan */ } SCAN.reader = null; }
    if (SCAN.stream) { SCAN.stream.getTracks().forEach(function (t) { t.stop(); }); SCAN.stream = null; }
    var el = document.getElementById('scanner');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // Dipanggil setiap kali kode terbaca; diteruskan ke kolom cari Kasir (alur yang sama dengan scanner fisik).
  function hasilScan(kode) {
    kode = String(kode || '').trim();
    if (!kode) return;
    var sekarang = Date.now();
    if (kode === SCAN.terakhir && sekarang - SCAN.waktu < 1800) return;   // jeda untuk kode yang sama
    SCAN.terakhir = kode; SCAN.waktu = sekarang;
    var cari = document.getElementById('posCari');
    if (!cari) { tutupScanner(); return; }
    window.haptik(30);
    cari.value = kode;
    cari.dispatchEvent(new Event('input', { bubbles: true }));
    SCAN.jumlah++;
    var badge = document.getElementById('scanHitung');
    if (badge) { badge.textContent = SCAN.jumlah + ' dipindai'; badge.hidden = false; }
    var garis = document.querySelector('#scanner .scan-garis');
    if (garis) { garis.classList.remove('kena'); void garis.offsetWidth; garis.classList.add('kena'); }
  }
  window.__hasilScan = hasilScan;

  function mulaiDeteksi(video) {
    if ('BarcodeDetector' in window) {
      var det;
      try { det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'] }); }
      catch (e) { det = new window.BarcodeDetector(); }
      var terakhirCek = 0;
      (function loop(t) {
        if (!SCAN.jalan) return;
        SCAN.raf = requestAnimationFrame(loop);
        if (t - terakhirCek < 140 || video.readyState < 2) return;
        terakhirCek = t;
        det.detect(video).then(function (r) { if (r && r.length && SCAN.jalan) hasilScan(r[0].rawValue); }).catch(function () { /* frame gagal */ });
      })(0);
      return;
    }
    // Cadangan (mis. iPhone/Safari): pustaka ZXing dimuat saat dibutuhkan.
    var pasang = function () {
      if (!SCAN.jalan) return;
      var Z = window.ZXing;
      if (!Z || !Z.BrowserMultiFormatReader) { toast('Pemindai kamera tidak tersedia. Ketik kode barang.', true); tutupScanner(); return; }
      SCAN.reader = new Z.BrowserMultiFormatReader();
      SCAN.reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, function (hasil) {
        if (hasil && SCAN.jalan) hasilScan(hasil.getText());
      }).catch(function () { toast('Pemindai kamera gagal dimulai.', true); tutupScanner(); });
    };
    if (window.ZXing) { pasang(); return; }
    var s = document.createElement('script');
    s.src = ZXING_URL; s.onload = pasang;
    s.onerror = function () { toast('Pemindai kamera perlu koneksi internet.', true); tutupScanner(); };
    document.head.appendChild(s);
  }

  function bukaScanner() {
    if (document.getElementById('scanner')) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Kamera tidak didukung di browser ini. Ketik kode barang.', true); return;
    }
    SCAN.jumlah = 0; SCAN.terakhir = ''; SCAN.jalan = true;
    var el = document.createElement('div');
    el.id = 'scanner'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Pindai barcode');
    el.innerHTML =
      '<video id="scanVideo" playsinline muted autoplay></video>' +
      '<div class="scan-atas"><button type="button" class="scan-x" id="scanTutup" aria-label="Tutup">' + ikonSvg('<path d="M6 6l12 12M18 6L6 18"/>', 'scan-ic') + '</button>' +
        '<b>Pindai barcode</b><span class="scan-hitung" id="scanHitung" hidden></span></div>' +
      '<div class="scan-bingkai"><i></i><i></i><i></i><i></i><span class="scan-garis"></span></div>' +
      '<div class="scan-bawah"><p>Arahkan ke barcode obat — otomatis masuk keranjang</p>' +
        '<div class="scan-aksi"><button type="button" id="scanSenter" hidden>' + ikonSvg('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>', 'scan-ic') + 'Senter</button>' +
        '<button type="button" id="scanSelesai" class="utama">Selesai</button></div></div>';
    document.body.appendChild(el);
    document.getElementById('scanTutup').onclick = tutupScanner;
    document.getElementById('scanSelesai').onclick = function () { tutupScanner(); };
    var video = document.getElementById('scanVideo');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(function (stream) {
        if (!SCAN.jalan) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        SCAN.stream = stream;
        video.srcObject = stream;
        var track = stream.getVideoTracks()[0];
        var cap = track && track.getCapabilities ? track.getCapabilities() : {};
        if (cap.torch) {
          var sen = document.getElementById('scanSenter'), nyala = false;
          sen.hidden = false;
          sen.onclick = function () {
            nyala = !nyala;
            track.applyConstraints({ advanced: [{ torch: nyala }] }).catch(function () { /* tidak didukung */ });
            sen.classList.toggle('on', nyala);
          };
        }
        return video.play().then(function () { mulaiDeteksi(video); });
      })
      .catch(function (e) {
        tutupScanner();
        toast((e && e.name === 'NotAllowedError') ? 'Izin kamera ditolak. Aktifkan izin kamera di pengaturan browser.' : 'Kamera tidak dapat dibuka.', true);
      });
  }
  window.bukaScanner = bukaScanner;
  window.tutupScanner = tutupScanner;

  // Kembali ke keadaan desktop: tutup lembar/pemindai yang tersisa.
  if (HP.addEventListener) HP.addEventListener('change', function () { if (!adalahHP()) { tutupMenuSheet(); tutupScanner(); } });
  else if (HP.addListener) HP.addListener(function () { if (!adalahHP()) { tutupMenuSheet(); tutupScanner(); } });
})();
