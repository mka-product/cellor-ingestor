"""Purpose: background worker daemon that polls B2 catalog for pending jobs and processes them.
Owner context: Ingestion.
Invariants: picks up jobs written by the API; never runs concurrently with another instance
            processing the same job_id (status transition pending → running is the claim).
Failure modes: network errors are retried on the next poll; processing errors mark the job failed.
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from tempfile import TemporaryDirectory

from api.api_service.infrastructure.bootstrap import Container as ApiContainer
from worker.worker_service.domain.models import IngestionRequest
from worker.worker_service.infrastructure.bootstrap import Container as WorkerContainer

logger = logging.getLogger("cellor.daemon")

POLL_INTERVAL = int(os.environ.get("DAEMON_POLL_INTERVAL", "30"))
STAGING_ROOT = Path(os.environ.get("DAEMON_STAGING_ROOT", "/tmp/cellor-daemon"))


def _claim_job(container: ApiContainer, job: dict) -> bool:
    """Transition a pending job to running. Returns False if already claimed."""
    if job.get("status") != "pending":
        return False
    container.catalog.upsert_job({**job, "status": "running", "stage": "starting", "message": "Worker claimed job"})
    refreshed = container.catalog.get_job(str(job["job_id"]))
    return refreshed.get("stage") == "starting"


def _process_job(container: ApiContainer, job: dict) -> None:
    job_id = str(job["job_id"])
    slide_id = str(job["slide_id"])
    version_id = str(job["version_id"])
    original_path = str(job.get("original_path", ""))
    reader_backend = str(job.get("reader_backend", "fastslide"))
    metadata_backend = str(job.get("metadata_backend", "openslide"))
    display_name = str(job.get("display_name", Path(original_path).name or slide_id))

    if not original_path:
        _fail(container, job, "original_path missing from job record")
        return

    logger.info("processing job %s slide=%s reader=%s", job_id, slide_id, reader_backend)

    STAGING_ROOT.mkdir(parents=True, exist_ok=True)
    filename = Path(original_path).name or f"{slide_id}.bin"

    try:
        source_bytes, _ = container.minio_proxy.get_s3_bytes(original_path)
    except Exception as exc:
        _fail(container, job, f"download failed: {exc}")
        return

    try:
        with TemporaryDirectory(dir=STAGING_ROOT) as tmp:
            local_path = Path(tmp) / filename
            local_path.write_bytes(source_bytes)

            worker = WorkerContainer(
                root=STAGING_ROOT,
                storage_backend="minio",
                reader_backend=reader_backend,
                metadata_backend=metadata_backend,
            )
            svc = worker.ingestion_service
            svc.bind_job(job_id=job_id, reader_backend=reader_backend)

            container.catalog.upsert_job({
                **job,
                "status": "running",
                "stage": "ingesting",
                "message": "Ingestion in progress",
                "progress_percent": 5.0,
            })

            publication = svc.ingest(
                IngestionRequest(
                    slide_id=slide_id,
                    version_id=version_id,
                    checksum=str(job.get("checksum", "")),
                    original_path=str(local_path),
                )
            )

        container.catalog.upsert_slide({
            "slide_id": publication.slide_id,
            "version_id": publication.version_id,
            "display_name": publication.source_name,
            "checksum": publication.source_checksum,
            "manifest_path": publication.manifest_path,
            "thumbnail_path": publication.thumbnail_path,
            "metrics": {
                "level_count": publication.level_count,
                "tile_count": publication.tile_count,
                "non_empty_tile_count": publication.non_empty_tile_count,
                "group_count": publication.group_count,
                "artifact_bytes": publication.artifact_bytes,
                "timings": publication.timings,
            },
        })
        container.catalog.upsert_job({
            **job,
            "status": "succeeded",
            "stage": "published",
            "message": "Manifest published",
            "progress_percent": 100.0,
            "display_name": publication.source_name,
            "metrics": {
                "level_count": publication.level_count,
                "tile_count": publication.tile_count,
                "artifact_bytes": publication.artifact_bytes,
            },
        })
        logger.info("job %s succeeded", job_id)
    except Exception as exc:
        logger.exception("job %s failed", job_id)
        _fail(container, job, str(exc))


def _fail(container: ApiContainer, job: dict, message: str) -> None:
    container.catalog.upsert_job({
        **job,
        "status": "failed",
        "stage": "failed",
        "message": message,
        "progress_percent": 100.0,
    })


def run_daemon() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    logger.info("daemon starting (poll_interval=%ss)", POLL_INTERVAL)
    container = ApiContainer()
    while True:
        try:
            jobs = container.catalog.list_jobs()
            pending = [j for j in jobs if j.get("status") == "pending"]
            for job in pending:
                if _claim_job(container, job):
                    _process_job(container, job)
        except Exception:
            logger.exception("poll loop error — will retry")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run_daemon()
