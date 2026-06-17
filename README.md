# Cellor Ingestor

Greenfield MVP for server-side WSI ingestion and deck.gl streaming.

## Monorepo Layout

- `api/` FastAPI service for upload orchestration, catalog queries, and manifest resolution.
- `worker/` Python ingestion worker for derived artifacts, tile groups, indexes, and manifests.
- `web/` React + TypeScript viewer using deck.gl tile rendering primitives.
- `docs/` ADRs, glossary, context map, and contracts.
- `scripts/` Local bootstrap and quality helpers.

## Local Workflow

1. Run `scripts/bootstrap.sh` to install local dependencies.
2. Run `pytest api/tests worker/tests` for backend verification.
3. Run `npm test -- --runInBand` inside `web/` for frontend verification.

This repository follows DDD layering:

- `domain`: entities, value objects, and invariants only.
- `application`: use cases and orchestration.
- `infrastructure`: storage, queue, imaging, and config adapters.
- `interfaces`: HTTP and worker entrypoints.
