"""Purpose: domain events emitted by upload and catalog workflows.
Owner context: Identity & Catalog.
Invariants: events are immutable facts with correlation-ready metadata.
Failure modes: construction fails on blank identifiers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class DomainEvent:
    name: str
    occurred_at: datetime = field(default_factory=utc_now)


@dataclass(frozen=True)
class OriginalUploaded(DomainEvent):
    slide_id: str = ""
    version_id: str = ""
    checksum: str = ""
    original_path: str = ""

    def __init__(self, slide_id: str, version_id: str, checksum: str, original_path: str) -> None:
        object.__setattr__(self, "name", "OriginalUploaded")
        object.__setattr__(self, "occurred_at", utc_now())
        object.__setattr__(self, "slide_id", slide_id)
        object.__setattr__(self, "version_id", version_id)
        object.__setattr__(self, "checksum", checksum)
        object.__setattr__(self, "original_path", original_path)


@dataclass(frozen=True)
class IngestionRequested(DomainEvent):
    job_id: str = ""
    slide_id: str = ""
    version_id: str = ""

    def __init__(self, job_id: str, slide_id: str, version_id: str) -> None:
        object.__setattr__(self, "name", "IngestionRequested")
        object.__setattr__(self, "occurred_at", utc_now())
        object.__setattr__(self, "job_id", job_id)
        object.__setattr__(self, "slide_id", slide_id)
        object.__setattr__(self, "version_id", version_id)
