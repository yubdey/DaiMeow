@echo off
rem ============================================================
rem  DaiMeow motion preview launcher
rem  Bundles the preview page, serves it locally, opens browser.
rem  NOTE: keep this file ASCII-only and avoid goto/labels/blocks.
rem  cmd.exe reads .bat using the console code page, so non-ASCII
rem  text here breaks parsing on some locales.
rem ============================================================
cd /d "%~dp0"
chcp 65001 >nul

if not exist "src\renderer\pet\live2dcubismcore.js" node -e "require('fs').copyFileSync('node_modules/@hazart-pkg/live2d-core/live2dcubismcore.min.js','src/renderer/pet/live2dcubismcore.js')"

echo [preview] bundling tools/preview-app.js ...
call npx esbuild tools/preview-app.js --bundle --outfile=tools/preview-bundle.js --format=iife --platform=browser || (echo. & echo [preview] bundle FAILED - see errors above & pause & exit /b 1)

echo.
echo [preview] starting local server - close this window to stop
node tools/preview-server.cjs
