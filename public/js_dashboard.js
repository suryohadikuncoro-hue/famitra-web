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
    var tanggal = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    var pil = [['hari_ini', 'Hari ini'], ['mingguan', '7 hari'], ['bulanan', 'Bulanan'], ['tahunan', 'Tahunan'], ['custom', 'Pilih tanggal']];
    // Ringkasan AI tetap paling atas (posisi tidak dipindah). Filter memakai
    // filterBarHtml('db') yang sama (ID dbMode/dbShift/... tetap) supaya
    // bacaFilter('db') — dipakai ringkasan & insight AI — tidak berubah.
    el.innerHTML =
      (punyaAI ? bannerKerangka() : '') +
      '<div class="db-head">' +
        '<div class="db-tanggal">' + esc(tanggal) + '</div>' +
        '<div class="db-kontrol">' +
          '<div class="db-pil" id="dbPil" role="group" aria-label="Rentang data">' +
            pil.map(function (p) {
              return '<button type="button" data-mode="' + p[0] + '" aria-pressed="' + (p[0] === 'hari_ini') + '">' + p[1] + '</button>';
            }).join('') +
          '</div>' +
          '<div class="db-filter">' + filterBarHtml('db') + '</div>' +
          '<span class="db-pj" id="dbPJ" hidden></span>' +
          '<button type="button" class="db-ikon-btn" id="dbCetak" title="Cetak ringkasan" aria-label="Cetak ringkasan" disabled>' +
            '<svg viewBox="0 0 24 24"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div id="dbIsi">' + kerangka(6) + '</div>';
    pasangFilter('db', muatDashboard, 'hari_ini');
    pasangPilRentang();
    muatDashboard();
    // Ringkasan AI dimulai manual melalui tombol Mulai/Refresh.
  }
};

/* Pil rentang menggantikan dropdown "Rentang" (dropdown tetap ada tapi
   disembunyikan, jadi nilai filter tetap dibaca dari elemen yang sama). */
