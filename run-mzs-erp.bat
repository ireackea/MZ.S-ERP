@echo off
setlocal EnableExtensions
call "%~dp0START_PROD_ULTIMATE.bat" %*
exit /b %errorlevel%
