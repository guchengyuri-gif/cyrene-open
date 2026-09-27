@echo off
chcp 65001 >nul
title Cyrene + Furina deploy
node "%~dp0deploy.cjs"
echo.
pause
