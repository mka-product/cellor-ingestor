"""
Cellor desktop launcher.

Starts a local MinIO (bundled Go binary) for object storage, then
starts the Cellor API (uvicorn, in a background thread), creates a
persistent local admin user on first run, and opens the browser.

Everything runs as ordinary OS processes — no Docker, no Python/Node
pre-installed by the user. PyInstaller bundles the full Python runtime
and all dependencies; MinIO is bundled as a sidecar binary.
"""
from __future__ import annotations

import json
import multiprocessing
import os
import platform
import secrets
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

# Required for PyInstaller + multiprocessing compatibility
multiprocessing.freeze_support()


# ── Directory helpers ──────────────────────────────────────────────────────

def bundle_dir() -> Path:
    """Directory that contains all bundled assets (web/dist, minio binary, …).

    In a PyInstaller --onedir build this is sys._MEIPASS (the _internal/ folder
    next to the executable).  When running from source it's the repo root.
    """
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass)
    return Path(__file__).parent.parent


def user_data_dir() -> Path:
    """Persistent user-writable directory for Cellor data (storage, catalog, …)."""
    system = platform.system()
    if system == "Windows":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home()))
    elif system == "Darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    d = base / "Cellor"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ── Port helpers ───────────────────────────────────────────────────────────

def free_port(preferred: int) -> int:
    """Return *preferred* if available, otherwise a random free port."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", preferred))
            return preferred
    except OSError:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]


# ── MinIO subprocess ───────────────────────────────────────────────────────

def _minio_exe() -> Path:
    name = "minio.exe" if sys.platform == "win32" else "minio"
    if getattr(sys, "_MEIPASS", None):
        # PyInstaller bundle: binary was collected into <bundle>/_internal/minio/
        return bundle_dir() / "minio" / name
    else:
        # Running from source: fetch-minio.py downloads here
        return Path(__file__).parent / "bin" / name


def start_minio(storage_dir: Path, port: int, ak: str, sk: str) -> subprocess.Popen:
    exe = _minio_exe()
    if not exe.exists():
        raise FileNotFoundError(
            f"MinIO binary not found at {exe}.\n"
            "Run  python desktop/scripts/fetch-minio.py  first."
        )
    if sys.platform != "win32":
        exe.chmod(0o755)
    env = {**os.environ, "MINIO_ROOT_USER": ak, "MINIO_ROOT_PASSWORD": sk}
    return subprocess.Popen(
        [str(exe), "server", str(storage_dir),
         "--address", f"127.0.0.1:{port}",
         "--console-address", "127.0.0.1:0"],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def ensure_bucket(port: int, ak: str, sk: str, bucket: str = "cellor") -> None:
    try:
        from minio import Minio  # bundled by PyInstaller
        client = Minio(f"127.0.0.1:{port}", access_key=ak, secret_key=sk, secure=False)
        if not client.bucket_exists(bucket):
            client.make_bucket(bucket)
    except Exception as exc:
        _log(f"[warn] bucket setup skipped: {exc}")


# ── API thread ─────────────────────────────────────────────────────────────

def _apply_env(
    data_dir: Path,
    api_port: int,
    minio_port: int,
    ak: str,
    sk: str,
    jwt_secret: str,
) -> None:
    """Write all runtime config into os.environ before uvicorn imports the app."""
    catalog_dir = data_dir / "catalog"
    catalog_dir.mkdir(parents=True, exist_ok=True)
    overlay_staging = data_dir / "overlay-staging"
    overlay_staging.mkdir(parents=True, exist_ok=True)

    os.environ.update({
        # State: use local JSON files for catalog/overlays/reviews
        "STATE_BACKEND": "file",
        "CATALOG_PATH": str(catalog_dir / "catalog.json"),
        "OVERLAYS_PATH": str(catalog_dir / "overlays.json"),
        "REVIEWS_PATH": str(catalog_dir / "reviews.json"),
        # Storage: local MinIO instance
        "MINIO_ENDPOINT": f"127.0.0.1:{minio_port}",
        "MINIO_ACCESS_KEY": ak,
        "MINIO_SECRET_KEY": sk,
        "MINIO_SECURE": "false",
        "STORAGE_BUCKET": "cellor",
        # Run the ingestion worker in-process (no separate daemon needed)
        "ENABLE_IN_PROCESS_INGESTION": "true",
        "ENABLE_IN_PROCESS_OVERLAY_INGESTION": "true",
        "OVERLAY_STAGING_DIR": str(overlay_staging),
        # Serve the pre-built React SPA from the bundle
        "STATIC_DIR": str(bundle_dir() / "web" / "dist"),
        "CORS_ORIGINS": f"http://127.0.0.1:{api_port}",
        # Persistent JWT secret so browser sessions survive app restarts
        "JWT_SECRET_KEY": jwt_secret,
    })


def _start_api_thread(port: int) -> threading.Thread:
    """Run uvicorn in a daemon thread. Must be called AFTER _apply_env()."""
    # When running from source the repo root must be on sys.path so that
    # `import api` resolves.  In a PyInstaller bundle everything is already
    # in sys._MEIPASS which Python adds automatically.
    repo_root = str(bundle_dir())
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

    import uvicorn  # noqa: PLC0415 — imported here so env vars are set first

    def _run() -> None:
        uvicorn.run(
            "api.api_service.main:app",
            host="127.0.0.1",
            port=port,
            log_level="warning",
            workers=1,
        )

    t = threading.Thread(target=_run, daemon=True, name="cellor-api")
    t.start()
    return t


# ── HTTP helpers ───────────────────────────────────────────────────────────

def _wait_http(url: str, timeout: float = 45.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=1)
            return
        except Exception:
            time.sleep(0.4)
    raise RuntimeError(f"Timed out waiting for {url}")


def _post(url: str, body: bytes, content_type: str) -> dict:
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": content_type},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"POST {url} → HTTP {exc.code}") from exc


# ── First-run user + auto-login token ─────────────────────────────────────

def ensure_local_user_token(api_port: int, data_dir: Path) -> str:
    """Create the local admin user on first run; always return a fresh JWT."""
    creds_file = data_dir / "desktop_user.json"
    if creds_file.exists():
        creds = json.loads(creds_file.read_text())
        email, password = creds["email"], creds["password"]
    else:
        email = "admin@cellor.local"
        password = secrets.token_urlsafe(20)
        creds_file.write_text(json.dumps({"email": email, "password": password}))

    base = f"http://127.0.0.1:{api_port}"

    # Attempt signup — fails silently if the user was already created
    try:
        _post(
            f"{base}/auth/signup",
            json.dumps({
                "email": email, "password": password,
                "first_name": "Local", "last_name": "Admin",
            }).encode(),
            "application/json",
        )
    except RuntimeError:
        pass  # 400 / 422 means the user already exists

    # Always get a fresh token (30-day lifetime by default)
    data = _post(
        f"{base}/auth/token",
        urllib.parse.urlencode({"username": email, "password": password}).encode(),
        "application/x-www-form-urlencoded",
    )
    return data["access_token"]


# ── Logging ────────────────────────────────────────────────────────────────

def _log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


# ── Main ───────────────────────────────────────────────────────────────────

def main() -> None:
    data_dir = user_data_dir()

    # -- Persistent MinIO credentials (created once, survive app restarts) --
    sc_file = data_dir / "storage_creds.json"
    if sc_file.exists():
        sc = json.loads(sc_file.read_text())
        minio_ak, minio_sk = sc["ak"], sc["sk"]
    else:
        minio_ak = "cellorlocal"
        minio_sk = secrets.token_urlsafe(24)
        sc_file.write_text(json.dumps({"ak": minio_ak, "sk": minio_sk}))

    # -- Persistent JWT secret (sessions survive restarts) --
    jwt_file = data_dir / "jwt_secret.txt"
    if jwt_file.exists():
        jwt_secret = jwt_file.read_text().strip()
    else:
        jwt_secret = secrets.token_urlsafe(48)
        jwt_file.write_text(jwt_secret)

    minio_port = free_port(19000)
    api_port   = free_port(18000)

    storage_dir = data_dir / "storage"
    storage_dir.mkdir(parents=True, exist_ok=True)

    minio_proc: subprocess.Popen | None = None

    def _shutdown(*_) -> None:
        if minio_proc is not None:
            try:
                minio_proc.terminate()
                minio_proc.wait(timeout=5)
            except Exception:
                try:
                    minio_proc.kill()
                except Exception:
                    pass
        sys.exit(0)

    signal.signal(signal.SIGTERM, _shutdown)
    if sys.platform != "win32":
        signal.signal(signal.SIGINT, _shutdown)

    # ── 1. Start MinIO ──────────────────────────────────────────────────
    _log("Starting local storage (MinIO)…")
    minio_proc = start_minio(storage_dir, minio_port, minio_ak, minio_sk)
    _wait_http(f"http://127.0.0.1:{minio_port}/minio/health/live")
    ensure_bucket(minio_port, minio_ak, minio_sk)

    # ── 2. Configure + start API ────────────────────────────────────────
    _log("Starting Cellor API…")
    _apply_env(data_dir, api_port, minio_port, minio_ak, minio_sk, jwt_secret)
    _start_api_thread(api_port)
    _wait_http(f"http://127.0.0.1:{api_port}/health")

    # ── 3. Ensure local user + get auto-login token ────────────────────
    _log("Preparing local session…")
    token = ensure_local_user_token(api_port, data_dir)

    # ── 4. Open app window ─────────────────────────────────────────────
    url = f"http://127.0.0.1:{api_port}?token={urllib.parse.quote(token, safe='')}"
    _log(f"Opening {url}")

    try:
        import webview  # noqa: PLC0415

        # Create the window with a blank page first.  Loading the real URL
        # immediately in create_window can fail on macOS before the Cocoa
        # runloop is fully active.  We navigate to the real URL inside the
        # func= startup callback, which fires once the GUI is ready.
        window = webview.create_window(
            "Cellor",
            "about:blank",
            width=1440,
            height=900,
            min_size=(900, 600),
        )

        def _on_window_closed():
            _shutdown()

        window.events.closed += _on_window_closed

        def _on_start(win: "webview.Window") -> None:  # type: ignore[name-defined]
            # Small settle delay so the Cocoa runloop and the API's static-file
            # mount have both fully initialised before the first navigation.
            time.sleep(0.8)
            win.load_url(url)

        _log("Cellor is running. Close the window to quit.")
        # webview.start() blocks the main thread (required by Cocoa/WinRT/GTK).
        webview.start(func=_on_start, args=window, debug=False)
        return  # _shutdown was already called via the closed event

    except ImportError:
        # pywebview not available — fall back to browser + keep-alive loop
        webbrowser.open(url)

    # ── 5. Stay alive; exit if MinIO dies (browser fallback only) ──────
    _log("Cellor is running. Close this window or press Ctrl+C to quit.")
    try:
        while True:
            time.sleep(2)
            if minio_proc.poll() is not None:
                _log("Storage process exited unexpectedly — shutting down.")
                break
    except KeyboardInterrupt:
        pass
    finally:
        _shutdown()


if __name__ == "__main__":
    main()
