<#
  backup-famitra.ps1 - Backup logis database apotek (roles + skema + data).

  Sifat: HANYA MEMBACA. Tidak ada INSERT/UPDATE/DELETE/DROP. Dump memakai
  `supabase db dump --linked` (pg_dump read-only), jadi kasir yang sedang
  melayani tidak terganggu dan data tidak berubah.

  Hasil disimpan DI LUAR repo (default C:\Users\User\backup-famitra) supaya
  tidak pernah ikut ter-commit ke GitHub.

  Pemakaian:
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\backup-famitra.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\backup-famitra.ps1 -Simpan 30
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\backup-famitra.ps1 -Kompres

  Parameter:
    -Tujuan   Folder penyimpanan backup. Default C:\Users\User\backup-famitra
    -Simpan   Jumlah backup terbaru yang dipertahankan; yang lebih lama dihapus.
    -Kompres  Buat juga arsip .zip di samping berkas .sql.
    -CliPath  Pakai supabase.exe tertentu (kalau tidak mau mengunduh otomatis).
#>
[CmdletBinding()]
param(
  [string]$Tujuan = 'C:\Users\User\backup-famitra',
  [int]$Simpan = 14,
  [switch]$Kompres,
  [string]$CliPath
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

# ------------------------------------------------------------------ 1. prasyarat
$akar = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $akar 'supabase\config.toml'))) {
  throw "Folder repo tidak dikenali: $akar (supabase\config.toml tidak ada)."
}
if (-not (Test-Path (Join-Path $akar 'supabase\.temp\linked-project.json'))) {
  throw 'Project Supabase belum ter-link. Jalankan: npx supabase link --project-ref xixhazawndmgqzstfjnq'
}

# Docker dipakai `db dump` untuk menjalankan pg_dump di container.
function PastikanDocker {
  if ((JalankanProgram 'docker' @('info', '--format', '{{.ServerVersion}}')).kode -eq 0) { return }
  $kandidat = @(
    "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe",
    "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
  ) | Where-Object { Test-Path $_ }
  $exe = $kandidat | Select-Object -First 1
  if (-not $exe) { throw 'Docker Desktop tidak ditemukan. Backup butuh Docker Desktop (dipakai pg_dump).' }
  Tulis 'Menyalakan Docker Desktop... (bisa 1-2 menit)'
  if (-not (Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $exe | Out-Null
  }
  for ($i = 1; $i -le 60; $i++) {
    if ((JalankanProgram 'docker' @('info', '--format', '{{.ServerVersion}}')).kode -eq 0) {
      Tulis 'Docker siap.'
      return
    }
    Start-Sleep -Seconds 5
  }
  throw "Docker tidak siap setelah 5 menit. Buka Docker Desktop manual sampai 'Engine running', lalu ulangi."
}

function Unduh([string]$url, [string]$tujuan) {
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    $r = JalankanProgram 'curl.exe' @('-L', '--fail', '--retry', '3', '--retry-delay', '2', '--connect-timeout', '30', '-o', $tujuan, $url)
    if ($r.kode -ne 0) {
      $r.keluaran | Select-Object -Last 5 | ForEach-Object { Write-Host "     $_" }
      throw "Unduhan gagal: $url"
    }
    return
  }
  $lama = $ProgressPreference
  $ProgressPreference = 'SilentlyContinue'
  try {
    Invoke-WebRequest -Uri $url -OutFile $tujuan -UseBasicParsing -TimeoutSec 900
  } finally {
    $ProgressPreference = $lama
  }
}

