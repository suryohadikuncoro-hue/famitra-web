@echo off
rem Pintasan backup database apotek. Klik dua kali atau jalankan dari cmd:
rem   tools\backup-famitra.cmd
rem   tools\backup-famitra.cmd -Simpan 30
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup-famitra.ps1" %*
if errorlevel 1 (
  echo.
  echo BACKUP GAGAL. Baca pesan di atas, data production tidak diubah.
) else (
  echo.
  echo BACKUP SELESAI.
)
pause