function pasangPilRentang() {
  var mode = document.getElementById('dbMode');
  var wadah = document.querySelector('.db-filter');
  if (!mode || !wadah) return;
  mode.closest('.field').style.display = 'none';
  function perluTerapkan() {
    wadah.classList.toggle('perlu-terapkan', ['bulanan', 'tahunan', 'custom'].indexOf(mode.value) >= 0);
  }
  document.getElementById('dbPil').onclick = function (e) {
    var b = e.target.closest('[data-mode]');
    if (!b) return;
    mode.value = b.dataset.mode;
    mode.dispatchEvent(new Event('change'));
    this.querySelectorAll('[data-mode]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
    perluTerapkan();
    if (b.dataset.mode === 'hari_ini' || b.dataset.mode === 'mingguan') muatDashboard();
  };
  var shift = document.getElementById('dbShift');
  if (shift) shift.addEventListener('change', muatDashboard);
  perluTerapkan();
}

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
    muatPromoWidget();
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
      : 'rgba(20,22,27,.08)';
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
  var judul = '<div class="dk-judul">Target omset' +
    '<svg class="dk-ikon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg></div>';
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

/* Grafik omzet harian bergaya sparkline (referensi Owner): tanpa sumbu &
   garis bantu, garis gelap = periode ini, garis merah pudar = periode
   sebelumnya, titik bercincin + kartu tooltip putih, pilihan 7/14/30 hari
   di bawah grafik. Data `tren_harian` 60 hari (tidak ikut filter). */
var GRAFIK = { hari: 7, data: [], aktif: null };

function kurvaHalus(p, jepitAtas, jepitBawah) {
  var jepit = function (y) {
    return jepitAtas === undefined ? y : Math.max(jepitAtas, Math.min(jepitBawah, y));
  };
  var d = 'M' + p[0][0].toFixed(1) + ',' + p[0][1].toFixed(1);
  for (var k = 0; k < p.length - 1; k++) {
    var p0 = p[k - 1] || p[k], p1 = p[k], p2 = p[k + 1], p3 = p[k + 2] || p2;
    d += ' C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + ',' + jepit(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) +
      ' ' + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + ',' + jepit(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) +
      ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
  }
  return d;
}

/* Sparkline kecil untuk kartu KPI (visual, minim teks):
   - jenis 'area'  : kurva + area bergradasi merah (kartu omzet, gelap)
   - jenis 'batang': kolom mini, hari ini disorot (kartu nota) */
function sparkMini(ini, lalu, gelap, jenis) {
  if (!ini.length) return '';
  var W = 110, H = 48, id = 'sp' + Math.random().toString(36).slice(2, 7);
  var mx = Math.max.apply(null, ini), mn = Math.min.apply(null, ini);
  if (jenis === 'batang') {
    mx = mx || 1;
    var n = ini.length, gap = 4, bw = (W - gap * (n - 1)) / n;
    return '<svg class="db-spark" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' +
      ini.map(function (v, i) {
        var h = Math.max(4, v / mx * (H - 4));
        var akhir = i === n - 1;
        return '<rect x="' + (i * (bw + gap)).toFixed(1) + '" y="' + (H - h).toFixed(1) + '" width="' + bw.toFixed(1) +
          '" height="' + h.toFixed(1) + '" rx="' + Math.min(4, bw / 2).toFixed(1) + '" fill="' +
          (akhir ? '#CE2C2B' : (gelap ? 'rgba(255,255,255,.16)' : '#E6E8EC')) + '"/>';
      }).join('') + '</svg>';
  }
  if (mx === mn) { mx += 1; mn -= 1; }
  var titik = ini.map(function (v, i) { return [2 + i * (W - 4) / Math.max(1, ini.length - 1), 6 + (mx - v) / (mx - mn) * (H - 12)]; });
  var garis = kurvaHalus(titik), akhir = titik[titik.length - 1];
  return '<svg class="db-spark" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' +
    '<defs><linearGradient id="' + id + '" x1="0" x2="0" y1="0" y2="1">' +
      '<stop offset="0" stop-color="#E8563F" stop-opacity=".55"/><stop offset="1" stop-color="#CE2C2B" stop-opacity="0"/></linearGradient></defs>' +
    '<path d="' + garis + ' L' + akhir[0].toFixed(1) + ',' + H + ' L' + titik[0][0].toFixed(1) + ',' + H + ' Z" fill="url(#' + id + ')"/>' +
    '<path d="' + garis + '" fill="none" stroke="' + (gelap ? '#fff' : '#CE2C2B') + '" stroke-width="2.2" stroke-linecap="round"/>' +
    '<circle cx="' + akhir[0].toFixed(1) + '" cy="' + akhir[1].toFixed(1) + '" r="6" fill="#E8563F" opacity=".35"/>' +
    '<circle cx="' + akhir[0].toFixed(1) + '" cy="' + akhir[1].toFixed(1) + '" r="3.2" fill="#fff"/></svg>';
}

function grafikOmzetHtml() {
  return '<div class="dkartu db-grafik" id="dbGrafik">' +
    '<div class="db-grafik-head">' +
      '<div><div class="dk-judul">Omzet harian</div>' +
        '<div class="db-grafik-total" id="dbGrafikTotal"></div>' +
        '</div>' +
      '<div class="db-legenda"><span><i class="lg-ini"></i>Ini</span><span><i class="lg-lalu"></i>Sebelumnya</span></div>' +
    '</div>' +
    '<div class="db-grafik-area" id="dbGrafikArea"></div>' +
    '<div class="db-rentang" role="group" aria-label="Rentang grafik">' +
      '<button type="button" data-grafik="7" aria-pressed="true">7 hari</button>' +
      '<button type="button" data-grafik="14" aria-pressed="false">14 hari</button>' +
      '<button type="button" data-grafik="30" aria-pressed="false">30 hari</button>' +
    '</div>' +
  '</div>';
}

function pasangGrafikOmzet(d) {
  GRAFIK.data = d.tren_harian || (d.sparkline || []).map(function (x) { return { tanggal: x.tanggal, omzet: x.omzet, nota: x.nota }; });
  var card = document.getElementById('dbGrafik');
  if (!card) return;
  card.querySelector('.db-rentang').onclick = function (e) {
    var b = e.target.closest('[data-grafik]');
    if (!b) return;
    GRAFIK.hari = Number(b.dataset.grafik);
    GRAFIK.aktif = null;
    gambarGrafikOmzet();
  };
  gambarGrafikOmzet();
}

function gambarGrafikOmzet() {
  var area = document.getElementById('dbGrafikArea');
  if (!area) return;
  var n = GRAFIK.hari, semuaData = GRAFIK.data;
  var data = semuaData.slice(-n);
  var lalu = semuaData.length >= n * 2 ? semuaData.slice(-n * 2, -n) : [];

  document.querySelectorAll('#dbGrafik [data-grafik]').forEach(function (b) {
    b.setAttribute('aria-pressed', Number(b.dataset.grafik) === n ? 'true' : 'false');
  });
  var jumlah = function (arr) { return arr.reduce(function (t, x) { return t + Number(x.omzet || 0); }, 0); };
  var total = jumlah(data), totalLalu = jumlah(lalu);
  var delta = lalu.length && totalLalu > 0 ? (total - totalLalu) / totalLalu * 100 : null;
  document.getElementById('dbGrafikTotal').innerHTML = esc(rupiah(total)) + ' ' + chipDelta(delta);
  if (!data.length) { area.innerHTML = '<div class="empty">Belum ada data penjualan.</div>'; return; }

  var W = Math.max(260, area.clientWidth || 600);
  var sempit = W < 500;
  var H = sempit ? 200 : 210, pt = sempit ? 70 : 64, pb = 28, px = 10;
  var ch = H - pt - pb, cw = W - px * 2;
  var nilai = data.map(function (x) { return Number(x.omzet || 0); });
  var nilaiLalu = lalu.map(function (x) { return Number(x.omzet || 0); });
  var semua = nilai.concat(nilaiLalu);
  // Skala mengikuti rentang data (gaya sparkline), bukan dari nol, supaya naik-turun terlihat.
  var mx = Math.max.apply(null, semua), mn = Math.min.apply(null, semua);
  var ruang = (mx - mn) * 0.12 || Math.abs(mx) * 0.1 || 1;
  mx += ruang * 0.4; mn -= ruang;
  var X = function (i) { return px + (data.length === 1 ? cw / 2 : i * cw / (data.length - 1)); };
  var Y = function (v) { return pt + (mx - v) / (mx - mn) * ch; };
  var titik = nilai.map(function (v, i) { return [X(i), Y(v)]; });
  var titikLalu = nilaiLalu.map(function (v, i) { return [X(i), Y(v)]; });
  var aktif = GRAFIK.aktif === null || GRAFIK.aktif >= data.length ? data.length - 1 : GRAFIK.aktif;

  // Label tanggal: pudar, yang aktif tebal; label dekat titik aktif disembunyikan.
  var tiap = Math.max(1, Math.ceil(data.length / Math.max(3, Math.floor(cw / 78))));
  var label = data.map(function (x, i) {
    var t = String(x.tanggal);
    return '<text class="db-x" data-i="' + i + '" x="' + X(i).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="' +
      (i === 0 ? 'start' : (i === data.length - 1 ? 'end' : 'middle')) + '"' +
      ((data.length - 1 - i) % tiap ? ' data-sisip="1"' : '') + '>' +
      Number(t.slice(8, 10)) + ' ' + ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][Number(t.slice(5, 7)) - 1] + '</text>';
  }).join('');
  var garis = kurvaHalus(titik, pt - 4, pt + ch + 4);
  var isiArea = garis + ' L' + titik[titik.length - 1][0].toFixed(1) + ',' + (pt + ch) + ' L' + titik[0][0].toFixed(1) + ',' + (pt + ch) + ' Z';

  area.innerHTML =
    '<svg class="db-grafik-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Grafik omzet ' + n + ' hari terakhir">' +
      '<defs><linearGradient id="gOmzetArea" x1="0" x2="0" y1="0" y2="1">' +
        '<stop offset="0" stop-color="#25262A" stop-opacity=".07"/><stop offset="1" stop-color="#25262A" stop-opacity="0"/></linearGradient></defs>' +
      (data.length > 1 ? '<path d="' + isiArea + '" fill="url(#gOmzetArea)"/>' : '') +
      (titikLalu.length > 1 ? '<path d="' + kurvaHalus(titikLalu, pt - 4, pt + ch + 4) + '" fill="none" stroke="#CE2C2B" stroke-opacity=".45" stroke-width="2.2" stroke-linecap="round"/>' : '') +
      (data.length > 1 ? '<path d="' + garis + '" fill="none" stroke="#25262A" stroke-width="3" stroke-linecap="round"/>' : '') +
      label +
      '<g id="dbGrafikPenanda"><circle r="8" fill="#fff" stroke="#25262A" stroke-width="2.5"/><circle r="3" fill="#25262A"/></g>' +
      '<rect x="0" y="0" width="' + W + '" height="' + (H - pb) + '" fill="transparent" id="dbGrafikSentuh"/>' +
    '</svg>' +
    '<div class="db-tip" id="dbGrafikTip"></div>';

  var hariNama = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  var bulan = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  var penanda = document.getElementById('dbGrafikPenanda');
  var tip = document.getElementById('dbGrafikTip');
  var labelEl = area.querySelectorAll('.db-x');
  function tunjuk(i) {
    var px_ = titik[i][0], py = titik[i][1];
    penanda.setAttribute('transform', 'translate(' + px_.toFixed(1) + ',' + py.toFixed(1) + ')');
    labelEl.forEach(function (t) {
      var j = Number(t.getAttribute('data-i'));
      t.classList.toggle('on', j === i);
      var dekat = Math.abs(j - i) * cw / Math.max(1, data.length - 1) < 58;
      t.style.display = (j === i || (!dekat && !t.hasAttribute('data-sisip'))) ? '' : 'none';
    });
    var tg = new Date(data[i].tanggal + 'T00:00:00');
    tip.innerHTML = '<small>' + hariNama[tg.getDay()] + ', ' + tg.getDate() + ' ' + bulan[tg.getMonth()] + '</small>' +
      '<b>' + esc(rupiah(data[i].omzet)) + '</b>' +
      (data[i].nota !== undefined ? '<small>' + angka(data[i].nota) + ' nota</small>' : '');
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.max(0, Math.min(W - tw, px_ - tw / 2)) + 'px';
    var atas = py - th - 16;
    tip.style.top = (atas >= 0 ? atas : py + 16) + 'px';
  }
  function dariPosisi(ev) {
    var box = area.getBoundingClientRect();
    var x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - box.left;
    var i = data.length === 1 ? 0 : Math.round((x - px) / cw * (data.length - 1));
    GRAFIK.aktif = Math.max(0, Math.min(data.length - 1, i));
    tunjuk(GRAFIK.aktif);
  }
  var sentuh = document.getElementById('dbGrafikSentuh');
  sentuh.addEventListener('mousemove', dariPosisi);
  sentuh.addEventListener('touchstart', dariPosisi, { passive: true });
  sentuh.addEventListener('touchmove', dariPosisi, { passive: true });
  tunjuk(aktif);
}

