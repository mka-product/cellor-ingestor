#!/usr/bin/env python3
"""Download the MinIO server binary for the current platform into desktop/bin/.

Run from the repo root:
    python desktop/scripts/fetch-minio.py
"""
from __future__ import annotations

import os
import platform
import stat
import subprocess
import sys
import urllib.request
from pathlib import Path

URLS: dict[tuple[str, str], tuple[str, str]] = {
    ("Windows", "AMD64"):  ("https://dl.min.io/server/minio/release/windows-amd64/minio.exe", "minio.exe"),
    ("Darwin",  "arm64"):  ("https://dl.min.io/server/minio/release/darwin-arm64/minio",      "minio"),
    ("Darwin",  "x86_64"): ("https://dl.min.io/server/minio/release/darwin-amd64/minio",      "minio"),
    ("Linux",   "x86_64"): ("https://dl.min.io/server/minio/release/linux-amd64/minio",       "minio"),
    ("Linux",   "aarch64"):("https://dl.min.io/server/minio/release/linux-arm64/minio",       "minio"),
}


def main() -> None:
    key = (platform.system(), platform.machine())
    if key not in URLS:
        sys.exit(f"Unsupported platform: {key[0]} / {key[1]}")

    url, name = URLS[key]
    out = Path(__file__).parent.parent / "bin" / name
    out.parent.mkdir(parents=True, exist_ok=True)

    if out.exists():
        print(f"Already present: {out}  (delete to re-download)")
        return

    print(f"Downloading {url}")
    print(f"        → {out}")

    # Prefer curl/wget if available (shows progress); fall back to urllib
    try:
        subprocess.run(["curl", "-fsSL", "--progress-bar", url, "-o", str(out)], check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        urllib.request.urlretrieve(url, out)

    if name != "minio.exe":
        out.chmod(out.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

    print("Done.")


if __name__ == "__main__":
    main()
