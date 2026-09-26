/* ============================================================ SI-FaMitra ====
   Js_Core — sesi, pemanggil API, router halaman, dan komponen bersama.
   File view lain mendaftarkan dirinya ke objek VIEWS.

   MIGRASI SUPABASE: satu-satunya perubahan struktural dari versi Apps Script
   asli ada di dua fungsi transport di bawah ini (call() dan api()). Seluruh
   file Js_Pos/Js_Dashboard/Js_Master/Js_Trx/Js_Ai TIDAK diubah — mereka hanya
   memanggil api(action, data) seperti sebelumnya.
   ========================================================================== */

var VIEWS = {};                 // id halaman -> { title, render(el) }
var SESSION = null;             // { token, user:{ username, nama, role, shift } }
var MENU = [];

/** Ganti sesuai project Supabase Anda, atau isi lewat build-time env jika ada. */
var SUPABASE_FN_URL = 'https://xixhazawndmgqzstfjnq.supabase.co/functions/v1/api';
var SUPABASE_PROMO_URL = 'https://xixhazawndmgqzstfjnq.supabase.co/functions/v1/promo';

/* ------------------------------------------------------------ Pemanggil API */

/**
 * Pengganti google.script.run: satu Edge Function menerima {fn, args} dan
 * mendispatch ke salah satu dari 5 fungsi bernama yang dipanggil langsung
 * dari frontend (api, login, logout, menuSaya, pulihkanSesi) — persis pola
 * pemanggilan RPC-by-name pada google.script.run[fn].apply(null, args).
 */
function call(fn, args) {
  return fetch(SUPABASE_FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fn: fn, args: args || [] })
  })
    .then(function (r) {
      if (!r.ok) throw new Error('Gagal menghubungi server (HTTP ' + r.status + ').');
      return r.json();
    })
    .catch(function (e) {
      throw new Error(e.message || 'Gagal menghubungi server.');
    });
}

/**
 * Panggil satu action pada router backend.
 * Token disertakan otomatis; sesi kedaluwarsa langsung melempar ke login.
 */
function promoApi(action, data) {
  return fetch(SUPABASE_PROMO_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ args: [action, data || {}, SESSION ? SESSION.token : null] }) })
    .then(function (r) { return r.json(); })
    .then(function (res) { if (!res.ok) { if (res.code === 'NO_SESSION') paksaLogin('Sesi berakhir. Masuk kembali untuk melanjutkan.'); throw new Error(res.error || 'Permintaan promo gagal.'); } return res.data; });
}

function api(action, data) {
  return call('api', [action, data || {}, SESSION ? SESSION.token : null])
    .then(function (res) {
      if (!res) throw new Error('Respons server kosong. Muat ulang halaman dan coba lagi.');
      if (!res.ok) {
        if (res.code === 'NO_SESSION') paksaLogin('Sesi berakhir. Masuk kembali untuk melanjutkan.');
        throw new Error(res.error);
      }
      return res.data;
    });
}

/* --------------------------------------------------------------- Pemformat */

