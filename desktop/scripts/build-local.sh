#!/usr/bin/env bash
# Build the Cellor desktop bundle for the current platform.
# Run from the repo root:   bash desktop/scripts/build-local.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "==> Building React SPA"
(cd web && npm ci --legacy-peer-deps && npm run build)

echo "==> Fetching MinIO binary"
python3.11 desktop/scripts/fetch-minio.py

echo "==> Installing Python build deps"
python3.11 -m pip install --quiet pyinstaller pyinstaller-hooks-contrib

echo "==> Running PyInstaller"
python3.11 -m PyInstaller desktop/cellor.spec

echo ""
echo "✓ Bundle ready: dist/Cellor/"
echo "  Run it with:  dist/Cellor/Cellor"
