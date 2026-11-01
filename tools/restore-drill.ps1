<#
  restore-drill.ps1 - Uji bahwa berkas backup benar-benar bisa dipulihkan.

  Cara kerja: backup di-restore ke database Postgres SEMENTARA di dalam Docker
  lokal (port 55432, container sekali pakai). Database production TIDAK disentuh
  sama sekali. Setelah restore, jumlah baris setiap tabel dibandingkan dengan
  manifest.json milik backup tersebut.

  Ini yang membedakan "sudah punya berkas" dari "sudah punya backup".

  Pemakaian:
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\restore-drill.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\restore-drill.ps1 -Folder C:\Users\User\backup-famitra\2026-10-31_2210
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\restore-drill.ps1 -Port 55433

  Parameter:
    -Folder  Folder backup yang diuji. Default: backup terbaru di -Tujuan.
    -Tujuan  Folder induk backup. Default C:\Users\User\backup-famitra
    -Port    Port host untuk Postgres sementara. Default 55432
    -Image   Image Docker Postgres. Default dideteksi dari versi server di dump.
    -Biarkan Container tidak dihapus setelah uji (untuk diperiksa manual).
#>
[CmdletBinding()]
param(
  [string]$Folder,
  [string]$Tujuan = 'C:\Users\User\backup-famitra',
  [int]$Port = 55432,
  [string]$Image,
  [switch]$Biarkan
)

$ErrorActionPreference = 'Stop'
function Tulis($pesan) { Write-Host $pesan }

function JalankanProgram([string]$program, [string[]]$argumen) {
  $eap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $keluaran = & $program @argumen 2>&1
    $kode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $eap
  }
  return [pscustomobject]@{ kode = $kode; keluaran = @($keluaran) }
}

function PastikanDocker {
  if ((JalankanProgram 'docker' @('info', '--format', '{{.ServerVersion}}')).kode -ne 0) {
    throw 'Docker tidak berjalan. Nyalakan Docker Desktop dulu (uji restore butuh Postgres sementara di Docker).'
  }
}

# ------------------------------------------------------------------ pilih backup
if (-not $Folder) {
  if (-not (Test-Path $Tujuan)) { throw "Folder backup belum ada: $Tujuan" }
  $kandidat = Get-ChildItem $Tujuan -Directory | Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}_\d{4}$' } | Sort-Object Name -Descending
  if (-not $kandidat) { throw "Belum ada backup di $Tujuan. Jalankan dulu tools\backup-famitra.cmd" }
  $Folder = $kandidat[0].FullName
}
if (-not (Test-Path $Folder)) { throw "Folder backup tidak ada: $Folder" }

$berkasWajib = @('schema.sql', 'data.sql', 'manifest.json')
foreach ($b in $berkasWajib) {
  if (-not (Test-Path (Join-Path $Folder $b))) { throw "Berkas wajib tidak ada: $b (di $Folder)" }
}
Tulis "Backup yang diuji: $Folder"

$manifest = Get-Content (Join-Path $Folder 'manifest.json') -Raw | ConvertFrom-Json
Tulis "Dibuat         : $($manifest.waktu)"
Tulis "Tabel tercatat : $($manifest.jumlah_tabel)"

# ------------------------------------------------------------------ versi & image
if (-not $Image) {
  $p = Select-String -Path (Join-Path $Folder 'schema.sql') -Pattern 'Dumped from database version (\d+)' -List
  if ($p -and $p.Matches) { $versi = $p.Matches.Groups[1].Value } else { $versi = '15' }
  $Image = "postgres:$versi-alpine"
}
Tulis "Image Docker   : $Image"

PastikanDocker

# ------------------------------------------------------------------ jalankan container
$nama = 'famitra-drill-' + (Get-Date -Format 'HHmmss')
Tulis "Menyalakan Postgres sementara ($nama)..."
$run = JalankanProgram 'docker' @('run', '-d', '--name', $nama, '-e', 'POSTGRES_PASSWORD=drill', '-p', "127.0.0.1:${Port}:5432", $Image)
if ($run.kode -ne 0) { $run.keluaran | ForEach-Object { Write-Host "  $_" }; throw 'Gagal menyalakan container Postgres.' }