// Gambar ulang grafik saat lebar layar berubah (dipasang sekali).
(function () {
  var t = null;
  window.addEventListener('resize', function () {
    clearTimeout(t);
    t = setTimeout(function () { if (document.getElementById('dbGrafikArea')) gambarGrafikOmzet(); }, 150);
  });
})();

/* ------------------------------------------------ Promo & kampanye aktif
   Data dari Edge Function `promo` action `dashboardAktif` (Owner & Apoteker):
   kupon (kampanye ACTIVE dalam periode), bundle ACTIVE, undian aktif, beserta
   ringkasan laporan periode aktif. Visual diutamakan, teks seminimal mungkin. */
var IKON_PROMO = {
  kupon: '<path d="M3 9V6a1 1 0 011-1h16a1 1 0 011 1v3a3 3 0 000 6v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3a3 3 0 000-6z"/><path d="M9 9h.01M15 15h.01M15 9l-6 6"/>',
  bundle: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  undian: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M3 12h18M12 8v13"/><path d="M12 8c-2-4-6-4-6-1.5S9 8 12 8zm0 0c2-4 6-4 6-1.5S15 8 12 8z"/>'
};

/* Widget promo memakai Edge Function promo action `dashboardAktif` yang hanya
   untuk Owner dan Apoteker. Untuk role lain kartunya tidak dirender supaya
   tidak muncul pesan "Akses ditolak" di dashboard. */