function rupiah(n) {
  n = Math.round(Number(n) || 0);
  var neg = n < 0;
  var s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-Rp' : 'Rp') + s;
}
/** Bentuk pendek untuk angka besar di layar sempit: Rp1,2 jt. */
function rupiahPendek(n) {
  n = Number(n) || 0;
  var a = Math.abs(n);
  if (a >= 1000000000) return (n / 1000000000).toFixed(1).replace('.', ',') + ' M';
  if (a >= 1000000) return 'Rp' + (n / 1000000).toFixed(1).replace('.', ',') + ' jt';
  if (a >= 100000) return 'Rp' + Math.round(n / 1000) + ' rb';
  return rupiah(n);
}
function angka(n) {
  return (Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
/** Nama tampilan untuk role. Nilai asli ('Kasir') tetap dipakai di seluruh
 *  logika sistem (RBAC, login, penyimpanan) — ini murni label di layar. */
function labelRole_(role) {
  return role === 'Kasir' ? 'Admin' : role;
}
function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function tglIndo(s) {
  if (!s) return '—';
  var p = String(s).substring(0, 10).split('-');
  if (p.length !== 3) return s;
  var bulan = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  return parseInt(p[2], 10) + ' ' + bulan[parseInt(p[1], 10) - 1] + ' ' + p[0];
}

/** Chip sisa hari menuju kedaluwarsa — warnanya menandakan tingkat urgensi. */
function chipExpired(sisaHari, tanggal) {
  if (sisaHari === null || sisaHari === undefined || sisaHari === '') return '<span class="chip">—</span>';
  var cls = sisaHari <= 30 ? 'chip-bad' : (sisaHari <= 90 ? 'chip-warn' : 'chip-ok');
  var teks = sisaHari < 0 ? 'Lewat ' + Math.abs(sisaHari) + ' hr' : sisaHari + ' hr lagi';
  return '<span class="chip ' + cls + '" title="' + esc(tanggal || '') + '">' + teks + '</span>';
}

function chipSegmen(seg) {
  var map = { 'VIP': 'chip-brand', 'Active Routine': 'chip-ok', 'At-Risk': 'chip-bad', 'Baru': '' };
  return '<span class="chip ' + (map[seg] || '') + '">' + esc(seg || 'Baru') + '</span>';
}

/** Badge naik/turun untuk perbandingan antar periode. */
function chipDelta(persen) {
  if (persen === null || persen === undefined) return '';
  var naik = persen >= 0;
  var cls = Math.abs(persen) < 0.5 ? 'rata' : (naik ? 'naik' : 'turun');
  var panah = cls === 'rata' ? '=' : (naik ? '▲' : '▼');
  return '<span class="delta ' + cls + '">' + panah + ' ' +
    Math.abs(persen).toFixed(0) + '%</span>';
}

/* --------------------------------------------------------------- Komponen */

var _toastTimer = null;
function toast(pesan, buruk) {
  var el = document.getElementById('toast');
  el.textContent = pesan;
  el.className = 'toast' + (buruk ? ' is-bad' : '');
  el.hidden = false;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function () { el.hidden = true; }, buruk ? 4500 : 2600);
}

function modalBuka(judul, bodyHtml, tombol) {
  document.getElementById('modalTitle').textContent = judul;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  var foot = document.getElementById('modalFoot');
  foot.innerHTML = '';
  (tombol || []).forEach(function (t) {
    var b = document.createElement('button');
    b.className = 'btn ' + (t.kelas || '');
    b.textContent = t.label;
    b.onclick = t.aksi;
    foot.appendChild(b);
  });
  document.getElementById('modal').hidden = false;
  var first = document.querySelector('#modalBody input, #modalBody select, #modalBody textarea');
  if (first) setTimeout(function () { first.focus(); }, 40);
}
function modalTutup() { document.getElementById('modal').hidden = true; }

document.getElementById('modal').addEventListener('click', function (e) {
  if (e.target.dataset.close) modalTutup();
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && !document.getElementById('modal').hidden) modalTutup();
});

function val(id) {
  var el = document.getElementById(id);
  return el ? String(el.value).trim() : '';
}
function numVal(id) {
  return Number(String(val(id)).replace(/[^\d.-]/g, '')) || 0;
}

function tabelKosong(pesan, kolom) {
  return '<tr><td colspan="' + (kolom || 8) + '" class="empty">' + esc(pesan) + '</td></tr>';
}

/** Kerangka abu-abu selama data dimuat, menggantikan teks "Memuat…". */
function kerangka(baris) {
  var r = '';
  for (var i = 0; i < (baris || 4); i++) {
    r += '<div class="sk sk-row" style="width:' + (94 - i * 9) + '%"></div>';
  }
  return '<div class="card"><div class="sk sk-title"></div>' + r + '</div>';
}
function memuat(el) { el.innerHTML = kerangka(5); }

/** Grafik batang berbasis SVG, tanpa pustaka eksternal. */
function svgBar(data, opts) {
  opts = opts || {};
  if (!data.length) return '<div class="empty">Belum ada data pada rentang ini.</div>';
  var w = 300, dasar = 100, tinggiMax = 88, gap = 5;
  var max = Math.max.apply(null, data.map(function (d) { return d.nilai; })) || 1;
  var bw = Math.min(46, (w - gap * (data.length - 1)) / data.length);
  var mulai = (w - (bw * data.length + gap * (data.length - 1))) / 2;

  var bars = data.map(function (d, i) {
    var bh = Math.max((d.nilai / max) * tinggiMax, 1);
    var x = mulai + i * (bw + gap);
    return '<rect class="' + (opts.alt ? 'bar-alt' : 'bar') + '" x="' + x.toFixed(1) +
      '" y="' + (dasar - bh).toFixed(1) + '" width="' + bw.toFixed(1) +
      '" height="' + bh.toFixed(1) + '" rx="2"><title>' + esc(d.label) + ': ' + rupiah(d.nilai) + '</title></rect>' +
      '<text class="lbl" x="' + (x + bw / 2).toFixed(1) + '" y="113" text-anchor="middle">' +
      esc(d.pendek || d.label) + '</text>';
  }).join('');

  return '<svg class="chart" viewBox="0 0 ' + w + ' 120" role="img">' +
    '<line class="axis" x1="0" y1="100" x2="' + w + '" y2="100"/>' + bars + '</svg>';
}

