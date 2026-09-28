/* ================================= Dashboard + Advanced Filtering Engine == */

/** Filter bar dipakai bersama oleh Dashboard, Laporan, dan Biaya. */
function filterBarHtml(prefix) {
  var th = new Date().getFullYear();
  var tahun = [];
  for (var y = th; y >= th - 4; y--) tahun.push('<option value="' + y + '">' + y + '</option>');
  var bulan = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus',
               'September','Oktober','November','Desember']
    .map(function (n, i) {
      var v = ('0' + (i + 1)).slice(-2);
      return '<option value="' + v + '"' + (i === new Date().getMonth() ? ' selected' : '') + '>' + n + '</option>';
    }).join('');

  return '<div class="filterbar">' +
    '<label class="field"><span>Rentang</span><select id="' + prefix + 'Mode" class="inp">' +
      '<option value="hari_ini">Hari ini</option>' +
      '<option value="mingguan">7 hari terakhir</option>' +
      '<option value="bulanan">Bulanan</option>' +
      '<option value="tahunan">Tahunan</option>' +
      '<option value="custom">Tanggal tertentu</option>' +
    '</select></label>' +
    '<label class="field" id="' + prefix + 'WrapBulan" hidden><span>Bulan</span>' +
      '<select id="' + prefix + 'Bulan" class="inp">' + bulan + '</select></label>' +
    '<label class="field" id="' + prefix + 'WrapTahun" hidden><span>Tahun</span>' +
      '<select id="' + prefix + 'Tahun" class="inp">' + tahun.join('') + '</select></label>' +
    '<label class="field" id="' + prefix + 'WrapDari" hidden><span>Dari</span>' +
      '<input id="' + prefix + 'Dari" class="inp" type="date"></label>' +
    '<label class="field" id="' + prefix + 'WrapSampai" hidden><span>Sampai</span>' +
      '<input id="' + prefix + 'Sampai" class="inp" type="date"></label>' +
    '<label class="field"><span>Shift</span><select id="' + prefix + 'Shift" class="inp">' +
      '<option value="Semua">Semua shift</option>' +
      '<option value="Pagi">Shift pagi (08–15)</option>' +
      '<option value="Sore">Shift sore (15–21)</option>' +
      '<option value="Luar Jam">Di luar jam buka</option>' +
    '</select></label>' +
    '<button id="' + prefix + 'Terapkan" class="btn btn-primary">Terapkan</button>' +
  '</div>';
}

function pasangFilter(prefix, onChange, modeAwal) {
  var mode = document.getElementById(prefix + 'Mode');
  if (modeAwal) mode.value = modeAwal;
  function sesuaikan() {
    var m = mode.value;
    document.getElementById(prefix + 'WrapBulan').hidden = (m !== 'bulanan');
    document.getElementById(prefix + 'WrapTahun').hidden = (m !== 'bulanan' && m !== 'tahunan');
    document.getElementById(prefix + 'WrapDari').hidden = (m !== 'custom');
    document.getElementById(prefix + 'WrapSampai').hidden = (m !== 'custom');
  }
  mode.addEventListener('change', sesuaikan);
  sesuaikan();
  document.getElementById(prefix + 'Terapkan').onclick = onChange;
}

function bacaFilter(prefix) {
  return {
    mode: val(prefix + 'Mode'), bulan: val(prefix + 'Bulan'), tahun: val(prefix + 'Tahun'),
    dari: val(prefix + 'Dari'), sampai: val(prefix + 'Sampai'), shift: val(prefix + 'Shift')
  };
}

/* ------------------------------------------------------------- Dashboard */

VIEWS.dashboard = {
  title: 'Dashboard',
  render: function (el) {
    var punyaAI = SESSION.user.role === 'Owner';
    el.innerHTML =
      (punyaAI ? bannerKerangka() : '') +
      filterBarHtml('db') +
      '<div id="dbIsi">' + kerangka(6) + '</div>';
    pasangFilter('db', muatDashboard, 'hari_ini');
    muatDashboard();
    // Ringkasan AI dimulai manual melalui tombol Mulai/Refresh.
  }
};

function muatDashboard() {
  var isi = document.getElementById('dbIsi');
  isi.innerHTML = kerangka(6);
  api('dashboard.ringkasan', { filter: bacaFilter('db') }).then(function (d) {
    isi.innerHTML = gambarDashboard(d);
    pasangEventDashboard(d);
    pasangGrafikOmzet(d);
    // Widget target omset bersifat independen (Edge Function marketing),
    // tidak bergantung pada payload dashboard utama, jadi diload paralel.
    muatTargetOmsetWidget();
  }).catch(function (e) {
    isi.innerHTML = '<div class="card"><p>' + esc(e.message) + '</p></div>';
  });
}

/* -------------------- Widget Target Omset di Dashboard --------------------
   Memanggil Edge Function `marketing` action `dashboardProgressPerCabang`.
   Aturan visibilitas laba sudah diterapkan di backend (withVisibility di
   marketing-function-paste.txt); frontend cukup render apa adanya. */
var SUPABASE_MARKETING_URL =
  'https://xixhazawndmgqzstfjnq.supabase.co/functions/v1/marketing';

function widgetMarketingApi(action, data) {
  var token = (window.SESSION && window.SESSION.token) || null;
  return fetch(SUPABASE_MARKETING_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args: [action, data || {}, token] }),
  }).then(function (r) {
    return r.json().then(function (j) {
      if (!r.ok || !j || j.ok === false) {
        throw new Error((j && j.error) || ('HTTP ' + r.status));
      }
      return j.data;
    });
  });
}

