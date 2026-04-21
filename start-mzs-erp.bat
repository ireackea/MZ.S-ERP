@echo off
setlocal EnableExtensions
call "%~dp0START_PROD_ULTIMATE.bat" --prod %*
exit /b %errorlevel%