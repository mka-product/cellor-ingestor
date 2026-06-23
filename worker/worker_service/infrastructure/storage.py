"""Purpose: artifact stores and shared manifest catalogs for local and MinIO-backed ingestion.
Owner context: Ingestion.
Invariants: remote-style paths are mapped deterministically under one root.
Failure modes: write failures bubble as filesystem errors.
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from time import perf_counter
from pathlib import Path

from minio import Minio

from worker.worker_service.domain.models import DerivedArtifact


@dataclass
class LocalArtifactStore:
    root: Path

    def write_bytes(self, path: str, payload: bytes, media_type: str) -> DerivedArtifact:
        target = self.root / path.removeprefix("s3://")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
        return DerivedArtifact(path=path, media_type=media_type)

    def exists(self, path: str) -> bool:
        return (self.root / path.removeprefix("s3://")).exists()

    def flush_pending(self, paths: list[str] | None = None, exclude_paths: set[str] | None = None) -> float:
        return 0.0


@dataclass
class MinioArtifactStore:
    client: Minio
    staging_root: Path
    upload_workers: int = 4
    storage_bucket: str = ""
    _pending: dict[str, tuple[Path, str]] = field(default_factory=dict)

    def write_bytes(self, path: str, payload: bytes, media_type: str) -> DerivedArtifact:
        target = self.staging_root / path.removeprefix("s3://")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
        self._pending[path] = (target, media_type)
        return DerivedArtifact(path=path, media_type=media_type)

    def exists(self, path: str) -> bool:
        bucket, key = self._split(path)
        try:
            self.client.stat_object(bucket, key)
            return True
        except Exception:
            return False

    def _split(self, path: str) -> tuple[str, str]:
        stripped = path.removeprefix("s3://")
        virtual_bucket, key = stripped.split("/", 1)
        if self.storage_bucket:
            return self.storage_bucket, f"{virtual_bucket}/{key}"
        return virtual_bucket, key

    def upload_file(self, path: str, source_path: Path, media_type: str = "application/octet-stream") -> DerivedArtifact:
        bucket, key = self._split(path)
        self.client.fput_object(bucket, key, str(source_path), content_type=media_type)
        return DerivedArtifact(path=path, media_type=media_type)

    def flush_pending(self, paths: list[str] | None = None, exclude_paths: set[str] | None = None) -> float:
        candidates = paths if paths is not None else list(self._pending.keys())
        selected = [
            path
            for path in candidates
            if path in self._pending and (exclude_paths is None or path not in exclude_paths)
        ]
        if not selected:
            return 0.0

        def upload(path: str) -> None:
            local_path, media_type = self._pending[path]
            bucket, key = self._split(path)
            self.client.fput_object(bucket, key, str(local_path), content_type=media_type)

        started = perf_counter()
        max_workers = max(1, min(self.upload_workers, len(selected)))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            list(executor.map(upload, selected))
        for path in selected:
            self._pending.pop(path, None)
        return perf_counter() - started


@dataclass
class FileCatalogRegistry:
    catalog_path: Path

    def __post_init__(self) -> None:
        self.catalog_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.catalog_path.exists():
            self.catalog_path.write_text(json.dumps({"slides": [], "jobs": [], "overlay_jobs": []}, indent=2))

    def mark_manifest_ready(self, slide_id: str, version_id: str, manifest_path: str) -> None:
        catalog = self._read()
        for slide in catalog["slides"]:
            if slide["slide_id"] == slide_id and slide["version_id"] == version_id:
                slide["manifest_path"] = manifest_path
                self._write(catalog)
                return
        catalog["slides"].append({"slide_id": slide_id, "version_id": version_id, "manifest_path": manifest_path})
        self._write(catalog)

    def upsert_slide(self, payload: dict[str, object]) -> None:
        catalog = self._read()
        for index, slide in enumerate(catalog["slides"]):
            if slide["slide_id"] == payload["slide_id"] and slide["version_id"] == payload["version_id"]:
                catalog["slides"][index] = payload
                self._write(catalog)
                return
        catalog["slides"].append(payload)
        self._write(catalog)

    def list_slides(self) -> list[dict[str, object]]:
        return self._read()["slides"]

    def upsert_job(self, payload: dict[str, object]) -> None:
        catalog = self._read()
        for index, job in enumerate(catalog["jobs"]):
            if job["job_id"] == payload["job_id"]:
                catalog["jobs"][index] = {**catalog["jobs"][index], **payload}
                self._write(catalog)
                return
        catalog["jobs"].append(payload)
        self._write(catalog)

    def get_job(self, job_id: str) -> dict[str, object]:
        for job in self._read()["jobs"]:
            if job["job_id"] == job_id:
                return job
        raise LookupError("job not found")

    def list_jobs(self) -> list[dict[str, object]]:
        return self._read()["jobs"]

    def _read(self) -> dict[str, list[dict[str, object]]]:
        payload = json.loads(self.catalog_path.read_text())
        payload.setdefault("slides", [])
        payload.setdefault("jobs", [])
        payload.setdefault("overlay_jobs", [])
        return payload

    def _write(self, payload: dict[str, list[dict[str, object]]]) -> None:
        self.catalog_path.write_text(json.dumps(payload, indent=2))
