"""Purpose: core Identity & Catalog domain entities and value objects.
Owner context: Identity & Catalog.
Invariants: slide versions are immutable snapshots; ingestion jobs are append-only lifecycle records.
Failure modes: invalid identity, checksum, or status transitions raise ValueError.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


@dataclass(frozen=True)
class SlideId:
    value: str

    def __post_init__(self) -> None:
        if not self.value.strip():
            raise ValueError("slide id must not be blank")


@dataclass(frozen=True)
class VersionId:
    value: str

    def __post_init__(self) -> None:
        if not self.value.strip():
            raise ValueError("version id must not be blank")


@dataclass(frozen=True)
class Checksum:
    value: str

    def __post_init__(self) -> None:
        if not self.value.strip():
            raise ValueError("checksum must not be blank")


@dataclass(frozen=True)
class StoragePath:
    value: str

    def __post_init__(self) -> None:
        if not self.value.strip():
            raise ValueError("storage path must not be blank")


@dataclass
class SlideVersion:
    slide_id: SlideId
    version_id: VersionId
    original_path: StoragePath
    checksum: Checksum
    created_at: datetime = field(default_factory=utc_now)
    manifest_path: str | None = None


@dataclass
class Slide:
    slide_id: SlideId
    latest_version_id: VersionId | None = None


@dataclass
class IngestionJob:
    job_id: str
    slide_id: SlideId
    version_id: VersionId
    checksum: Checksum
    status: JobStatus = JobStatus.PENDING
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)

    def mark_running(self) -> None:
        self.status = JobStatus.RUNNING
        self.updated_at = utc_now()

    def mark_succeeded(self) -> None:
        self.status = JobStatus.SUCCEEDED
        self.updated_at = utc_now()

    def mark_failed(self) -> None:
        self.status = JobStatus.FAILED
        self.updated_at = utc_now()


@dataclass(frozen=True)
class OverlayId:
    value: str

    def __post_init__(self) -> None:
        if not self.value.strip():
            raise ValueError("overlay id must not be blank")


@dataclass(frozen=True)
class AnnotationLayerId:
    value: str

    def __post_init__(self) -> None:
        if not self.value.strip():
            raise ValueError("annotation layer id must not be blank")


@dataclass(frozen=True)
class AnnotationId:
    value: str

    def __post_init__(self) -> None:
        if not self.value.strip():
            raise ValueError("annotation id must not be blank")


@dataclass(frozen=True)
class CommentId:
    value: str

    def __post_init__(self) -> None:
        if not self.value.strip():
            raise ValueError("comment id must not be blank")


@dataclass(frozen=True)
class OverlayFeature:
    id: str
    name: str
    kind: str
    geometry: dict[str, Any]
    properties: dict[str, Any]
    style_hints: dict[str, Any]
    bounds: tuple[float, float, float, float]


@dataclass(frozen=True)
class OverlayDefinition:
    overlay_id: OverlayId
    slide_id: SlideId
    name: str
    kind: str
    features: tuple[OverlayFeature, ...]
    legend: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True)
class AnnotationLayer:
    layer_id: AnnotationLayerId
    slide_id: SlideId
    name: str
    color: str
    is_visible: bool = True
    is_locked: bool = False


@dataclass(frozen=True)
class AnnotationFeature:
    annotation_id: AnnotationId
    slide_id: SlideId
    layer_id: AnnotationLayerId
    geometry: dict[str, Any]
    properties: dict[str, Any]
    style: dict[str, Any]
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)


@dataclass(frozen=True)
class AnnotationComment:
    comment_id: CommentId
    slide_id: SlideId
    annotation_id: AnnotationId
    body: str
    author: str
    parent_comment_id: CommentId | None = None
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)
