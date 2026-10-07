// public/js_marketing_poin.js
// UI: Marketing > Poin & Reward (khusus Owner)
//  - atur perolehan poin per cabang (rasio, pembulatan, minimal, pengganda, retur) + simulasi
//  - kelola reward penukaran poin per cabang (tambah, ubah, aktif/nonaktif)
//  - riwayat penukaran: reward poin + kupon promo dalam satu daftar
// Memakai Edge Function `promo` (promoApi): rewardList, rewardSave, rewardStatus, redemptionList,
// poinSettingGet, poinSettingSave, poinSimulasi.
// Menempel pada VIEWS.marketing milik Owner tanpa mengubah js_master.js.

(function () {
  if (typeof VIEWS === 'undefined' || !VIEWS.marketing) return;

  var REWARD_ROWS = [];
  var NAMA_TIER = { reguler: 'Reguler', silver: 'Silver', gold: 'Gold' };

  var NAMA_BULAT = { bawah: 'ke bawah', atas: 'ke atas', terdekat: 'ke terdekat' };
  var NAMA_BASIS = { harga_akhir: 'harga akhir setelah diskon', subtotal: 'subtotal sebelum diskon' };
  var NAMA_GABUNG = { tertinggi: 'Ambil yang tertinggi', kali: 'Dikalikan', jumlah: 'Dijumlahkan (dua pengganda 2x menjadi 3x)' };
  var TIPE_POIN = ['Umum', 'Tenaga Kesehatan', 'Apotek Lain'];
  var NAMA_HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  var POIN_STATE = null;

  function fmtF(n) { return String(Number(n)).replace('.', ','); }

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
      '<div><button id="mpAturPoin" class="btn">Atur perolehan poin</button> <button id="mpTambah" class="btn btn-primary">+ Reward</button></div></div>' +
      '<p id="mpPerolehan" class="sub" style="margin:0 0 12px">Memuat aturan perolehan poin…</p>' +
      '<h4 style="margin:0 0 8px">Daftar reward</h4><div id="mpReward"><div class="empty">Memuat reward…</div></div>' +
      '<h4 style="margin:16px 0 8px">Riwayat penukaran</h4><div id="mpRiwayat"><div class="empty">Memuat riwayat…</div></div>' +
      '</div>';
  }

  function ringkasPerolehan(c) {
    if (!c.aktif) return '<strong>Program poin nonaktif.</strong> Transaksi baru tidak menambah poin.';
    var ft = c.faktor_tipe || {};
    var tipe = TIPE_POIN.map(function (t) {
      var f = Number(ft[t]);
      return esc(t) + ': ' + (f === 0 ? 'tanpa poin' : fmtF(f) + 'x');
    }).join(' · ');
    var aktifPg = (c.pengganda || []).filter(function (x) { return x.aktif; }).length;
    var teks = 'Perolehan poin: <strong>' + angka(c.poin_per_kelipatan) + ' poin</strong> tiap ' + rupiah(c.rupiah_per_kelipatan) +
      ' dari ' + esc(NAMA_BASIS[c.basis_hitung] || '') + ', dibulatkan ' + esc(NAMA_BULAT[c.pembulatan] || '') + '. ' + tipe + '.';
    if (Number(c.min_belanja) > 0) teks += ' Minimal belanja ' + rupiah(c.min_belanja) + '.';
    if (c.maks_poin_per_transaksi) teks += ' Maksimal ' + angka(c.maks_poin_per_transaksi) + ' poin per transaksi.';
    if (aktifPg) teks += ' ' + aktifPg + ' pengganda aktif.';
    if (!c.retur_kurangi_poin) teks += ' Retur tidak mengurangi poin.';
    return teks;
  }

  function muatPerolehanPoin() {
    var box = document.getElementById('mpPerolehan');
    if (!box) return;
    promoApi('poinSettingGet', {}).then(function (res) {
      POIN_STATE = res;
      var info = res.tersimpan ? '' : ' <em>(pengaturan bawaan, belum pernah diubah)</em>';
      var r = (res.riwayat || [])[0];
      var akhir = r ? ' Terakhir diubah ' + esc(waktuIndo(r.disimpan_pada)) + ' oleh ' + esc(r.disimpan_oleh || '—') + '.' : '';
      box.innerHTML = ringkasPerolehan(res.cfg) + info + akhir;
    }).catch(function (e) {
      POIN_STATE = null;
      box.innerHTML = '<span style="color:#b00020">' + esc(e.message) + '</span>';
    });
  }

  function opsiPilihan(pasangan, terpilih) {
    return Object.keys(pasangan).map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === terpilih ? ' selected' : '') + '>' + esc(pasangan[k]) + '</option>';
    }).join('');
  }

  function barisPengganda(x) {
    var hari = NAMA_HARI.map(function (h, d) {
      var on = (x.hari || []).indexOf(d) >= 0;
      return '<label style="margin-right:8px"><input type="checkbox" class="mp-pg-hari" value="' + d + '"' + (on ? ' checked' : '') + '> ' + h + '</label>';
    }).join('');
    return '<div class="mp-pg" style="border:1px solid rgba(128,128,128,.35);border-radius:8px;padding:10px;margin-bottom:8px">' +
      '<label class="field"><span>Nama pengganda</span><input class="inp mp-pg-nama" maxlength="60" placeholder="Poin 2x hari Selasa" value="' + esc(x.nama) + '"></label>' +
      '<label class="field"><span>Faktor (x)</span><input class="inp mp-pg-faktor" type="number" min="0.01" max="100" step="0.01" value="' + esc(x.faktor) + '"></label>' +
      '<div class="field"><span>Hari berlaku (kosong = setiap hari)</span>' + hari + '</div>' +
      '<label class="field"><span>Mulai (opsional)</span><input class="inp mp-pg-mulai" type="date" value="' + esc(x.mulai || '') + '"></label>' +
      '<label class="field"><span>Selesai (opsional)</span><input class="inp mp-pg-selesai" type="date" value="' + esc(x.selesai || '') + '"></label>' +
      '<label><input type="checkbox" class="mp-pg-aktif"' + (x.aktif ? ' checked' : '') + '> Aktif</label> ' +
      '<button type="button" class="btn btn-sm mp-pg-hapus">Hapus</button></div>';
  }

  function gambarPengganda(list) {
    var box = document.getElementById('mpPgList');
    if (box) box.innerHTML = list.length ? list.map(barisPengganda).join('') : '<p class="sub">Belum ada pengganda.</p>';
  }

  function bacaPengganda() {
    var out = [];
    document.querySelectorAll('#mpPgList .mp-pg').forEach(function (el) {
      var hari = [];
      el.querySelectorAll('.mp-pg-hari:checked').forEach(function (c) { hari.push(Number(c.value)); });
      var it = {
        nama: el.querySelector('.mp-pg-nama').value.trim(),
        faktor: Number(el.querySelector('.mp-pg-faktor').value),
        aktif: el.querySelector('.mp-pg-aktif').checked
      };
      if (hari.length) it.hari = hari;
      var m = el.querySelector('.mp-pg-mulai').value, se = el.querySelector('.mp-pg-selesai').value;
      if (m) it.mulai = m;
      if (se) it.selesai = se;
      out.push(it);
    });
    return out;
  }

  function bacaFormPoin() {
    var cap = val('mpCap');
    return {
      aktif: val('mpAktif') === '1',
      basis_hitung: val('mpBasis'),
      rupiah_per_kelipatan: Number(val('mpRp')),
      poin_per_kelipatan: Number(val('mpPk')),
      pembulatan: val('mpBulat'),
      min_belanja: Number(val('mpMin') || 0),
      maks_poin_per_transaksi: cap === '' ? null : Number(cap),
      faktor_tipe: { 'Umum': Number(val('mpFUmum')), 'Tenaga Kesehatan': Number(val('mpFNakes')), 'Apotek Lain': Number(val('mpFApotek')) },
      gabung_pengganda: val('mpGabung'),
      pengganda: bacaPengganda(),
      retur_kurangi_poin: val('mpRetur') === '1'
    };
  }

  function tampilHasilSimulasi(d) {
    var t = '<strong>' + angka(d.poin) + ' poin</strong>';
    if (d.alasan) t += ' — ' + esc(d.alasan);
    if (d.kelipatan !== undefined && d.kelipatan !== null) {
      t += '<br>Dasar hitung ' + rupiah(d.basis) + ' → ' + angka(d.kelipatan) + ' kelipatan, poin dasar ' + angka(d.poin_dasar) +
        '; faktor tipe ' + fmtF(d.faktor_tipe) + 'x; faktor promo ' + fmtF(d.faktor_promo) + 'x';
      if (d.pengganda_terpakai && d.pengganda_terpakai.length) t += ' (' + d.pengganda_terpakai.map(esc).join(', ') + ')';
      if (d.dibatasi) t += '; dibatasi batas maksimal per transaksi';
      t += '.';
    }
    return t;
  }

  function formPerolehanPoin() {
    if (!POIN_STATE) { toast('Pengaturan poin belum termuat. Coba lagi sebentar.', true); return; }
    var c = POIN_STATE.cfg, ft = c.faktor_tipe || {};
    var hariIni = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    var opsiTipe = opsiPilihan({ 'Umum': 'Umum', 'Tenaga Kesehatan': 'Tenaga Kesehatan', 'Apotek Lain': 'Apotek Lain' }, 'Umum');
    var riwayat = (POIN_STATE.riwayat || []).map(function (r) {
      return '<li>' + esc(waktuIndo(r.disimpan_pada)) + ' — ' + esc(r.disimpan_oleh || '—') + '</li>';
    }).join('');
    modalBuka('Pengaturan perolehan poin',
      '<p class="sub">Berlaku untuk transaksi berikutnya di cabang aktif. Poin yang sudah diperoleh pelanggan tidak berubah.</p>' +
      '<h4 style="margin:8px 0">Program</h4>' +
      '<label class="field"><span>Status program</span><select id="mpAktif" class="inp">' + opsiPilihan({ '1': 'Aktif', '0': 'Nonaktif' }, c.aktif ? '1' : '0') + '</select></label>' +
      '<h4 style="margin:8px 0">Rumus perolehan</h4>' +
      '<label class="field"><span>Belanja per kelipatan (Rp)</span><input id="mpRp" class="inp" type="number" min="1" step="100" value="' + esc(c.rupiah_per_kelipatan) + '"></label>' +
      '<label class="field"><span>Poin yang didapat per kelipatan</span><input id="mpPk" class="inp" type="number" min="1" max="1000" step="1" value="' + esc(c.poin_per_kelipatan) + '"></label>' +
      '<label class="field"><span>Dasar hitung</span><select id="mpBasis" class="inp">' + opsiPilihan(NAMA_BASIS, c.basis_hitung) + '</select></label>' +
      '<label class="field"><span>Pembulatan kelipatan</span><select id="mpBulat" class="inp">' + opsiPilihan(NAMA_BULAT, c.pembulatan) + '</select></label>' +
      '<label class="field"><span>Minimal belanja per transaksi (Rp, 0 = tanpa minimal)</span><input id="mpMin" class="inp" type="number" min="0" step="500" value="' + esc(c.min_belanja) + '"></label>' +
      '<label class="field"><span>Batas poin per transaksi (kosong = tanpa batas)</span><input id="mpCap" class="inp" type="number" min="1" step="1" value="' + esc(c.maks_poin_per_transaksi === null || c.maks_poin_per_transaksi === undefined ? '' : c.maks_poin_per_transaksi) + '"></label>' +
      '<h4 style="margin:8px 0">Faktor per tipe pelanggan</h4>' +
      '<p class="sub">1 = normal, 0 = tidak mendapat poin, 0,5 = setengah, 2 = dua kali.</p>' +
      '<label class="field"><span>Umum</span><input id="mpFUmum" class="inp" type="number" min="0" max="100" step="0.01" value="' + esc(ft['Umum'] === undefined ? 1 : ft['Umum']) + '"></label>' +
      '<label class="field"><span>Tenaga Kesehatan</span><input id="mpFNakes" class="inp" type="number" min="0" max="100" step="0.01" value="' + esc(ft['Tenaga Kesehatan'] === undefined ? 0 : ft['Tenaga Kesehatan']) + '"></label>' +
      '<label class="field"><span>Apotek Lain</span><input id="mpFApotek" class="inp" type="number" min="0" max="100" step="0.01" value="' + esc(ft['Apotek Lain'] === undefined ? 0 : ft['Apotek Lain']) + '"></label>' +
      '<h4 style="margin:8px 0">Pengganda promo</h4>' +
      '<label class="field"><span>Bila beberapa pengganda berlaku bersamaan</span><select id="mpGabung" class="inp">' + opsiPilihan(NAMA_GABUNG, c.gabung_pengganda) + '</select></label>' +
      '<div id="mpPgList"></div><button type="button" id="mpPgTambah" class="btn btn-sm">+ Tambah pengganda</button>' +
      '<h4 style="margin:12px 0 8px">Retur</h4>' +
      '<label class="field"><span>Retur mengurangi poin</span><select id="mpRetur" class="inp">' + opsiPilihan({ '1': 'Ya', '0': 'Tidak' }, c.retur_kurangi_poin ? '1' : '0') + '</select></label>' +
      '<h4 style="margin:12px 0 8px">Simulasi</h4>' +
      '<p class="sub">Coba contoh belanja dengan pengaturan di atas (belum disimpan).</p>' +
      '<label class="field"><span>Tipe pelanggan</span><select id="mpSimTipe" class="inp">' + opsiTipe + '</select></label>' +
      '<label class="field"><span>Subtotal sebelum diskon (Rp, kosong = sama dengan harga akhir)</span><input id="mpSimSub" class="inp" type="number" min="0" step="500"></label>' +
      '<label class="field"><span>Harga akhir setelah diskon (Rp)</span><input id="mpSimHarga" class="inp" type="number" min="0" step="500" value="25000"></label>' +
      '<label class="field"><span>Tanggal transaksi</span><input id="mpSimTgl" class="inp" type="date" value="' + hariIni + '"></label>' +
      '<label><input id="mpSimRetur" type="checkbox"> Simulasikan retur (pengurangan poin)</label> ' +
      '<button type="button" id="mpSimBtn" class="btn btn-sm">Hitung poin</button>' +
      '<div id="mpSimHasil" class="sub" style="margin-top:8px"></div>' +
      (riwayat ? '<h4 style="margin:12px 0 8px">Riwayat perubahan</h4><ul class="sub" style="margin:0;padding-left:18px">' + riwayat + '</ul>' : ''),
      [{ label: 'Batal', aksi: modalTutup },
       { label: 'Simpan', kelas: 'btn-primary', aksi: function () {
         var cfg = bacaFormPoin();
         if (!cfg.aktif && !window.confirm('Program poin akan dinonaktifkan. Transaksi baru tidak akan menambah poin. Lanjutkan?')) return;
         promoApi('poinSettingSave', cfg)
           .then(function () { modalTutup(); toast('Pengaturan perolehan poin tersimpan.'); muatPerolehanPoin(); })
           .catch(function (e) { toast(e.message, true); });
       } }]);
    gambarPengganda(c.pengganda || []);
    document.getElementById('modalBody').onclick = function (e) {
      if (e.target.closest('#mpPgTambah')) {
        var daftar = bacaPengganda();
        daftar.push({ nama: '', faktor: 2, aktif: true });
        gambarPengganda(daftar);
        return;
      }
      var h = e.target.closest('.mp-pg-hapus');
      if (h) { var kartu = h.closest('.mp-pg'); if (kartu) kartu.remove(); return; }
      if (e.target.closest('#mpSimBtn')) {
        var hasil = document.getElementById('mpSimHasil');
        hasil.textContent = 'Menghitung…';
        promoApi('poinSimulasi', {
          cfg: bacaFormPoin(), tipe_customer: val('mpSimTipe'), harga_akhir: Number(val('mpSimHarga') || 0),
          subtotal: val('mpSimSub') === '' ? undefined : Number(val('mpSimSub')),
          tanggal: val('mpSimTgl') || undefined, retur: document.getElementById('mpSimRetur').checked
        }).then(function (d) { hasil.innerHTML = tampilHasilSimulasi(d); })
          .catch(function (err) { hasil.textContent = err.message; });
      }
    };
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
    document.getElementById('mpAturPoin').onclick = formPerolehanPoin;
    muatPerolehanPoin();
    muatRewardMarketing();
    muatRiwayatMarketing();
  };
})();
