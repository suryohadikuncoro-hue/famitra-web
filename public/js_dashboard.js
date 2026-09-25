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
  }).catch(function (e) {
    isi.innerHTML = '<div class="card"><p>' + esc(e.message) + '</p></div>';
  });
}

function gambarDashboard(d) {
  var k = d.kpi;

  /* 1. Hero omzet — angka besar di kiri, tren tujuh hari di kanan. */
  var hari = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
  var tren7 = d.sparkline.map(function (x) {
    return {
      label: x.tanggal, nilai: x.omzet,
      pendek: hari[new Date(x.tanggal + 'T00:00:00').getDay()]
    };
  });
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
          satelit('Laba bersih', rupiah(k.laba_bersih), k.laba_bersih < 0) +
          satelit('Nota terjual', angka(k.nota), false, k.delta_nota) +
          satelit('Rata-rata nota', rupiah(k.rata_nota), false, k.delta_rata) +
        '</div>' +
      '</div>' +
      '<div class="hero-chart">' +
        '<div class="sat-label">Tujuh hari terakhir</div>' +
        svgBar(tren7) +
      '</div>' +
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

  /* 4. Strip segmen pelanggan dengan visual donut */
  var s = d.segmen_pelanggan;
  var totalPel = (s.VIP || 0) + (s['Active Routine'] || 0) + (s['At-Risk'] || 0) + (s.Baru || 0);
  var donutData = [
    { label: 'VIP', nilai: s.VIP || 0 },
    { label: 'Rutin', nilai: s['Active Routine'] || 0 },
    { label: 'Risiko', nilai: s['At-Risk'] || 0 },
    { label: 'Baru', nilai: s.Baru || 0 }
  ];
  
  var segStrip =
    '<div class="card" style="margin-bottom:14px; display:flex; align-items:center; gap:20px;">' +
      svgDonut(donutData, totalPel) +
      '<div class="segstrip" style="margin-bottom:0; flex:1">' +
        seg('vip', s.VIP || 0, 'VIP') +
        seg('rutin', s['Active Routine'] || 0, 'Rutin') +
        seg('risk', s['At-Risk'] || 0, 'Risiko') +
        seg('', s.Baru || 0, 'Baru') +
      '</div>' +
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

  return hero + strip + segStrip +
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
    hero.onclick = function () {
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
      '<tr><td>Laba bersih</td><td class="r num">' + rupiah(k.laba_bersih) + '</td></tr>' +
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
