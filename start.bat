@echo off
chcp 65001 >nul
rem Switch to script directory so it runs from any location
cd /d "%~dp0"
start "" /B npx electron .
