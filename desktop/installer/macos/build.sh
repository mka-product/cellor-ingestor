#!/usr/bin/env bash
# Create a macOS DMG from the PyInstaller .app bundle.
# Called by the GitHub Actions workflow; can also be run locally.
#
# Usage:  bash desktop/installer/macos/build.sh [arch]
#   arch defaults to the current machine's arch (arm64 or x64)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ARCH="${1:-$(uname -m)}"
# Normalise arm64 vs x86_64 for the filename
[[ "$ARCH" == "x86_64" ]] && ARCH_LABEL="x64" || ARCH_LABEL="arm64"

APP_PATH="$ROOT/dist/Cellor.app"
DMG_PATH="$ROOT/dist/Cellor-macOS-${ARCH_LABEL}.dmg"

if [[ ! -d "$APP_PATH" ]]; then
  echo "ERROR: $APP_PATH not found — run pyinstaller desktop/cellor.spec first"
  exit 1
fi

# Install create-dmg if not present
if ! command -v create-dmg &>/dev/null; then
  echo "Installing create-dmg via Homebrew…"
  brew install create-dmg
fi

rm -f "$DMG_PATH"

create-dmg \
  --volname "Cellor" \
  --volicon "$ROOT/desktop/assets/icon.icns" \
  --window-size 600 380 \
  --icon-size 128 \
  --icon "Cellor.app" 150 185 \
  --app-drop-link 450 185 \
  --hide-extension "Cellor.app" \
  --background "$ROOT/desktop/assets/dmg-background.png" \
  "$DMG_PATH" \
  "$APP_PATH" \
  2>/dev/null || \
create-dmg \
  --volname "Cellor" \
  --window-size 600 380 \
  --icon-size 128 \
  --icon "Cellor.app" 150 185 \
  --app-drop-link 450 185 \
  --hide-extension "Cellor.app" \
  "$DMG_PATH" \
  "$APP_PATH"

echo "DMG created: $DMG_PATH"