/** Daftar peringkat sebagai bar horizontal. */
function barPeringkat(items, opts) {
  opts = opts || {};
  if (!items.length) return '<div class="empty">' + esc(opts.kosong || 'Belum ada data.') + '</div>';
  var max = Math.max.apply(null, items.map(function (i) { return i.nilai; })) || 1;
  return '<div class="rank">' + items.map(function (i) {
    return '<div class="rank-item">' +
      '<div class="rank-top"><strong>' + esc(i.nama) + '</strong><span class="num">' +
        esc(i.tampil) + '</span></div>' +
      '<div class="rank-bar"><div class="rank-fill' + (opts.alt ? ' alt' : '') +
        '" style="width:' + Math.max(3, (i.nilai / max) * 100).toFixed(1) + '%"></div></div>' +
      (i.catatan ? '<div class="sub">' + esc(i.catatan) + '</div>' : '') +
    '</div>';
  }).join('') + '</div>';
}

/* ----------------------------------------------------------------- Router */

function gantiHalaman(id) {
  var v = VIEWS[id];
  if (!v) { toast('Halaman belum tersedia.', true); return; }
  if (!MENU.some(function (m) { return m.id === id; })) {
    toast('Anda tidak punya akses ke halaman itu.', true);
    return;
  }
  document.getElementById('pageTitle').textContent = v.title;
  document.querySelectorAll('.nav button, .tabbar button').forEach(function (b) {
    b.classList.toggle('is-active', b.dataset.id === id);
  });
  document.querySelector('.sidebar').classList.remove('is-open');
  var el = document.getElementById('view');
  memuat(el);
  try { v.render(el); } catch (e) { el.innerHTML = '<div class="card"><p>' + esc(e.message) + '</p></div>'; }
}

function bangunNav() {
  var nav = document.getElementById('navMenu');
  var tab = document.getElementById('tabbar');
  nav.innerHTML = ''; tab.innerHTML = '';
  MENU.forEach(function (m) {
    var b = document.createElement('button');
    b.textContent = m.label; b.dataset.id = m.id;
    b.onclick = function () { gantiHalaman(m.id); };
    nav.appendChild(b);
  });
  MENU.slice(0, 5).forEach(function (m) {
    var b = document.createElement('button');
    b.textContent = m.label.split(' ')[0]; b.dataset.id = m.id;
    b.onclick = function () { gantiHalaman(m.id); };
    tab.appendChild(b);
  });
}

/* ------------------------------------------------------------------ Sesi */

function simpanSesi(s) {
  SESSION = s;
  try { localStorage.setItem('famitra_token', s.token); } catch (e) {}
}

function paksaLogin(pesan) {
  SESSION = null;
  try { localStorage.removeItem('famitra_token'); } catch (e) {}
  document.getElementById('appScreen').hidden = true;
  document.getElementById('aidock').hidden = true;
  document.getElementById('loginScreen').style.display = '';
  if (pesan) tampilkanErrorLogin(pesan);
}

function tampilkanErrorLogin(pesan) {
  var el = document.getElementById('loginError');
  el.textContent = pesan; el.hidden = !pesan;
}

