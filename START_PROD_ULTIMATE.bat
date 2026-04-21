@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "START_SCRIPT=%SCRIPT_DIR%\start-mzs-erp-safe.ps1"
set "STOP_SCRIPT=%SCRIPT_DIR%\stop-mzs-erp-safe.ps1"
set "PS_EXE=powershell.exe"

if not exist "%START_SCRIPT%" (
    echo [ERROR] Missing launcher script: %START_SCRIPT%
    exit /b 1
)

set "MODE=safe"
set "OPEN_BROWSER=1"
set "SKIP_INSTALL=0"
set "SKIP_BUILD=0"
set "NO_COLOR=0"
set "AUTO_RESTART=0"

:parse_args
if "%~1"=="" goto run_launcher
if /I "%~1"=="--prod" (
    set "MODE=safe"
    shift
    goto parse_args
)
if /I "%~1"=="--dev" (
    set "MODE=dev"
    shift
    goto parse_args
)
if /I "%~1"=="--skip-install" (
    set "SKIP_INSTALL=1"
    shift
    goto parse_args
)
if /I "%~1"=="--skip-build" (
    set "SKIP_BUILD=1"
    shift
    goto parse_args
)
if /I "%~1"=="--no-browser" (
    set "OPEN_BROWSER=0"
    shift
    goto parse_args
)
if /I "%~1"=="--no-color" (
    set "NO_COLOR=1"
    shift
    goto parse_args
)
if /I "%~1"=="--auto-restart" (
    set "AUTO_RESTART=1"
    shift
    goto parse_args
)
if /I "%~1"=="--stop" (
    if not exist "%STOP_SCRIPT%" (
        echo [ERROR] Missing stop script: %STOP_SCRIPT%
        exit /b 1
    )
    %PS_EXE% -NoProfile -ExecutionPolicy Bypass -File "%STOP_SCRIPT%" -RepoPath "%SCRIPT_DIR%"
    exit /b %errorlevel%
)

echo [WARN] Ignoring unknown argument: %~1
shift
goto parse_args

:run_launcher
set "PS_ARGS="
if "%OPEN_BROWSER%"=="1" set "PS_ARGS=!PS_ARGS! -OpenBrowser"
if /I "%MODE%"=="safe" set "PS_ARGS=!PS_ARGS! -SafeMode"
if "%SKIP_INSTALL%"=="1" set "PS_ARGS=!PS_ARGS! -SkipInstall"
if "%SKIP_BUILD%"=="1" set "PS_ARGS=!PS_ARGS! -SkipBuild"
if "%NO_COLOR%"=="1" set "PS_ARGS=!PS_ARGS! -NoColor"
if "%AUTO_RESTART%"=="1" set "PS_ARGS=!PS_ARGS! -AutoRestart"

%PS_EXE% -NoProfile -ExecutionPolicy Bypass -File "%START_SCRIPT%" -RepoPath "%SCRIPT_DIR%" %PS_ARGS%
exit /b %errorlevel%
