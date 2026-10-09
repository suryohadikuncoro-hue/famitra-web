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
  // Jenis reward (loyalty_rewards.reward_type). Hanya `discount` yang mengurangi
  // harga jual; `service` dan `free_product` hanya dicatat nilai manfaatnya
  // untuk laporan. Bawaan `discount` supaya reward lama tetap berperilaku sama.
  var JENIS_REWARD = {
    discount: 'Diskon potongan harga',
    service: 'Layanan gratis (mis. cek tensi)',
    free_product: 'Produk non farmasi gratis'
  };
  var NAMA_JENIS_REWARD = { discount: 'Diskon', service: 'Layanan', free_product: 'Produk non farmasi' };
  var LABEL_NILAI_REWARD = {
    discount: 'Nilai potongan (Rp)',
    service: 'Nilai manfaat (Rp, untuk laporan)',
    free_product: 'Nilai manfaat (Rp, untuk laporan)'
  };

  /** Jenis reward yang sah; nilai tak dikenal dianggap `discount` (perilaku lama). */
  function jenisReward_(r) {
    var j = String((r && r.reward_type) || '');
    return JENIS_REWARD[j] ? j : 'discount';
  }

  function labelNilaiReward_(jenis) {
    return LABEL_NILAI_REWARD[jenis] || LABEL_NILAI_REWARD.discount;
  }

  var NAMA_BULAT = { bawah: 'ke bawah', atas: 'ke atas', terdekat: 'ke terdekat' };
  var NAMA_BASIS = { harga_akhir: 'harga akhir setelah diskon', subtotal: 'subtotal sebelum diskon' };
  var NAMA_MASA = { bulan: 'X bulan sejak diperoleh', selamanya: 'tidak pernah hangus', akhir_tahun: 'hangus 31 Desember tahun berikutnya' };
  var NAMA_MASA_PENDEK = { bulan: 'X bulan', selamanya: 'tidak pernah hangus', akhir_tahun: 'akhir tahun berikutnya' };
  var NAMA_GABUNG = { tertinggi: 'Ambil yang tertinggi', kali: 'Dikalikan', jumlah: 'Dijumlahkan (dua pengganda 2x menjadi 3x)' };
  var TIPE_POIN = ['Umum', 'Tenaga Kesehatan', 'Apotek Lain'];
  // Bawaan faktor penukaran (nilai potongan), sama dengan loyalty_cfg_default():
  // 1 = penuh, 0,5 = setengah, 0 = tipe itu tidak boleh menukar.
  var BAWAAN_TUKAR = { 'Umum': 1, 'Tenaga Kesehatan': 0.5, 'Apotek Lain': 0 };
  var NAMA_HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  var POIN_STATE = null;
  var TK_CARI = [];

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
    var modeMasa = String(c.masa_berlaku_mode || 'bulan');
    teks += ' Masa berlaku poin: ' + esc(modeMasa === 'bulan'
      ? angka(c.masa_berlaku_bulan || 12) + ' bulan sejak diperoleh'
      : (NAMA_MASA_PENDEK[modeMasa] || modeMasa)) + '.';
    // Aturan penukaran reward (faktor hanya mengubah nilai potongan rupiah,
    // bukan jumlah poin yang dipotong).
    var ftTukar = c.faktor_tipe_tukar || {};
    var tipeTukar = TIPE_POIN.map(function (t) {
      var v = ftTukar[t];
      var f = Number(v === undefined || v === null || v === '' ? BAWAAN_TUKAR[t] : v);
      return esc(t) + ' ' + (f === 0 ? 'tidak bisa' : fmtF(f) + 'x');
    }).join(', ');
    teks += ' Penukaran poin: ' + tipeTukar + '.';
    if (Number(c.min_poin_tukar) > 0) teks += ' Minimal saldo ' + angka(c.min_poin_tukar) + ' poin untuk bisa menukar.';
    if (Number(c.maks_persen_tukar) < 100) teks += ' Nilai penukaran dibatasi ' + fmtF(c.maks_persen_tukar) + '% dari nilai transaksi.';
    if (Number(c.maks_tukar_per_hari) > 0) teks += ' Maksimal ' + angka(c.maks_tukar_per_hari) + ' penukaran per pelanggan per hari.';
    if (Number(c.maks_tukar_per_bulan) > 0) teks += ' Maksimal ' + angka(c.maks_tukar_per_bulan) + ' penukaran per pelanggan per bulan.';
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
    // Faktor penukaran: kolom yang dikosongkan memakai bawaan, bukan 0, supaya
    // tidak ada tipe yang diam-diam kehilangan hak menukar karena salah kosong.
    var faktorInput = function (id, baku) { var s = val(id); return s === '' ? baku : Number(s); };
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
      retur_kurangi_poin: val('mpRetur') === '1',
      masa_berlaku_mode: val('mpMasa'),
      masa_berlaku_bulan: Number(val('mpMasaBulan') || 12),
      faktor_tipe_tukar: { 'Umum': faktorInput('mpTkUmum', BAWAAN_TUKAR['Umum']), 'Tenaga Kesehatan': faktorInput('mpTkNakes', BAWAAN_TUKAR['Tenaga Kesehatan']), 'Apotek Lain': faktorInput('mpTkApotek', BAWAAN_TUKAR['Apotek Lain']) },
      min_poin_tukar: Number(val('mpTkMin') || 0),
      maks_persen_tukar: Number(val('mpTkPersen') || 100),
      maks_tukar_per_hari: Number(val('mpTkHari') || 0),
      maks_tukar_per_bulan: Number(val('mpTkBulan') || 0)
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

  function tampilHasilSimulasiTukar(d, subtotal, diskon) {
    var catatan = '<p style="margin:6px 0 0"><em>Hanya simulasi — tidak ada data yang diubah.</em></p>';
    if (!d.boleh) {
      return '<span style="color:#b00020"><strong>Tidak boleh ditukar.</strong> ' + esc(d.alasan || 'Penukaran tidak memenuhi syarat.') + '</span>' + catatan;
    }
    // `jenis` dari server (default discount bila server belum mengirimnya).
    var jenis = d.jenis && JENIS_REWARD[d.jenis] ? d.jenis : 'discount';
    var potongan = Number(d.nilai_penukaran || 0);
    var manfaat = Number(d.nilai_manfaat === undefined || d.nilai_manfaat === null ? d.nilai_reward : d.nilai_manfaat);
    var akhir = Math.max(0, Number(subtotal || 0) - Number(diskon || 0) - potongan);
    var barisJenis = '<br>Jenis reward: <strong>' + esc(NAMA_JENIS_REWARD[jenis]) + '</strong> (' + esc(JENIS_REWARD[jenis]) + ')';
    var barisPoin = '<br>Poin yang dipotong: ' + angka(d.poin_dibutuhkan) + ' poin, sisa poin ' + angka(d.sisa_setelah) + ' (saldo ' + angka(d.poin_tersedia) + ')';
    if (jenis !== 'discount') {
      // Layanan / produk non farmasi: harga jual TIDAK berkurang. Yang tercatat
      // hanya nilai manfaatnya untuk laporan (ROI/ROAS), bukan penghematan harga.
      return '<strong style="color:#0a7d33">Boleh ditukar.</strong>' + barisJenis +
        '<br>Nilai manfaat: <strong>' + rupiah(manfaat) + '</strong>' +
        ' (nilai reward ' + rupiah(d.nilai_reward) + ')' +
        '<br><strong>Harga jual tidak berkurang.</strong> Yang dicatat hanya nilai manfaat ' +
        rupiah(manfaat) + ' untuk laporan, bukan potongan harga.' +
        barisPoin +
        '<br>Harga akhir (tanpa potongan reward): <strong>' + rupiah(akhir) + '</strong>' +
        catatan;
    }
    return '<strong style="color:#0a7d33">Boleh ditukar.</strong>' + barisJenis +
      '<br>Nilai potongan: <strong>' + rupiah(potongan) + '</strong>' +
      ' (nilai reward ' + rupiah(d.nilai_reward) + ' × faktor ' + fmtF(d.faktor_tipe) + 'x untuk tipe ' + esc(d.tipe_customer) + ')' +
      barisPoin +
      '<br>Harga akhir setelah potongan: <strong>' + rupiah(akhir) + '</strong>' +
      (Number(d.maks_persen) < 100 ? ' (batas ' + fmtF(d.maks_persen) + '% dari nilai transaksi)' : '') +
      catatan;
  }

  function muatRewardTukar() {
    var sel = document.getElementById('mpTkReward');
    if (!sel) return;
    var isi = function (rows) {
      sel.innerHTML = '<option value="">— pilih reward —</option>' + (rows || []).map(function (r) {
        return '<option value="' + esc(r.id) + '">' + esc(r.name) + ' — ' + angka(r.points_required) + ' poin · ' + rupiah(r.reward_value) +
          (r.is_active ? '' : ' (nonaktif)') + '</option>';
      }).join('');
    };
    // Pakai daftar yang sudah dimuat kartu utama bila ada supaya tidak memanggil ulang.
    if (REWARD_ROWS.length) { isi(REWARD_ROWS); return; }
    promoApi('rewardList', {}).then(isi).catch(function (e) {
      sel.innerHTML = '<option value="">' + esc(e.message) + '</option>';
    });
  }

  function formPerolehanPoin() {
    if (!POIN_STATE) { toast('Pengaturan poin belum termuat. Coba lagi sebentar.', true); return; }
    var c = POIN_STATE.cfg, ft = c.faktor_tipe || {};
    // Kolom penukaran bisa saja belum ada di baris lama; pakai bawaan bila kosong.
    var ftTukar = c.faktor_tipe_tukar || {};
    var faktorTukar = function (t) {
      var v = ftTukar[t];
      return (v === undefined || v === null || v === '') ? BAWAAN_TUKAR[t] : v;
    };
    var angkaTukar = function (v, baku) {
      return (v === undefined || v === null || v === '' || !isFinite(Number(v))) ? baku : Number(v);
    };
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
      '<h4 style="margin:12px 0 8px">Masa berlaku poin</h4>' +
      '<p class="sub">Poin hangus dengan urutan <strong>FIFO</strong>: poin yang paling dulu diperoleh dipakai lebih dulu, ' +
        'sehingga poin yang sudah ditukar reward <strong>tidak</strong> ikut hangus.</p>' +
      '<label class="field"><span>Masa berlaku</span><select id="mpMasa" class="inp">' + opsiPilihan(NAMA_MASA, c.masa_berlaku_mode || 'bulan') + '</select></label>' +
      '<label class="field"><span>Lama berlaku (bulan, hanya bila memilih X bulan)</span><input id="mpMasaBulan" class="inp" type="number" min="1" max="120" step="1" value="' + esc(c.masa_berlaku_bulan || 12) + '"></label>' +
      '<p class="sub">Perubahan pengaturan ini berlaku untuk pemeriksaan berikutnya. Poin yang sudah diperoleh pelanggan tidak berubah saat menyimpan.</p>' +
      '<button type="button" id="mpDryBtn" class="btn btn-sm">Lihat uji kering kedaluwarsa</button>' +
      '<div id="mpDryHasil" class="sub" style="margin-top:8px"></div>' +
      '<h4 style="margin:12px 0 8px">Penukaran reward</h4>' +
      '<p class="sub">Poin yang dipotong pelanggan <strong>selalu sebesar poin milik reward</strong>. ' +
        'Faktor di bawah hanya mengubah <strong>nilai potongan rupiah</strong>, bukan jumlah poin: ' +
        '1 = penuh, 0,5 = setengah nilai, 0 = tipe itu tidak boleh menukar poin.</p>' +
      '<label class="field"><span>Faktor nilai potongan — Umum</span><input id="mpTkUmum" class="inp" type="number" min="0" max="100" step="0.01" value="' + esc(faktorTukar('Umum')) + '"></label>' +
      '<label class="field"><span>Faktor nilai potongan — Tenaga Kesehatan</span><input id="mpTkNakes" class="inp" type="number" min="0" max="100" step="0.01" value="' + esc(faktorTukar('Tenaga Kesehatan')) + '"></label>' +
      '<label class="field"><span>Faktor nilai potongan — Apotek Lain</span><input id="mpTkApotek" class="inp" type="number" min="0" max="100" step="0.01" value="' + esc(faktorTukar('Apotek Lain')) + '"></label>' +
      '<label class="field"><span>Minimal saldo poin untuk menukar (0 = tanpa minimal)</span><input id="mpTkMin" class="inp" type="number" min="0" max="1000000" step="1" value="' + esc(angkaTukar(c.min_poin_tukar, 0)) + '"></label>' +
      '<label class="field"><span>Batas nilai transaksi yang boleh dibayar dengan poin (%, 100 = tanpa batas tambahan)</span><input id="mpTkPersen" class="inp" type="number" min="1" max="100" step="0.01" value="' + esc(angkaTukar(c.maks_persen_tukar, 100)) + '"></label>' +
      '<label class="field"><span>Batas penukaran per pelanggan per hari (0 = tanpa batas)</span><input id="mpTkHari" class="inp" type="number" min="0" max="1000" step="1" value="' + esc(angkaTukar(c.maks_tukar_per_hari, 0)) + '"></label>' +
      '<label class="field"><span>Batas penukaran per pelanggan per bulan (0 = tanpa batas)</span><input id="mpTkBulan" class="inp" type="number" min="0" max="10000" step="1" value="' + esc(angkaTukar(c.maks_tukar_per_bulan, 0)) + '"></label>' +
      '<h4 style="margin:12px 0 8px">Simulasi</h4>' +
      '<p class="sub">Coba contoh belanja dengan pengaturan di atas (belum disimpan).</p>' +
      '<label class="field"><span>Tipe pelanggan</span><select id="mpSimTipe" class="inp">' + opsiTipe + '</select></label>' +
      '<label class="field"><span>Subtotal sebelum diskon (Rp, kosong = sama dengan harga akhir)</span><input id="mpSimSub" class="inp" type="number" min="0" step="500"></label>' +
      '<label class="field"><span>Harga akhir setelah diskon (Rp)</span><input id="mpSimHarga" class="inp" type="number" min="0" step="500" value="25000"></label>' +
      '<label class="field"><span>Tanggal transaksi</span><input id="mpSimTgl" class="inp" type="date" value="' + hariIni + '"></label>' +
      '<label><input id="mpSimRetur" type="checkbox"> Simulasikan retur (pengurangan poin)</label> ' +
      '<button type="button" id="mpSimBtn" class="btn btn-sm">Hitung poin</button>' +
      '<div id="mpSimHasil" class="sub" style="margin-top:8px"></div>' +
      '<h4 style="margin:12px 0 8px">Simulasi penukaran</h4>' +
      '<p class="sub">Uji satu reward dengan pengaturan penukaran yang <strong>tersimpan</strong> di cabang ini (simpan dulu perubahan di atas bila ingin angkanya ikut berubah). Angkanya memakai fungsi yang sama dengan kasir, jadi hasilnya sama dengan yang berlaku saat transaksi.</p>' +
      '<label class="field"><span>Nomor WA pelanggan</span><input id="mpTkWA" class="inp" placeholder="08xx atau 628xx"></label>' +
      '<button type="button" id="mpTkCari" class="btn btn-sm">Cari pelanggan</button>' +
      '<div id="mpTkHasilCari" class="sub" style="margin-top:8px"></div>' +
      '<p class="sub" style="margin:6px 0 0">Catatan: pencarian pelanggan memakai daftar pelanggan cabang aktif dan sekaligus menjalankan pemeriksaan kedaluwarsa poin otomatis (sama seperti halaman Pelanggan). Hasil simulasi penukaran sendiri tidak mengubah saldo poin siapa pun.</p>' +
      '<label class="field"><span>Reward</span><select id="mpTkReward" class="inp"><option value="">Memuat reward…</option></select></label>' +
      '<label class="field"><span>Subtotal transaksi (Rp)</span><input id="mpTkSubtotal" class="inp" type="number" min="0" step="500" value="25000"></label>' +
      '<label class="field"><span>Diskon manual (Rp, kosong = 0)</span><input id="mpTkDiskon" class="inp" type="number" min="0" step="500"></label>' +
      '<button type="button" id="mpTkHitung" class="btn btn-sm">Hitung penukaran</button>' +
      '<div id="mpTkHasil" class="sub" style="margin-top:8px"></div>' +
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
    muatRewardTukar();
    document.getElementById('modalBody').onclick = function (e) {
      if (e.target.closest('#mpPgTambah')) {
        var daftar = bacaPengganda();
        daftar.push({ nama: '', faktor: 2, aktif: true });
        gambarPengganda(daftar);
        return;
      }
      var h = e.target.closest('.mp-pg-hapus');
      if (h) { var kartu = h.closest('.mp-pg'); if (kartu) kartu.remove(); return; }
      if (e.target.closest('#mpDryBtn')) {
        // Uji kering: hanya membaca, tidak mengubah saldo siapa pun.
        var boxDry = document.getElementById('mpDryHasil');
        if (!boxDry) return;
        boxDry.textContent = 'Menghitung…';
        promoApi('poinKedaluwarsaRingkasan', {}).then(function (d) {
          var modeTeks = d.mode === 'bulan' ? angka(d.bulan) + ' bulan sejak diperoleh' : (NAMA_MASA[d.mode] || d.mode);
          if (!d.baris || !d.baris.length) {
            boxDry.innerHTML = '<strong>Tidak ada poin yang akan hangus.</strong> Masa berlaku sekarang: ' + esc(modeTeks) + '.';
            return;
          }
          var baris = d.baris.slice(0, 20).map(function (x) {
            return '<tr><td>' + esc(x.nama) + (x.saldo_cukup ? '' : ' <span class="chip chip-bad">saldo tidak sinkron</span>') + '</td>' +
              '<td class="r num">' + angka(x.saldo) + '</td>' +
              '<td class="r num">' + angka(x.akan_hangus) + '</td>' +
              '<td>' + (x.kedaluwarsa_terawal ? tglIndo(x.kedaluwarsa_terawal) : '—') + '</td></tr>';
          }).join('');
          boxDry.innerHTML = '<strong>Uji kering:</strong> ' + angka(d.total_akan_hangus) + ' poin dari ' +
            angka(d.jumlah_pelanggan) + ' pelanggan akan hangus. Masa berlaku: ' + esc(modeTeks) + '.' +
            (d.jumlah_saldo_kurang ? '<br><span style="color:#b00020">' + angka(d.jumlah_saldo_kurang) +
              ' pelanggan saldonya tidak sinkron dengan buku mutasi. Saldonya TIDAK akan diubah dan perlu pemeriksaan manual.</span>' : '') +
            '<div class="table-wrap" style="margin-top:6px"><table><thead><tr><th>Pelanggan</th><th class="r">Saldo</th>' +
            '<th class="r">Akan hangus</th><th>Hangus sejak</th></tr></thead><tbody>' + baris + '</tbody></table></div>' +
            (d.baris.length > 20 ? '<p style="margin:6px 0 0">Menampilkan 20 teratas dari ' + angka(d.baris.length) + ' pelanggan.</p>' : '') +
            '<p style="margin:6px 0 0"><strong>Tidak ada data yang diubah.</strong> Penghangusan berjalan otomatis saat halaman Pelanggan dibuka, dan dicatat di buku mutasi poin.</p>';
        }).catch(function (er) {
          boxDry.innerHTML = '<span style="color:#b00020">' + esc(er.message) + '</span>';
        });
        return;
      }
      if (e.target.closest('#mpSimBtn')) {
        var hasil = document.getElementById('mpSimHasil');
        hasil.textContent = 'Menghitung…';
        promoApi('poinSimulasi', {
          cfg: bacaFormPoin(), tipe_customer: val('mpSimTipe'), harga_akhir: Number(val('mpSimHarga') || 0),
          subtotal: val('mpSimSub') === '' ? undefined : Number(val('mpSimSub')),
          tanggal: val('mpSimTgl') || undefined, retur: document.getElementById('mpSimRetur').checked
        }).then(function (d) { hasil.innerHTML = tampilHasilSimulasi(d); })
          .catch(function (err) { hasil.textContent = err.message; });
        return;
      }
      if (e.target.closest('#mpTkCari')) {
        var boxCari = document.getElementById('mpTkHasilCari');
        boxCari.textContent = 'Mencari…';
        TK_CARI = [];
        // `api` = Edge Function `api` (router utama), bukan promoApi.
        api('crm.list', { q: val('mpTkWA'), tipe: 'Semua' }).then(function (rows) {
          TK_CARI = rows || [];
          if (!TK_CARI.length) { boxCari.innerHTML = '<span style="color:#b00020">Pelanggan tidak ditemukan di cabang aktif.</span>'; return; }
          boxCari.innerHTML = '<div class="pos-reward-list">' + TK_CARI.slice(0, 20).map(function (x, i) {
            return '<div class="pos-reward-item"><div><strong>' + esc(x.Nama || 'Tanpa nama') + '</strong>' +
              '<span>' + esc(x.Nomor_WA || '—') + ' · ' + angka(x.Total_Points) + ' poin · ' + esc(x.Tipe_Customer || 'Umum') + '</span></div>' +
              '<button type="button" class="btn btn-sm" data-mp-tkwa="' + i + '">Pilih</button></div>';
          }).join('') + '</div>' +
            (TK_CARI.length > 20 ? '<p class="sub" style="margin:6px 0 0">Menampilkan 20 teratas dari ' + angka(TK_CARI.length) + ' pelanggan.</p>' : '');
        }).catch(function (er) {
          boxCari.innerHTML = '<span style="color:#b00020">' + esc(er.message) + '</span>';
        });
        return;
      }
      var pilihTk = e.target.closest('[data-mp-tkwa]');
      if (pilihTk) {
        var cust = TK_CARI[Number(pilihTk.dataset.mpTkwa)];
        if (!cust) return;
        document.getElementById('mpTkWA').value = cust.Nomor_WA || '';
        document.getElementById('mpTkHasilCari').innerHTML = 'Terpilih: <strong>' + esc(cust.Nama || 'Tanpa nama') + '</strong> · ' +
          esc(cust.Nomor_WA || '—') + ' · saldo ' + angka(cust.Total_Points) + ' poin · tipe ' + esc(cust.Tipe_Customer || 'Umum') +
          ' · tier ' + esc(cust.Tier || 'reguler');
        return;
      }
      if (e.target.closest('#mpTkHitung')) {
        var boxTukar = document.getElementById('mpTkHasil');
        var rewardTukar = val('mpTkReward');
        var subtotalTukar = Number(val('mpTkSubtotal') || 0);
        var diskonTukar = val('mpTkDiskon') === '' ? 0 : Number(val('mpTkDiskon'));
        if (!rewardTukar) { boxTukar.innerHTML = '<span style="color:#b00020">Pilih reward yang mau disimulasikan.</span>'; return; }
        boxTukar.textContent = 'Menghitung…';
        promoApi('poinTukarSimulasi', { reward_id: rewardTukar, nomor_wa: val('mpTkWA'), subtotal: subtotalTukar, diskon: diskonTukar })
          .then(function (d) { boxTukar.innerHTML = tampilHasilSimulasiTukar(d, subtotalTukar, diskonTukar); })
          .catch(function (err) { boxTukar.innerHTML = '<span style="color:#b00020">' + esc(err.message) + '</span>'; });
        return;
      }
    };
  }

  function muatRewardMarketing() {
    var box = document.getElementById('mpReward');
    if (!box) return;
    promoApi('rewardList', {}).then(function (rows) {
      REWARD_ROWS = rows || [];
      if (!REWARD_ROWS.length) { box.innerHTML = '<div class="empty">Belum ada reward di cabang ini. Klik “+ Reward” untuk membuat.</div>'; return; }
      box.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Reward</th><th>Jenis</th><th class="r">Poin</th><th class="r">Nilai</th><th>Tier min.</th><th>Status</th><th></th></tr></thead><tbody>' +
        REWARD_ROWS.map(function (r) {
          var jenis = jenisReward_(r);
          return '<tr><td><strong>' + esc(r.name) + '</strong></td>' +
            '<td><span class="chip">' + esc(NAMA_JENIS_REWARD[jenis]) + '</span></td>' +
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
    var jenis = jenisReward_(r);
    var opsiTier = ['reguler', 'silver', 'gold'].map(function (t) {
      return '<option value="' + t + '"' + (r.min_tier === t ? ' selected' : '') + '>' + NAMA_TIER[t] + '</option>';
    }).join('');
    modalBuka(ubah ? 'Ubah reward' : 'Reward baru',
      '<label class="field"><span>Nama reward</span><input id="mpNama" class="inp" placeholder="Diskon Rp5.000" value="' + esc(r.name) + '"></label>' +
      '<label class="field"><span>Jenis reward</span><select id="mpRwJenis" class="inp">' + opsiPilihan(JENIS_REWARD, jenis) + '</select></label>' +
      '<p class="sub">Hanya <strong>diskon potongan harga</strong> yang mengurangi harga jual. ' +
        'Layanan gratis dan produk non farmasi gratis tidak mengurangi harga jual; nilainya dicatat sebagai manfaat untuk laporan.</p>' +
      '<label class="field"><span>Poin yang dibutuhkan</span><input id="mpPoin" class="inp" type="number" min="1" step="1" value="' + esc(r.points_required) + '"></label>' +
      '<label class="field"><span id="mpRwNilaiLabel">' + esc(labelNilaiReward_(jenis)) + '</span><input id="mpNilai" class="inp" type="number" min="1" step="500" value="' + esc(r.reward_value) + '"></label>' +
      '<label class="field"><span>Tier minimum pelanggan</span><select id="mpTier" class="inp">' + opsiTier + '</select></label>' +
      '<p class="sub">Perubahan berlaku untuk penukaran berikutnya. Riwayat penukaran yang sudah terjadi tidak berubah.</p>',
      [{ label: 'Batal', aksi: modalTutup },
       { label: 'Simpan', kelas: 'btn-primary', aksi: function () {
         var p = { id: ubah ? r.id : undefined, name: val('mpNama'), reward_type: val('mpRwJenis') || 'discount', points_required: Number(val('mpPoin')), reward_value: Number(val('mpNilai')), min_tier: val('mpTier') };
         promoApi('rewardSave', p).then(function () { modalTutup(); toast('Reward tersimpan.'); muatRewardMarketing(); })
           .catch(function (e) { toast(e.message, true); });
       } }]);
    // Label nilai mengikuti jenis. Hanya teks label yang diganti, angka yang
    // sudah diketik kasir/Owner tidak dihapus.
    var selJenis = document.getElementById('mpRwJenis');
    if (selJenis) selJenis.onchange = function () {
      var lbl = document.getElementById('mpRwNilaiLabel');
      if (lbl) lbl.textContent = labelNilaiReward_(this.value);
    };
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
