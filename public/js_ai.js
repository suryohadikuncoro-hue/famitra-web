/* =========================================== Asisten AI (khusus Owner) =====
   Tiga bagian: banner ringkasan di puncak dashboard, widget melayang dengan
   status mini/panel/penuh, dan sapaan proaktif yang muncul tanpa diminta.

   Semua data dimuat ulang setiap kali dashboard dibuka — tanpa cache — supaya
   ringkasannya selalu mencerminkan keadaan saat itu.

   Batasan UI (agar widget tidak memenuhi dashboard):
   - Hanya 3 saran teratas yang ditampilkan langsung di footer. Sisanya
     disembunyikan di balik tombol "Saran lainnya".
   - Sapaan proaktif ringkas (maks 1 sekaligus, dengan cooldown 30 detik),
     supaya tidak menumpuk bubble yang menghalangi input.
   ========================================================================= */

var AI_CABANG_VALID = ['KARLA', 'PUCUK', 'KENDAL', 'PULE'];
function cabangAIAktif() {
  var cabang = SESSION && SESSION.user && SESSION.user.cabang_id;
  return AI_CABANG_VALID.indexOf(cabang) !== -1 ? cabang : '';
}

var AI = {
  status: 'mini',        // mini | panel | full
  riwayat: [],           // { peran: 'me'|'ai', teks }
  saran: [],
  proaktifTampil: false,
  proaktifCooldown: 0,   // timestamp terakhir proaktif
  sedangTanya: false,
  ringkasanCache: null,
  ringkasanMemuat: false
};

function siapkanAsisten() {
  var dock = document.getElementById('aidock');
  dock.hidden = false;
  aiSetStatus('mini');

  document.getElementById('aidockFab').onclick = function () { aiSetStatus('panel'); };
  document.getElementById('aidockMin').onclick = function () { aiSetStatus('mini'); };
  document.getElementById('aidockSize').onclick = function () {
    aiSetStatus(AI.status === 'full' ? 'panel' : 'full');
  };
  document.getElementById('aidockKirim').onclick = aiKirim;
  document.getElementById('aidockInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') aiKirim();
  });

  if (!AI.riwayat.length) {
    aiTulis('ai', 'Halo Bu Isnah, ada yang bisa saya bantu?');
  }
}

function aiSetStatus(s) {
  AI.status = s;
  var dock = document.getElementById('aidock');
  dock.className = 'aidock ' + s;
  document.getElementById('aidockFab').hidden = (s !== 'mini');
  document.getElementById('aidockBox').hidden = (s === 'mini');
  if (s !== 'mini') {
    document.getElementById('aidockBadge').hidden = true;
    var b = document.getElementById('aidockBody');
    b.scrollTop = b.scrollHeight;
  }
}

/* --------------------------------------------------- Banner ringkasan ---- */

/**
 * Ringkasan AI hanya dimuat setelah Owner menekan Mulai/Refresh.
 * Hasil terakhir disimpan di state sesi agar tetap tampil saat berpindah modul.
 */
function sapaanRingkasanAI() {
  var jam = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', hour12: false
  }).format(new Date()));
  var waktu = jam >= 5 && jam < 11 ? 'pagi' : jam >= 11 && jam < 15 ? 'siang' : jam >= 15 && jam < 19 ? 'sore' : 'malam';
  var cabang = cabangAIAktif() || (SESSION && SESSION.user && SESSION.user.cabang_id) || 'cabang aktif';
  return 'Selamat ' + waktu + ', Bu Isn​​ah. Berikut adalah ringkasan Apotek ' + cabang + ' hari ini.';
}

function gambarRingkasanAI(el, d) {
  var sorot = (d.sorotan || []).map(function (x) {
    return '<div><div class="sorot-label">' + esc(x.label) + '</div>' +
      '<div class="sorot-nilai">' + esc(x.nilai) + '</div>' +
      '<div class="sorot-catatan">' + esc(x.catatan) + '</div></div>';
  }).join('');
  el.innerHTML =
    '<div class="aibanner-top">' +
      '<span class="aibanner-tag">Ringkasan hari ini</span>' +
      '<button type="button" class="btn btn-sm" data-ai-summary="start">Refresh</button>' +
    '</div>' +
    '<p><strong>' + esc(sapaanRingkasanAI()) + '</strong></p>' +
    '<p>' + esc(d.ringkasan || '') + '</p>' +
    '<div class="aibanner-sorot">' + sorot + '</div>';
}

