FROM node:20-alpine AS web-build

WORKDIR /web
COPY web/package*.json ./
RUN npm ci --legacy-peer-deps
COPY web ./
RUN npm run build

FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libopenslide0 openslide-tools libvips42 libvips-tools && rm -rf /var/lib/apt/lists/*

COPY api/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY api /app/api
COPY worker /app/worker
COPY --from=web-build /web/dist /app/web/dist

CMD ["uvicorn", "api.api_service.main:app", "--host", "0.0.0.0", "--port", "8000"]
