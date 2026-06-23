# ── Stage 1: build the React frontend ─────────────────────────────────────────
FROM node:20-alpine AS web-builder
WORKDIR /build
COPY web/package*.json ./
RUN npm ci --legacy-peer-deps
COPY web/ ./
RUN npm run build

# ── Stage 2: Python API runtime + built frontend ───────────────────────────────
FROM python:3.11-slim

# System libs required by openslide and libvips (slide processing)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libopenslide0 openslide-tools libvips42 libvips-tools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY api/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY api/    ./api/
COPY worker/ ./worker/

# Seed catalog files — in production override with a mounted persistent volume
COPY data/catalog/ ./data/catalog/

# Built frontend assets served by FastAPI
COPY --from=web-builder /build/dist ./web/dist

# Default paths (override via env vars on Render)
ENV CATALOG_PATH=/app/data/catalog/catalog.json \
    OVERLAYS_PATH=/app/data/catalog/overlays.json \
    REVIEWS_PATH=/app/data/catalog/reviews.json \
    STATIC_DIR=/app/web/dist

EXPOSE 8000
CMD ["uvicorn", "api.api_service.main:app", "--host", "0.0.0.0", "--port", "8000"]