function bolehPromoDashboard_() {
  var role = (SESSION && SESSION.user && SESSION.user.role) || '';
  return role === 'Owner' || role === 'Apoteker';
}

function promoKartuHtml() {
  if (!bolehPromoDashboard_()) return '';
  return '<div class="db-grid21" id="dbPromoBaris">' +
    '<div class="dkartu" id="dbPromo">' + kerangka(3) + '</div>' +
    '<div class="dkartu db-promo-sum" id="dbPromoSum">' + kerangka(3) + '</div>' +
  '</div>';
}

function muatPromoWidget() {
  if (!bolehPromoDashboard_()) return;
  var kiri = document.getElementById('dbPromo'), kanan = document.getElementById('dbPromoSum');
  if (!kiri) return;
  promoApi('dashboardAktif', {}).then(function (res) {
    var d = normalisasiPromo(res || {});
    kiri.innerHTML = gambarDaftarPromo(d.items || []);
    kanan.innerHTML = gambarRingkasPromo(d.ringkasan || {}, d.items || []);
    var kelola = kiri.querySelector('[data-kelola]');
    if (kelola) kelola.onclick = function () { gantiHalaman('marketing'); };
  }).catch(function (e) {
    kiri.innerHTML = '<div class="dk-judul">Promo & kampanye aktif</div><div class="empty">' + esc(e.message) + '</div>';
    kanan.innerHTML = '';
    kanan.hidden = true;
  });
}

/* Samakan bentuk data backend (kupon/bundle/undian) untuk tampilan. */
function normalisasiPromo(res) {
  var items = (res.item || res.items || []).map(function (x) {
    if (x.jenis === 'kupon') {
      var kode = (x.kode || []).map(function (c) { return c.code; });
      var kuota = (x.kode || []).every(function (c) { return c.usage_limit_total; }) && (x.kode || []).length
        ? (x.kode || []).reduce(function (n, c) { return n + Number(c.usage_limit_total || 0); }, 0) : null;
      return { jenis: 'kupon', nama: x.nama, kode: kode[0] ? kode[0] + (kode.length > 1 ? ' +' + (kode.length - 1) : '') : '',
        mulai: x.mulai, selesai: x.selesai, pakai: x.dipakai || 0, kuota: kuota, omzet: x.omzet || 0 };
    }
    if (x.jenis === 'bundle') {
      return { jenis: 'bundle', nama: x.nama, kode: x.kode || '', mulai: x.mulai, selesai: x.selesai,
        pakai: x.terjual || 0, kuota: null, omzet: x.omzet || 0 };
    }
    // Undian: tanggal selesai = akhir hari periode_selesai.
    return { jenis: 'undian', nama: x.nama, kode: '', mulai: x.mulai + 'T00:00:00+07:00', selesai: x.selesai + 'T23:59:59+07:00',
      pakai: x.pemenang || 0, kuota: x.hadiah || null, omzet: 0 };
  });
  var r = res.ringkasan || {};
  return { items: items, ringkasan: { omzet: r.omzet || 0, diskon: r.diskon || 0, hpp: r.hpp || 0,
    nota: r.transaksi || r.nota || 0, pelanggan: r.pelanggan_unik || r.pelanggan || 0 } };
}

function cincinWaktu(mulai, selesai, jenis) {
  var a = new Date(mulai).getTime(), b = new Date(selesai).getTime(), now = Date.now();
  var pct = b > a ? Math.max(0, Math.min(1, (now - a) / (b - a))) : 1;
  var r = 18, kel = 2 * Math.PI * r;
  return '<svg class="db-cincin" viewBox="0 0 44 44" aria-hidden="true">' +
    '<circle cx="22" cy="22" r="' + r + '" class="db-cincin-dasar"/>' +
    '<circle cx="22" cy="22" r="' + r + '" class="db-cincin-isi" transform="rotate(-90 22 22)" stroke-dasharray="' + kel.toFixed(1) + '" stroke-dashoffset="' + (kel * (1 - pct)).toFixed(1) + '"/>' +
    '<g transform="translate(12,12) scale(.8333)" class="db-cincin-ikon">' + (IKON_PROMO[jenis] || '') + '</g></svg>';
}

function sisaHari(selesai) {
  var ms = new Date(selesai).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 864e5));
}

function gambarDaftarPromo(items) {
  var isOwner = SESSION && SESSION.user && SESSION.user.role === 'Owner';
  var kepala = '<div class="dk-judul">Promo & kampanye aktif' +
    (items.length ? ' <span class="db-promo-hitung">' + items.length + '</span>' : '') +
    (isOwner ? '<button type="button" class="db-link-btn" data-kelola>Kelola ›</button>' : '') + '</div>';
  if (!items.length) {
    return kepala + '<div class="db-promo-kosong">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' + IKON_PROMO.kupon + '</svg>' +
      '<span>Belum ada promo aktif</span></div>';
  }
  var maxOmzet = Math.max.apply(null, items.map(function (x) { return Number(x.omzet || 0); }).concat([1]));
  return kepala + '<div class="db-promo-list">' + items.map(function (x) {
    var sisa = sisaHari(x.selesai);
    var kuota = x.kuota ? Math.min(1, (x.pakai || 0) / x.kuota) : null;
    var meter = kuota !== null
      ? '<span class="db-meter" title="Pemakaian ' + angka(x.pakai || 0) + ' dari ' + angka(x.kuota) + '"><i style="width:' + (kuota * 100).toFixed(0) + '%"></i></span>'
      : '<span class="db-meter alt" title="Omzet ' + esc(rupiahPendek(x.omzet || 0)) + '"><i style="width:' + ((x.omzet || 0) / maxOmzet * 100).toFixed(0) + '%"></i></span>';
    return '<div class="db-promo-item ' + esc(x.jenis) + '">' +
      cincinWaktu(x.mulai, x.selesai, x.jenis) +
      '<div class="db-promo-teks">' +
        '<div class="db-promo-nama">' + esc(x.nama) + (x.kode ? ' <code>' + esc(x.kode) + '</code>' : '') + '</div>' +
        '<div class="db-promo-bawah">' + meter +
          '<span class="db-promo-sisa' + (sisa <= 3 ? ' mepet' : '') + '">' + sisa + ' hr</span></div>' +
      '</div>' +
      '<div class="db-promo-angka"><b>' + angka(x.pakai || 0) + (x.jenis === 'undian' && x.kuota ? '<small>/' + angka(x.kuota) + '</small>' : '') + '</b>' +
        '<span>' + (x.jenis === 'kupon' ? 'dipakai' : x.jenis === 'bundle' ? 'terjual' : 'pemenang') + '</span></div>' +
    '</div>';
  }).join('') + '</div>';
}

