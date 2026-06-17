"""Purpose: ingestion domain events emitted during worker execution.
Owner context: Ingestion.
Invariants: lifecycle events follow request processing order.
Failure modes: none.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class WorkerEvent:
    name: str
    slide_id: str
    version_id: str
    occurred_at: datetime = field(default_factory=utc_now)


def ingestion_started(slide_id: str, version_id: str) -> WorkerEvent:
    return WorkerEvent(name="IngestionStarted", slide_id=slide_id, version_id=version_id)


def ingestion_completed(slide_id: str, version_id: str) -> WorkerEvent:
    return WorkerEvent(name="IngestionCompleted", slide_id=slide_id, version_id=version_id)


def manifest_published(slide_id: str, version_id: str) -> WorkerEvent:
    return WorkerEvent(name="ManifestPublished", slide_id=slide_id, version_id=version_id)


def ingestion_failed(slide_id: str, version_id: str) -> WorkerEvent:
    return WorkerEvent(name="IngestionFailed", slide_id=slide_id, version_id=version_id)