function muatTargetOmsetWidget() {
  var box = document.getElementById('dbTargetOmsetBody');
  if (!box) return;
  box.innerHTML = kerangka(2);
  widgetMarketingApi('dashboardProgressPerCabang', {}).then(function (rows) {
    box.innerHTML = renderTargetGauge(rows || []);
    animasiGauge(box);
  }).catch(function (e) {
    box.innerHTML = '<div class="empty" style="color:var(--bad)">Gagal memuat target omset: ' +
      esc(e.message) + '</div>';
  });
}

/* Gauge target omset (di posisi kanan hero). Busur 30 segmen; segmen terisi
   sesuai progres, warnanya bergradasi mengikuti posisi di busur. Setelah
   target tercapai seluruh busur hijau dan laba setelah target ditampilkan. */
var GAUGE_N = 30;

function svgGauge(persen, tercapai, teksTengah, teksBawah) {
  var cx = 120, cy = 120, r1 = 80, r2 = 106;
  var isi = Math.round(Math.max(0, Math.min(100, persen)) / 100 * GAUGE_N);
  var dari = tercapai ? [14, 159, 110] : [143, 29, 34];   // ok / brand-dark
  var ke   = tercapai ? [74, 200, 150] : [238, 138, 60];  // ok-muda / amber
  var seg = '';
  for (var i = 0; i < GAUGE_N; i++) {
    var sudut = Math.PI * (1 - (i + 0.5) / GAUGE_N);
    var cos = Math.cos(sudut), sin = Math.sin(sudut);
    var t = i / (GAUGE_N - 1);
    var warna = i < isi
      ? 'rgb(' + dari.map(function (c, k) { return Math.round(c + (ke[k] - c) * t); }).join(',') + ')'
      : '#ECEDF0';
    seg += '<line class="gauge-seg' + (i < isi ? ' isi' : '') + '" style="--i:' + i + '" ' +
      'x1="' + (cx + r1 * cos).toFixed(1) + '" y1="' + (cy - r1 * sin).toFixed(1) + '" ' +
      'x2="' + (cx + r2 * cos).toFixed(1) + '" y2="' + (cy - r2 * sin).toFixed(1) + '" ' +
      'stroke="' + warna + '"/>';
  }
  return '<svg class="gauge" viewBox="0 0 240 132" role="img" aria-label="Progres target ' +
      esc(teksTengah) + '">' + seg +
    '<text class="gauge-angka" x="120" y="104" text-anchor="middle">' + esc(teksTengah) + '</text>' +
    '<text class="gauge-label" x="120" y="124" text-anchor="middle">' + esc(teksBawah) + '</text>' +
  '</svg>';
}

function animasiGauge(box) {
  var svg = box.querySelector('.gauge');
  if (!svg) return;
  // Satu momen gerak saat data tiba: segmen menyala berurutan.
  requestAnimationFrame(function () { svg.classList.add('siap'); });
}

function renderTargetGauge(rows) {
  var isOwner = SESSION && SESSION.user && SESSION.user.role === 'Owner';
  var r = rows[0];
  var judul = '<div class="sat-label">Target omset</div>';
  if (!r || !r.target) {
    return judul + svgGauge(0, false, '—', 'belum ada target') +
      '<div class="gauge-info"><span class="sub">Belum ada target aktif untuk cabang ini.</span>' +
      (isOwner ? '<a class="btn btn-sm" href="javascript:gantiHalaman(\'targetOmset\')">Buat target</a>' : '') +
      '</div>';
  }
  var s = r.ringkasan || {};
  var tercapai = !!s.tercapai;
  var pct = Number(s.progress_persen) || 0;
  var kurang = Math.max(0, Number(s.target_omset_idr || 0) - Number(s.omset_idr || 0));
  var info;
  if (tercapai) {
    info =
      '<div class="gauge-baris"><span class="chip gauge-chip ok">✓ Tercapai</span>' +
        '<span class="sub">' + rupiahPendek(s.omset_idr) + ' dari ' + rupiahPendek(s.target_omset_idr) + '</span></div>' +
      (s.laba_setelah_target_idr !== null && s.laba_setelah_target_idr !== undefined
        ? '<div class="gauge-laba"><span class="sub">Laba setelah target</span>' +
            '<strong class="' + (Number(s.laba_setelah_target_idr) < 0 ? 'minus' : '') + '">' +
            rupiah(s.laba_setelah_target_idr) + '</strong></div>'
        : '');
  } else {
    info =
      '<div class="gauge-baris"><span class="sub">' + rupiahPendek(s.omset_idr) + ' dari ' +
        rupiahPendek(s.target_omset_idr) + '</span>' +
        '<span class="chip gauge-chip kurang">kurang ' + rupiahPendek(kurang) + '</span></div>' +
      '<div class="gauge-kunci">🔒 Laba setelah target terbuka saat target tercapai</div>';
  }
  return judul +
    svgGauge(pct, tercapai, (tercapai ? Math.round(pct) : pct.toFixed(pct < 10 ? 1 : 0)) + '%', 'dari target') +
    '<div class="gauge-info">' + info +
      '<div class="sub gauge-periode">' + esc(r.target.nama) + ' · ' + tglIndo(r.target.periode_mulai) +
        ' s.d. ' + tglIndo(r.target.periode_selesai) +
        (isOwner ? ' · <a href="javascript:gantiHalaman(\'targetOmset\')">Detail</a>' : '') + '</div>' +
    '</div>';
}

/* Grafik omzet harian (di bawah hero): garis halus bergradasi, area pudar,
   tooltip + garis putus-putus saat disentuh/diarahkan. 7 atau 30 hari,
   tidak ikut filter rentang. Digambar sesuai lebar kartu, ulang saat resize. */
