@echo off
chcp 65001 >nul
echo.
node "%~dp0deploy_ext.cjs"
echo.
pause
