@echo off
title NoxaStore Wallet - Deploy to GitHub
echo =====================================================
echo    NoxaStore Wallet - Auto Git Push to GitHub
echo =====================================================
echo.
echo [1/3] Menyiapkan perubahan (git add)...
git add .
echo.
echo [2/3] Menyimpan commit (git commit)...
git commit -m "update app - %date% %time%"
echo.
echo [3/3] Mengunggah ke GitHub (git push origin main)...
git push origin main
echo.
echo =====================================================
echo    SELESAI! Kode telah berhasil diunggah ke GitHub.
echo    Server FinCloud akan otomatis memuat kode terbaru.
echo =====================================================
echo.
pause