var GRAFIK = { hari: 7, data: [] };

function grafikOmzetHtml() {
  return '<div class="card grafik-card" id="dbGrafik">' +
    '<div class="grafik-head">' +
      '<div><div class="sat-label">Omzet harian</div>' +
        '<div class="grafik-total" id="dbGrafikTotal"></div>' +
        '<div class="sub" id="dbGrafikSub"></div></div>' +
      '<div class="seg-toggle" role="group" aria-label="Rentang grafik">' +
        '<button type="button" data-grafik="7" aria-pressed="true">7 hari</button>' +
        '<button type="button" data-grafik="30" aria-pressed="false">30 hari</button>' +
      '</div>' +
    '</div>' +
    '<div class="grafik-area" id="dbGrafikArea"></div>' +
  '</div>';
}

function pasangGrafikOmzet(d) {
  var src = d.tren_harian || (d.sparkline || []).map(function (x) { return { tanggal: x.tanggal, omzet: x.omzet, nota: x.nota }; });
  GRAFIK.data = src;
  var card = document.getElementById('dbGrafik');
  if (!card) return;
  card.querySelector('.seg-toggle').onclick = function (e) {
    var b = e.target.closest('[data-grafik]');
    if (!b) return;
    GRAFIK.hari = Number(b.dataset.grafik);
    gambarGrafikOmzet();
  };
  gambarGrafikOmzet();
}

function singkatRp(n) {
  var a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1).replace('.', ',') + ' M';
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',') + ' jt';
  if (a >= 1e3) return Math.round(n / 1e3) + ' rb';
  return String(Math.round(n));
}

