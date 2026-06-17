FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libopenslide0 openslide-tools libvips42 libvips-tools && rm -rf /var/lib/apt/lists/*

COPY worker/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY worker /app/worker

CMD ["python", "-m", "worker.worker_service.interfaces.cli", "--help"]
