@echo off
chcp 65001 >nul
title MZ.S-ERP - 10/10 Production Mode - 2026
color 0A

echo ========================================================
echo   MZ.S-ERP - 10/10 Production Launch
echo   Enterprise Warehouse ^& Production System
echo ========================================================

echo [1/4] Cleaning old containers...
docker compose down

echo [2/4] Building full stack...
call npm run build:full

echo [3/4] Starting Docker Production Stack...
docker compose up -d --build

echo [4/4] Waiting for services...
timeout /t 15 >nul

echo.
echo النظام يعمل الآن على:
echo Frontend : http://localhost:4173
echo Backend  : http://localhost:3001
echo Login    : superadmin / SecurePassword2026!
echo.
echo Press any key to open browser...
pause

start http://localhost:4173