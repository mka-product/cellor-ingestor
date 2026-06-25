# Cellor

WSI ingestion, streaming, and annotation platform — monorepo.

## What it does

- Ingests whole-slide images (SVS, NDPI, TIFF, …) into tile pyramids stored on S3-compatible object storage
- Streams tiles and overlay heatmaps to a deck.gl viewer over a FastAPI backend
- Runs as a **standalone desktop app** (no Docker, no browser needed) or as a **cloud-hosted service** on Fly.io / Docker Compose
- Supports overlay ingestion (cluster maps, OD density, polygon annotations) with two-step delete confirmation
- Background ingestion daemon decoupled from the API for scalable processing

## Monorepo layout

```
api/        FastAPI service — upload orchestration, catalog, manifest, auth
worker/     Ingestion worker — tile pyramids, overlays, cluster summaries
web/        React + TypeScript viewer — deck.gl tiles, overlays, annotations
desktop/    Native desktop launcher (pywebview + bundled MinIO)
docs/       ADRs, glossary, context map, data contracts
scripts/    Local bootstrap and quality helpers
```

## Quick start

See **[DEPLOY.md](DEPLOY.md)** for full instructions. Short version:

### Desktop (macOS / Windows / Linux)

```bash
python3.12 -m venv .venv-desktop && source .venv-desktop/bin/activate
pip install -r api/requirements.txt && pip install pywebview
(cd web && npm ci --legacy-peer-deps && npm run build)
python desktop/scripts/fetch-minio.py
python desktop/launcher.py
```

Opens a native window. No browser, no Docker. User data stored in `~/Library/Application Support/Cellor/`.

### Docker Compose (self-hosted)

```bash
cp .env.example .env   # fill in storage credentials
docker compose up --build -d
# API at http://localhost:8000
```

### Fly.io (cloud)

```bash
(cd web && npm run build)
fly deploy --config fly.toml        # API + SPA
fly deploy --config fly.worker.toml # ingestion worker
```

## Development

```bash
# Backend tests
pytest api/tests worker/tests

# Frontend tests
cd web && npm test -- --runInBand

# Local dev server (hot reload)
cd web && npm run dev
# API: uvicorn api.api_service.main:app --reload
```

## Architecture

Follows DDD layering throughout `api/` and `worker/`:

| Layer | Responsibility |
|---|---|
| `domain/` | Entities, value objects, invariants |
| `application/` | Use cases, orchestration |
| `infrastructure/` | Storage, queue, imaging, config adapters |
| `interfaces/` | HTTP routes, worker entrypoints |

Storage is S3-compatible (Backblaze B2, AWS S3, MinIO). Auth is JWT-based — Supabase JWKS in cloud mode, locally-issued tokens in desktop mode.