function masukAplikasi() {
  return call('menuSaya', [SESSION.token]).then(function (res) {
    if (!res.ok) { paksaLogin(res.error); return; }
    MENU = Array.isArray(res.data.menu) ? res.data.menu.slice() : [];
    // Backward-compatible guard: older api deployments may omit the newly
    // introduced Marketing item even though the frontend view is available.
    if (res.data.user && res.data.user.role === 'Owner' &&
        !MENU.some(function (m) { return m.id === 'marketing'; })) {
      var crmIndex = MENU.findIndex(function (m) { return m.id === 'crm'; });
      MENU.splice(crmIndex < 0 ? MENU.length : crmIndex + 1, 0,
        { id: 'marketing', label: 'Marketing' });
    }
    SESSION.user = res.data.user;
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appScreen').hidden = false;
    document.getElementById('sbNama').textContent = res.data.user.nama;
    document.getElementById('sbRole').textContent = labelRole_(res.data.user.role);
    var namaCabang = {
      KARLA: 'Apotek Fa-Mitra Karla',
      PUCUK: 'Apotek Fa-Mitra Pucuk',
      KENDAL: 'Apotek Fa-Mitra Kendal',
      PULE: 'Apotek Fa-Mitra Pule'
    }[res.data.user.cabang_id] || res.data.apotek;
    document.getElementById('sbApotek').textContent = namaCabang;

    var chip = document.getElementById('shiftChip');
    perbaruhiShift_();   // langsung perbarui saat login

    bangunNav();
    gantiHalaman(res.data.halamanAwal);
    if (res.data.user.role === 'Owner') siapkanAsisten();
  });
}

var roleDipilih = 'Kasir';
document.getElementById('roleTabs').addEventListener('click', function (e) {
  var b = e.target.closest('.role-tab');
  if (!b) return;
  roleDipilih = b.dataset.role;
  document.querySelectorAll('.role-tab').forEach(function (x) {
    x.classList.toggle('is-active', x === b);
  });
});

function prosesLogin() {
  var btn = document.getElementById('loginBtn');
  var u = document.getElementById('loginUser').value.trim();
  var p = document.getElementById('loginPass').value;
  if (!u || !p) { tampilkanErrorLogin('Username dan password wajib diisi.'); return; }
  tampilkanErrorLogin('');
  btn.disabled = true; btn.textContent = 'Memeriksa…';
  call('login', [u, p, roleDipilih])
    .then(function (res) {
      if (!res.ok) { tampilkanErrorLogin(res.error); return; }
      simpanSesi(res.data);
      document.getElementById('loginPass').value = '';
      return masukAplikasi();
    })
    .catch(function (e) { tampilkanErrorLogin(e.message); })
    .then(function () { btn.disabled = false; btn.textContent = 'Masuk'; });
}

document.getElementById('loginBtn').onclick = prosesLogin;
['loginUser', 'loginPass'].forEach(function (id) {
  document.getElementById(id).addEventListener('keydown', function (e) {
    if (e.key === 'Enter') prosesLogin();
  });
});

document.getElementById('logoutBtn').onclick = function () {
  var t = SESSION ? SESSION.token : null;
  paksaLogin('');
  if (t) call('logout', [t]);
};

document.getElementById('menuToggle').onclick = function () {
  document.querySelector('.sidebar').classList.toggle('is-open');
};

/* Shift dihitung dari jam browser, bukan dari sesi login, supaya label
   berubah otomatis saat pergantian shift tanpa perlu logout-login ulang.
   Batas jam mengikuti CFG.SHIFT_PAGI dan CFG.SHIFT_SORE di server:
   Pagi 08:00-14:59, Sore 15:00-20:59, di luar itu Luar Jam. */
function shiftSekarang_() {
  var h = new Date().getHours();
  if (h >= 8 && h < 15) return 'Pagi';
  if (h >= 15 && h < 21) return 'Sore';
  return 'Luar Jam';
}

function perbaruhiShift_() {
  var chip = document.getElementById('shiftChip');
  if (!chip) return;
  var sh = shiftSekarang_();
  chip.textContent = sh === 'Luar Jam' ? 'Di luar jam operasional' : 'Shift ' + sh;
  chip.className = 'chip ' + (sh === 'Luar Jam' ? 'chip-warn' : 'chip-brand');
}

setInterval(function () {
  var c = document.getElementById('clockChip');
  if (c) c.textContent = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  perbaruhiShift_();   // cek tiap detik, label berubah tepat saat pergantian shift
}, 1000);

/* Pulihkan sesi bila token lama masih hidup. */
(function () {
  var t = null;
  try { t = localStorage.getItem('famitra_token'); } catch (e) {}
  if (!t) return;
  call('pulihkanSesi', [t]).then(function (res) {
    if (res && res.ok) { simpanSesi(res.data); masukAplikasi(); }
  }).catch(function () {});
})();
