@echo off
chcp 65001 >nul
echo.
node "%~dp0install_model.cjs" %*
echo.
pause
