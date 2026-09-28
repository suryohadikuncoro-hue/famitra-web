// public/js_marketing_target.js
// UI: Target Omset & Laba Bersih Marketing
//
// Akses:
//   - Owner       : boleh CRUD target omset + baca dashboard progress (cabang sendiri)
//   - Apoteker    : baca dashboard progress (cabang sendiri, target tidak bisa dibuat)
//   - Kasir       : baca dashboard progress (cabang sendiri, target tidak bisa dibuat)
//
// Backend: Edge Function `marketing` di
//   https://xixhazawndmgqzstfjnq.supabase.co/functions/v1/marketing
//
// Aturan visibilitas (sesuai permintaan Owner):
//   - Dashboard "Progress Cabang" (semua role, hanya cabang sesi): sebelum target tercapai, laba
//     TIDAK ditampilkan ke user manapun — hanya progress omset + badge
//     "🔒 Laba disembunyikan". Setelah tercapai, seluruh angka tampil.
//   - Halaman "Kelola Target Omset" (Owner only): laba bersih SELALU tampil,
//     terlepas dari status tercapai, karena Owner-lah yang menetapkan target.
//
// Pola: vanilla JS, mengikuti gaya js_marketing_lottery.js / js_dashboard.js

(function () {
  var SUPABASE_MARKETING_URL =
    "https://xixhazawndmgqzstfjnq.supabase.co/functions/v1/marketing";

  function marketingApi(action, data) {
    var token = (window.SESSION && window.SESSION.token) || null;
    return fetch(SUPABASE_MARKETING_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: [action, data || {}, token] }),
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || !j || j.ok === false) {
          var msg = (j && j.error) || ("HTTP " + r.status);
          var err = new Error(msg);
          err.payload = j;
          throw err;
        }
        return j.data;
      });
    });
  }

  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function rupiah(n) {
    var v = Number(n) || 0;
    return "Rp " + v.toLocaleString("id-ID");
  }

  function rupiahInput(n) {
    var v = Number(n) || 0;
    return v.toLocaleString("id-ID");
  }

  function parseRupiahInput(s) {
    if (!s) return 0;
    return Number(String(s).replace(/[^\d.-]/g, "")) || 0;
  }

  function tglIndo(s) {
    if (!s) return "—";
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (!m) return esc(s);
    var bulan = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
                 "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    return parseInt(m[3], 10) + " " + bulan[parseInt(m[2], 10)] + " " + m[1];
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function monthStartISO() {
    var d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-01";
  }

  function monthEndISO() {
    var d = new Date();
    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(last).padStart(2, "0");
  }

  // Daftar cabang hardcoded fallback jika SESSION.cabangs tidak tersedia
  var DEFAULT_CABANGS = [
    { kode_cabang: "KARLA", nama_cabang: "Apotek Fa-Mitra Karla" },
    { kode_cabang: "PUCUK", nama_cabang: "Apotek Fa-Mitra Pucuk" },
    { kode_cabang: "KENDAL", nama_cabang: "Apotek Fa-Mitra Kendal" },
    { kode_cabang: "PULE", nama_cabang: "Apotek Fa-Mitra Pule" }
  ];

  // Isolasi cabang: fitur target omset hanya untuk cabang sesi (semua role,
  // termasuk Owner). Backend juga menolak cabang lain.
  function cabangList() {
    var SESS = window.SESSION || {};
    var kode = String((SESS.user && SESS.user.cabang_id) || "").trim();
    var semua = (Array.isArray(SESS.cabangs) && SESS.cabangs.length) ? SESS.cabangs : DEFAULT_CABANGS;
    if (!kode) return [];
    var cocok = semua.filter(function (c) { return c.kode_cabang === kode; });
    return cocok.length ? cocok : [{ kode_cabang: kode, nama_cabang: kode }];
  }

  // ---------------- State ----------------
  var state = {
    tab: "progress", // progress | target | form
    editId: null,
    formCabang: "",
    targets: [],
    progress: [],
    saving: false,
  };

  // ---------------- Tabs ----------------
  function tabsHtml() {
    var SESS = window.SESSION || {};
    var isOwner = SESS.user && SESS.user.role === "Owner";
    var tabs = [
      { id: "progress", label: "Progress Cabang" },
      { id: "target", label: "Kelola Target Omset", onlyOwner: true },
    ];
    var html = '<div class="tabs" style="display:flex;gap:8px;margin:12px 0;flex-wrap:wrap;">';
    tabs.forEach(function (t) {
      if (t.onlyOwner && !isOwner) return;
      var active = state.tab === t.id;
      html += '<button class="tab-btn" data-tab="' + t.id +
        '" style="padding:8px 14px;border:1px solid #cbd5e1;border-radius:8px;background:' +
        (active ? "#1e293b" : "#fff") + ";color:" + (active ? "#fff" : "#1e293b") +
        ';cursor:pointer;">' + esc(t.label) + '</button>';
    });
    html += '</div>';
    return html;
  }

  function bindTabs(el) {
    el.querySelectorAll("#mt-tabs .tab-btn").forEach(function (b) {
      b.onclick = function () {
        state.tab = b.getAttribute("data-tab");
        state.editId = null;
        render(el);
      };
    });
  }

  // ---------------- Tab: Progress per Cabang (semua role) ----------------
  function renderProgressTab() {
    return '<div id="mt-progress-body">Memuat data…</div>' +
      '<div style="margin-top:14px;padding:12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:13px;color:#92400e;">' +
        '<strong>Catatan:</strong> Sebelum target tercapai, perhitungan laba (HPP, biaya operasional, laba bersih) ' +
        'disembunyikan untuk semua user. Setelah target tercapai, seluruh angka tampil otomatis.' +
      '</div>';
  }

  function loadProgress(bodyEl) {
    bodyEl.innerHTML = '<div class="card">' +
      '<div class="sk sk-title"></div>' +
      '<div class="sk sk-row" style="width:80%"></div>' +
      '<div class="sk sk-row" style="width:60%"></div>' +
      '</div>';
    marketingApi("dashboardProgressPerCabang", {}).then(function (rows) {
      state.progress = rows || [];
      bodyEl.innerHTML = renderProgressCards(state.progress);
    }).catch(function (e) {
      bodyEl.innerHTML = '<div class="card"><div class="empty" style="color:#dc2626;">Gagal memuat progress: ' +
        esc(e.message) + '</div></div>';
    });
  }

  function renderProgressCards(rows) {
    if (!rows.length) {
      return '<div class="card"><div class="empty">Belum ada cabang terdaftar.</div></div>';
    }
    return rows.map(function (r) {
      return '<div class="card" style="margin-bottom:14px;">' +
        cardProgressInner(r) +
      '</div>';
    }).join('');
  }

  function cardProgressInner(r) {
    var t = r.target;
    var s = r.ringkasan;
    var namaCab = r.nama_cabang || r.kode_cabang || "—";
    if (!t || !s) {
      return '<div class="card-head">' +
          '<h3>' + esc(namaCab) + ' <span class="sub" style="font-weight:400;">(' + esc(r.kode_cabang) + ')</span></h3>' +
          '<span class="chip" style="background:#f1f5f9;color:#64748b;">Belum ada target aktif</span>' +
        '</div>' +
        '<div class="sub" style="margin-top:8px;">' +
          'Owner belum menetapkan target omset untuk cabang ini. ' +
          'Setelah target dibuat, progres akan muncul di sini.' +
        '</div>';
    }
    var target = Number(s.target_omset_idr) || 0;
    var omset = Number(s.omset_idr) || 0;
    var pct = Math.max(0, Math.min(100, Number(s.progress_persen) || 0));
    var tercapai = !!s.tercapai;
    var statusBadge = tercapai
      ? '<span class="chip" style="background:#d1fae5;color:#065f46;">&#10003; Tercapai</span>'
      : '<span class="chip" style="background:#fef3c7;color:#92400e;">Belum tercapai</span>';

    var financialHtml = '';
    if (tercapai) {
      // Laba visible — tampilkan HPP/biaya_op/laba jika tersedia
      if (s.laba_bersih_idr !== null && s.laba_bersih_idr !== undefined) {
        financialHtml =
          '<div class="grid g3" style="margin-top:12px;">' +
            '<div><div class="sub">HPP</div><strong>' + rupiah(s.total_hpp_idr) + '</strong></div>' +
            '<div><div class="sub">Biaya Operasional</div><strong>' + rupiah(s.biaya_operasional_idr) + '</strong></div>' +
            '<div><div class="sub">Laba Bersih</div>' +
              '<strong style="color:' + (Number(s.laba_bersih_idr) >= 0 ? '#16a34a' : '#dc2626') + ';">' +
                rupiah(s.laba_bersih_idr) +
              '</strong></div>' +
          '</div>';
      } else {
        financialHtml =
          '<div style="margin-top:12px;padding:10px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-size:13px;">' +
            '<strong>HPP tidak tersedia/lengkap</strong>; laba tidak dapat dihitung. ' +
            'Pastikan transaksi memiliki nilai total_hpp yang valid.' +
          '</div>';
      }
    } else {
      // Laba disembunyikan sesuai permintaan Owner
      financialHtml =
        '<div style="margin-top:12px;padding:14px;background:#f1f5f9;border:1px dashed #94a3b8;border-radius:8px;text-align:center;">' +
          '<div style="font-size:24px;line-height:1;">&#128274;</div>' +
          '<div style="margin-top:6px;font-weight:600;color:#475569;">Laba disembunyikan &mdash; target belum tercapai</div>' +
          '<div class="sub" style="margin-top:2px;">Angka HPP, biaya operasional, dan laba bersih akan muncul setelah target tercapai.</div>' +
        '</div>';
    }

    return '<div class="card-head">' +
        '<h3>' + esc(namaCab) + ' <span class="sub" style="font-weight:400;">(' + esc(r.kode_cabang) + ')</span></h3>' +
        statusBadge +
      '</div>' +
      '<div class="sub" style="margin-top:4px;">' + esc(t.nama) +
        ' &middot; ' + tglIndo(t.periode_mulai) + ' s.d. ' + tglIndo(t.periode_selesai) +
      '</div>' +
      '<div class="grid g2" style="margin-top:10px;">' +
        '<div><div class="sub">Target omset</div><strong>' + rupiah(target) + '</strong></div>' +
        '<div><div class="sub">Omset aktual</div><strong>' + rupiah(omset) + ' (' + pct.toFixed(1) + '%)</strong></div>' +
      '</div>' +
      '<div style="margin-top:10px;background:#e2e8f0;height:10px;border-radius:5px;overflow:hidden;">' +
        '<div style="background:' + (tercapai ? '#16a34a' : '#0ea5e9') + ';width:' + pct.toFixed(1) + '%;height:100%;transition:width .3s ease;"></div>' +
      '</div>' +
      '<div class="sub" style="margin-top:6px;">' +
        formatAngka(s.transaksi_count) + ' transaksi &middot; ' +
        formatAngka(s.biaya_operasional_count) + ' catatan biaya operasional' +
      '</div>' +
      financialHtml;
  }

  function formatAngka(n) {
    var v = Number(n) || 0;
    return v.toLocaleString("id-ID");
  }

  // ---------------- Tab: Target Omset (Owner only) ----------------
  function renderTargetTab(el) {
    return '<div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
      cabangList().map(function (c) {
        return '<span class="chip" style="background:#e0f2fe;color:#075985;">Cabang: ' + esc(c.nama_cabang) + '</span>';
      }).join("") +
      '<label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="mt-only-aktif"/> Hanya aktif</label>' +
      '<button id="mt-reload" style="padding:6px 12px;background:#0ea5e9;color:#fff;border:0;border-radius:8px;cursor:pointer;">Muat Ulang</button>' +
      '<span style="flex:1"></span>' +
      '<button id="mt-new" style="padding:6px 14px;background:#16a34a;color:#fff;border:0;border-radius:8px;cursor:pointer;">+ Target Baru</button>' +
    '</div>' +
    '<div id="mt-target-body">Memuat…</div>';
  }

  function loadTargetList(bodyEl) {
    var targetBody = bodyEl.querySelector("#mt-target-body");
    if (!targetBody) return;

    targetBody.innerHTML = '<div class="card">' +
      '<div class="sk sk-title"></div>' +
      '<div class="sk sk-row" style="width:80%"></div>' +
      '<div class="sk sk-row" style="width:60%"></div>' +
      '</div>';

    var cabang = (bodyEl.querySelector("#mt-cabang") && bodyEl.querySelector("#mt-cabang").value) || "";
    var onlyAktif = !!(bodyEl.querySelector("#mt-only-aktif") && bodyEl.querySelector("#mt-only-aktif").checked);

    marketingApi("targetOmsetList", { kode_cabang: cabang || null, only_aktif: onlyAktif })
      .then(function (rows) {
        state.targets = rows || [];
        targetBody.innerHTML = renderTargetTable(state.targets);
      })
      .catch(function (e) {
        targetBody.innerHTML = '<div class="card"><div class="empty" style="color:#dc2626;">Gagal memuat target: ' +
          esc(e.message) + '</div></div>';
      });
  }

  function renderTargetTable(rows) {
    if (!rows.length) {
      return '<div class="card"><div class="empty">Belum ada target omset. Klik <strong>+ Target Baru</strong> untuk membuat.</div></div>';
    }
    var trs = rows.map(function (t) {
      var status = t.aktif
        ? '<span class="chip" style="background:#d1fae5;color:#065f46;">Aktif</span>'
        : '<span class="chip" style="background:#f1f5f9;color:#64748b;">Non-aktif</span>';

      var labaCell;
      if (t.laba_bersih_idr !== null && t.laba_bersih_idr !== undefined) {
        labaCell = '<strong style="color:' + (Number(t.laba_bersih_idr) >= 0 ? '#16a34a' : '#dc2626') + ';">' +
          rupiah(t.laba_bersih_idr) + '</strong>';
      } else if (t.hpp_available === false) {
        labaCell = '<span class="sub" style="color:#991b1b;">HPP tidak lengkap</span>';
      } else {
        labaCell = '<span class="sub">—</span>';
      }

      return '<tr>' +
        '<td><strong>' + esc(t.nama_target) + '</strong></td>' +
        '<td>' + esc(t.kode_cabang) + '</td>' +
        '<td>' + tglIndo(t.periode_mulai) + '<br/><span class="sub">s.d. ' + tglIndo(t.periode_selesai) + '</span></td>' +
        '<td class="r"><strong>' + rupiah(t.target_omset_idr) + '</strong></td>' +
        '<td class="r">' + rupiah(t.omset_idr) + '</td>' +
        '<td class="r">' + labaCell + '</td>' +
        '<td class="c">' + status + '</td>' +
        '<td class="c" style="white-space:nowrap;">' +
          '<button class="btn btn-sm" data-mt-edit="' + esc(t.id) + '">Ubah</button> ' +
          '<button class="btn btn-sm" data-mt-toggle="' + esc(t.id) + '" data-mt-aktif="' + (t.aktif ? '1' : '0') + '">' +
            (t.aktif ? 'Nonaktifkan' : 'Aktifkan') + '</button> ' +
          '<button class="btn btn-sm" data-mt-delete="' + esc(t.id) + '" style="background:#fee2e2;color:#991b1b;">Hapus</button>' +
        '</td>' +
      '</tr>';
    }).join("");

    return '<div class="card"><div class="table-wrap"><table>' +
      '<thead><tr><th>Nama Target</th><th>Cabang</th><th>Periode</th><th class="r">Target</th><th class="r">Omset</th><th class="r">Laba Bersih</th><th class="c">Status</th><th class="c">Aksi</th></tr></thead>' +
      '<tbody>' + trs + '</tbody>' +
      '</table></div></div>';
  }

  // ---------------- Tab: Form Target (Owner only) ----------------
  function renderFormTab() {
    var editing = state.editId
      ? state.targets.filter(function (t) { return t.id === state.editId; })[0]
      : null;
    var cabangOpts = cabangList().map(function (c) {
      return '<option value="' + esc(c.kode_cabang) + '" selected>' + esc(c.nama_cabang) + '</option>';
    }).join("");

    var v = editing || {};
    var defMulai = v.periode_mulai || monthStartISO();
    var defSelesai = v.periode_selesai || monthEndISO();
    var defTarget = v.target_omset_idr ? rupiahInput(v.target_omset_idr) : "";

    return '<div class="card" style="max-width:640px;">' +
      '<div class="card-head"><h3>' + (editing ? 'Ubah Target Omset' : 'Target Omset Baru') + '</h3></div>' +
      '<form id="mt-form" style="display:grid;gap:12px;">' +
        '<label class="field"><span>Cabang</span>' +
          '<select id="mt-f-cabang" class="inp" required disabled>' +
            cabangOpts +
          '</select>' +
        '</label>' +
        '<label class="field"><span>Nama target</span>' +
          '<input id="mt-f-nama" class="inp" type="text" required placeholder="cth: Target Bulanan Oktober" value="' + esc(v.nama_target || "") + '">' +
        '</label>' +
        '<div class="grid g2">' +
          '<label class="field"><span>Periode mulai</span>' +
            '<input id="mt-f-mulai" class="inp" type="date" required value="' + esc(defMulai) + '">' +
          '</label>' +
          '<label class="field"><span>Periode selesai</span>' +
            '<input id="mt-f-selesai" class="inp" type="date" required value="' + esc(defSelesai) + '">' +
          '</label>' +
        '</div>' +
        '<label class="field"><span>Target omset (Rp)</span>' +
          '<input id="mt-f-target" class="inp" type="text" required inputmode="numeric" placeholder="cth: 50.000.000" value="' + esc(defTarget) + '">' +
        '</label>' +
        '<label class="field"><span>Catatan (opsional)</span>' +
          '<textarea id="mt-f-catatan" class="inp" rows="3" placeholder="Catatan internal">' + esc(v.catatan || "") + '</textarea>' +
        '</label>' +
        '<label style="display:flex;align-items:center;gap:6px;">' +
          '<input type="checkbox" id="mt-f-aktif" ' + (v.aktif === false ? '' : 'checked') + '> Target aktif' +
        '</label>' +
        '<div style="display:flex;gap:8px;margin-top:4px;">' +
          '<button type="submit" class="btn btn-primary" id="mt-f-save" ' + (state.saving ? 'disabled' : '') + '>' +
            (state.saving ? 'Menyimpan…' : (editing ? 'Simpan Perubahan' : 'Buat Target')) +
          '</button>' +
          '<button type="button" class="btn" id="mt-f-cancel">Batal</button>' +
        '</div>' +
      '</form>' +
      (editing ? '<div class="sub" style="margin-top:8px;">Catatan: Hanya boleh 1 target aktif per cabang. Jika Anda mengaktifkan target ini, target aktif lain di cabang yang sama akan otomatis dinonaktifkan.</div>' : '') +
    '</div>';
  }

  function bindForm(el) {
    var form = el.querySelector("#mt-form");
    if (!form) return;
    form.onsubmit = function (ev) {
      ev.preventDefault();
      if (state.saving) return;
      var editing = state.editId
        ? state.targets.filter(function (t) { return t.id === state.editId; })[0]
        : null;
      var kode_cabang = el.querySelector("#mt-f-cabang").value.trim();
      var nama = el.querySelector("#mt-f-nama").value.trim();
      var mulai = el.querySelector("#mt-f-mulai").value;
      var selesai = el.querySelector("#mt-f-selesai").value;
      var target = parseRupiahInput(el.querySelector("#mt-f-target").value);
      var aktif = el.querySelector("#mt-f-aktif").checked;
      var catatan = el.querySelector("#mt-f-catatan").value.trim();

      if (!kode_cabang) { toast("Pilih cabang terlebih dahulu.", true); return; }
      if (!nama) { toast("Nama target wajib diisi.", true); return; }
      if (!mulai || !selesai) { toast("Periode mulai & selesai wajib diisi.", true); return; }
      if (selesai < mulai) { toast("Periode selesai tidak boleh sebelum periode mulai.", true); return; }
      if (!(target > 0)) { toast("Target omset harus lebih dari 0.", true); return; }

      var payload = {
        id: editing ? editing.id : null,
        kode_cabang: kode_cabang,
        nama: nama,
        periode_mulai: mulai,
        periode_selesai: selesai,
        target_omset_idr: target,
        aktif: aktif,
        catatan: catatan || null,
      };

      state.saving = true;
      render(el);
      marketingApi("targetOmsetSave", payload).then(function () {
        state.saving = false;
        state.editId = null;
        state.tab = "target";
        render(el);
        toast("Target omset tersimpan.");
      }).catch(function (e) {
        state.saving = false;
        render(el);
        toast("Gagal menyimpan: " + e.message, true);
      });
    };

    var cancelBtn = el.querySelector("#mt-f-cancel");
    if (cancelBtn) {
      cancelBtn.onclick = function () {
        state.editId = null;
        state.tab = "target";
        render(el);
      };
    }
  }

  // ---------------- Main render ----------------
  function render(el) {
    var tabsEl = el.querySelector("#mt-tabs");
    var bodyEl = el.querySelector("#mt-body");
    if (!tabsEl || !bodyEl) return;

    tabsEl.innerHTML = tabsHtml();
    bindTabs(el);

    if (state.tab === "progress") {
      bodyEl.innerHTML = renderProgressTab();
      loadProgress(bodyEl.querySelector("#mt-progress-body"));
      return;
    }

    if (state.tab === "form") {
      bodyEl.innerHTML = renderFormTab();
      bindForm(el);
      return;
    }

    // tab: target
    bodyEl.innerHTML = renderTargetTab(el);
    loadTargetList(bodyEl);

    var reloadBtn = bodyEl.querySelector("#mt-reload");
    if (reloadBtn) reloadBtn.onclick = function () { loadTargetList(bodyEl); };
    var newBtn = bodyEl.querySelector("#mt-new");
    if (newBtn) newBtn.onclick = function () {
      state.editId = null;
      state.tab = "form";
      render(el);
    };
    var cabangSel = bodyEl.querySelector("#mt-cabang");
    if (cabangSel) cabangSel.onchange = function () { loadTargetList(bodyEl); };
    var onlyAktifCb = bodyEl.querySelector("#mt-only-aktif");
    if (onlyAktifCb) onlyAktifCb.onchange = function () { loadTargetList(bodyEl); };

    bodyEl.onclick = function (e) {
      var editBtn = e.target.closest("[data-mt-edit]");
      if (editBtn) {
        state.editId = editBtn.getAttribute("data-mt-edit");
        state.tab = "form";
        render(el);
        return;
      }
      var toggleBtn = e.target.closest("[data-mt-toggle]");
      if (toggleBtn) {
        var id = toggleBtn.getAttribute("data-mt-toggle");
        var cur = toggleBtn.getAttribute("data-mt-aktif") === "1";
        var labelAksi = cur ? "Nonaktifkan" : "Aktifkan";
        if (!confirm(labelAksi + " target ini?")) return;
        marketingApi("targetOmsetStatus", { id: id, aktif: !cur }).then(function () {
          loadTargetList(bodyEl);
          toast("Status target diperbarui.");
        }).catch(function (err) {
          toast("Gagal: " + err.message, true);
        });
        return;
      }
      var delBtn = e.target.closest("[data-mt-delete]");
      if (delBtn) {
        var did = delBtn.getAttribute("data-mt-delete");
        if (!confirm("Hapus target omset ini? Tindakan tidak dapat dibatalkan.")) return;
        marketingApi("targetOmsetDelete", { id: did }).then(function () {
          loadTargetList(bodyEl);
          toast("Target dihapus.");
        }).catch(function (err) {
          toast("Gagal: " + err.message, true);
        });
        return;
      }
    };
  }

  VIEWS.targetOmset = {
    title: "Target Omset & Laba",
    render: function (el) {
      el.innerHTML =
        '<div class="crm-shell">' +
          '<div class="crm-head"><div>' +
            '<div class="eyebrow">MARKETING &middot; TARGET OMSET</div>' +
            '<h2>Target Omset &amp; Laba Bersih</h2>' +
            '<p class="sub">Owner menetapkan target omset untuk cabangnya sendiri per periode. Sebelum target tercapai, ' +
              'laba disembunyikan. Setelah tercapai, seluruh angka tampil.</p>' +
          '</div></div>' +
          '<div id="mt-tabs"></div>' +
          '<div id="mt-body">' + kerangka(3) + '</div>' +
        '</div>';
      render(el);
    }
  };

  // ---------------- Hook menu: tambahkan "Target Omset" untuk Owner ----------------
  // Menu utama di-populate server-side oleh menuSaya, jadi kita tambahkan item
  // ini via patch bangunNav (dipakai lagi tiap sesi dipulihkan / login ulang).
  function patchBangunNav() {
    var origBangunNav = window.bangunNav;
    if (typeof origBangunNav !== "function") {
      setTimeout(patchBangunNav, 250);
      return;
    }
    if (origBangunNav.__mtPatched) return;
    window.bangunNav = function () {
      origBangunNav.apply(this, arguments);
      try {
        var SESS = window.SESSION;
        var isOwner = SESS && SESS.user && SESS.user.role === "Owner";
        if (!isOwner || !Array.isArray(window.MENU)) return;

        var already = window.MENU.some(function (m) { return m.id === "targetOmset"; });
        if (!already) {
          var idx = -1;
          for (var i = 0; i < window.MENU.length; i++) {
            if (window.MENU[i].id === "marketing") { idx = i; break; }
          }
          window.MENU.splice(idx < 0 ? window.MENU.length : idx + 1, 0,
            { id: "targetOmset", label: "Target Omset" });
        }

        // Sisipkan tombol di sidebar (setelah Marketing) dan tabbar (jika muat).
        var nav = document.getElementById("navMenu");
        if (nav && !nav.querySelector('button[data-id="targetOmset"]')) {
          var marketingBtn = null;
          nav.querySelectorAll("button").forEach(function (b) {
            if (b.dataset.id === "marketing") marketingBtn = b;
          });
          var btn = document.createElement("button");
          btn.textContent = "Target Omset";
          btn.dataset.id = "targetOmset";
          btn.onclick = function () { gantiHalaman("targetOmset"); };
          if (marketingBtn && marketingBtn.parentNode) {
            marketingBtn.parentNode.insertBefore(btn, marketingBtn.nextSibling);
          } else {
            nav.appendChild(btn);
          }
        }

        var tab = document.getElementById("tabbar");
        if (tab && !tab.querySelector('button[data-id="targetOmset"]') && tab.children.length < 5) {
          var tbtn = document.createElement("button");
          tbtn.textContent = "Target";
          tbtn.dataset.id = "targetOmset";
          tbtn.onclick = function () { gantiHalaman("targetOmset"); };
          tab.appendChild(tbtn);
        }
      } catch (e) {
        // diam: jangan gagalkan UI utama jika hook menu bermasalah
        try { console.warn("MarketingTarget hook menu:", e); } catch (_) {}
      }
    };
    window.bangunNav.__mtPatched = true;

    // Kalau menu sudah ada (mount awal diproses sebelum file ini load), rebuild sekali.
    if (Array.isArray(window.MENU) && window.MENU.length) {
      window.bangunNav();
    }
  }

  // Tunggu sampai js_core.js selesai mendefinisikan bangunNav (loaded sebelum file ini).
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", patchBangunNav);
  } else {
    patchBangunNav();
  }

  // Expose untuk debugging & integrasi eksternal
  window.MarketingTarget = {
    reloadProgress: function () {
      if (VIEWS && VIEWS.targetOmset) {
        var body = document.querySelector("#mt-progress-body");
        if (body) loadProgress(body);
      }
    }
  };
})();