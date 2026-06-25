# Cellor — Launch & Deployment Guide

---

## Desktop (local, no Docker)

The desktop build bundles MinIO, the API, and the React SPA into a single app that runs without any external dependencies.

### Run from source

```bash
# 1. Create venv with Python 3.12
python3.12 -m venv .venv-desktop
source .venv-desktop/bin/activate

# 2. Install all dependencies
pip install -r api/requirements.txt
pip install pywebview

# 3. Build the React frontend
(cd web && npm ci --legacy-peer-deps && npm run build)

# 4. Download the MinIO binary for your platform
python desktop/scripts/fetch-minio.py

# 5. Launch
python desktop/launcher.py
```

The app opens a native window (WKWebView on macOS). Close the window to shut everything down. User data and credentials are stored in `~/Library/Application Support/Cellor/` (macOS).

### Build a distributable bundle (PyInstaller)

Produces a self-contained `dist/Cellor/` directory you can zip and share.

```bash
# Requires Python 3.12 on PATH as python3.12
bash desktop/scripts/build-local.sh
# Output: dist/Cellor/Cellor
```

> **Note:** `build-local.sh` currently references `python3.11` — update the shebang to `python3.12` if that is your installed version.

---

## Self-hosted (Docker Compose)

Runs the API + MinIO + ingestion daemon locally or on any Linux VM.

```bash
# 1. Copy and fill in credentials
cp .env.example .env
# Edit .env: set MINIO_*, STORAGE_BUCKET, STATE_BACKEND, SUPABASE_JWKS_URL

# 2. Start
docker compose up --build -d

# API:          http://localhost:8000
# MinIO console: http://localhost:9001  (admin/admin)
```

To also run the ingestion worker manually (e.g. to ingest a local slide):

```bash
docker compose --profile manual run worker python worker/ingest.py path/to/slide.svs
```

---

## Cloud (Fly.io)

The project ships two Fly apps: `cellor-api` (API + SPA) and `cellor-worker` (background ingestion daemon).

### Prerequisites

- `fly` CLI installed and authenticated (`fly auth login`)
- A Backblaze B2 bucket (or any S3-compatible store) with credentials
- A Supabase project for auth (or remove `SUPABASE_JWKS_URL` to disable auth)

### First deploy

```bash
# 1. Build the frontend so it gets copied into the Docker image
(cd web && npm ci --legacy-peer-deps && npm run build)

# 2. Set secrets (do this once; values persist across deploys)
fly secrets set \
  MINIO_ACCESS_KEY=<your-key-id> \
  MINIO_SECRET_KEY=<your-app-key> \
  STORAGE_BUCKET=<your-bucket> \
  JWT_SECRET_KEY=$(openssl rand -hex 32) \
  --app cellor-api

# 3. Deploy the API
fly deploy --config fly.toml

# 4. (Optional) Deploy the background ingestion worker
fly secrets set \
  MINIO_ACCESS_KEY=<your-key-id> \
  MINIO_SECRET_KEY=<your-app-key> \
  STORAGE_BUCKET=<your-bucket> \
  --app cellor-worker

fly deploy --config fly.worker.toml
```

### Re-deploy after code changes

```bash
(cd web && npm run build)   # only needed if frontend changed
fly deploy --config fly.toml
```

### Key environment variables

| Variable | Where | Purpose |
|---|---|---|
| `MINIO_ENDPOINT` | both apps | S3-compatible host (no `https://`) |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | both apps | Object storage credentials |
| `STORAGE_BUCKET` | both apps | Single bucket for all namespaces |
| `STATE_BACKEND` | API | `object_store` (cloud) or `file` (local) |
| `JWT_SECRET_KEY` | API | Signs desktop session tokens |
| `SUPABASE_JWKS_URL` | API | Supabase JWKS endpoint for auth; omit to disable |
| `CORS_ORIGINS` | API | Comma-separated allowed origins |
| `STATIC_DIR` | API | Path to built React assets (`/app/web/dist` in Docker) |