function gambarGrafikOmzet() {
  var area = document.getElementById('dbGrafikArea');
  if (!area) return;
  var n = GRAFIK.hari;
  var semuaData = GRAFIK.data;
  var data = semuaData.slice(-n);
  var sebelum = semuaData.length >= n * 2 ? semuaData.slice(-n * 2, -n) : null;

  document.querySelectorAll('#dbGrafik [data-grafik]').forEach(function (b) {
    b.setAttribute('aria-pressed', Number(b.dataset.grafik) === n ? 'true' : 'false');
  });
  var total = data.reduce(function (t, x) { return t + Number(x.omzet || 0); }, 0);
  var totalSebelum = sebelum ? sebelum.reduce(function (t, x) { return t + Number(x.omzet || 0); }, 0) : 0;
  var delta = sebelum && totalSebelum > 0 ? (total - totalSebelum) / totalSebelum * 100 : null;
  document.getElementById('dbGrafikTotal').innerHTML = esc(rupiah(total)) + ' ' + chipDelta(delta);
  document.getElementById('dbGrafikSub').textContent =
    n + ' hari terakhir · rata-rata ' + rupiahPendek(data.length ? total / data.length : 0) + '/hari' +
    (delta !== null ? ' · dibanding ' + n + ' hari sebelumnya' : '');

  if (!data.length) { area.innerHTML = '<div class="empty">Belum ada data penjualan.</div>'; return; }

  var W = Math.max(280, area.clientWidth || 600), H = 230;
  var pl = 50, pr = 14, pt = 14, pb = 30;
  var cw = W - pl - pr, ch = H - pt - pb;
  var nilai = data.map(function (x) { return Number(x.omzet || 0); });
  var maks = Math.max.apply(null, nilai), min = Math.min(0, Math.min.apply(null, nilai));
  // Batas atas "rapi" supaya garis bantu jatuh di angka bulat.
  var kasar = (maks - min) / 4 || 1;
  var pangkat = Math.pow(10, Math.floor(Math.log10(kasar)));
  var langkah = [1, 2, 2.5, 5, 10].map(function (m) { return m * pangkat; }).filter(function (v) { return v >= kasar; })[0];
  var atas = Math.ceil(maks / langkah) * langkah || langkah * 4;
  var bawah = Math.floor(min / langkah) * langkah;
  var X = function (i) { return pl + (data.length === 1 ? cw / 2 : i * cw / (data.length - 1)); };
  var Y = function (v) { return pt + (atas - v) / (atas - bawah) * ch; };

  var grid = '';
  for (var g = bawah; g <= atas + 1e-6; g += langkah) {
    grid += '<line class="grafik-grid" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(g).toFixed(1) + '" y2="' + Y(g).toFixed(1) + '"/>' +
      '<text class="grafik-y" x="' + (pl - 8) + '" y="' + (Y(g) + 4).toFixed(1) + '" text-anchor="end">' + singkatRp(g) + '</text>';
  }
  var tiap = n <= 7 ? 1 : Math.ceil(data.length / Math.max(3, Math.floor(cw / 70)));
  var sumbuX = data.map(function (x, i) {
    if ((data.length - 1 - i) % tiap !== 0) return '';
    var t = String(x.tanggal);
    var jangkar = i === 0 ? 'start' : (i === data.length - 1 ? 'end' : 'middle');
    return '<text class="grafik-x" x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + jangkar + '">' +
      t.slice(8, 10) + '/' + t.slice(5, 7) + '</text>';
  }).join('');

  // Kurva halus (Catmull-Rom → Bezier), titik kontrol dijepit di area grafik.
  var titik = data.map(function (x, i) { return [X(i), Y(Number(x.omzet || 0))]; });
  var jepit = function (y) { return Math.max(pt, Math.min(pt + ch, y)); };
  var garis = 'M' + titik[0][0].toFixed(1) + ',' + titik[0][1].toFixed(1);
  for (var k = 0; k < titik.length - 1; k++) {
    var p0 = titik[k - 1] || titik[k], p1 = titik[k], p2 = titik[k + 1], p3 = titik[k + 2] || p2;
    var c1 = [p1[0] + (p2[0] - p0[0]) / 6, jepit(p1[1] + (p2[1] - p0[1]) / 6)];
    var c2 = [p2[0] - (p3[0] - p1[0]) / 6, jepit(p2[1] - (p3[1] - p1[1]) / 6)];
    garis += ' C' + c1[0].toFixed(1) + ',' + c1[1].toFixed(1) + ' ' + c2[0].toFixed(1) + ',' + c2[1].toFixed(1) +
      ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
  }
  var isiArea = garis + ' L' + titik[titik.length - 1][0].toFixed(1) + ',' + (pt + ch) + ' L' + titik[0][0].toFixed(1) + ',' + (pt + ch) + ' Z';

  area.innerHTML =
    '<svg class="grafik" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Grafik omzet ' + n + ' hari terakhir">' +
      '<defs>' +
        '<linearGradient id="gOmzetGaris" x1="0" x2="1" y1="0" y2="0">' +
          '<stop offset="0" stop-color="#8F1D22"/><stop offset=".55" stop-color="#CE2C2B"/><stop offset="1" stop-color="#EE8A3C"/></linearGradient>' +
        '<linearGradient id="gOmzetArea" x1="0" x2="0" y1="0" y2="1">' +
          '<stop offset="0" stop-color="#CE2C2B" stop-opacity=".16"/><stop offset="1" stop-color="#CE2C2B" stop-opacity="0"/></linearGradient>' +
      '</defs>' +
      grid + sumbuX +
      '<path d="' + isiArea + '" fill="url(#gOmzetArea)"/>' +
      '<path d="' + garis + '" fill="none" stroke="url(#gOmzetGaris)" stroke-width="3" stroke-linecap="round"/>' +
      '<line class="grafik-kursor" id="dbGrafikKursor" y1="' + pt + '" y2="' + (pt + ch) + '" x1="-10" x2="-10"/>' +
      '<circle class="grafik-titik" id="dbGrafikTitik" r="6" cx="-10" cy="-10"/>' +
      '<rect x="' + pl + '" y="0" width="' + cw + '" height="' + H + '" fill="transparent" id="dbGrafikSentuh"/>' +
    '</svg>' +
    '<div class="grafik-tip" id="dbGrafikTip" hidden></div>';

  var hariNama = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  var bulan = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  var sentuh = document.getElementById('dbGrafikSentuh');
  var kursor = document.getElementById('dbGrafikKursor');
  var bulat = document.getElementById('dbGrafikTitik');
  var tip = document.getElementById('dbGrafikTip');
  function tunjuk(ev) {
    var box = sentuh.ownerSVGElement.getBoundingClientRect();
    var x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - box.left;
    var i = data.length === 1 ? 0 : Math.round((x - pl) / cw * (data.length - 1));
    i = Math.max(0, Math.min(data.length - 1, i));
    var px = titik[i][0], py = titik[i][1];
    kursor.setAttribute('x1', px); kursor.setAttribute('x2', px);
    bulat.setAttribute('cx', px); bulat.setAttribute('cy', py);
    var tg = new Date(data[i].tanggal + 'T00:00:00');
    tip.innerHTML = '<div class="grafik-tip-tgl">' + hariNama[tg.getDay()] + ', ' + tg.getDate() + ' ' + bulan[tg.getMonth()] + '</div>' +
      '<div>Omzet: <strong>' + esc(rupiah(data[i].omzet)) + '</strong></div>' +
      (data[i].nota !== undefined ? '<div class="grafik-tip-tgl">' + angka(data[i].nota) + ' nota</div>' : '');
    tip.hidden = false;
    var tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(W - tw, px - tw / 2)) + 'px';
    // Di atas titik; kalau tidak muat, pindah ke bawah titik supaya titik tetap terlihat.
    var atasTip = py - tip.offsetHeight - 14;
    tip.style.top = (atasTip >= 0 ? atasTip : py + 14) + 'px';
  }
  function sembunyi() {
    tip.hidden = true;
    kursor.setAttribute('x1', -10); kursor.setAttribute('x2', -10);
    bulat.setAttribute('cx', -10);
  }
  sentuh.addEventListener('mousemove', tunjuk);
  sentuh.addEventListener('mouseleave', sembunyi);
  sentuh.addEventListener('touchstart', tunjuk, { passive: true });
  sentuh.addEventListener('touchmove', tunjuk, { passive: true });
}

// Gambar ulang grafik saat lebar layar berubah (dipasang sekali).
(function () {
  var t = null;
  window.addEventListener('resize', function () {
    clearTimeout(t);
    t = setTimeout(function () { if (document.getElementById('dbGrafikArea')) gambarGrafikOmzet(); }, 150);
  });
})();

