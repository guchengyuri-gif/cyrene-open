@echo off
chcp 65001 >nul
title Cyrene rollback
node "%~dp0rollback.cjs"
echo.
pause