# CLI diunduh sekali dari rilis resmi Supabase (bukan dari npm).
function DapatkanCli([string]$jalur) {
  if ($jalur) {
    if (-not (Test-Path $jalur)) { throw "CliPath tidak ditemukan: $jalur" }
    return $jalur
  }
  $folderCli = Join-Path $env:LOCALAPPDATA 'famitra-cli'
  $exe = Join-Path $folderCli 'supabase.exe'
  if (Test-Path $exe) { return $exe }

  Tulis 'Supabase CLI belum ada di laptop ini, mengunduh sekali (~65 MB) dari rilis resmi...'
  New-Item -ItemType Directory -Force -Path $folderCli | Out-Null
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
  $urlCek = 'https://github.com/supabase/cli/releases/latest/download/checksums.txt'

  # Utamakan .tar.gz tanpa versi (selalu ada di rilis terbaru); .zip hanya ada
  # dengan nama bervers, jadi dicari lewat API bila tar tidak tersedia.
  $pakaiTar = [bool](Get-Command tar -ErrorAction SilentlyContinue)
  if ($pakaiTar) {
    $unduhan = Join-Path $env:TEMP 'supabase_windows_amd64.tar.gz'
    $polaCek = 'supabase_windows_amd64\.tar\.gz$'
    Unduh 'https://github.com/supabase/cli/releases/latest/download/supabase_windows_amd64.tar.gz' $unduhan
  } else {
    $unduhan = Join-Path $env:TEMP 'supabase_windows_amd64.zip'
    $polaCek = 'supabase_windows_amd64\.zip$'
    $urlZip = $null
    try {
      $info = Invoke-RestMethod -Uri 'https://api.github.com/repos/supabase/cli/releases/latest' -UseBasicParsing
      $aset = $info.assets | Where-Object { $_.name -match 'windows_amd64\.zip$' } | Select-Object -First 1
      if ($aset) { $urlZip = $aset.browser_download_url }
    } catch { }
    if (-not $urlZip) { throw 'Tidak bisa menentukan lokasi unduhan Supabase CLI. Jalankan dengan -CliPath <jalur supabase.exe>.' }
    Unduh $urlZip $unduhan
  }

  try {
    $isiCek = (Invoke-WebRequest -Uri $urlCek -UseBasicParsing -TimeoutSec 120).Content
    $baris = ($isiCek -split "`n") | Where-Object { $_.Trim() -match $polaCek } | Select-Object -First 1
    if ($baris) {
      $harap = ($baris.Trim() -split '\s+')[0].ToLower()
      $dapat = (Get-FileHash -Path $unduhan -Algorithm SHA256).Hash.ToLower()
      if ($harap -ne $dapat) { throw 'Checksum unduhan tidak cocok dengan rilis resmi. Unduhan dibatalkan.' }
      Tulis '  checksum resmi: cocok.'
    }
  } catch {
    Tulis "  peringatan: checksum tidak diverifikasi ($($_.Exception.Message))"
  }

  if ($pakaiTar) {
    & tar -xzf $unduhan -C $folderCli
  } else {
    Expand-Archive -Path $unduhan -DestinationPath $folderCli -Force
  }
  Remove-Item -Path $unduhan -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path $exe)) {
    $turunan = Get-ChildItem -Path $folderCli -Filter 'supabase*.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($turunan) { Copy-Item -Path $turunan.FullName -Destination $exe -Force }
  }
  if (-not (Test-Path $exe)) { throw "Gagal mengekstrak supabase.exe ke $folderCli" }
  return $exe
}

# ------------------------------------------------------------------ 2. folder
if (-not (Test-Path $Tujuan)) { New-Item -ItemType Directory -Force -Path $Tujuan | Out-Null }
# bersihkan folder sisa percobaan yang gagal (tanpa berkas)
Get-ChildItem $Tujuan -Directory |
  Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}_\d{4}$' -and -not (Get-ChildItem $_.FullName -File -ErrorAction SilentlyContinue) } |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }

$stempel = Get-Date -Format 'yyyy-MM-dd_HHmm'
$folder = Join-Path $Tujuan $stempel
New-Item -ItemType Directory -Force -Path $folder | Out-Null
Tulis "Backup tujuan: $folder"

$exeCli = DapatkanCli $CliPath
$versi = (JalankanProgram $exeCli @('--version')).keluaran
Tulis "Supabase CLI : $($versi | Select-Object -First 1)"

# ------------------------------------------------------------------ 3. dump
function JalankanDump([string[]]$argumen, [string]$namaBerkas) {
  $tujuan = Join-Path $folder $namaBerkas
  Tulis "  -> dump $namaBerkas ..."
  $semua = @('db', 'dump', '--linked', '--yes') + $argumen + @('-f', $tujuan)
  $hasil = JalankanProgram $exeCli $semua
  if ($hasil.kode -ne 0) {
    $hasil.keluaran | Select-Object -Last 25 | ForEach-Object { Write-Host "     $_" }
    throw "Gagal dump $namaBerkas (exit $($hasil.kode))."
  }
  if (-not (Test-Path $tujuan)) { throw "Dump $namaBerkas tidak menghasilkan berkas." }
  $ukuran = (Get-Item $tujuan).Length
  if ($ukuran -le 0) { throw "Dump $namaBerkas kosong (0 byte)." }
  Tulis ("     ok: {0:N0} byte" -f $ukuran)
}

