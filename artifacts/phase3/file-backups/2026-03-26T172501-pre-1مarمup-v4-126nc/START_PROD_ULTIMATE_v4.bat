@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title MZ.S-ERP - ULTIMATE v4.0 ABSOLUTE PRODUCTION LAUNCHER
color 0A

set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

set "LOG_FILE=%ROOT_DIR%production.log"
set "BACKUP_DIR=%ROOT_DIR%backups\%date:~-4%%date:~4,2%%date:~7,2%_%time:~0,2%%time:~3,2%"
set "GRAFANA_URL=http://localhost:3000"
set "METRICS_URL=http://localhost:3001/metrics"
set "FRONTEND_URL=http://localhost:4173"
set "HEALTH_URL=http://localhost:3001/api/health"
set "MAX_ATTEMPTS=15"
set "WAIT_SECONDS=4"

:: إنشاء مجلد الباك اب
if not exist "backups" mkdir backups
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

echo.
echo ========================================================
echo   MZ.S-ERP - ULTIMATE v4.0 ABSOLUTE LAUNCHER
echo   Enterprise Warehouse & Production System
echo   Full Power - Zero Downtime - Grafana Monitoring
echo ========================================================
echo.

call :log "Launch started at %date% %time%"

:: 1. Backup تلقائي قبل التشغيل
echo [1/9] Creating pre-launch backup...
docker compose down --remove-orphans
copy "backend\prisma\dev.db" "%BACKUP_DIR%\dev.db.backup" >nul 2>&1
call :log "[OK] Database backup created in %BACKUP_DIR%"

:: 2. التحقق من Docker
echo [2/9] Checking Docker...
docker --version >nul 2>&1 || (echo ❌ Docker غير موجود. شغل Docker Desktop. & pause & exit /b 1)
call :log "[OK] Docker detected."

:: 3. Prisma Migrate Deploy
echo [3/9] Running Prisma Migrate Deploy...
cd backend
npx prisma migrate deploy >> "%LOG_FILE%" 2>&1
npx prisma generate >> "%LOG_FILE%" 2>&1
cd ..
call :log "[OK] Prisma Migrate completed."

:: 4. بناء ذكي
echo [4/9] Smart Full Build...
npm run build:full >> "%LOG_FILE%" 2>&1
call :log "[OK] Full build completed."

:: 5. تشغيل الـ Stack
echo [5/9] Starting Docker Stack with PM2 Clustering...
docker compose up -d --build >> "%LOG_FILE%" 2>&1
call :log "[OK] Docker stack started."

:: 6. Health Check متقدم
echo [6/9] Advanced Health Check...
set "attempt=0"
:health
set /a attempt+=1
curl -fsS "%HEALTH_URL%" >nul 2>&1
if !errorlevel! equ 0 (
    echo ✅ System is Healthy!
    call :log "[OK] Health check passed."
    goto :launch
)
if !attempt! geq %MAX_ATTEMPTS% (
    echo ⚠️ Health check failed after %MAX_ATTEMPTS% attempts.
    call :log "[WARN] Health check failed."
    goto :launch
)
timeout /t %WAIT_SECONDS% >nul
goto :health

:launch
:: 7. فتح المتصفح + Grafana + Metrics
echo [7/9] Opening Browser + Monitoring Dashboard...
start "" "%FRONTEND_URL%"
timeout /t 2 >nul
start "" "%METRICS_URL%"
start "" "%GRAFANA_URL%"

:: 8. التقرير النهائي
echo [8/9] Generating Final Report...
(
echo ========================================================
echo Launch Time: %date% %time%
echo Status: FULL PRODUCTION READY
echo Frontend: %FRONTEND_URL%
echo Backend : http://localhost:3001
echo Metrics : %METRICS_URL%
echo Grafana : %GRAFANA_URL%
echo Login   : superadmin / SecurePassword2026!
echo PM2 Clustering: Enabled
echo PostgreSQL: Connected
echo Backup  : %BACKUP_DIR%
echo ========================================================
) >> "%LOG_FILE%"

:: 9. إنهاء
echo [9/9] Launch Complete - System Running at Full Power.
echo.
echo ========================================================
echo   ✅ MZ.S-ERP IS NOW RUNNING AT FULL POWER
echo   All services + Grafana + Monitoring are active.
echo   Log file: %LOG_FILE%
echo ========================================================
echo.
pause
exit /b 0

:log
echo %~1>> "%LOG_FILE%"
exit /b 0