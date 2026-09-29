// public/js_marketing_poin.js
// UI: Marketing > Poin & Reward (khusus Owner)
//  - kelola reward penukaran poin per cabang (tambah, ubah, aktif/nonaktif)
//  - riwayat penukaran: reward poin + kupon promo dalam satu daftar
// Memakai Edge Function `promo` (promoApi): rewardList, rewardSave, rewardStatus, redemptionList.
// Menempel pada VIEWS.marketing milik Owner tanpa mengubah js_master.js.

(function () {
  if (typeof VIEWS === 'undefined' || !VIEWS.marketing) return;

  var REWARD_ROWS = [];
  var NAMA_TIER = { reguler: 'Reguler', silver: 'Silver', gold: 'Gold' };

  function waktuIndo(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function kerangkaPoin() {
    return '<div id="mpCard" class="card crm-refill">' +
      '<div class="card-head"><div><h3>Poin &amp; Reward</h3>' +
      '<p class="sub">Atur reward penukaran poin dan pantau riwayat penukaran (reward dan kupon) di cabang aktif.</p></div>' +
      '<button id="mpTambah" class="btn btn-primary">+ Reward</button></div>' +
      '<p class="sub" style="margin:0 0 12px">Perolehan poin saat ini: <strong>1 poin tiap Rp1.000</strong> belanja. ' +
      'Tenaga Kesehatan dan Apotek Lain tidak mendapat poin.</p>' +
      '<h4 style="margin:0 0 8px">Daftar reward</h4><div id="mpReward"><div class="empty">Memuat reward…</div></div>' +
      '<h4 style="margin:16px 0 8px">Riwayat penukaran</h4><div id="mpRiwayat"><div class="empty">Memuat riwayat…</div></div>' +
      '</div>';
  }

  function muatRewardMarketing() {
    var box = document.getElementById('mpReward');
    if (!box) return;
    promoApi('rewardList', {}).then(function (rows) {
      REWARD_ROWS = rows || [];
      if (!REWARD_ROWS.length) { box.innerHTML = '<div class="empty">Belum ada reward di cabang ini. Klik “+ Reward” untuk membuat.</div>'; return; }
      box.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Reward</th><th class="r">Poin</th><th class="r">Nilai diskon</th><th>Tier min.</th><th>Status</th><th></th></tr></thead><tbody>' +
        REWARD_ROWS.map(function (r) {
          return '<tr><td><strong>' + esc(r.name) + '</strong></td>' +
            '<td class="r">' + angka(r.points_required) + '</td>' +
            '<td class="r">' + rupiah(r.reward_value) + '</td>' +
            '<td>' + esc(NAMA_TIER[r.min_tier] || r.min_tier) + '</td>' +
            '<td>' + (r.is_active ? 'Aktif' : 'Nonaktif') + '</td>' +
            '<td class="r"><button class="btn btn-sm" data-mp-ubah="' + esc(r.id) + '">Ubah</button> ' +
            '<button class="btn btn-sm" data-mp-status="' + esc(r.id) + '" data-aktif="' + (r.is_active ? '0' : '1') + '">' + (r.is_active ? 'Nonaktifkan' : 'Aktifkan') + '</button></td></tr>';
        }).join('') + '</tbody></table></div>';
      box.onclick = function (e) {
        var u = e.target.closest('[data-mp-ubah]');
        if (u) { var r = REWARD_ROWS.filter(function (x) { return x.id === u.dataset.mpUbah; })[0]; if (r) formRewardMarketing(r); return; }
        var st = e.target.closest('[data-mp-status]');
        if (st) {
          promoApi('rewardStatus', { id: st.dataset.mpStatus, is_active: st.dataset.aktif === '1' })
            .then(function () { toast('Status reward diperbarui.'); muatRewardMarketing(); })
            .catch(function (err) { toast(err.message, true); });
        }
      };
    }).catch(function (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }

  function muatRiwayatMarketing() {
    var box = document.getElementById('mpRiwayat');
    if (!box) return;
    promoApi('redemptionList', {}).then(function (rows) {
      rows = rows || [];
      if (!rows.length) { box.innerHTML = '<div class="empty">Belum ada penukaran reward atau pemakaian kupon.</div>'; return; }
      box.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Waktu</th><th>Jenis</th><th>Pelanggan</th><th>Reward / kupon</th><th class="r">Poin</th><th class="r">Nilai</th><th>Nota</th></tr></thead><tbody>' +
        rows.map(function (x) {
          var batal = x.status === 'reversed' ? ' <em>(dibatalkan)</em>' : '';
          return '<tr><td>' + esc(waktuIndo(x.waktu)) + '</td>' +
            '<td>' + (x.jenis === 'reward' ? 'Reward poin' : 'Kupon') + '</td>' +
            '<td><strong>' + esc(x.pelanggan) + '</strong><span class="cart-line-meta">' + esc(x.nomor_wa) + '</span></td>' +
            '<td>' + esc(x.nama) + batal + '</td>' +
            '<td class="r">' + (x.poin ? '−' + angka(x.poin) : '—') + '</td>' +
            '<td class="r">' + rupiah(x.nilai) + '</td>' +
            '<td>' + esc(x.no_nota || '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }

  function formRewardMarketing(r) {
    var ubah = !!r;
    r = r || { name: '', points_required: '', reward_value: '', min_tier: 'reguler' };
    var opsiTier = ['reguler', 'silver', 'gold'].map(function (t) {
      return '<option value="' + t + '"' + (r.min_tier === t ? ' selected' : '') + '>' + NAMA_TIER[t] + '</option>';
    }).join('');
    modalBuka(ubah ? 'Ubah reward' : 'Reward baru',
      '<label class="field"><span>Nama reward</span><input id="mpNama" class="inp" placeholder="Diskon Rp5.000" value="' + esc(r.name) + '"></label>' +
      '<label class="field"><span>Poin yang dibutuhkan</span><input id="mpPoin" class="inp" type="number" min="1" step="1" value="' + esc(r.points_required) + '"></label>' +
      '<label class="field"><span>Nilai diskon (Rp)</span><input id="mpNilai" class="inp" type="number" min="1" step="500" value="' + esc(r.reward_value) + '"></label>' +
      '<label class="field"><span>Tier minimum pelanggan</span><select id="mpTier" class="inp">' + opsiTier + '</select></label>' +
      '<p class="sub">Perubahan berlaku untuk penukaran berikutnya. Riwayat penukaran yang sudah terjadi tidak berubah.</p>',
      [{ label: 'Batal', aksi: modalTutup },
       { label: 'Simpan', kelas: 'btn-primary', aksi: function () {
         var p = { id: ubah ? r.id : undefined, name: val('mpNama'), points_required: Number(val('mpPoin')), reward_value: Number(val('mpNilai')), min_tier: val('mpTier') };
         promoApi('rewardSave', p).then(function () { modalTutup(); toast('Reward tersimpan.'); muatRewardMarketing(); })
           .catch(function (e) { toast(e.message, true); });
       } }]);
  }

  // VIEWS.marketing sudah dibungkus js_marketing_lottery.js (Apoteker -> lottery).
  // Untuk Owner, tempelkan kartu Poin & Reward setelah tampilan promo dirender.
  var renderSebelumnya = VIEWS.marketing.render;
  VIEWS.marketing.render = function (el) {
    renderSebelumnya(el);
    var role = SESSION && SESSION.user && SESSION.user.role;
    if (role !== 'Owner') return;
    var shell = el.querySelector('.crm-shell');
    if (!shell || document.getElementById('mpCard')) return;
    shell.insertAdjacentHTML('beforeend', kerangkaPoin());
    document.getElementById('mpTambah').onclick = function () { formRewardMarketing(null); };
    muatRewardMarketing();
    muatRiwayatMarketing();
  };
})();
