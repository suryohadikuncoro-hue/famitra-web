@echo off
rem Uji bahwa backup terbaru benar-benar bisa dipulihkan (restore ke Postgres
rem sementara di Docker lokal; database production TIDAK disentuh).
rem   tools\restore-drill.cmd
rem   tools\restore-drill.cmd -Folder C:\Users\User\backup-famitra\2026-11-01_0822
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore-drill.ps1" %*
if errorlevel 1 (
  echo.
  echo UJI RESTORE TIDAK LULUS / BERMASALAH. Jangan hapus backup, baca pesan di atas.
) else (
  echo.
  echo UJI RESTORE SELESAI.
)
pause
