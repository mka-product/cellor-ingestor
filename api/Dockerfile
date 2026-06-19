FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libopenslide0 openslide-tools libvips42 libvips-tools && rm -rf /var/lib/apt/lists/*

COPY api/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY api /app/api
COPY worker /app/worker

CMD ["uvicorn", "api.api_service.main:app", "--host", "0.0.0.0", "--port", "8000"]
