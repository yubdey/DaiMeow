@echo off
rem ============================================================
rem  DaiMeow local build script
rem  Usage : double-click this file, or run it from a terminal.
rem  Output: installer + portable exe in release\
rem  NOTE  : keep this file ASCII-only and avoid goto/labels.
rem          cmd.exe reads .bat files using the console code page,
rem          so non-ASCII text here breaks parsing on some locales.
rem ============================================================
cd /d "%~dp0"

echo [1/3] installing dependencies ...
call npm install || (echo. & echo [build] npm install FAILED & pause & exit /b 1)

echo.
echo [2/3] bundling pet renderer ...
call npm run build:pet || (echo. & echo [build] build:pet FAILED & pause & exit /b 1)

echo.
echo [3/3] packaging ...
call npm run dist || (echo. & echo [build] packaging FAILED & pause & exit /b 1)

echo.
echo [build] done. output:
dir /b release\*.exe 2>nul
pause
