#!/usr/bin/env bash
# Build a Linux AppImage from the PyInstaller --onedir bundle.
# Requires: Python 3, Pillow (for fallback icon generation)
#
# Run from repo root:  bash desktop/installer/linux/build-appimage.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BUNDLE="$ROOT/dist/Cellor"
APPDIR="$ROOT/dist/Cellor.AppDir"
OUTPUT="$ROOT/dist/Cellor-Linux-x64.AppImage"
TOOL="$ROOT/dist/appimagetool-x86_64.AppImage"

if [[ ! -d "$BUNDLE" ]]; then
  echo "ERROR: $BUNDLE not found — run pyinstaller desktop/cellor.spec first"
  exit 1
fi

# ── Download appimagetool ──────────────────────────────────────────────────
if [[ ! -f "$TOOL" ]]; then
  echo "Downloading appimagetool…"
  curl -fsSL \
    "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage" \
    -o "$TOOL"
  chmod +x "$TOOL"
fi

# ── Build AppDir ───────────────────────────────────────────────────────────
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin"

echo "Copying bundle…"
cp -r "$BUNDLE/." "$APPDIR/usr/bin/Cellor"

# AppRun entrypoint
cat > "$APPDIR/AppRun" << 'APPRUN'
#!/bin/bash
SELF="$(readlink -f "$0")"
HERE="${SELF%/*}"
exec "$HERE/usr/bin/Cellor/Cellor" "$@"
APPRUN
chmod +x "$APPDIR/AppRun"

# .desktop file
cat > "$APPDIR/Cellor.desktop" << 'DESKTOP'
[Desktop Entry]
Type=Application
Name=Cellor Workspace
Exec=Cellor
Icon=cellor
Categories=Science;Education;
Comment=Whole-slide image viewer and analysis workspace
DESKTOP

# Icon: use assets/icon.png if present, otherwise generate a simple one
ICON_SRC="$ROOT/desktop/assets/icon.png"
if [[ -f "$ICON_SRC" ]]; then
  cp "$ICON_SRC" "$APPDIR/cellor.png"
else
  python3 - "$APPDIR/cellor.png" << 'PY'
import sys
try:
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (256, 256), (10, 11, 17, 255))
    draw = ImageDraw.Draw(img)
    draw.ellipse([28, 28, 228, 228], fill=(56, 189, 248, 255))
    draw.ellipse([80, 80, 176, 176], fill=(10, 11, 17, 255))
    img.save(sys.argv[1])
except Exception:
    # Pillow not available — create a 1×1 placeholder
    open(sys.argv[1], "wb").write(
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00"
        b"\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18"
        b"\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
PY
fi

# ── Package AppImage ───────────────────────────────────────────────────────
echo "Building AppImage…"
ARCH=x86_64 "$TOOL" "$APPDIR" "$OUTPUT" 2>/dev/null || \
ARCH=x86_64 "$TOOL" --appimage-extract-and-run "$APPDIR" "$OUTPUT"

echo "AppImage created: $OUTPUT"
