@echo off
title PMI Forensic Clock AR - Local Bridge Server
cd /d "%~dp0"
echo =============================================================
echo   Menjalankan Server Lokal PMI Forensic Clock AR...
echo   Port: 3000
echo =============================================================
echo.
echo Membuka Web Dashboard di browser...
start http://localhost:3000/dashboard.html
echo.
node server.js
pause
