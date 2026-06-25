@echo off
:: Build the Cellor desktop bundle on Windows.
:: Run from the repo root:  desktop\scripts\build-local.bat
setlocal enabledelayedexpansion

set ROOT=%~dp0..\..
cd /d "%ROOT%"

echo =^> Building React SPA
cd web
call npm ci --legacy-peer-deps
call npm run build
cd ..

echo =^> Fetching MinIO binary
python desktop\scripts\fetch-minio.py

echo =^> Installing Python build deps
python -m pip install --quiet pyinstaller pyinstaller-hooks-contrib

echo =^> Running PyInstaller
python -m PyInstaller desktop\cellor.spec

echo.
echo Done. Bundle at dist\Cellor\
echo Run with:  dist\Cellor\Cellor.exe