function gambarDashboard(d) {
  var k = d.kpi;

  /* 1. Hero omzet — angka besar di kiri, gauge target omset di kanan. */
  // Tentukan rentang label yang sedang aktif untuk header cetak.
  var rentangLabel = d.rentang.label || 'periode ini';
  var hero =
    '<div class="hero" id="dbHero">' +
      '<div>' +
        '<div class="hero-label">Omzet ' + esc(rentangLabel.toLowerCase()) +
          (d.shift_filter !== 'Semua' ? ' · ' + esc(d.shift_filter) : '') +
          ' <span class="sub" style="font-weight:400">· klik untuk buka laporan</span></div>' +
        '<div class="hero-row">' +
          '<div class="hero-value">' + rupiah(k.omzet) + '</div>' +
          chipDelta(k.delta_omzet) +
        '</div>' +
        '<div class="hero-satelit">' +
          satelit('Laba kotor', rupiah(k.laba_kotor), k.laba_kotor < 0) +
          // Laba bersih / laba setelah target ada di widget & halaman Target Omset;
          // di sini diganti retur supaya tidak dobel.
          satelit('Retur', rupiah(k.retur_total || 0), false) +
          satelit('Nota terjual', angka(k.nota), false, k.delta_nota) +
          satelit('Rata-rata nota', rupiah(k.rata_nota), false, k.delta_rata) +
        '</div>' +
      '</div>' +
      // Posisi kanan hero: gauge target omset (dimuat terpisah dari Edge Function marketing).
      '<div class="hero-chart hero-target" id="dbTargetOmsetBody">' + kerangka(2) + '</div>' +
    '</div>';

  /* 2. Strip peringatan — klik untuk membuka rincian. */
  var strip;
  if (d.expiring_total || d.stok_menipis_total) {
    var kritis = d.expiring_kritis > 0;
    var bagian = [];
    if (d.expiring_total) {
      bagian.push(d.expiring_total + ' batch kedaluwarsa &lt;90 hari (' + rupiahPendek(d.expiring_nilai) + ')');
    }
    if (d.stok_menipis_total) bagian.push(d.stok_menipis_total + ' produk di bawah stok minimum');
    strip =
      '<div class="alertstrip ' + (kritis ? 'kritis' : 'perhatian') + '" id="dbStrip">' +
        '<span class="pesan"><span class="dot"></span>' + bagian.join(' · ') + '</span>' +
        '<span class="spacer"></span>' +
        '<span class="lihat">' + (kritis ? '⚠ KRITIS · ' : '') + 'Lihat rincian ▸</span>' +
      '</div>';
  } else {
    strip = '<div class="alertstrip aman"><span class="pesan"><span class="dot"></span>' +
      'Stok aman, tidak ada batch mendekati kedaluwarsa.</span></div>';
  }

  /* 3. PJ shift — kartu berbeda untuk yang sedang jaga (Kasir) vs yang mengawasi (Owner/Apoteker) */
  var pj = d.pj_shift;
  var chipPJ = '<span class="chip ' + (pj.di_luar_jam ? 'chip-warn' : 'chip-brand') + '">' +
    (pj.di_luar_jam ? 'Di luar jam buka' : esc(pj.shift) + ' · ' + esc(pj.jam)) + '</span>';
  var kartuShift;
  if (pj.role === 'Kasir') {
    // Yang sedang jaga apotek: tampilkan nama kasir ini sendiri sebagai PJ.
    kartuShift =
      '<div class="card">' +
        '<div class="card-head"><h3>Penanggung jawab</h3>' + chipPJ + '</div>' +
        '<p style="margin:0"><strong>' + esc(pj.petugas) + '</strong> — ' + esc(labelRole_(pj.role)) + '</p>' +
        '<p class="sub" style="margin:3px 0 0">Aktif sejak ' + esc(pj.login_at) + '</p>' +
      '</div>';
  } else {
    // Owner/Apoteker melihat dari rumah/lokasi lain:
    // tampilkan admin yang paling terakhir melakukan transaksi hari ini,
    // BUKAN nama akun Owner sendiri (Owner sedang mengawasi, bukan jaga).
    var infoJaga = pj.petugas_jaga
      ? '<p style="margin:6px 0 0"><strong>Sedang jaga: ' + esc(pj.petugas_jaga) + '</strong></p>' +
        '<p class="sub" style="margin:3px 0 0">Aktivitas ' + esc(pj.sumber_aktivitas) +
        ' terakhir pukul ' + esc(pj.aktivitas_jam) + '</p>'
      : '<p class="sub" style="margin:6px 0 0">Belum ada aktivitas kasir hari ini.</p>';
    kartuShift =
      '<div class="card">' +
        '<div class="card-head"><h3>Penanggung jawab</h3>' + chipPJ + '</div>' +
        '<p style="margin:0">Anda login sebagai <strong>' + esc(pj.petugas) + '</strong> — ' +
          esc(labelRole_(pj.role)) + '</p>' +
        infoJaga +
      '</div>';
  }

  /* 4. Strip segmen pelanggan */
  var s = d.segmen_pelanggan;
  var segStrip =
    '<div class="segstrip">' +
      seg('vip', s.VIP || 0, 'Pelanggan VIP') +
      seg('rutin', s['Active Routine'] || 0, 'Rutin belanja') +
      seg('risk', s['At-Risk'] || 0, 'Perlu ditindak') +
      seg('', s.Baru || 0, 'Baru terdaftar') +
    '</div>';

  /* 5. Feed transaksi + panel kanan */
  var feedJual =
    '<div class="card"><div class="card-head"><h3>Penjualan terkini</h3></div>' +
      '<div class="table-wrap tbl-sm"><table><thead><tr><th>Nota</th><th>Pembeli</th>' +
        '<th class="r">Total</th><th>Jam</th></tr></thead><tbody>' +
        (d.live_sales.length ? d.live_sales.map(function (r) {
          var pendek = String(r.No_Nota).split('-').pop();
          return '<tr><td title="' + esc(r.No_Nota) + '">#' + esc(pendek) + '</td>' +
            '<td>' + esc(r.Nama_Pelanggan) + '</td>' +
            '<td class="r num">' + rupiah(r.Harga_Akhir) + '</td>' +
            '<td>' + esc(r.Jam) +
            (r.Shift === 'Luar Jam' ? ' <span class="chip chip-warn">luar jam</span>' : '') +
            '</td></tr>';
        }).join('') : tabelKosong('Belum ada penjualan.', 4)) +
      '</tbody></table></div></div>' +
    '<div class="card"><div class="card-head"><h3>Pengeluaran terkini</h3></div>' +
      '<div class="table-wrap tbl-sm"><table><thead><tr><th>Keterangan</th>' +
        '<th class="r">Nominal</th><th>Tanggal</th></tr></thead><tbody>' +
        (d.live_expense.length ? d.live_expense.map(function (r) {
          return '<tr><td>' + esc(r.Keterangan) + '</td>' +
            '<td class="r num">' + rupiah(r.Nominal) + '</td>' +
            '<td>' + tglIndo(r.Tanggal) + '</td></tr>';
        }).join('') : tabelKosong('Belum ada pengeluaran.', 3)) +
      '</tbody></table></div></div>';

  var maxShift = Math.max(d.shift_chart.Pagi, d.shift_chart.Sore, d.shift_chart['Luar Jam'] || 0);
  var kartuShiftBar =
    '<div class="card"><div class="card-head"><h3>Pagi vs sore</h3></div>' +
      barPeringkat([
        { nama: 'Shift pagi', nilai: d.shift_chart.Pagi, tampil: rupiahPendek(d.shift_chart.Pagi) },
        { nama: 'Shift sore', nilai: d.shift_chart.Sore, tampil: rupiahPendek(d.shift_chart.Sore) }
      ].concat(d.shift_chart['Luar Jam'] ? [{
        nama: 'Di luar jam buka', nilai: d.shift_chart['Luar Jam'],
        tampil: rupiahPendek(d.shift_chart['Luar Jam'])
      }] : []), { kosong: 'Belum ada penjualan.' }) +
    '</div>';

  var kartuProduk =
    '<div class="card"><div class="card-head"><h3>Produk terlaris</h3></div>' +
      barPeringkat(d.top_produk.map(function (p) {
        return { nama: p.nama, nilai: p.qty, tampil: angka(p.qty) + ' pcs' };
      }), { alt: true, kosong: 'Belum ada penjualan pada rentang ini.' }) +
    '</div>';

  var kartuPelanggan =
    '<div class="card"><div class="card-head"><h3>Pelanggan</h3>' +
      '<div class="tabs" id="dbTabsPel">' +
        '<button class="is-active" data-tab="top">Teratas</button>' +
        '<button data-tab="risk">Perlu ditindak</button>' +
      '</div></div>' +
      '<div id="dbPelTop">' +
        barPeringkat(d.top_pelanggan.map(function (c) {
          return {
            nama: c.Nama, nilai: c.Total_Belanja, tampil: rupiahPendek(c.Total_Belanja),
            catatan: c.Tipe_Customer + ' · ' + angka(c.Jumlah_Transaksi) + ' transaksi'
          };
        }), { kosong: 'Belum ada pelanggan yang berbelanja.' }) +
      '</div>' +
      '<div id="dbPelRisk" hidden>' +
        (d.at_risk.length ? d.at_risk.map(function (c) {
          return '<div class="rank-item" style="margin-bottom:12px">' +
            '<div class="rank-top"><strong>' + esc(c.Nama) + '</strong>' +
              '<a class="btn btn-sm" target="_blank" href="https://wa.me/' + esc(c.Nomor_WA) + '">WhatsApp</a>' +
            '</div>' +
            '<div class="sub">' + esc(c.Tipe_Customer) + ' · ' + c.jeda_hari +
              ' hari tanpa transaksi · ' + rupiahPendek(c.Total_Belanja) + '</div>' +
          '</div>';
        }).join('') : '<div class="empty">Tidak ada pelanggan yang tertinggal.</div>') +
      '</div>' +
    '</div>';

  /* 6. Tabel detail terlipat */
  var lipat =
    '<details class="fold stack14" id="dbFold">' +
      '<summary>Rincian stok: kedaluwarsa dan yang perlu dipesan</summary>' +
      '<div class="fold-body"><div class="grid g2">' +
        '<div><h4 style="font-size:14px; margin-bottom:9px">Mendekati kedaluwarsa</h4>' +
          '<div class="table-wrap"><table><thead><tr><th>Obat</th><th>Batch</th>' +
            '<th class="c">Stok</th><th>Sisa</th></tr></thead><tbody>' +
            (d.expiring.length ? d.expiring.map(function (r) {
              return '<tr><td>' + esc(r.Nama_Obat) + '</td><td>' + esc(r.Kode_Batch) + '</td>' +
                '<td class="c num">' + angka(r.Stok_Real) + '</td>' +
                '<td>' + chipExpired(r.sisa_hari, r.Expired_Date) + '</td></tr>';
            }).join('') : tabelKosong('Tidak ada batch yang mendesak.', 4)) +
          '</tbody></table></div></div>' +
        '<div><h4 style="font-size:14px; margin-bottom:9px">Perlu dipesan ulang</h4>' +
          '<div class="table-wrap"><table><thead><tr><th>Obat</th>' +
            '<th class="c">Stok kini</th><th class="c">Minimum</th></tr></thead><tbody>' +
            (d.stok_menipis.length ? d.stok_menipis.map(function (r) {
              return '<tr><td>' + esc(r.Nama_Obat) + '</td>' +
                '<td class="c num">' + angka(r.stok) + '</td>' +
                '<td class="c num">' + angka(r.minimal) + '</td></tr>';
            }).join('') : tabelKosong('Semua produk di atas minimum.', 3)) +
          '</tbody></table></div></div>' +
      '</div></div>' +
    '</details>';

  /* 7. Insight AI terperinci, hanya Owner */
  var insight = d.ai_enabled ?
    '<details class="fold stack14" id="dbInsight">' +
      '<summary>Rekomendasi strategis terperinci</summary>' +
      '<div class="fold-body" id="aiInsights">' + kerangka(3) + '</div>' +
    '</details>' : '';

  return hero + grafikOmzetHtml() + strip + segStrip +
    '<div class="split">' +
      '<div>' + kartuShift + feedJual + '</div>' +
      '<div>' + kartuShiftBar + kartuProduk + kartuPelanggan + '</div>' +
    '</div>' + lipat + insight +
    // Tombol cetak ringkasan Owner, di luar area yang akan di-screenshot.
    '<div class="card db-print-card">' +
      '<div class="card-head"><h3>Cetak ringkasan Owner</h3></div>' +
      '<p class="sub" style="margin:0 0 10px">Menghasilkan 1 halaman A4 berisi KPI utama, ' +
        'top 5 produk, top 5 pelanggan, dan 5 transaksi terakhir — siap print untuk arsip.</p>' +
      '<button class="btn btn-primary" id="dbCetak">' + '\u{1F5B6}️' + ' Cetak ringkasan</button>' +
    '</div>';
}