function gambarRingkasPromo(r, items) {
  var omzet = Number(r.omzet || 0), diskon = Number(r.diskon || 0), hpp = Number(r.hpp || 0);
  var laba = Math.max(0, omzet - hpp), dasar = omzet + diskon || 1;
  var roas = diskon > 0 ? omzet / diskon : null;
  var seg = function (v, kelas) { return '<i class="' + kelas + '" style="width:' + (v / dasar * 100).toFixed(1) + '%"></i>'; };
  var jual = items.filter(function (x) { return x.jenis !== 'undian' && x.omzet > 0; })
    .sort(function (a, b) { return b.omzet - a.omzet; }).slice(0, 4);
  var maxJual = jual.length ? jual[0].omzet : 1;
  // Cincin ROAS: penuh di 10×.
  var rr = 26, kel = 2 * Math.PI * rr, isi = roas ? Math.min(1, roas / 10) : 0;
  return '<div class="dk-judul">Hasil promo</div>' +
    '<div class="db-promo-atas">' +
      '<div><div class="db-promo-besar">' + esc(rupiahPendek(omzet)) + '</div>' +
        '<div class="db-promo-kecil">' + angka(r.nota || 0) + ' nota · ' + angka(r.pelanggan || 0) + ' pelanggan</div></div>' +
      '<svg class="db-roas" viewBox="0 0 64 64" role="img" aria-label="ROAS">' +
        '<circle cx="32" cy="32" r="' + rr + '" class="db-roas-dasar"/>' +
        '<circle cx="32" cy="32" r="' + rr + '" class="db-roas-isi" stroke-dasharray="' + kel.toFixed(1) + '" stroke-dashoffset="' + (kel * (1 - isi)).toFixed(1) + '"/>' +
        '<text x="32" y="33" text-anchor="middle" class="db-roas-angka">' + (roas ? (roas >= 10 ? Math.round(roas) : roas.toFixed(1).replace('.', ',')) + '×' : '—') + '</text>' +
        '<text x="32" y="45" text-anchor="middle" class="db-roas-label">ROAS</text></svg>' +
    '</div>' +
    '<div class="db-komposisi" title="Komposisi nilai belanja promo">' +
      seg(laba, 'laba') + seg(Math.min(hpp, omzet), 'hpp') + seg(diskon, 'diskon') + '</div>' +
    '<div class="db-komposisi-ket">' +
      '<span><i class="laba"></i>Laba ' + esc(rupiahPendek(laba)) + '</span>' +
      '<span><i class="hpp"></i>HPP ' + esc(rupiahPendek(hpp)) + '</span>' +
      '<span><i class="diskon"></i>Diskon ' + esc(rupiahPendek(diskon)) + '</span>' +
    '</div>' +
    (jual.length ? '<div class="db-promo-bar">' + jual.map(function (x) {
      return '<div><span class="n">' + esc(x.nama) + '</span><span class="b"><i style="width:' + (x.omzet / maxJual * 100).toFixed(0) + '%"></i></span>' +
        '<span class="v">' + esc(rupiahPendek(x.omzet)) + '</span></div>';
    }).join('') + '</div>' : '');
}

function inisial(nama) {
  var s = String(nama || '').trim();
  if (!s || /^umum$/i.test(s)) return 'U';
  return s.split(/\s+/).slice(0, 2).map(function (x) { return x.charAt(0); }).join('').toUpperCase();
}