function muatBannerAI() {
  var el = document.getElementById('aiBanner');
  if (!el || AI.ringkasanMemuat) return;
  var cfg = window.AI_CFG || {};
  if (!cfg.summaryUrl || /REPLACE_ME/.test(cfg.summaryUrl)) {
    el.innerHTML =
      '<div class="aibanner-top"><span class="aibanner-tag">Ringkasan hari ini</span></div>' +
      '<p>Asisten AI belum dikonfigurasi. Isi <code>window.AI_CFG</code> di <code>Index.html</code> dengan URL webhook n8n.</p>';
    return;
  }
  var cabang = cabangAIAktif();
  if (!cabang) {
    el.innerHTML = '<div class="aibanner-top"><span class="aibanner-tag">Ringkasan hari ini</span></div>' +
      '<p>Cabang sesi tidak valid. Ringkasan AI tidak dimuat.</p>';
    return;
  }
  AI.ringkasanMemuat = true;
  el.innerHTML = '<div class="aibanner-top"><span class="aibanner-tag">Ringkasan hari ini</span></div>' +
    '<p class="memuat">Memuat ringkasan AI…</p>';
  fetch(cfg.summaryUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'token': cfg.token || ''
    },
    body: JSON.stringify({
      cabang: cabang,
      role: (SESSION && SESSION.user && SESSION.user.role) || '',
      filter: bacaFilter && bacaFilter('db') ? bacaFilter('db') : { mode: 'hari_ini' }
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
      throw new Error((res.body && res.body.error) || 'Gagal memuat ringkasan.');
    }
    var d = res.body.data || {};
    AI.ringkasanCache = d;
    gambarRingkasanAI(el, d);
    AI.saran = d.saran || [];
    gambarSaran();
    AI.proaktifTampil = false;
  }).catch(function (e) {
    el.innerHTML =
      '<div class="aibanner-top"><span class="aibanner-tag">Ringkasan hari ini</span>' +
      '<button type="button" class="btn btn-sm" data-ai-summary="start">Coba lagi</button></div>' +
      '<p>Asisten AI tidak dapat dihubungi: ' + esc(e.message) + '</p>';
  }).then(function () {
    AI.ringkasanMemuat = false;
  });
}

document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-ai-summary="start"]');
  if (b) {
    e.preventDefault();
    muatBannerAI();
  }
});

function bannerKerangka() {
  var isi = AI.ringkasanCache ?
    '<p>' + esc(AI.ringkasanCache.ringkasan || '') + '</p>' +
    '<div class="aibanner-sorot">' + (AI.ringkasanCache.sorotan || []).map(function (x) {
      return '<div><div class="sorot-label">' + esc(x.label) + '</div>' +
        '<div class="sorot-nilai">' + esc(x.nilai) + '</div>' +
        '<div class="sorot-catatan">' + esc(x.catatan) + '</div></div>';
    }).join('') + '</div>' :
    '<p><strong>' + esc(sapaanRingkasanAI()) + '</strong></p>' +
    '<p class="sub">Mulai untuk membaca penjualan, stok, dan pelanggan dengan AI.</p>';
  var aksi = AI.ringkasanCache ? 'Refresh' : 'Mulai';
  return '<div class="aibanner" id="aiBanner">' +
    '<div class="aibanner-top"><span class="aibanner-tag">Ringkasan hari ini</span>' +
    '<button type="button" class="btn btn-sm" data-ai-summary="start">' + aksi + '</button></div>' + isi +
  '</div>';
}

/* ------------------------------------------------- Sapaan proaktif ------- */

/**
 * Dipanggil eksplisit saat Owner membuka panel chat. Tidak muncul otomatis
 * di dashboard — kalau dipaksa, gelembung menumpuk dan menutupi input.
 * Cooldown 30 detik antar proaktif agar tidak spam.
 */
function tampilkanProaktif(list) {
  if (!list || !list.length) return;
  var now = Date.now();
  if (now - AI.proaktifCooldown < 30000) return;
  AI.proaktifCooldown = now;
  AI.proaktifTampil = true;

  /* Tampilkan satu per satu (maks 2) dengan jeda supaya Owner sempat
     membaca. */
  list.slice(0, 2).forEach(function (p, i) {
    setTimeout(function () {
      aiTulis('ai', p.teks, { aksi: p.aksi, nomor_wa: p.nomor_wa, proaktif: true });
      if (AI.status === 'mini') {
        var badge = document.getElementById('aidockBadge');
        badge.textContent = String(Number(badge.textContent || 0) + 1);
        badge.hidden = false;
      }
    }, 700 + i * 1200);
  });
}

/* ---------------------------------------------------------- Percakapan --- */

function aiTulis(peran, teks, opsi) {
  opsi = opsi || {};
  AI.riwayat.push({ peran: peran, teks: teks });

  var body = document.getElementById('aidockBody');
  if (!body) return;

  var kelas = 'bubble ' + (peran === 'me' ? 'me' : 'ai') + (opsi.proaktif ? ' proaktif' : '');
  var aksi = '';
  if (opsi.aksi) {
    aksi = '<button class="aksi-cepat" data-tanya="' + esc(opsi.aksi) + '"' +
      (opsi.nomor_wa ? ' data-wa="' + esc(opsi.nomor_wa) + '"' : '') + '>' +
      esc(opsi.aksi) + '</button>';
  }
  var tag = opsi.sumber === 'lokal' ? '<div class="sumber-tag">Dijawab dari data lokal</div>' : '';

  var div = document.createElement('div');
  div.className = kelas;
  div.innerHTML = esc(teks) + aksi + tag;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
  return div;
}

