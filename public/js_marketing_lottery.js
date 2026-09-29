// public/js_marketing_lottery.js
// UI: Marketing > Kupon Undian
// Akses: Owner + Apoteker (Kasir ditolak oleh backend lottery)
//
// Pola: vanilla JS, mengikuti gaya js_dashboard.js / js_master.js
// Memanggil Edge Function `lottery` lewat fetch POST { fn, args }.

(function () {
  var SUPABASE_LOTTERY_URL =
    "https://xixhazawndmgqzstfjnq.supabase.co/functions/v1/lottery";

  function lotteryApi(action, data) {
    var token = (typeof SESSION !== "undefined" && SESSION && SESSION.token) || null;
    return fetch(SUPABASE_LOTTERY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fn: action, args: [data || {}, token] }),
    }).catch(function (cause) {
      // Fetch rejection gives no HTTP status: network, browser blocking and CORS
      // are indistinguishable here. Do not claim the function is undeployed.
      var err = new Error("Tidak dapat terhubung ke layanan Kupon Undian. Periksa koneksi lalu coba lagi.");
      err.code = "LOTTERY_NETWORK";
      err.cause = cause;
      throw err;
    }).then(function (r) {
      return r.json().catch(function (cause) {
        var err = new Error("Respons layanan Kupon Undian tidak valid (HTTP " + r.status + ").");
        err.code = "LOTTERY_RESPONSE";
        err.status = r.status;
        err.cause = cause;
        throw err;
      }).then(function (j) {
        if (!r.ok || !j || j.ok === false) {
          if (j && j.code === "NO_SESSION" && typeof paksaLogin === "function") paksaLogin("Sesi berakhir. Silakan login ulang.");
          var msg = (j && (j.error || j.message)) || ("HTTP " + r.status);
          var err = new Error(msg);
          err.payload = j;
          err.status = r.status;
          throw err;
        }
        return j.data;
      });
    });
  }

  function listErrorHtml(e) {
    var connection = e.code === "LOTTERY_NETWORK";
    var deployment = connection || e.code === "LOTTERY_RESPONSE" || e.status === 404 || e.status >= 500;
    return '<div role="alert" style="color:#b91c1c;">' +
      '<strong>Daftar campaign belum berhasil dimuat.</strong><p>' + esc(e.message) + '</p>' +
      (deployment ? '<p>Jika tetap gagal, minta pengelola memeriksa deployment Edge Function <code>lottery</code>, migrasi database, dan CORS untuk alamat preview ini. Deploy frontend saja tidak menyiapkan backend. Penyebab pastinya perlu diperiksa; pesan ini bukan bukti backend belum ter-deploy.</p>' : '') +
      '<button type="button" id="lot-retry">Coba Lagi</button>' +
      '<details style="margin-top:8px;"><summary>Detail teknis</summary><div>' +
      esc(e.cause ? e.cause.message : e.message) +
      (e.status ? ' · HTTP ' + esc(e.status) : '') + '</div></details></div>';
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
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return "Tidak tersedia";
    var v = Number(n);
    return "Rp " + v.toLocaleString("id-ID");
  }

  function minimumHtml(c) {
    return '<div style="color:#475569;font-size:13px;margin:8px 0;">Minimum total belanja selama campaign: <b>' +
      rupiah(c.min_total_belanja_idr === undefined ? 0 : c.min_total_belanja_idr) +
      '</b>. Akumulasi harga akhir transaksi di cabang dan periode campaign (tanggal awal/akhir termasuk), sebelum koreksi retur. Tetap wajib minimal 1 transaksi; bukan jumlah kupon.<br>' +
      'Syarat transaksi: minimal <b>' + angka(c.min_jumlah_transaksi === undefined ? 1 : c.min_jumlah_transaksi) + '</b> transaksi, masing-masing minimal belanja <b>' +
      rupiah(c.min_belanja_per_transaksi_idr === undefined ? 0 : c.min_belanja_per_transaksi_idr) +
      '</b> (transaksi di bawah nilai itu tidak dihitung, baik untuk jumlah transaksi maupun total belanja).</div>';
  }

  function angka(n) { var v = Number(n); return Number.isFinite(v) ? v.toLocaleString("id-ID") : "0"; }

  function validMinTransaksi(v) {
    return String(v).trim() === String(v) && /^\d{1,4}$/.test(String(v)) && Number(v) >= 1 && Number(v) <= 1000;
  }

  function validMinimum(v) {
    return String(v).trim() === String(v) && /^\d{1,12}(\.\d{1,2})?$/.test(String(v));
  }

  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  var _branches = [];
  var _generation = 0;
  function currentSession() {
    return typeof SESSION !== "undefined" && SESSION ? SESSION : { user: {} };
  }
  function resetCustomer() {
    _selectedCustomer = null;
    _custCache = [];
    var old = document.getElementById("lot-w-suggest");
    if (old) old.remove();
  }
  function clearCampaign() {
    _generation++;
    resetCustomer();
    state.editId = null;
    state.detailCampaign = null;
    state.participants = []; state.prizes = []; state.winners = [];
  }
  // ---------------- State ----------------
  var state = {
    tab: "list", // list | form | participants | winners | report
    editId: null,
    detailCampaign: null,
    participants: [],
    winners: [],
    prizes: [],
  };

  // ---------------- Tabs ----------------
  function tabsHtml() {
    var tabs = [
      { id: "list", label: "Daftar Campaign" },
      { id: "form", label: state.editId ? "Edit Campaign" : "Buat Campaign" },
      { id: "participants", label: "Peserta", disabled: !state.detailCampaign },
      { id: "winners", label: "Pemenang", disabled: !state.detailCampaign },
      { id: "report", label: "Laporan (ROI/ROAS)", disabled: !state.detailCampaign },
    ];
    return (
      '<div class="tabs" style="display:flex;gap:8px;margin:12px 0;flex-wrap:wrap;">' +
      tabs
        .map(function (t) {
          var active = state.tab === t.id;
          var dis = t.disabled ? "opacity:.5;cursor:not-allowed;" : "";
          return (
            '<button type="button" class="tab-btn" data-tab="' +
            t.id +
            '"' + (t.disabled ? ' disabled aria-disabled="true" aria-describedby="lot-campaign-help"' : '') +
            ' style="padding:8px 14px;border:1px solid #cbd5e1;border-radius:8px;background:' +
            (active ? "#1e293b" : "#fff") +
            ";color:" +
            (active ? "#fff" : "#1e293b") +
            ";cursor:pointer;" +
            dis +
            '">' +
            esc(t.label) +
            "</button>"
          );
        })
        .join("") +
      "</div>" +
      (!state.detailCampaign ? '<p id="lot-campaign-help" style="color:#475569;font-size:13px;">Peserta, Pemenang, dan Laporan aktif setelah campaign dibuka. Pilih <b>Buka</b> pada Daftar Campaign. Jika daftar belum termuat, gunakan <b>Muat Ulang</b>; jika masih kosong, pilih <b>Buat Campaign</b>.</p>' : '')
    );
  }

  // ---------------- List ----------------
  function renderList() {
    var SESS = currentSession();
    var cabangOpts = (_branches)
      .map(function (c) {
        return '<option value="' + esc(c.kode_cabang) + '">' + esc(c.nama_cabang) + "</option>";
      })
      .join("");
    var onlyAktif =
      '<label style="display:flex;align-items:center;gap:6px;"><input type="checkbox" id="lot-only-aktif"/> Hanya aktif</label>';

    var html =
      '<div class="filter-bar" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">' +
      '<select id="lot-cabang" style="padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;">' +
      (SESS.user.role === "Owner"
        ? '<option value="">Semua cabang</option>' + cabangOpts
        : '<option value="' + esc(SESS.user.cabang_id) + '" selected>Cabang saya</option>') +
      "</select>" +
      onlyAktif +
      '<button id="lot-reload" style="padding:6px 12px;background:#0ea5e9;color:#fff;border:0;border-radius:8px;cursor:pointer;">Muat Ulang</button>' +
      '<button id="lot-new" style="padding:6px 12px;background:#16a34a;color:#fff;border:0;border-radius:8px;cursor:pointer;">+ Buat Campaign</button>' +
      "</div>";

    html += '<div id="lot-list-body">Memuat...</div>';

    setTimeout(function () {
      bindList();
      loadList();
    }, 0);

    return html;
  }

  function bindList() {
    var btn = document.getElementById("lot-reload");
    if (btn) btn.onclick = loadList;
    var nw = document.getElementById("lot-new");
    if (nw)
      nw.onclick = function () {
        clearCampaign();
        state.tab = "form";
        render();
      };
  }

  function loadList() {
    var body = document.getElementById("lot-list-body");
    if (!body) return;
    body.innerHTML = "Memuat...";
    var SESS = currentSession();
    var fd = {
      only_aktif: document.getElementById("lot-only-aktif")?.checked || false,
      kode_cabang:
        SESS.user.role === "Owner"
          ? document.getElementById("lot-cabang")?.value || null
          : SESS.user.cabang_id || null,
    };
    lotteryApi("lotteryList", fd)
      .then(function (rows) {
        if (!rows || !rows.length) {
          body.innerHTML = '<div style="color:#64748b;">Belum ada campaign.</div>';
          return;
        }
        var cards = rows
          .map(function (r) {
            var ps = r.prize_summary || { count: 0, total_nilai: 0 };
            return (
              '<div class="card" style="border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin-bottom:10px;background:#fff;">' +
              '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
              '<div><div style="font-weight:600;font-size:16px;">' +
              esc(r.nama) +
              '</div><div style="color:#64748b;font-size:13px;">Cabang: ' +
              esc(r.kode_cabang) +
              " · " +
              esc(r.periode_mulai) +
              " → " +
              esc(r.periode_selesai) +
              "</div></div>" +
              '<div style="text-align:right;">' +
              '<span style="display:inline-block;padding:3px 8px;border-radius:999px;font-size:12px;background:' +
              (r.aktif ? "#dcfce7;color:#166534" : "#fee2e2;color:#991b1b") +
              ';">' +
              (r.aktif ? "Aktif" : "Non-aktif") +
              "</span>" +
              '<div style="margin-top:6px;font-size:12px;color:#475569;">' +
              ps.count +
              " hadiah · " +
              rupiah(ps.total_nilai) +
              "</div>" +
              "</div></div>" +
              minimumHtml(r) +
              '<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;">' +
              '<button data-act="open" data-id="' +
              esc(r.id) +
              '" style="padding:6px 10px;background:#0ea5e9;color:#fff;border:0;border-radius:6px;cursor:pointer;">Buka</button>' +
              '<button data-act="edit" data-id="' + esc(r.id) + '">Edit</button>' +
              '<button data-act="toggle" data-id="' +
              esc(r.id) +
              '" data-aktif="' +
              (r.aktif ? "0" : "1") +
              '" style="padding:6px 10px;background:' +
              (r.aktif ? "#f59e0b" : "#16a34a") +
              ';color:#fff;border:0;border-radius:6px;cursor:pointer;">' +
              (r.aktif ? "Nonaktifkan" : "Aktifkan") +
              "</button>" +
              "</div></div>"
            );
          })
          .join("");
        body.innerHTML = cards;
        body.querySelectorAll("button[data-act]").forEach(function (b) {
          b.onclick = function () {
            var id = b.getAttribute("data-id");
            var act = b.getAttribute("data-act");
            if (act === "open" || act === "edit") openDetail(id, act === "edit");
            else toggleStatus(id, b.getAttribute("data-aktif") === "1");
          };
        });
      })
      .catch(function (e) {
        body.innerHTML = listErrorHtml(e);
        var retry = document.getElementById("lot-retry");
        if (retry) retry.onclick = loadList;
      });
  }

  function openDetail(id, edit) {
    clearCampaign();
    var generation = _generation;
    lotteryApi("lotteryGet", { id: id })
      .then(function (d) {
        if (generation !== _generation) return;
        state.detailCampaign = d.campaign;
        state.editId = id;
        state.prizes = d.prizes || [];
        state.winners = d.winners || [];
        state.tab = edit ? "form" : "participants";
        render();
      })
      .catch(function (e) { alert("Gagal: " + e.message); });
  }

  function toggleStatus(id, aktif) {
    if (!confirm(aktif ? "Aktifkan campaign ini?" : "Nonaktifkan campaign ini?")) return;
    lotteryApi("lotteryStatus", { id: id, aktif: aktif })
      .then(function () { loadList(); })
      .catch(function (e) { alert("Gagal: " + e.message); });
  }

  // ---------------- Form ----------------
  function renderForm() {
    var SESS = currentSession();
    var isEdit = !!state.editId;
    var c = isEdit ? state.detailCampaign || {} : {};

    var cabangSel =
      '<select id="lot-f-cabang" style="padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;">' +
      (SESS.user.role === "Owner"
        ? (_branches)
            .map(function (x) {
              return (
                '<option value="' + esc(x.kode_cabang) + '"' +
                (x.kode_cabang === c.kode_cabang ? " selected" : "") +
                ">" + esc(x.nama_cabang) + "</option>"
              );
            })
            .join("")
        : '<option value="' + esc(SESS.user.cabang_id) + '" selected>' + esc(SESS.user.cabang_id) + "</option>") +
      "</select>";

    var prizes = (state.prizes || []).filter(function (p) { return !p.retired; });
    var prizesHtml =
      '<div id="lot-prizes">' +
      prizes
        .map(function (p, i) {
          return prizeRow(i, p);
        })
        .join("") +
      "</div>" +
      '<button type="button" id="lot-add-prize" style="margin-top:8px;padding:6px 10px;background:#e2e8f0;border:0;border-radius:6px;cursor:pointer;">+ Tambah Hadiah</button>';

    var html =
      '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;max-width:780px;">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
      formField("Nama Campaign", '<input id="lot-f-nama" value="' + esc(c.nama || "") + '" style="width:100%;padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;"/>', true) +
      formField("Cabang", cabangSel, true) +
      formField(
        "Periode Mulai",
        '<input id="lot-f-mulai" type="date" value="' + esc(c.periode_mulai || todayISO()) + '"/>',
        true,
      ) +
      formField(
        "Periode Selesai",
        '<input id="lot-f-selesai" type="date" value="' + esc(c.periode_selesai || todayISO()) + '"/>',
        true,
      ) +
      formField(
        "Minimum total belanja selama campaign (Rp)",
        '<input id="lot-f-min-belanja" type="number" min="0" max="999999999999.99" step="0.01" required value="' + esc(c.min_total_belanja_idr === undefined ? 0 : c.min_total_belanja_idr) + '" style="width:100%;padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;"/>' +
        '<small>Contoh 300000: total pembelian selama periode, boleh dari beberapa transaksi. Nilai 0 tetap mensyaratkan minimal 1 transaksi. Maksimal 2 desimal. Mengubah minimum menghitung ulang peserta/laporan, bukan menghapus pemenang terdahulu.</small>',
        true,
      ) +
      formField(
        "Minimal jumlah transaksi",
        '<input id="lot-f-min-trx" type="number" min="1" max="1000" step="1" required value="' + esc(c.min_jumlah_transaksi === undefined ? 1 : c.min_jumlah_transaksi) + '" style="width:100%;padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;"/>' +
        '<small>Contoh 10: pelanggan harus memiliki minimal 10 transaksi yang dihitung selama periode campaign sebelum kuponnya bisa dicatat. Nilai 1 = cukup satu transaksi. Transaksi di hari yang sama dihitung terpisah.</small>',
        true,
      ) +
      formField(
        "Minimal belanja per transaksi (Rp)",
        '<input id="lot-f-min-per-trx" type="number" min="0" max="999999999999.99" step="0.01" required value="' + esc(c.min_belanja_per_transaksi_idr === undefined ? 0 : c.min_belanja_per_transaksi_idr) + '" style="width:100%;padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;"/>' +
        '<small>Contoh 25000: transaksi baru dihitung sebagai 1 transaksi bila belanjanya minimal Rp25.000; di bawah itu tidak dihitung sama sekali (juga tidak masuk total belanja campaign). Nilai 0 = semua transaksi dihitung.</small>',
        true,
      ) +
      formField(
        "Catatan",
        '<textarea id="lot-f-catatan" rows="2" style="width:100%;">' + esc(c.catatan || "") + "</textarea>",
      ) +
      "</div>" +
      '<h4 style="margin:14px 0 6px;">Hadiah</h4>' +
      '<div style="font-size:12px;color:#64748b;margin-bottom:6px;">Hadiah boleh di luar inventory. Probabilitas hanya informasi untuk undian offline; aplikasi tidak mengundi. Hadiah yang dihapus dari form dinonaktifkan, histori tetap ada. Hadiah dengan pemenang tidak dapat diubah.</div>' +
      prizesHtml +
      '<div style="margin-top:14px;display:flex;gap:8px;">' +
      '<button id="lot-save" style="padding:8px 14px;background:#16a34a;color:#fff;border:0;border-radius:8px;cursor:pointer;">Simpan</button>' +
      '<button id="lot-cancel" style="padding:8px 14px;background:#e2e8f0;border:0;border-radius:8px;cursor:pointer;">Batal</button>' +
      "</div>" +
      "</div>";

    setTimeout(function () { bindForm(); }, 0);
    return html;
  }

  function formField(label, inputHtml, required) {
    return (
      '<label style="display:flex;flex-direction:column;gap:4px;font-size:13px;color:#475569;">' +
      esc(label) +
      (required ? ' <span style="color:#b91c1c;">*</span>' : "") +
      '<div style="width:100%;">' + inputHtml + "</div>" +
      "</label>"
    );
  }

  function prizeRow(i, p) {
    p = p || {};
    return (
      '<div class="prize-row" data-i="' +
      i +
      '" data-id="' + esc(p.id || "") + '" data-image="' + esc(p.gambar_url || "") + '" style="display:grid;grid-template-columns:2fr 1fr 1fr 0.7fr auto;gap:6px;margin-bottom:6px;align-items:center;">' +
      '<input class="p-name" placeholder="Nama hadiah / produk" value="' + esc(p.nama_hadiah || p.nama_produk || "") + '" style="padding:6px;border:1px solid #cbd5e1;border-radius:6px;"/>' +
      '<input class="p-prod" placeholder="Nama produk (opsional)" value="' + esc(p.nama_produk || "") + '" style="padding:6px;border:1px solid #cbd5e1;border-radius:6px;"/>' +
      '<input class="p-nilai" type="number" min="0" step="1000" placeholder="Nilai (IDR)" value="' + esc(p.nilai_hadiah_idr || 0) + '" style="padding:6px;border:1px solid #cbd5e1;border-radius:6px;"/>' +
      '<input class="p-prob" type="number" min="0" max="100" step="0.01" placeholder="Prob %" value="' + esc(p.probabilitas_persen || 0) + '" style="padding:6px;border:1px solid #cbd5e1;border-radius:6px;"/>' +
      '<button type="button" class="p-del" style="padding:6px 8px;background:#fee2e2;color:#991b1b;border:0;border-radius:6px;cursor:pointer;">×</button>' +
      "</div>"
    );
  }

  function bindForm() {
    var add = document.getElementById("lot-add-prize");
    if (add)
      add.onclick = function () {
        var wrap = document.getElementById("lot-prizes");
        var div = document.createElement("div");
        div.innerHTML = prizeRow(999, {});
        wrap.appendChild(div.firstChild);
        rebindPrizeRows();
      };
    rebindPrizeRows();
    var branch = document.getElementById("lot-f-cabang");
    if (branch && state.editId) branch.disabled = true;

    var sv = document.getElementById("lot-save");
    if (sv) sv.onclick = saveForm;
    var cn = document.getElementById("lot-cancel");
    if (cn)
      cn.onclick = function () {
        clearCampaign();
        state.tab = "list";
        render();
      };
  }

  function rebindPrizeRows() {
    var rows = document.querySelectorAll(".prize-row");
    rows.forEach(function (r) {
      var del = r.querySelector(".p-del");
      if (del) del.onclick = function () { r.remove(); };
    });
  }

  function readForm() {
    var prizes = [];
    document.querySelectorAll(".prize-row").forEach(function (r) {
      var nama_hadiah = r.querySelector(".p-name").value.trim();
      var nama_produk = r.querySelector(".p-prod").value.trim();
      var nilai = Number(r.querySelector(".p-nilai").value) || 0;
      var prob = Number(r.querySelector(".p-prob").value) || 0;
      if (nama_hadiah || nama_produk) {
        prizes.push({
          id: r.getAttribute("data-id") || undefined,
          gambar_url: r.getAttribute("data-image") || null,
          nama_hadiah: nama_hadiah || nama_produk,
          nama_produk: nama_produk || null,
          nilai_hadiah_idr: nilai,
          probabilitas_persen: prob,
        });
      }
    });
    return {
      id: state.editId || undefined,
      kode_cabang: document.getElementById("lot-f-cabang").value,
      nama: document.getElementById("lot-f-nama").value.trim(),
      periode_mulai: document.getElementById("lot-f-mulai").value,
      periode_selesai: document.getElementById("lot-f-selesai").value,
      catatan: document.getElementById("lot-f-catatan").value.trim(),
      min_total_belanja_idr: document.getElementById("lot-f-min-belanja").value,
      min_jumlah_transaksi: document.getElementById("lot-f-min-trx").value,
      min_belanja_per_transaksi_idr: document.getElementById("lot-f-min-per-trx").value,
      prizes: prizes,
    };
  }

  function saveForm() {
    var fd = readForm();
    if (!fd.nama) return alert("Nama campaign wajib diisi");
    if (!fd.kode_cabang) return alert("Cabang wajib diisi");
    if (!fd.periode_mulai || !fd.periode_selesai)
      return alert("Periode wajib diisi");
    if (fd.periode_selesai < fd.periode_mulai)
      return alert("Periode selesai tidak boleh sebelum periode mulai");

    if (!validMinimum(fd.min_total_belanja_idr))
      return alert("Minimum total belanja harus 0–999999999999.99, maksimal 2 desimal (tanpa pemisah ribuan)");
    if (!validMinTransaksi(fd.min_jumlah_transaksi))
      return alert("Minimal jumlah transaksi harus bilangan bulat 1–1000");
    if (!validMinimum(fd.min_belanja_per_transaksi_idr))
      return alert("Minimal belanja per transaksi harus 0–999999999999.99, maksimal 2 desimal (tanpa pemisah ribuan)");

    var btn = document.getElementById("lot-save");
    if (btn.disabled) return;
    btn.disabled = true;
    var generation = _generation;
    lotteryApi("lotterySave", fd)
      .then(function (r) {
        if (generation !== _generation) return;
        clearCampaign();
        state.tab = "list";
        render();
      })
      .catch(function (e) { alert("Gagal: " + e.message); })
      .finally(function () { btn.disabled = false; });
  }

  function loadFormForEdit() {
    if (!state.editId) return;
    var generation = _generation;
    lotteryApi("lotteryGet", { id: state.editId })
      .then(function (d) {
        if (generation !== _generation) return;
        state.detailCampaign = d.campaign;
        state.prizes = d.prizes || [];
        render();
      })
      .catch(function (e) { alert("Gagal: " + e.message); });
  }

  // ---------------- Participants ----------------
  function renderParticipants() {
    if (!state.detailCampaign) {
      return '<div style="color:#64748b;">Buka campaign dari tab Daftar Campaign terlebih dahulu.</div>';
    }
    var c = state.detailCampaign;
    var html =
      '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
      "<div><b>" + esc(c.nama) + "</b> · " + esc(c.kode_cabang) + " · " + esc(c.periode_mulai) + " → " + esc(c.periode_selesai) + "</div>" +
      '<button id="lot-reload-part" style="padding:6px 10px;background:#0ea5e9;color:#fff;border:0;border-radius:6px;cursor:pointer;">Muat Ulang</button>' +
      "</div>" +
      '<div id="lot-part-body" style="margin-top:10px;">Memuat...</div>' +
      "</div>";

    setTimeout(function () {
      var b = document.getElementById("lot-reload-part");
      if (b) b.onclick = loadParticipants;
      loadParticipants();
    }, 0);
    return html;
  }

  function loadParticipants() {
    var body = document.getElementById("lot-part-body");
    if (!body) return;
    body.innerHTML = "Memuat...";
    var generation = _generation;
    lotteryApi("lotteryEligibleParticipants", { campaign_id: state.detailCampaign.id })
      .then(function (d) {
        if (generation !== _generation || document.getElementById("lot-part-body") !== body) return;
        state.participants = d.participants || [];
        state.detailCampaign = d.campaign;
        body.innerHTML = minimumHtml(d.campaign) +
          '<div style="color:#475569;font-size:13px;margin-bottom:6px;">Total peserta eligible: <b>' +
          d.total_peserta +
          "</b> (dari " +
          d.total_transaksi +
          " transaksi ber-WhatsApp di cabang/periode campaign, termasuk yang tidak eligible)</div>" +
          tableParticipants(d.participants);
      })
      .catch(function (e) {
        body.innerHTML = '<div style="color:#b91c1c;">Gagal: ' + esc(e.message) + "</div>";
      });
  }

  function tableParticipants(rows) {
    if (!rows.length) return '<div style="color:#64748b;">Belum ada peserta eligible.</div>';
    var trs = rows
      .map(function (r) {
        return (
          "<tr>" +
          "<td>" + esc(r.nama) + "</td>" +
          "<td>" + esc(r.nomor_wa) + "</td>" +
          "<td>" + esc(r.tipe_customer) + "</td>" +
          "<td>" + esc(r.segment_crm || "-") + "</td>" +
          "<td style='text-align:right;'>" + r.jumlah_transaksi_periode + "</td>" +
          "<td style='text-align:right;'>" + rupiah(r.total_belanja_periode) + "</td>" +
          "</tr>"
        );
      })
      .join("");
    return (
      '<div style="overflow:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">' +
      "<thead><tr style='background:#f1f5f9;'>" +
      "<th>Nama</th><th>WA</th><th>Tipe</th><th>Segment</th><th>Transaksi</th><th>Total Belanja Selama Campaign</th>" +
      "</tr></thead><tbody>" +
      trs +
      "</tbody></table></div>"
    );
  }

  // ---------------- Winners ----------------
  function renderWinners() {
    if (!state.detailCampaign) {
      return '<div style="color:#64748b;">Buka campaign dari tab Daftar Campaign terlebih dahulu.</div>';
    }
    var c = state.detailCampaign;
    var prizes = (state.prizes || []).filter(function (p) { return !p.retired; });

    var html =
      '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">' +
      "<b>" + esc(c.nama) + "</b> · " + esc(c.kode_cabang) +
      '<div id="lot-w-minimum">' + minimumHtml(c) + "</div>" +
      '<h4 style="margin-top:14px;">Catat Pemenang (offline)</h4>' +
      '<div style="display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr 1fr auto;gap:6px;align-items:end;">' +
      '<label style="font-size:12px;color:#475569;">Pelanggan (cari nama/ WA)<input id="lot-w-cust" placeholder="ketik min 2 huruf" style="width:100%;padding:6px;border:1px solid #cbd5e1;border-radius:6px;"/></label>' +
      '<label style="font-size:12px;color:#475569;">Hadiah<select id="lot-w-prize" style="width:100%;padding:6px;border:1px solid #cbd5e1;border-radius:6px;">' +
      prizes.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.nama_hadiah || p.nama_produk) + " (" + rupiah(p.nilai_hadiah_idr) + ")</option>"; }).join("") +
      "</select></label>" +
      '<label style="font-size:12px;color:#475569;">Berlaku s/d<input id="lot-w-exp" type="date" value="' + esc(c.periode_selesai) + '" style="width:100%;padding:6px;border:1px solid #cbd5e1;border-radius:6px;"/></label>' +
      '<label style="font-size:12px;color:#475569;">Tgl Ambil<input id="lot-w-pickup" type="date" style="width:100%;padding:6px;border:1px solid #cbd5e1;border-radius:6px;"/></label>' +
      '<label style="font-size:12px;color:#475569;">Status<select id="lot-w-status" style="width:100%;padding:6px;border:1px solid #cbd5e1;border-radius:6px;"><option value="belum_diambil">Belum diambil</option><option value="sudah_diambil">Sudah diambil</option></select></label>' +
      '<button id="lot-w-save" style="padding:8px 12px;background:#16a34a;color:#fff;border:0;border-radius:6px;cursor:pointer;">Catat</button>' +
      "</div>" +
      '<div id="lot-w-msg" style="margin-top:6px;font-size:12px;"></div>' +
      '<h4 style="margin-top:18px;">Daftar Pemenang</h4>' +
      '<div id="lot-w-body">Memuat...</div>' +
      "</div>";

    setTimeout(bindWinners, 0);
    return html;
  }

  var _custCache = [];
  function bindWinners() {
    if (!state.detailCampaign) return;
    resetCustomer();
    var generation = _generation;
    var campaignId = state.detailCampaign.id;
    var cust = document.getElementById("lot-w-cust");
    var sv = document.getElementById("lot-w-save");
    if (sv) sv.onclick = saveWinner;
    if (cust) {
      cust.addEventListener("input", function () {
        _selectedCustomer = null;
        var q = cust.value.trim().toLowerCase();
        if (q.length < 2) { showCustSuggest(cust, []); return; }
        var list = _custCache.filter(function (x) {
          return (x.nama || "").toLowerCase().includes(q) || (x.nomor_wa || "").includes(q);
        }).slice(0, 10);
        showCustSuggest(cust, list);
      });
    }
    if (cust) cust.disabled = true;
    lotteryApi("lotteryEligibleParticipants", { campaign_id: campaignId })
      .then(function (d) {
        if (generation !== _generation || document.getElementById("lot-w-cust") !== cust) return;
        _custCache = d.participants || [];
        state.detailCampaign = d.campaign;
        var minimum = document.getElementById("lot-w-minimum");
        if (minimum) minimum.innerHTML = minimumHtml(d.campaign);
        cust.disabled = false;
        cust.placeholder = _custCache.length ? "ketik min 2 huruf" : "Belum ada peserta eligible";
      }).catch(function (e) {
        if (generation !== _generation || document.getElementById("lot-w-cust") !== cust) return;
        var msg = document.getElementById("lot-w-msg");
        if (msg) msg.textContent = "Gagal memuat pelanggan: " + e.message;
      });
    loadWinners();
  }

  var _selectedCustomer = null;
  function showCustSuggest(input, list) {
    var old = document.getElementById("lot-w-suggest");
    if (old) old.remove();
    if (!list.length) return;
    var div = document.createElement("div");
    div.id = "lot-w-suggest";
    div.style.cssText = "position:absolute;background:#fff;border:1px solid #cbd5e1;border-radius:6px;max-height:200px;overflow:auto;z-index:10;font-size:13px;";
    list.forEach(function (x) {
      var opt = document.createElement("div");
      opt.textContent = x.nama + " (" + x.nomor_wa + ") · " + x.tipe_customer + " · Total selama campaign: " + rupiah(x.total_belanja_periode);
      opt.style.cssText = "padding:6px 10px;cursor:pointer;";
      opt.onclick = function () {
        _selectedCustomer = x;
        input.value = x.nama + " (" + x.nomor_wa + ") · " + rupiah(x.total_belanja_periode);
        div.remove();
      };
      div.appendChild(opt);
    });
    input.parentNode.appendChild(div);
  }

  function saveWinner() {
    var msg = document.getElementById("lot-w-msg");
    msg.textContent = "";
    if (!_selectedCustomer) { msg.textContent = "Pilih pelanggan dari saran"; return; }
    var fd = {
      campaign_id: state.detailCampaign.id,
      customer_id: _selectedCustomer.customer_id,
      prize_id: document.getElementById("lot-w-prize").value,
      coupon_expired_at: document.getElementById("lot-w-exp").value,
      pickup_date: document.getElementById("lot-w-pickup").value || null,
      pickup_status: document.getElementById("lot-w-status").value,
    };
    if (!fd.prize_id) { msg.textContent = "Pilih hadiah"; return; }
    if (!fd.coupon_expired_at) { msg.textContent = "Tanggal berlaku wajib"; return; }
    if (fd.pickup_status === "sudah_diambil" && !fd.pickup_date) {
      msg.textContent = "Tanggal ambil wajib diisi jika status 'sudah_diambil'";
      return;
    }

    var btn = document.getElementById("lot-w-save");
    if (btn.disabled) return;
    btn.disabled = true;
    var generation = _generation;
    lotteryApi("lotteryWinnerSave", fd)
      .then(function (w) {
        if (generation !== _generation || document.getElementById("lot-w-msg") !== msg) return;
        msg.style.color = "#166534";
        msg.textContent = "Tersimpan. Kupon: " + (w.coupon_code || "");
        _selectedCustomer = null;
        document.getElementById("lot-w-cust").value = "";
        loadWinners();
      })
      .catch(function (e) {
        msg.style.color = "#b91c1c";
        if (generation !== _generation || document.getElementById("lot-w-msg") !== msg) return;
        msg.textContent = "Gagal: " + e.message;
      }).finally(function () { btn.disabled = false; });
  }

  function loadWinners() {
    var body = document.getElementById("lot-w-body");
    if (!body) return;
    body.innerHTML = "Memuat...";
    var generation = _generation;
    lotteryApi("lotteryGet", { id: state.detailCampaign.id })
      .then(function (d) {
        if (generation !== _generation || document.getElementById("lot-w-body") !== body) return;
        state.winners = d.winners || [];
        var prizeMap = {};
        (d.prizes || []).forEach(function (p) { prizeMap[p.id] = p; });
        if (!state.winners.length) {
          body.innerHTML = '<div style="color:#64748b;">Belum ada pemenang.</div>';
          return;
        }
        var trs = state.winners.map(function (w) {
          var p = prizeMap[w.prize_id] || {};
          return (
            "<tr>" +
            "<td><code>" + esc(w.coupon_code) + "</code></td>" +
            "<td>" + esc(p.nama_hadiah || p.nama_produk || "-") + "</td>" +
            "<td style='text-align:right;'>" + rupiah(p.nilai_hadiah_idr || 0) + "</td>" +
            "<td>" + esc(w.pickup_date || "-") + "</td>" +
            "<td>" + esc(w.pickup_status) + "</td>" +
            "</tr>"
          );
        }).join("");
        body.innerHTML =
          '<div style="overflow:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">' +
          "<thead><tr style='background:#f1f5f9;'>" +
          "<th>Kupon</th><th>Hadiah</th><th>Nilai</th><th>Tgl Ambil</th><th>Status</th>" +
          "</tr></thead><tbody>" + trs + "</tbody></table></div>";
      })
      .catch(function (e) {
        body.innerHTML = '<div style="color:#b91c1c;">Gagal: ' + esc(e.message) + "</div>";
      });
  }

  // ---------------- Report ----------------
  function renderReport() {
    if (!state.detailCampaign) {
      return '<div style="color:#64748b;">Buka campaign dari tab Daftar Campaign terlebih dahulu.</div>';
    }
    var html =
      '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">' +
      "<b>" + esc(state.detailCampaign.nama) + "</b> · " + esc(state.detailCampaign.kode_cabang) +
      '<div id="lot-rpt-body" style="margin-top:12px;">Memuat...</div>' +
      "</div>";
    setTimeout(loadReport, 0);
    return html;
  }

  function loadReport() {
    var body = document.getElementById("lot-rpt-body");
    if (!body) return;
    body.innerHTML = "Memuat...";
    var generation = _generation;
    lotteryApi("lotteryReport", { campaign_id: state.detailCampaign.id })
      .then(function (d) {
        if (generation !== _generation || document.getElementById("lot-rpt-body") !== body) return;
        var r = d.ringkasan || {};
        body.innerHTML = minimumHtml(d.campaign) +
          '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">' +
          kpi("Total Pemenang", r.total_pemenang) +
          kpi("Hadiah Diambil", r.hadiah_terambil) +
          kpi("Total Biaya Hadiah", rupiah(r.total_biaya_hadiah_idr)) +
          kpi("Peserta Eligible Saat Ini", r.total_peserta_eligible) +
          kpi("Transaksi Peserta Eligible", r.total_transaksi_peserta) +
          kpi("Revenue Peserta Eligible", rupiah(r.total_revenue_idr)) +
          kpi("Laba Kotor Peserta Eligible", rupiah(r.total_profit_idr)) +
          kpi("ROAS", r.roas === null ? "-" : (Math.round(r.roas * 100) / 100).toFixed(2)) +
          kpi("ROI proxy (%)", r.roi_direct_percent === null ? "-" : (Math.round(r.roi_direct_percent * 100) / 100).toFixed(2) + " %") +
          "</div><p>" + esc(d.basis || "") + "</p>" + (d.warning ? "<p>" + esc(d.warning) + "</p>" : "");
      })
      .catch(function (e) {
        body.innerHTML = '<div style="color:#b91c1c;">Gagal: ' + esc(e.message) + "</div>";
      });
  }

  function kpi(label, val) {
    return (
      '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px;">' +
      '<div style="font-size:12px;color:#64748b;">' + esc(label) + "</div>" +
      '<div style="font-size:18px;font-weight:600;color:#0f172a;">' + esc(val) + "</div>" +
      "</div>"
    );
  }

  // ---------------- Main render ----------------
  function render() {
    var root = document.getElementById("lottery-root");
    if (!root) return;
    var body = "";
    if (state.tab === "list") body = renderList();
    else if (state.tab === "form") body = renderForm();
    else if (state.tab === "participants") body = renderParticipants();
    else if (state.tab === "winners") body = renderWinners();
    else if (state.tab === "report") body = renderReport();

    root.innerHTML = tabsHtml() + '<div id="lot-body">' + body + "</div>";

    root.querySelectorAll(".tab-btn").forEach(function (b) {
      b.onclick = function () {
        var tab = b.getAttribute("data-tab");
        if (b.disabled || (!state.detailCampaign && ["participants", "winners", "report"].indexOf(tab) >= 0)) return;
        _generation++;
        resetCustomer();
        state.tab = tab;
        render();
      };
    });

    if (state.tab === "form" && state.editId && (!state.detailCampaign || state.detailCampaign.id !== state.editId)) {
      loadFormForEdit();
    }
  }

  // js_master registers the Owner promo screen first. Keep it unchanged and
  // route Apoteker to lottery only, without invoking Owner-only promo APIs.
  var ownerMarketingRender = VIEWS.marketing.render;
  VIEWS.marketing.render = function (el) {
    var role = currentSession().user.role;
    if (role !== "Owner" && role !== "Apoteker") { el.textContent = "Akses Marketing ditolak"; return; }
    if (role === "Apoteker") {
      el.innerHTML = '<div id="lottery-root"></div>';
      window.MarketingLottery.mount("lottery-root");
      return;
    }
    ownerMarketingRender(el);
  };

  // expose entry
  window.MarketingLottery = {
    mount: function (rootEl) {
      if (typeof rootEl === "string") rootEl = document.getElementById(rootEl);
      if (!rootEl) {
        // buat wrapper di akhir main
        var main = document.getElementById("main") || document.body;
        rootEl = document.createElement("div");
        rootEl.id = "lottery-root";
        main.appendChild(rootEl);
      }
      rootEl.id = "lottery-root";
      clearCampaign();
      state.tab = "list";
      _branches = [];
      var sess = currentSession(), role = sess.user && sess.user.role;
      if (role !== "Owner" && role !== "Apoteker") { rootEl.textContent = "Akses lottery ditolak"; return; }
      if (role === "Apoteker" && !sess.user.cabang_id) { rootEl.textContent = "Sesi ini tidak punya cabang"; return; }
      if (role === "Owner") {
        var generation = _generation;
        rootEl.textContent = "Memuat cabang...";
        api("cabang.list", {}).then(function (rows) {
          if (generation !== _generation || document.getElementById("lottery-root") !== rootEl) return;
          _branches = rows || [];
          render();
        }).catch(function (e) { if (generation === _generation) rootEl.textContent = "Gagal memuat cabang: " + e.message; });
      } else render();
    },
  };
})();
