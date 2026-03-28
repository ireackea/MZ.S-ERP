@echo off
chcp 65001 >nul
title MZ.S-ERP System

setlocal EnableDelayedExpansion

set "PROJECT_ROOT=%~dp0"
set "BACKEND_DIR=%PROJECT_ROOT%backend"

echo.
echo ============================================
echo   MZ.S-ERP - Feed Factory Management System
echo   Version: 2026-03-18
echo ============================================
echo.

REM Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed
    echo Please install Node.js 18+ from: https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo [OK] Node.js: %NODE_VERSION%
echo.

REM Check folders
echo [1/6] Checking folders...
if not exist "%BACKEND_DIR%" (
    echo [ERROR] backend folder not found
    pause
    exit /b 1
)
echo [OK] Folders found
echo.

REM Create .env if not exists
echo [2/6] Checking settings file...
if not exist "%PROJECT_ROOT%.env" (
    echo [INFO] Creating .env file...
    copy "%PROJECT_ROOT%.env.example" "%PROJECT_ROOT%.env" >nul
    
    powershell -Command "(Get-Content '%PROJECT_ROOT%.env') -replace 'JWT_SECRET=CHANGE_ME_LONG_RANDOM_SECRET','JWT_SECRET=mz-s-erp-development-secret-key-2026' | Set-Content '%PROJECT_ROOT%.env'"
    powershell -Command "(Get-Content '%PROJECT_ROOT%.env') -replace 'ADMIN_PASSWORD=CHANGE_ME_STRONG_PASSWORD','ADMIN_PASSWORD=admin123' | Set-Content '%PROJECT_ROOT%.env'"
    echo [OK] .env file created
) else (
    echo [OK] .env file exists
)
echo.

REM Check dependencies
echo [3/6] Checking dependencies...
if not exist "%PROJECT_ROOT%node_modules" (
    echo [INFO] Installing main dependencies...
    cd /d "%PROJECT_ROOT%"
    call npm install
)
echo [OK] Main dependencies ready

if not exist "%BACKEND_DIR%node_modules" (
    echo [INFO] Installing backend dependencies...
    cd /d "%BACKEND_DIR%"
    call npm install
    cd /d "%PROJECT_ROOT%"
)
echo [OK] Backend dependencies ready
echo.

REM Generate Prisma Client
echo [4/6] Generating Prisma Client...
cd /d "%BACKEND_DIR%"
call npx prisma generate >nul 2>&1
echo [OK] Prisma Client generated
echo.

REM Check database
echo [5/6] Checking database...
if not exist "%BACKEND_DIR%\prisma\dev.db" (
    echo [INFO] Creating database...
    call npx prisma migrate dev --name init
    echo [OK] Database created
) else (
    echo [OK] Database exists
)
cd /d "%PROJECT_ROOT%"
echo.

REM Show info
echo ============================================
echo   Starting System...
echo ============================================
echo.
echo   Access URLs:
echo   - Frontend:  http://localhost:5173
echo   - Backend:   http://localhost:3000
echo   - Health:    http://localhost:3000/api/health
echo.
echo   Default Login:
echo   - Username:  admin
echo   - Password:  admin123
echo.
echo   Press Ctrl+C to stop the system
echo ============================================
echo.

REM Set environment variables
set NODE_ENV=development
set PORT=3000
set JWT_SECRET=mz-s-erp-development-secret-key-2026
set CORS_ORIGINS=http://localhost:5173,http://localhost:5174,http://localhost:3000

REM Start Backend in new window
echo [6/6] Starting services...
start "MZ.S-ERP Backend" cmd /k "cd /d %BACKEND_DIR% && set NODE_ENV=development && set PORT=3000 && set JWT_SECRET=mz-s-erp-development-secret-key-2026 && set CORS_ORIGINS=http://localhost:5173,http://localhost:5174,http://localhost:3000 && npm run start:dev"

timeout /t 8 /nobreak >nul

REM Start Frontend in new window
start "MZ.S-ERP Frontend" cmd /k "cd /d %PROJECT_ROOT% && set NODE_ENV=development && npm run dev"

echo.
echo ============================================
echo   System Started Successfully!
echo ============================================
echo.
echo   Two windows should have opened:
echo   1. MZ.S-ERP Backend
echo   2. MZ.S-ERP Frontend
echo.
echo   Wait for these messages:
echo   - Backend:  'Nest application successfully started'
echo   - Frontend: 'ready in xxx ms'
echo.
echo   Then open your browser:
echo   http://localhost:5173
echo.
echo   To stop: Close both windows or press Ctrl+C in each
echo ============================================
echo.
echo   Press any key to close this window...
pause >nul