/**
 * Tampilkan 3 saran teratas sebagai chip ringkas di footer. Sisanya
 * disembunyikan di balik tombol "Saran lainnya" — klik untuk expand.
 * Mencegah widget penuh dengan chip yang menghabiskan ruang footer.
 */
function gambarSaran() {
  var el = document.getElementById('aidockSaran');
  if (!el) return;
  var list = AI.saran || [];
  var top = list.slice(0, 3);
  var rest = list.slice(3);
  var html = top.map(function (q) {
    return '<button data-tanya="' + esc(q) + '">' + esc(q) + '</button>';
  }).join('');
  if (rest.length) {
    html += '<button class="saran-toggle" data-toggle="more">+' + rest.length +
      ' lagi</button><div class="saran-more" hidden>' +
      rest.map(function (q) {
        return '<button data-tanya="' + esc(q) + '">' + esc(q) + '</button>';
      }).join('') + '</div>';
  }
  el.innerHTML = html;
}

/* Satu penangan klik untuk seluruh tombol saran dan aksi cepat. */
document.addEventListener('click', function (e) {
  var tog = e.target.closest('[data-toggle="more"]');
  if (tog) {
    var saranWrap = tog.parentElement;
    if (saranWrap) saranWrap.classList.toggle('is-open');
    return;
  }
  var b = e.target.closest('[data-tanya]');
  if (!b) return;
  if (b.dataset.wa) {
    var pesan = 'Halo, salam dari Apotek Fa-Mitra. Kami ingin memastikan kebutuhan obat Anda tetap tercukupi.';
    window.open('https://wa.me/' + b.dataset.wa + '?text=' + encodeURIComponent(pesan), '_blank');
    return;
  }
  if (AI.status === 'mini') aiSetStatus('panel');
  aiTanya(b.dataset.tanya);
});

function aiKirim() {
  var input = document.getElementById('aidockInput');
  var q = input.value.trim();
  if (!q) return;
  input.value = '';
  aiTanya(q);
}

function aiTanya(q) {
  if (AI.sedangTanya) { toast('Tunggu jawaban sebelumnya selesai.', true); return; }
  var cfg = window.AI_CFG || {};
  if (!cfg.chatUrl || /REPLACE_ME/.test(cfg.chatUrl)) {
    aiTulis('ai', 'Asisten AI belum dikonfigurasi. Isi window.AI_CFG di Index.html dengan URL webhook n8n.');
    return;
  }
  var cabang = cabangAIAktif();
  if (!cabang) {
    aiTulis('ai', 'Cabang sesi tidak valid. Asisten AI tidak dapat digunakan.');
    return;
  }
  AI.sedangTanya = true;

  aiTulis('me', q);
  var tunggu = aiTulis('ai', 'Sedang membaca data…');

  /* ai-chat workflow n8n di-set tanpa auth (CORS *). Tetap kirim token di
     body untuk kompatibilitas, JANGAN kirim Authorization header (kalau
     dikirim dengan nilai yang tidak cocok, preflight n8n bisa gagal). */
  fetch(cfg.chatUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'token': cfg.token || ''
    },
    body: JSON.stringify({
      cabang: cabang,
      role: (SESSION && SESSION.user && SESSION.user.role) || '',
      q: q,
      riwayat: AI.riwayat.slice(-8)
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
      throw new Error((res.body && res.body.error) || 'Gagal menghubungi asisten.');
    }
    var r = res.body.data || {};
    var follow = r.pertanyaan_lanjutan ? '<div class="ai-followup">' + esc(r.pertanyaan_lanjutan) + '</div>' : '';
    tunggu.innerHTML = esc(r.jawaban || '') + follow +
      (r.sumber === 'lokal' ? '<div class="sumber-tag">Dijawab dari data lokal</div>' : '');
    AI.saran = Array.isArray(r.saran) ? r.saran.slice(0, 2) : [];
    gambarSaran();
    AI.riwayat[AI.riwayat.length - 1] = { peran: 'ai', teks: (r.jawaban || '') + (r.pertanyaan_lanjutan ? '\n' + r.pertanyaan_lanjutan : '') };
    document.getElementById('aidockBody').scrollTop = 99999;
  }).catch(function (e) {
    tunggu.textContent = 'Gagal: ' + e.message;
  }).then(function () { AI.sedangTanya = false; });
}
