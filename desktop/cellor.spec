# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for the Cellor desktop bundle.
#
# Prerequisites (run from repo root):
#   1.  cd web && npm ci --legacy-peer-deps && npm run build
#   2.  python desktop/scripts/fetch-minio.py
#   3.  pip install pyinstaller pyinstaller-hooks-contrib
#       pip install -r api/requirements.txt -r worker/requirements.txt
#
# Then:
#   pyinstaller desktop/cellor.spec
#
# Output: dist/Cellor/   (--onedir bundle)

from __future__ import annotations

import sys
from pathlib import Path

block_cipher = None

# SPECPATH is the directory that contains this .spec file (desktop/)
root = Path(SPECPATH).parent  # repo root

# ── Sanity checks ──────────────────────────────────────────────────────────
web_dist = root / "web" / "dist"
if not web_dist.exists():
    raise SystemExit(
        f"\nERROR: React SPA not built.\n"
        f"  cd {root}/web && npm ci --legacy-peer-deps && npm run build\n"
    )

minio_name = "minio.exe" if sys.platform == "win32" else "minio"
minio_src  = root / "desktop" / "bin" / minio_name
if not minio_src.exists():
    raise SystemExit(
        f"\nERROR: MinIO binary not found at {minio_src}.\n"
        f"  python {root}/desktop/scripts/fetch-minio.py\n"
    )

# ── Collect packages ───────────────────────────────────────────────────────
from PyInstaller.utils.hooks import collect_all, collect_submodules

datas:    list = [(str(web_dist), "web/dist")]
binaries: list = [(str(minio_src), "minio")]
hidden:   list = []

for pkg in ("api", "worker"):
    d, b, h = collect_all(pkg)
    datas    += d
    binaries += b
    hidden   += h

# uvicorn uses many dynamic internal imports
hidden += [
    "uvicorn.logging",
    "uvicorn.loops", "uvicorn.loops.auto", "uvicorn.loops.asyncio",
    "uvicorn.protocols",
    "uvicorn.protocols.http", "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets", "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.lifespan", "uvicorn.lifespan.on", "uvicorn.lifespan.off",
    "uvicorn.middleware", "uvicorn.middleware.proxy_headers",
    # ASGI / HTTP
    "h11", "h11._readers", "h11._writers", "h11._events",
    "anyio", "anyio._backends._asyncio",
    "starlette.routing", "starlette.middleware", "starlette.staticfiles",
    "starlette.responses", "starlette.websockets",
    # FastAPI / Pydantic
    "fastapi", "fastapi.security", "fastapi.middleware.cors",
    "fastapi.responses", "fastapi.staticfiles",
    "pydantic_core", "pydantic.v1",
    # Auth / crypto
    "jwt", "cryptography", "cryptography.hazmat.primitives",
    "cryptography.hazmat.backends", "cryptography.hazmat.backends.openssl",
    # Storage
    "minio", "minio.credentials", "minio.commonconfig",
    # Data processing
    "duckdb",
    "pyarrow", "pyarrow.pandas_compat", "pyarrow.parquet",
    "shapely", "shapely.geometry", "shapely.ops",
    "PIL", "PIL.Image", "PIL.ImageDraw",
    # WSI imaging
    "pyvips", "openslide",
    # Worker internals
    "numpy", "numpy.core",
    "psutil",
]

# Collect fastslide submodules (may contain Rust binary extensions)
hidden += collect_submodules("fastslide")

# ── Optional icon paths ────────────────────────────────────────────────────
_icon_win  = str(root / "desktop" / "assets" / "icon.ico")
_icon_mac  = str(root / "desktop" / "assets" / "icon.icns")
_icon      = _icon_win if sys.platform == "win32" else _icon_mac
_icon_kwarg = {"icon": _icon} if Path(_icon).exists() else {}

# ── Analysis ───────────────────────────────────────────────────────────────
a = Analysis(
    [str(root / "desktop" / "launcher.py")],
    pathex=[str(root)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hidden,
    hookspath=[str(root / "desktop" / "hooks")],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "_tkinter", "test", "_pytest", "IPython", "matplotlib"],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Cellor",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,       # UPX can break native extensions; leave off by default
    console=False,   # No console window on Windows/macOS
    **_icon_kwarg,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name="Cellor",
)

# macOS: also produce a .app bundle (used by the DMG installer step)
if sys.platform == "darwin":
    _bundle_kwarg = {"icon": _icon_mac} if Path(_icon_mac).exists() else {}
    app = BUNDLE(
        coll,
        name="Cellor.app",
        bundle_identifier="com.cellor.workspace",
        info_plist={
            "CFBundleShortVersionString": "1.0.0",
            "CFBundleName": "Cellor",
            "CFBundleDisplayName": "Cellor Workspace",
            "LSMinimumSystemVersion": "12.0",
            "NSHighResolutionCapable": True,
            "NSRequiresAquaSystemAppearance": False,
        },
        **_bundle_kwarg,
    )
