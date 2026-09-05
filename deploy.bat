@echo off
title NoxarianetApp - Deploy to GitHub
echo =====================================================
echo    NoxarianetApp - Auto Git Push to GitHub
echo =====================================================
echo.
echo [1/4] Membersihkan ppob_visibility.json dari Git tracking...
git rm -f ppob_visibility.json 2>nul
git rm --cached -f ppob_visibility.json 2>nul
del /f /q ppob_visibility.json 2>nul
echo.
echo [2/4] Menyiapkan perubahan (git add -A)...
git add -A
echo.
echo [3/4] Menyimpan commit (git commit)...
git commit -m "fix: remove ppob_visibility.json from git repo to prevent merge conflicts"
echo.
echo [4/4] Mengunggah ke GitHub (git push origin main)...
git push origin main
echo.
echo =====================================================
echo    SELESAI! Kode telah berhasil diunggah ke GitHub.
echo    Silakan klik Start / Restart pada panel FinCloud.
echo =====================================================
echo.
pause