PastikanDocker
Tulis 'Membuat dump (hanya membaca, tidak mengubah data)...'
JalankanDump @('--role-only') 'roles.sql'
JalankanDump @() 'schema.sql'
JalankanDump @('--data-only', '--use-copy') 'data.sql'

# ------------------------------------------------------------------ 4. verifikasi + manifest
Tulis 'Memeriksa isi dump...'
$daftarBerkas = foreach ($b in @('roles.sql', 'schema.sql', 'data.sql')) {
  $p = Join-Path $folder $b
  [pscustomobject]@{
    berkas = $b
    byte   = (Get-Item $p).Length
    sha256 = (Get-FileHash -Path $p -Algorithm SHA256).Hash
  }
}

# Hitung baris per tabel dari blok COPY di data.sql (isi data tidak ditampilkan).
$hitungan = @{}
$namaTabel = $null
$jumlah = 0
foreach ($baris in [System.IO.File]::ReadLines((Join-Path $folder 'data.sql'))) {
  if ($null -eq $namaTabel) {
    if ($baris -match '^COPY\s+"?([^"\s\.]+)"?\."?([^"\s]+)"?') {
      $namaTabel = "$($Matches[1]).$($Matches[2])"
      $jumlah = 0
    }
    continue
  }
  if ($baris -eq '\.') { $hitungan[$namaTabel] = $jumlah; $namaTabel = $null; continue }
  $jumlah++
}
if ($namaTabel) { $hitungan[$namaTabel] = $jumlah }

$kosong = @($hitungan.Keys | Where-Object { $hitungan[$_] -eq 0 })

$manifest = [pscustomobject]@{
  waktu           = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
  proyek          = 'xixhazawndmgqzstfjnq'
  folder          = $folder
  berkas          = $daftarBerkas
  jumlah_tabel    = $hitungan.Count
  baris_per_tabel = $hitungan
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $folder 'manifest.json') -Encoding UTF8

$ringkasan = @()
$ringkasan += 'Backup database SI-FaMitra'
$ringkasan += "Waktu        : $($manifest.waktu)"
$ringkasan += "Folder       : $folder"
$ringkasan += "Jumlah tabel : $($hitungan.Count)"
foreach ($b in $daftarBerkas) {
  $ringkasan += ("Berkas       : {0} ({1:N0} byte, sha256 {2}...)" -f $b.berkas, $b.byte, $b.sha256.Substring(0, 16))
}
$ringkasan += ''
$ringkasan += 'Baris per tabel (10 terbesar):'
$hitungan.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 10 | ForEach-Object {
  $ringkasan += ("  {0,-45} {1}" -f $_.Key, $_.Value)
}
if ($kosong.Count -gt 0) {
  $ringkasan += ''
  $ringkasan += ("Tabel tanpa baris ({0}): {1}" -f $kosong.Count, ($kosong -join ', '))
}
$ringkasan += ''
$ringkasan += 'Uji restore: tools\restore-drill.cmd'
$ringkasan += 'Panduan    : docs/backup-dan-restore.md'
$ringkasan | Set-Content -Path (Join-Path $folder 'ringkasan.txt') -Encoding UTF8
$ringkasan | ForEach-Object { Write-Host $_ }

if ($Kompres) {
  Tulis 'Membuat arsip zip...'
  $zip = Join-Path $folder 'backup.zip'
  Compress-Archive -Path @(
    (Join-Path $folder 'roles.sql'),
    (Join-Path $folder 'schema.sql'),
    (Join-Path $folder 'data.sql'),
    (Join-Path $folder 'manifest.json')
  ) -DestinationPath $zip -Force
  Tulis ("  ok: {0:N0} byte" -f (Get-Item $zip).Length)
}

# ------------------------------------------------------------------ 5. rotasi
$lama = Get-ChildItem $Tujuan -Directory |
  Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}_\d{4}$' -and $_.FullName -ne $folder } |
  Sort-Object Name -Descending |
  Select-Object -Skip ([Math]::Max(0, $Simpan - 1))
foreach ($d in $lama) {
  Tulis "Hapus backup lama: $($d.Name)"
  Remove-Item -LiteralPath $d.FullName -Recurse -Force
}

Tulis ''
Tulis "SELESAI. Backup tersimpan di: $folder"
