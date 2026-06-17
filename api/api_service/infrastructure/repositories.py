"""Purpose: local in-memory repositories for API bootstrap and tests.
Owner context: Identity & Catalog and Delivery.
Invariants: stores are keyed by immutable identifiers and behave deterministically in-process.
Failure modes: none outside programmer misuse.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from api.api_service.domain.models import IngestionJob, Slide, SlideId, SlideVersion, VersionId


@dataclass
class InMemorySlideRepository:
    _items: dict[str, Slide] = field(default_factory=dict)

    def get(self, slide_id: SlideId) -> Slide | None:
        return self._items.get(slide_id.value)

    def save(self, slide: Slide) -> None:
        self._items[slide.slide_id.value] = slide


@dataclass
class InMemorySlideVersionRepository:
    _items: dict[tuple[str, str], SlideVersion] = field(default_factory=dict)

    def get(self, slide_id: SlideId, version_id: VersionId) -> SlideVersion | None:
        return self._items.get((slide_id.value, version_id.value))

    def find_by_checksum(self, checksum: str) -> SlideVersion | None:
        for version in self._items.values():
            if version.checksum.value == checksum:
                return version
        return None

    def save(self, version: SlideVersion) -> None:
        self._items[(version.slide_id.value, version.version_id.value)] = version


@dataclass
class InMemoryIngestionJobRepository:
    _items: dict[str, IngestionJob] = field(default_factory=dict)

    def get_by_version(self, slide_id: SlideId, version_id: VersionId) -> IngestionJob | None:
        for job in self._items.values():
            if job.slide_id == slide_id and job.version_id == version_id:
                return job
        return None

    def get(self, job_id: str) -> IngestionJob | None:
        return self._items.get(job_id)

    def save(self, job: IngestionJob) -> None:
        self._items[job.job_id] = job
