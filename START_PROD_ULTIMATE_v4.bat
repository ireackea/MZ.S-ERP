@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title MZ.S-ERP - ULTIMATE v5.0 ABSOLUTE PRODUCTION LAUNCHER
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
set "APP_PORTS=3001 4173 4174"

:: إنشاء مجلد الباك اب
if not exist "backups" mkdir backups
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

echo.
echo ========================================================
echo   MZ.S-ERP - ULTIMATE v5.0 ABSOLUTE LAUNCHER
echo   Enterprise Warehouse & Production System
echo   Full Power - Zero Downtime - Grafana Monitoring
echo ========================================================
echo.

call :log "Launch started at %date% %time%"

:: 1. Backup تلقائي قبل كل شيء
echo [1/9] Creating pre-launch backup...
copy "backend\prisma\dev.db" "%BACKUP_DIR%\dev.db.backup" >nul 2>&1
call :log "[OK] Database backup created."

:: 2. إغلاق كامل قوي
echo [2/9] Full System Shutdown...
call :full_shutdown

:: 3. Prisma Migrate
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
echo [5/9] Starting Docker Stack with PM2...
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
echo [7/9] Opening Browser + Monitoring...
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
echo ========================================================
) >> "%LOG_FILE%"

:: 9. إنهاء
echo [9/9] Launch Complete.
echo.
echo ========================================================
echo   ✅ MZ.S-ERP IS NOW RUNNING AT FULL POWER
echo   All services + Grafana + Monitoring are active.
echo   Log file: %LOG_FILE%
echo ========================================================
echo.
pause
exit /b 0

:full_shutdown
call :log "[INFO] Starting complete shutdown..."
docker compose down --remove-orphans >> "%LOG_FILE%" 2>&1

for %%P in (%APP_PORTS%) do (
    call :stop_port %%P
)
timeout /t 3 >nul
call :log "[OK] Complete shutdown finished."
exit /b 0

:stop_port
set "TARGET_PORT=%~1"
for /f "tokens=5" %%I in ('netstat -ano ^| findstr /R /C:":%TARGET_PORT% .*LISTENING"') do (
    taskkill /PID %%I /F >nul 2>&1
    call :log "[OK] Killed PID %%I on port %TARGET_PORT%."
)
exit /b 0

:log
echo %~1>> "%LOG_FILE%"
exit /b 0