"""Purpose: compose worker dependencies for local execution and tests.
Owner context: Ingestion.
Invariants: one container owns one storage root and registry.
Failure modes: startup fails on invalid root path or dependency wiring.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from multiprocessing import cpu_count
from pathlib import Path
from typing import Optional

from minio import Minio

from worker.worker_service.application.services import IngestionApplicationService
from worker.worker_service.infrastructure.events import InMemoryEventSink
from worker.worker_service.infrastructure.index import BinaryIndexCodec
from worker.worker_service.infrastructure.reader import (
    FastSlideReader,
    LocalSlideReader,
    OpenSlideReader,
    build_metadata_reader,
)
from worker.worker_service.infrastructure.storage import FileCatalogRegistry, LocalArtifactStore, MinioArtifactStore


@dataclass
class Container:
    root: Path
    storage_backend: str = "local"
    reader_backend: str = "fastslide"
    metadata_backend: str = "openslide"
    catalog_path: Optional[Path] = None
    events: InMemoryEventSink = field(default_factory=InMemoryEventSink)
    max_workers: int | None = None
    chunk_group_count: int = 8
    tissue_mask_size: int = 1024
    upload_workers: int = 4

    def __post_init__(self) -> None:
        catalog_path = self.catalog_path or self.root / "catalog.json"
        self.registry = FileCatalogRegistry(catalog_path)
        self.max_workers = self.max_workers or max(1, min(cpu_count(), int(os.environ.get("INGEST_MAX_WORKERS", "4"))))
        self.chunk_group_count = int(os.environ.get("INGEST_CHUNK_GROUP_COUNT", str(self.chunk_group_count)))
        self.tissue_mask_size = int(os.environ.get("INGEST_TISSUE_MASK_SIZE", str(self.tissue_mask_size)))
        self.upload_workers = int(os.environ.get("INGEST_UPLOAD_WORKERS", str(self.upload_workers)))
        if self.storage_backend == "minio":
            endpoint = os.environ.get("MINIO_ENDPOINT", "minio:9000")
            access_key = os.environ.get("MINIO_ACCESS_KEY", "minioadmin")
            secret_key = os.environ.get("MINIO_SECRET_KEY", "minioadmin")
            secure = os.environ.get("MINIO_SECURE", "false").lower() == "true"
            self.store = MinioArtifactStore(
                Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=secure),
                staging_root=self.root,
                upload_workers=self.upload_workers,
            )
        else:
            self.store = LocalArtifactStore(self.root)
        if self.reader_backend == "openslide":
            self.reader = OpenSlideReader()
        elif self.reader_backend == "fastslide":
            self.reader = FastSlideReader()
        elif self.reader_backend == "pyvips":
            from worker.worker_service.infrastructure.reader import PyVipsReader

            self.reader = PyVipsReader()
        else:
            self.reader = LocalSlideReader()
        self.metadata_reader = build_metadata_reader(self.metadata_backend, self.reader_backend)
        self.index_codec = BinaryIndexCodec()

    @property
    def ingestion_service(self) -> IngestionApplicationService:
        return IngestionApplicationService(
            reader=self.reader,
            metadata_reader=self.metadata_reader,
            store=self.store,
            events=self.events,
            index_encoder=self.index_codec,
            manifest_sink=self.registry,
            reader_backend=self.reader_backend,
            max_workers=self.max_workers,
            chunk_group_count=self.chunk_group_count,
            tissue_mask_size=self.tissue_mask_size,
            progress_sink=self.registry,
        )
