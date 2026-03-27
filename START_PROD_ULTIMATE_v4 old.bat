@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title MZ.S-ERP - Official Full Production Launcher v4
color 0A

set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

set "LOG_FILE=%ROOT_DIR%production.log"
set "DOCKER_BIN_DIR=C:\Program Files\Docker\Docker\resources\bin"
set "DOCKER_EXE=docker"
if exist "%DOCKER_BIN_DIR%\docker.exe" (
    set "PATH=%DOCKER_BIN_DIR%;%PATH%"
    set "DOCKER_EXE=%DOCKER_BIN_DIR%\docker.exe"
)
set "HEALTH_URL=http://localhost:3001/api/health"
set "FRONTEND_URL=http://localhost:4173"
set "BACKEND_URL=http://localhost:3001"
set "METRICS_URL=http://localhost:3001/metrics"
set "MAX_ATTEMPTS=12"
set "WAIT_SECONDS=5"
set "SHUTDOWN_WAIT_SECONDS=2"
set "APP_PORTS=3001 4173 4174"

> "%LOG_FILE%" echo ========================================================

echo.
echo ========================================================
echo   MZ.S-ERP - OFFICIAL FULL PRODUCTION LAUNCHER v4
echo   Enterprise Warehouse ^& Production System
echo   Verified Startup Flow
echo ========================================================
echo.

call :log "========================================================"
call :log "Launch started at %date% %time%"
call :log "Root directory: %ROOT_DIR%"
call :log "Docker bin dir: %DOCKER_BIN_DIR%"
call :log "Docker executable: %DOCKER_EXE%"

echo [1/8] Recording runtime tool versions...
"%DOCKER_EXE%" --version >> "%LOG_FILE%" 2>&1
call npm --version >> "%LOG_FILE%" 2>&1
curl --version >> "%LOG_FILE%" 2>&1
echo [OK] Runtime tool probe recorded.
call :log "[OK] Runtime tool probe recorded."

echo [2/8] Performing complete system shutdown...
call :full_shutdown

echo [3/8] Building frontend and backend...
call npm run build:full >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
    echo [ERROR] Build failed. See production.log for details.
    call :log "[ERROR] Build failed."
    goto :fail
)
call :log "[OK] Full build completed successfully."

echo [4/8] Starting Docker production stack...
"%DOCKER_EXE%" compose up -d --build >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
    echo [ERROR] Docker stack failed to start. See production.log for details.
    call :log "[ERROR] Docker stack failed to start."
    goto :fail
)
call :log "[OK] Docker stack started."

echo [5/8] Waiting for backend health...
set "attempt=0"

:health_check
set /a attempt+=1
echo Checking health attempt !attempt!/%MAX_ATTEMPTS%...

curl -fsS "%HEALTH_URL%" | findstr /I "\"status\":\"healthy\"" >nul
if not errorlevel 1 (
    echo [OK] System is healthy.
    call :log "[OK] Health check passed on attempt !attempt!."
    goto :after_health
)

if !attempt! geq %MAX_ATTEMPTS% (
    echo [WARN] Health check did not pass after %MAX_ATTEMPTS% attempts.
    call :log "[WARN] Health check did not pass after %MAX_ATTEMPTS% attempts."
    goto :after_health
)

call :wait_seconds %WAIT_SECONDS%
goto :health_check

:after_health
echo [6/8] Capturing runtime status...
"%DOCKER_EXE%" compose ps >> "%LOG_FILE%" 2>&1
call :log "[OK] Runtime status captured."

echo [7/8] Opening service URLs...
start "" "%FRONTEND_URL%"
call :wait_seconds 2
start "" "%METRICS_URL%"
call :log "[OK] Browser tabs opened."

echo [8/8] Startup sequence completed.
call :log "[OK] Startup sequence completed."

setlocal DisableDelayedExpansion
echo.
echo ========================================================
echo   MZ.S-ERP is running.
echo   Frontend : %FRONTEND_URL%
echo   Backend  : %BACKEND_URL%
echo   Metrics  : %METRICS_URL%
echo   Health   : %HEALTH_URL%
echo   Login    : superadmin / SecurePassword2026!
echo ========================================================
echo.
echo Log file: %LOG_FILE%
>> "%LOG_FILE%" echo Frontend: %FRONTEND_URL%
>> "%LOG_FILE%" echo Backend : %BACKEND_URL%
>> "%LOG_FILE%" echo Metrics : %METRICS_URL%
>> "%LOG_FILE%" echo Health  : %HEALTH_URL%
>> "%LOG_FILE%" echo Login   : superadmin / SecurePassword2026!
>> "%LOG_FILE%" echo Launch completed at %date% %time%
>> "%LOG_FILE%" echo ========================================================
endlocal

pause
exit /b 0

:fail
echo.
echo ========================================================
echo   Startup failed.
echo   Review the log file:
echo   %LOG_FILE%
echo ========================================================
call :log "Startup failed at %date% %time%"
pause
exit /b 1

:log
echo %~1>> "%LOG_FILE%"
exit /b 0

:full_shutdown
call :log "[INFO] Starting complete shutdown sequence."
"%DOCKER_EXE%" compose down --remove-orphans >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
    echo [WARN] docker compose down returned a non-zero exit code. Continuing.
    call :log "[WARN] docker compose down returned a non-zero exit code."
) else (
    call :log "[OK] Previous containers cleaned."
)

for %%P in (%APP_PORTS%) do (
    call :stop_port %%P
)

call :wait_seconds %SHUTDOWN_WAIT_SECONDS%
call :log "[OK] Complete shutdown sequence finished."
exit /b 0

:stop_port
set "TARGET_PORT=%~1"
set "PORT_HAS_PROCESS="
for /f "tokens=5" %%I in ('netstat -ano ^| findstr /R /C:":%TARGET_PORT% .*LISTENING"') do (
    set "TARGET_PID=%%I"
    if not "!TARGET_PID!"=="0" (
        set "PORT_HAS_PROCESS=1"
        echo [INFO] Stopping PID !TARGET_PID! on port %TARGET_PORT%...
        call :log "[INFO] Stopping PID !TARGET_PID! on port %TARGET_PORT%..."
        taskkill /PID !TARGET_PID! /F >> "%LOG_FILE%" 2>&1
        if errorlevel 1 (
            echo [WARN] Failed to stop PID !TARGET_PID! on port %TARGET_PORT%.
            call :log "[WARN] Failed to stop PID !TARGET_PID! on port %TARGET_PORT%."
        ) else (
            call :log "[OK] Stopped PID !TARGET_PID! on port %TARGET_PORT%."
        )
    )
)

if not defined PORT_HAS_PROCESS (
    call :log "[OK] No active listener found on port %TARGET_PORT%."
)
exit /b 0

:wait_seconds
ping 127.0.0.1 -n %~1 >nul
exit /b 0