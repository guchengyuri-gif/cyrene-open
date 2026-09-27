@echo off
chcp 65001 >nul
echo.
node "%~dp0rollback_ext.cjs"
echo.
pause
