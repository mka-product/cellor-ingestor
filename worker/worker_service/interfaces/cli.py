"""Purpose: simple CLI entrypoint for local ingestion runs.
Owner context: Ingestion.
Invariants: converts arguments to one ingestion request and exits non-zero on failure.
Failure modes: invalid CLI args or ingestion errors terminate the process.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from time import perf_counter

from worker.worker_service.domain.models import IngestionRequest
from worker.worker_service.infrastructure.bootstrap import Container
from worker.worker_service.infrastructure.storage import MinioArtifactStore


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--slide-id", required=True)
    parser.add_argument("--version-id", required=True)
    parser.add_argument("--job-id")
    parser.add_argument("--checksum", required=True)
    parser.add_argument("--original-path", required=True)
    parser.add_argument("--output-root", default=".artifacts")
    parser.add_argument("--catalog-path", default=".artifacts/catalog/catalog.json")
    parser.add_argument("--storage-backend", default="local", choices=["local", "minio"])
    parser.add_argument("--reader-backend", default="fastslide", choices=["local", "openslide", "pyvips", "fastslide"])
    parser.add_argument(
        "--metadata-backend",
        default="openslide",
        choices=["openslide", "fastslide", "pyvips", "local", "render"],
    )
    parser.add_argument("--max-workers", type=int, default=4)
    parser.add_argument("--chunk-group-count", type=int, default=8)
    parser.add_argument("--tissue-mask-size", type=int, default=1024)
    parser.add_argument("--upload-workers", type=int, default=4)
    args = parser.parse_args()

    original_path = Path(args.original_path)
    checksum = args.checksum
    if checksum == "auto":
        digest = hashlib.sha256()
        with original_path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        checksum = f"sha256:{digest.hexdigest()}"

    container = Container(
        root=Path(args.output_root),
        storage_backend=args.storage_backend,
        reader_backend=args.reader_backend,
        metadata_backend=args.metadata_backend,
        catalog_path=Path(args.catalog_path),
        max_workers=args.max_workers,
        chunk_group_count=args.chunk_group_count,
        tissue_mask_size=args.tissue_mask_size,
        upload_workers=args.upload_workers,
    )
    ingestion_service = container.ingestion_service
    job_id = args.job_id or f"job-{args.slide_id}-{args.version_id}"
    ingestion_service.bind_job(job_id=job_id, reader_backend=args.reader_backend)
    raw_object_path = f"s3://raw/{args.slide_id}/{args.version_id}/original/{original_path.name}"
    if isinstance(container.store, MinioArtifactStore):
        container.store.upload_file(raw_object_path, original_path)
    started = perf_counter()
    container.registry.upsert_job(
        {
            "job_id": job_id,
            "slide_id": args.slide_id,
            "version_id": args.version_id,
            "status": "running",
            "reader_backend": args.reader_backend,
            "progress_percent": 1.0,
            "stage": "starting",
            "message": "Worker bootstrapped",
            "started_at": None,
            "updated_at": None,
        }
    )
    print(
        json.dumps(
            {
                "type": "progress",
                "job_id": job_id,
                "slide_id": args.slide_id,
                "version_id": args.version_id,
                "reader_backend": args.reader_backend,
                "progress_percent": 1.0,
                "stage": "starting",
                "message": "Worker bootstrapped",
            }
        ),
        file=sys.stderr,
        flush=True,
    )
    publication = ingestion_service.ingest(
        IngestionRequest(
            slide_id=args.slide_id,
            version_id=args.version_id,
            checksum=checksum,
            original_path=args.original_path,
        )
    )
    elapsed_seconds = perf_counter() - started
    container.registry.upsert_slide(
        {
            "slide_id": publication.slide_id,
            "version_id": publication.version_id,
            "display_name": publication.source_name,
            "checksum": publication.source_checksum,
            "manifest_path": publication.manifest_path,
            "thumbnail_path": publication.thumbnail_path,
            "metrics": {
                "elapsed_seconds": elapsed_seconds,
                "level_count": publication.level_count,
                "tile_count": publication.tile_count,
                "non_empty_tile_count": publication.non_empty_tile_count,
                "group_count": publication.group_count,
                "artifact_bytes": publication.artifact_bytes,
                "timings": publication.timings,
            },
        }
    )
    container.registry.upsert_job(
        {
            "job_id": job_id,
            "slide_id": publication.slide_id,
            "version_id": publication.version_id,
            "status": "succeeded",
            "reader_backend": args.reader_backend,
            "progress_percent": 100.0,
            "stage": "published",
            "message": "Manifest published",
            "started_at": publication.published_at.isoformat(),
            "updated_at": publication.published_at.isoformat(),
        }
    )
    print(
        json.dumps(
            {
                "slide_id": publication.slide_id,
                "version_id": publication.version_id,
                "manifest_path": publication.manifest_path,
                "metrics": {
                    "elapsed_seconds": round(elapsed_seconds, 3),
                    "level_count": publication.level_count,
                    "tile_count": publication.tile_count,
                    "non_empty_tile_count": publication.non_empty_tile_count,
                    "group_count": publication.group_count,
                    "artifact_bytes": publication.artifact_bytes,
                    "timings": publication.timings,
                },
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
