"""Purpose: ingestion worker ports for readers, storage, and event sinks.
Owner context: Ingestion.
Invariants: ports remain framework-agnostic and side effects are explicit.
Failure modes: adapters raise infrastructure errors on IO or codec failures.
"""

from __future__ import annotations

from typing import Protocol

from worker.worker_service.domain.events import WorkerEvent
from worker.worker_service.domain.models import DerivedArtifact, IngestionRequest, SlideMetadata, TileIndexEntry


class SlideSource(Protocol):
    @property
    def dimensions(self) -> tuple[int, int]: ...

    def describe(self) -> object: ...

    def get_thumbnail(self, max_size: tuple[int, int]) -> object: ...

    def read_tile(self, tile_x: int, tile_y: int, tile_size: int, downsample: int) -> object: ...

    def close(self) -> None: ...


class SlideReader(Protocol):
    def open(self, request: IngestionRequest) -> SlideSource: ...


class MetadataReader(Protocol):
    def describe(self, request: IngestionRequest) -> SlideMetadata: ...


class ArtifactStore(Protocol):
    def write_bytes(self, path: str, payload: bytes, media_type: str) -> DerivedArtifact: ...

    def exists(self, path: str) -> bool: ...

    def flush_pending(
        self,
        paths: list[str] | None = None,
        exclude_paths: set[str] | None = None,
    ) -> float: ...


class EventSink(Protocol):
    def publish(self, event: WorkerEvent) -> None: ...


class ManifestSink(Protocol):
    def mark_manifest_ready(self, slide_id: str, version_id: str, manifest_path: str) -> None: ...

    def list_slides(self) -> list[dict[str, object]]: ...


class IndexEncoder(Protocol):
    def encode(self, entries: list[TileIndexEntry]) -> bytes: ...