function satelit(label, nilai, minus, delta) {
  return '<div><div class="sat-label">' + esc(label) + '</div>' +
    '<div class="sat-nilai' + (minus ? ' minus' : '') + '">' + esc(nilai) + '</div>' +
    (delta !== undefined && delta !== null ? chipDelta(delta) : '') + '</div>';
}

function seg(kelas, nilai, label) {
  return '<div class="seg ' + kelas + '">' +
    '<div class="seg-nilai">' + angka(nilai) + '</div>' +
    '<div class="seg-label">' + esc(label) + '</div></div>';
}

function pasangEventDashboard(d) {
  var strip = document.getElementById('dbStrip');
  if (strip) {
    strip.onclick = function () {
      var f = document.getElementById('dbFold');
      f.open = true;
      f.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }

  // Klik hero omzet → pindah ke halaman Laporan (filter sudah dibawa).
  var hero = document.getElementById('dbHero');
  if (hero) {
    hero.style.cursor = 'pointer';
    hero.title = 'Buka halaman Laporan dengan filter yang sama';
    hero.onclick = function (e) {
      // Klik di area gauge target tidak membuka laporan.
      if (e.target.closest('.hero-target')) return;
      if (typeof VIEWS !== 'undefined' && VIEWS.laporan && typeof gantiHalaman === 'function') {
        // Simpan filter ke session agar halaman Laporan bisa langsung memakainya.
        try { sessionStorage.setItem('db_filter', JSON.stringify(bacaFilter('db'))); } catch (e) {}
        gantiHalaman('laporan');
      }
    };
  }

  // Tombol cetak ringkasan Owner.
  var btnCetak = document.getElementById('dbCetak');
  if (btnCetak) btnCetak.onclick = function () { cetakRingkasanOwner(d); };

  var tabs = document.getElementById('dbTabsPel');
  if (tabs) {
    tabs.onclick = function (e) {
      var b = e.target.closest('[data-tab]');
      if (!b) return;
      tabs.querySelectorAll('button').forEach(function (x) {
        x.classList.toggle('is-active', x === b);
      });
      document.getElementById('dbPelTop').hidden = (b.dataset.tab !== 'top');
      document.getElementById('dbPelRisk').hidden = (b.dataset.tab !== 'risk');
    };
  }

  var fold = document.getElementById('dbInsight');
  if (fold) {
    fold.addEventListener('toggle', function () {
      if (fold.open && !fold.dataset.dimuat) { fold.dataset.dimuat = '1'; muatInsights(); }
    });
  }
}

function muatInsights() {
  var box = document.getElementById('aiInsights');
  if (!box) return;
  var cfg = window.AI_CFG || {};
  if (!cfg.summaryUrl || /REPLACE_ME/.test(cfg.summaryUrl)) {
    box.innerHTML = '<p class="sub">Asisten AI belum dikonfigurasi. Isi <code>window.AI_CFG</code> di <code>Index.html</code>.</p>';
    return;
  }
  fetch(cfg.summaryUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (cfg.token || '')
    },
    body: JSON.stringify({
      role: (SESSION && SESSION.user && SESSION.user.role) || '',
      filter: bacaFilter && bacaFilter('db') ? bacaFilter('db') : { mode: 'hari_ini' },
      mode: 'insights'
    })
  }).then(function (r) {
    return r.text().then(function (text) {
      if (!text || !text.trim()) throw new Error('Webhook mengembalikan response kosong.');
      var j;
      try { j = JSON.parse(text); } catch (e) { throw new Error('Response webhook bukan JSON: ' + text.slice(0, 160)); }
      return { ok: r.ok, body: Array.isArray(j) ? (j[0] || {}) : j };
    });
  }).then(function (res) {
    if (!res.ok || !res.body || res.body.ok === false) {
      throw new Error((res.body && res.body.error) || 'Gagal memuat insight.');
    }
    var d = res.body.data || {};
    var items = d.insights || [];
    if (!items.length) {
      box.innerHTML = '<p class="sub">Tidak ada insight khusus saat ini.</p>';
      return;
    }
    box.innerHTML = items.map(function (x) {
      var draft = x.draft_wa ?
        '<button class="btn btn-sm" style="margin-top:8px" data-wadraft="' + esc(x.nomor_wa) +
        '" data-pesan="' + esc(x.draft_wa) + '">Buka draf WhatsApp</button>' : '';
      return '<div class="insight ' + esc(x.level || '') + '">' +
        '<h4>' + esc(x.judul) + '</h4><p>' + esc(x.isi) + '</p>' +
        (x.aksi ? '<div class="aksi">' + esc(x.aksi) + '</div>' : '') + draft + '</div>';
    }).join('');
    box.onclick = function (e) {
      var b = e.target.closest('[data-wadraft]');
      if (!b) return;
      window.open('https://wa.me/' + b.dataset.wadraft + '?text=' + encodeURIComponent(b.dataset.pesan), '_blank');
    };
  }).catch(function (e) {
    box.innerHTML = '<p class="sub">' + esc(e.message) + '</p>';
  });
}