function gambarDashboard(d) {
  var k = d.kpi;
  var rentangLabel = (d.rentang.label || 'periode ini').toLowerCase();
  var tren = d.tren_harian || [];
  var ambil = function (arr, f) { return arr.map(function (x) { return Number(x[f] || 0); }); };
  var tren7 = tren.slice(-7), tren7Lalu = tren.length >= 14 ? tren.slice(-14, -7) : [];

  /* 1. Tiga kartu KPI */
  // Laba kotor adalah hak Owner. Role lain (Apoteker/Kasir) melihat Rata-rata
  // nota: angka operasional yang penting, tapi bukan informasi laba.
  var isOwner = !!(SESSION && SESSION.user && SESSION.user.role === 'Owner');
  var kartuOmzet =
    '<div class="dkartu dk-gelap db-omzet" id="dbHero"' +
      (isOwner ? ' role="link" tabindex="0" title="Buka Laporan dengan filter yang sama"' : '') + '>' +
      '<div class="dk-judul">Omzet ' + esc(rentangLabel) + (d.shift_filter !== 'Semua' ? ' · ' + esc(d.shift_filter) : '') +
        '<svg class="dk-ikon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M15 9.5a3 3 0 00-3-1.5c-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2a3 3 0 01-3-1.5M12 6.5v11"/></svg></div>' +
      '<div class="dk-flex"><div>' +
        '<div class="dk-nilai">' + rupiah(k.omzet) + '</div>' +
        (k.delta_omzet !== null && k.delta_omzet !== undefined ? '<div class="dk-baris">' + chipDelta(k.delta_omzet) + '</div>' : '') +
      '</div>' + sparkMini(ambil(tren7, 'omzet'), null, true, 'area') + '</div>' +
      '<div class="dk-sub2">' +
        (isOwner
          ? '<div><small>Laba kotor</small><b class="' + (k.laba_kotor < 0 ? 'minus' : '') + '">' + rupiah(k.laba_kotor) + '</b></div>'
          : '<div><small>Rata-rata nota</small><b>' + rupiah(k.rata_nota || 0) + '</b></div>') +
        '<div><small>Retur</small><b>' + rupiah(k.retur_total || 0) + '</b></div>' +
      '</div>' +
    '</div>';

  var kartuNota =
    '<div class="dkartu db-nota">' +
      '<div class="dk-judul">Nota terjual' +
        '<svg class="dk-ikon" viewBox="0 0 24 24"><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg></div>' +
      '<div class="dk-flex"><div>' +
        '<div class="dk-nilai">' + angka(k.nota) + ' <small>nota</small></div>' +
        '<div class="dk-baris">' + chipDelta(k.delta_nota) + '<span>rata-rata ' + rupiah(k.rata_nota) + '</span></div>' +
      '</div>' + sparkMini(ambil(tren7, 'nota'), null, false, 'batang') + '</div>' +
    '</div>';

  /* Kartu stok visual: donat kesehatan stok (aman/menipis/habis dari produk
     aktif) + dua angka berikon (batch ED <90 hari, produk menipis). */
  var kritis = d.expiring_kritis > 0;
  var totalProduk = Number(d.produk_aktif_total || 0);
  var habis = Number(d.stok_habis_total || 0);
  var menipis = Math.max(0, Number(d.stok_menipis_total || 0) - habis);
  var aman = Math.max(0, totalProduk - menipis - habis);
  var persenAman = totalProduk ? Math.round(aman / totalProduk * 100) : null;
  var donat = (function () {
    var r = 30, kel = 2 * Math.PI * r, mulai = 0, bagian = [[aman, '#34D399'], [menipis, '#F5A524'], [habis, '#E5484D']];
    var busur = totalProduk ? bagian.map(function (b) {
      if (!b[0]) return '';
      var panjang = b[0] / totalProduk * kel;
      var el = '<circle cx="40" cy="40" r="' + r + '" fill="none" stroke="' + b[1] + '" stroke-width="10" ' +
        'stroke-dasharray="' + Math.max(0, panjang - 2).toFixed(1) + ' ' + kel.toFixed(1) + '" stroke-dashoffset="' + (-mulai).toFixed(1) + '" transform="rotate(-90 40 40)"/>';
      mulai += panjang; return el;
    }).join('') : '';
    return '<svg class="db-donat" viewBox="0 0 80 80" role="img" aria-label="Kesehatan stok: ' + aman + ' aman, ' + menipis + ' menipis, ' + habis + ' habis">' +
      '<circle cx="40" cy="40" r="30" fill="none" stroke="#EEF0F3" stroke-width="10"/>' + busur +
      '<text x="40" y="42" text-anchor="middle" class="db-donat-angka">' + (persenAman === null ? '—' : persenAman + '%') + '</text>' +
      '<text x="40" y="53" text-anchor="middle" class="db-donat-label">aman</text></svg>';
  })();
  var ikonJam = '<svg viewBox="0 0 24 24"><path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"/></svg>';
  var ikonKotak = '<svg viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>';
  var kartuStok =
    '<div class="dkartu db-stok' + (kritis ? ' kritis' : '') + '" id="dbStrip" role="button" tabindex="0" title="Buka rincian stok">' +
      '<div class="dk-judul">Stok' +
        '<svg class="dk-ikon" viewBox="0 0 24 24"><path d="M12 3l10 18H2L12 3z"/><path d="M12 10v4M12 17.5v.5"/></svg></div>' +
      '<div class="db-stok-visual">' + donat +
        '<div class="db-stok-angka">' +
          '<div class="' + (kritis ? 'bahaya' : (d.expiring_total ? 'waspada' : 'tenang')) + '" title="Batch kedaluwarsa < 90 hari' + (kritis ? ' (' + d.expiring_kritis + ' di bawah 30 hari)' : '') + '">' +
            '<span class="db-stok-ikon">' + ikonJam + '</span><b>' + angka(d.expiring_total || 0) + '</b><small>ED</small></div>' +
          '<div class="' + (d.stok_menipis_total ? 'waspada' : 'tenang') + '" title="Produk di bawah stok minimum">' +
            '<span class="db-stok-ikon">' + ikonKotak + '</span><b>' + angka(d.stok_menipis_total || 0) + '</b><small>menipis</small></div>' +
        '</div>' +
      '</div>' +
      (totalProduk ? '<div class="db-stok-legenda" aria-hidden="true">' +
        '<span><i style="background:#34D399"></i>' + angka(aman) + '</span>' +
        '<span><i style="background:#F5A524"></i>' + angka(menipis) + '</span>' +
        '<span><i style="background:#E5484D"></i>' + angka(habis) + '</span></div>' : '') +
    '</div>';

  /* 2. Grafik + target */
  var kartuTarget = '<div class="dkartu db-target hero-target" id="dbTargetOmsetBody">' + kerangka(2) + '</div>';

  /* 3. Tabel bertab */
  var barisJual = (d.live_sales || []).map(function (r) {
    return '<tr><td><span class="db-av">' + esc(inisial(r.Nama_Pelanggan)) + '</span>' + esc(r.Nama_Pelanggan || 'Umum') + '</td>' +
      '<td class="db-hp-sembunyi num" title="' + esc(r.No_Nota) + '">' + esc(r.No_Nota) + '</td>' +
      '<td class="num">' + esc(r.Jam) + '</td>' +
      '<td class="db-hp-sembunyi"><span class="db-shift' + (r.Shift === 'Luar Jam' ? ' warn' : '') + '">' + esc(r.Shift || '-') + '</span></td>' +
      '<td class="r num"><b>' + rupiah(r.Harga_Akhir) + '</b></td></tr>';
  }).join('');
  var barisProduk = (d.top_produk || []).map(function (p, i) {
    return '<tr><td><span class="db-av db-av-no">' + (i + 1) + '</span>' + esc(p.nama) + '</td>' +
      '<td class="r num">' + angka(p.qty) + ' pcs</td><td class="r num"><b>' + rupiah(p.omzet) + '</b></td></tr>';
  }).join('');
  var barisPel = (d.top_pelanggan || []).map(function (c) {
    return '<tr><td><span class="db-av">' + esc(inisial(c.Nama)) + '</span>' + esc(c.Nama) + '</td>' +
      '<td class="db-hp-sembunyi">' + esc(c.Tipe_Customer) + '</td>' +
      '<td class="r num">' + angka(c.Jumlah_Transaksi) + ' trx</td><td class="r num"><b>' + rupiah(c.Total_Belanja) + '</b></td></tr>';
  }).join('');
  var risiko = (d.at_risk || []).length ? '<div class="db-risiko"><div class="dk-judul">Perlu ditindak</div>' +
    d.at_risk.map(function (c) {
      return '<div class="db-risiko-item"><div><b>' + esc(c.Nama) + '</b><div class="dk-sub">' + esc(c.Tipe_Customer) + ' · ' +
        c.jeda_hari + ' hari tanpa transaksi · ' + rupiahPendek(c.Total_Belanja) + '</div></div>' +
        '<a class="btn btn-sm" target="_blank" href="https://wa.me/' + esc(c.Nomor_WA) + '">WhatsApp</a></div>';
    }).join('') + '</div>' : '';
  var barisBiaya = (d.live_expense || []).map(function (r) {
    return '<tr><td>' + esc(r.Keterangan) + '</td><td>' + tglIndo(r.Tanggal) + '</td><td class="r num"><b>' + rupiah(r.Nominal) + '</b></td></tr>';
  }).join('');
  var tabel = function (kepala, isi, kolom, kosong) {
    return '<div class="db-tabel"><table><thead><tr>' + kepala + '</tr></thead><tbody>' +
      (isi || tabelKosong(kosong, kolom)) + '</tbody></table></div>';
  };
  var kartuTab =
    '<div class="dkartu db-tab">' +
      '<div class="db-tabs" id="dbTabs" role="tablist">' +
        '<button type="button" role="tab" data-tabdb="jual" aria-selected="true">Penjualan terkini</button>' +
        '<button type="button" role="tab" data-tabdb="produk" aria-selected="false">Produk terlaris</button>' +
        '<button type="button" role="tab" data-tabdb="pel" aria-selected="false">Pelanggan teratas</button>' +
        '<button type="button" role="tab" data-tabdb="biaya" aria-selected="false">Pengeluaran</button>' +
      '</div>' +
      '<div data-panel="jual">' + tabel('<th>Pelanggan</th><th class="db-hp-sembunyi">Nota</th><th>Jam</th><th class="db-hp-sembunyi">Shift</th><th class="r">Total</th>', barisJual, 5, 'Belum ada penjualan.') + '</div>' +
      '<div data-panel="produk" hidden>' + tabel('<th>Produk</th><th class="r">Terjual</th><th class="r">Omzet</th>', barisProduk, 3, 'Belum ada penjualan pada rentang ini.') + '</div>' +
      '<div data-panel="pel" hidden>' + tabel('<th>Pelanggan</th><th class="db-hp-sembunyi">Tipe</th><th class="r">Transaksi</th><th class="r">Belanja</th>', barisPel, 4, 'Belum ada pelanggan yang berbelanja.') + risiko + '</div>' +
      '<div data-panel="biaya" hidden>' + tabel('<th>Keterangan</th><th>Tanggal</th><th class="r">Nominal</th>', barisBiaya, 3, 'Belum ada pengeluaran.') + '</div>' +
    '</div>';

  /* 4. Widget gelap: penanggung jawab, omzet per shift, segmen pelanggan */
  var pj = d.pj_shift || {};
  var infoPJ = pj.role === 'Kasir'
    ? '<b>' + esc(pj.petugas) + '</b><span>Anda sedang jaga · sejak ' + esc(pj.login_at || '-') + '</span>'
    : (pj.petugas_jaga
      ? '<b>' + esc(pj.petugas_jaga) + '</b><span>' + esc(pj.sumber_aktivitas || 'Aktivitas') + ' terakhir pukul ' + esc(pj.aktivitas_jam || '-') + '</span>'
      : '<b>Belum ada aktivitas kasir</b><span>Anda login sebagai ' + esc(pj.petugas || '-') + '</span>');
  var sc = d.shift_chart || {};
  var shiftList = [['Pagi · 08–15', sc.Pagi || 0], ['Sore · 15–21', sc.Sore || 0]].concat(sc['Luar Jam'] ? [['Di luar jam', sc['Luar Jam']]] : []);
  var maxShift = Math.max.apply(null, shiftList.map(function (x) { return x[1]; })) || 1;
  var s = d.segmen_pelanggan || {};
  var widget =
    '<div class="dkartu dk-gelap db-widget">' +
      '<div class="dk-judul">Penanggung jawab <span class="db-chip-shift' + (pj.di_luar_jam ? ' luar' : '') + '">' +
        (pj.di_luar_jam ? 'Di luar jam buka' : esc(pj.shift || '-') + ' · ' + esc(pj.jam || '')) + '</span></div>' +
      '<div class="db-pj-info">' + infoPJ + '</div>' +
      '<div class="dk-judul" style="margin-top:14px">Omzet per shift</div>' +
      '<div class="db-shift-list">' + shiftList.map(function (x) {
        return '<div><div class="t"><span>' + x[0] + '</span><b>' + rupiah(x[1]) + '</b></div>' +
          '<div class="bar"><i style="width:' + (x[1] / maxShift * 100).toFixed(1) + '%"></i></div></div>';
      }).join('') + '</div>' +
      '<div class="dk-judul" style="margin-top:14px">Segmen pelanggan</div>' +
      '<div class="db-seg4">' +
        '<div><b>' + angka(s.VIP || 0) + '</b><small>VIP</small></div>' +
        '<div><b>' + angka(s['Active Routine'] || 0) + '</b><small>Rutin belanja</small></div>' +
        '<div><b class="' + ((s['At-Risk'] || 0) ? 'warn' : '') + '">' + angka(s['At-Risk'] || 0) + '</b><small>Perlu ditindak</small></div>' +
        '<div><b>' + angka(s.Baru || 0) + '</b><small>Baru terdaftar</small></div>' +
      '</div>' +
    '</div>';

  /* 5. Rincian stok & rekomendasi AI (terlipat; ID tetap) */
  var lipat =
    '<details class="fold" id="dbFold">' +
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
  var insight = d.ai_enabled ?
    '<details class="fold" id="dbInsight">' +
      '<summary>Rekomendasi strategis terperinci</summary>' +
      '<div class="fold-body" id="aiInsights">' + kerangka(3) + '</div>' +
    '</details>' : '';

  return '<div class="db-grid3">' + kartuOmzet + kartuNota + kartuStok + '</div>' +
    '<div class="db-grid21 db-baris-grafik">' + grafikOmzetHtml() + kartuTarget + '</div>' +
    promoKartuHtml() +
    '<div class="db-grid21">' + kartuTab + widget + '</div>' +
    '<div class="db-lipat">' + lipat + insight + '</div>';
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
  // Hanya untuk Owner: halaman Laporan Laba-Rugi bukan hak role lain, jadi
  // kartu tidak dibuat seolah bisa diklik oleh mereka.
  var hero = document.getElementById('dbHero');
  var isOwner = !!(SESSION && SESSION.user && SESSION.user.role === 'Owner');
  if (hero && isOwner) {
    hero.style.cursor = 'pointer';
    hero.title = 'Buka halaman Laporan dengan filter yang sama';
    hero.onkeydown = function (e) { if (e.key === 'Enter') hero.onclick(e); };
    hero.onclick = function () {
      if (typeof VIEWS !== 'undefined' && VIEWS.laporan && typeof gantiHalaman === 'function') {
        // Simpan filter ke session agar halaman Laporan bisa langsung memakainya.
        try { sessionStorage.setItem('db_filter', JSON.stringify(bacaFilter('db'))); } catch (e) {}
        gantiHalaman('laporan');
      }
    };
  }
  if (hero && !isOwner) hero.style.cursor = 'default';

  if (strip) strip.onkeydown = function (e) { if (e.key === 'Enter') strip.onclick(); };

  // Tombol cetak ringkasan Owner (ikon di header dashboard).
  var btnCetak = document.getElementById('dbCetak');
  if (btnCetak) { btnCetak.disabled = false; btnCetak.onclick = function () { cetakRingkasanOwner(d); }; }

  // Lencana penanggung jawab di header.
  var lencana = document.getElementById('dbPJ');
  var pj = d.pj_shift || {};
  if (lencana) {
    var nama = pj.role === 'Kasir' ? pj.petugas : pj.petugas_jaga;
    lencana.innerHTML = '<span class="dot' + (pj.di_luar_jam ? ' mati' : '') + '"></span>' +
      (nama ? 'Jaga: <b>' + esc(nama) + '</b>' : 'Belum ada yang jaga') +
      ' · ' + (pj.di_luar_jam ? 'di luar jam' : esc(pj.shift || '-'));
    lencana.hidden = false;
  }

  // Tab tabel: penjualan / produk / pelanggan / pengeluaran.
  var tabDb = document.getElementById('dbTabs');
  if (tabDb) {
    tabDb.onclick = function (e) {
      var b = e.target.closest('[data-tabdb]');
      if (!b) return;
      tabDb.querySelectorAll('[data-tabdb]').forEach(function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
      tabDb.parentNode.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== b.dataset.tabdb; });
    };
  }

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
  // Baris Laba kotor hanya ikut tercetak untuk Owner; role lain tidak boleh
  // membawa angka laba ke kertas.
  var isOwner = !!(SESSION && SESSION.user && SESSION.user.role === 'Owner');
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
      (isOwner ? '<tr><td>Laba kotor</td><td class="r num">' + rupiah(k.laba_kotor) + '</td></tr>' : '') +
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