$lulus = $false
try {
  $siap = $false
  for ($i = 1; $i -le 60; $i++) {
    $cek = JalankanProgram 'docker' @('exec', $nama, 'pg_isready', '-U', 'postgres')
    if ($cek.kode -eq 0) { $siap = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $siap) { throw 'Postgres sementara tidak siap setelah 2 menit.' }
  Tulis 'Postgres sementara siap.'

  # -------------------------------------------------------------- restore
  Tulis 'Menyalin berkas dump ke container...'
  foreach ($b in @('roles.sql', 'schema.sql', 'data.sql')) {
    $sumber = Join-Path $Folder $b
    if (Test-Path $sumber) {
      $cp = JalankanProgram 'docker' @('cp', $sumber, "${nama}:/tmp/$b")
      if ($cp.kode -ne 0) { throw "Gagal menyalin $b ke container." }
    }
  }

  $db = 'drill'
  JalankanProgram 'docker' @('exec', $nama, 'psql', '-U', 'postgres', '-c', "DROP DATABASE IF EXISTS $db") | Out-Null
  $buat = JalankanProgram 'docker' @('exec', $nama, 'psql', '-U', 'postgres', '-c', "CREATE DATABASE $db")
  if ($buat.kode -ne 0) { $buat.keluaran | ForEach-Object { Write-Host "  $_" }; throw 'Gagal membuat database drill.' }

  # roles.sql boleh gagal sebagian (role platform sudah ada / tidak boleh dibuat ulang).
  Tulis 'Restore roles (galat role platform diabaikan)...'
  JalankanProgram 'docker' @('exec', $nama, 'psql', '-U', 'postgres', '-d', $db, '-q', '-f', '/tmp/roles.sql') | Out-Null

  Tulis 'Restore skema...'
  $skema = JalankanProgram 'docker' @('exec', $nama, 'psql', '-U', 'postgres', '-d', $db, '-q', '-f', '/tmp/schema.sql')
  $galatSkema = @($skema.keluaran | Where-Object { $_ -match '^psql:|ERROR:' })
  Tulis ("  skema: {0} galat" -f $galatSkema.Count)

  Tulis 'Restore data...'
  $data = JalankanProgram 'docker' @('exec', $nama, 'psql', '-U', 'postgres', '-d', $db, '-q', '-f', '/tmp/data.sql')
  $galatData = @($data.keluaran | Where-Object { $_ -match '^psql:|ERROR:' })
  Tulis ("  data : {0} galat" -f $galatData.Count)
  if ($galatData.Count -gt 0) {
    Tulis '  contoh galat data (maks 5):'
    $galatData | Select-Object -First 5 | ForEach-Object { Write-Host "    $_" }
  }

  # -------------------------------------------------------------- verifikasi jumlah baris
  Tulis ''
  Tulis 'Membandingkan jumlah baris dengan manifest...'
  $beda = @()
  $sama = 0
  $skipPlatform = 0
  $semuaKunci = @($manifest.baris_per_tabel.PSObject.Properties)
  foreach ($kunci in $semuaKunci) {
    $tabel = $kunci.Name
    $harap = [int64]$kunci.Value
    $bagian = $tabel.Split('.')
    if ($bagian[0] -in @('auth', 'storage')) { $skipPlatform++; continue }
    $sql = 'SELECT count(*) FROM "' + $bagian[0] + '"."' + $bagian[1] + '";'
    $h = JalankanProgram 'docker' @('exec', $nama, 'psql', '-U', 'postgres', '-d', $db, '-A', '-t', '-c', $sql)
    if ($h.kode -ne 0) { $beda += [pscustomobject]@{ tabel = $tabel; harap = $harap; dapat = 'TIDAK ADA' }; continue }
    $angka = ($h.keluaran | Where-Object { $_ -match '^\s*\d+\s*$' } | Select-Object -First 1)
    if (-not $angka) { $beda += [pscustomobject]@{ tabel = $tabel; harap = $harap; dapat = 'GAGAL' }; continue }
    $dapat = [int64]$angka.Trim()
    if ($dapat -eq $harap) { $sama++ } else { $beda += [pscustomobject]@{ tabel = $tabel; harap = $harap; dapat = $dapat } }
  }

  Tulis ("Cocok: {0} tabel dari {1}." -f $sama, ($semuaKunci.Count - $skipPlatform))
  if ($skipPlatform -gt 0) {
    Tulis ("Tabel schema platform (auth, storage) dilewati di Postgres vanilla: {0} tabel (wajar, tidak mengurangi data apotek)." -f $skipPlatform)
  }
  if ($beda.Count -gt 0) {
    Tulis 'Tidak cocok (perlu diperiksa):'
    $beda | Format-Table -AutoSize | Out-String | Write-Host
  }

  # -------------------------------------------------------------- beri nilai
  if ($beda.Count -eq 0) {
    $lulus = $true
    Tulis ''
    Tulis 'HASIL: LULUS - backup ini bisa dipulihkan dan data apoteknya utuh.'
  } else {
    Tulis ''
    Tulis 'HASIL: PERIKSA - restore berjalan tetapi ada selisih/galat di atas.'
    Tulis 'Bandingkan dulu sebelum menyimpulkan; jangan menghapus backup ini.'
  }
} finally {
  if (-not $Biarkan) {
    Tulis "Membersihkan container $nama..."
    JalankanProgram 'docker' @('rm', '-f', $nama) | Out-Null
  } else {
    Tulis "Container $nama dibiarkan hidup (port $Port). Hapus manual: docker rm -f $nama"
  }
}

if (-not $lulus) { exit 2 }