/* =========================================== Cetak ringkasan Owner (1 halaman)
   Rangkuman A4 yang siap print, berisi KPI utama, top 5 produk, top 5
   pelanggan, dan 5 transaksi terakhir. Tidak menyentuh backend — data
   berasal dari payload dashboard yang sudah di-load. */
function cetakRingkasanOwner(d) {
  var k = d.kpi || {};
  var barisProduk = (d.top_produk || []).slice(0, 5).map(function (p, i) {
    return '<tr><td class="ctr">' + (i + 1) + '</td><td>' + esc(p.nama) + '</td>' +
      '<td class="r num">' + angka(p.qty) + ' pcs</td></tr>';
  }).join('') || '<tr><td colspan="3" class="ctr sub">Tidak ada data.</td></tr>';
  var barisPelanggan = (d.top_pelanggan || []).slice(0, 5).map(function (c, i) {
    return '<tr><td class="ctr">' + (i + 1) + '</td><td>' + esc(c.Nama) + '</td>' +
      '<td class="sub">' + esc(c.Tipe_Customer) + '</td>' +
      '<td class="r num">' + rupiah(c.Total_Belanja) + '</td></tr>';
  }).join('') || '<tr><td colspan="4" class="ctr sub">Tidak ada data.</td></tr>';
  var barisTrx = (d.live_sales || []).slice(0, 5).map(function (r) {
    return '<tr><td>' + esc(r.No_Nota) + '</td><td>' + esc(r.Nama_Pelanggan) + '</td>' +
      '<td class="r num">' + rupiah(r.Harga_Akhir) + '</td>' +
      '<td>' + esc(r.Jam) + '</td></tr>';
  }).join('') || '<tr><td colspan="4" class="ctr sub">Tidak ada data.</td></tr>';

  var el = document.getElementById('struk');
  // Pakai class 'lebar' (A4) bukan 'w80' (thermal 80mm) supaya muat semua tabel.
  el.className = 'struk lebar ringkasan-owner';
  var _cetak = new Date();
  var _hm = ('0' + _cetak.getHours()).slice(-2) + ':' + ('0' + _cetak.getMinutes()).slice(-2);
  var _tg = _cetak.getFullYear() + '-' + ('0' + (_cetak.getMonth() + 1)).slice(-2) +
    '-' + ('0' + _cetak.getDate()).slice(-2);
  el.innerHTML =
    '<div class="ctr"><strong>' + esc(CFG.APOTEK) + '</strong><br>' +
      '<span style="font-size:11px">Ringkasan ' + esc(d.rentang.label || 'periode') +
      (d.shift_filter && d.shift_filter !== 'Semua' ? ' · ' + esc(d.shift_filter) : '') + '</span><br>' +
      '<span style="font-size:10px; color:#666">Dicetak ' + esc(tglIndo(_tg)) + ' ' +
      esc(_hm) + ' · oleh ' + esc((SESSION && SESSION.user && SESSION.user.nama) || '-') + '</span></div>' +
    '<hr>' +
    '<table style="width:100%">' +
      '<tr><td><strong>Omzet</strong></td><td class="r num">' + rupiah(k.omzet) + '</td></tr>' +
      '<tr><td>Laba kotor</td><td class="r num">' + rupiah(k.laba_kotor) + '</td></tr>' +
      '<tr><td>Retur (' + angka(k.retur_count || 0) + ')</td><td class="r num">' + rupiah(k.retur_total || 0) + '</td></tr>' +
      '<tr><td>Nota terjual</td><td class="r num">' + angka(k.nota) + '</td></tr>' +
      '<tr><td>Rata-rata nota</td><td class="r num">' + rupiah(k.rata_nota) + '</td></tr>' +
    '</table>' +
    '<hr>' +
    '<div style="font-weight:700; font-size:11px; margin:4px 0 2px">Top 5 produk</div>' +
    '<table style="width:100%"><thead><tr><th style="width:18px">#</th><th>Produk</th>' +
      '<th class="r">Qty</th></tr></thead><tbody>' + barisProduk + '</tbody></table>' +
    '<div style="font-weight:700; font-size:11px; margin:8px 0 2px">Top 5 pelanggan</div>' +
    '<table style="width:100%"><thead><tr><th style="width:18px">#</th><th>Nama</th>' +
      '<th>Tipe</th><th class="r">Belanja</th></tr></thead><tbody>' + barisPelanggan + '</tbody></table>' +
    '<div style="font-weight:700; font-size:11px; margin:8px 0 2px">5 transaksi terakhir</div>' +
    '<table style="width:100%"><thead><tr><th>Nota</th><th>Pembeli</th>' +
      '<th class="r">Total</th><th>Jam</th></tr></thead><tbody>' + barisTrx + '</tbody></table>' +
    '<hr>' +
    '<div class="ctr sub" style="font-size:10px">' +
      'Dokumen ini dihasilkan otomatis oleh SI-FaMitra untuk arsip internal.</div>';

  setTimeout(function () { window.print(); }, 120);
}