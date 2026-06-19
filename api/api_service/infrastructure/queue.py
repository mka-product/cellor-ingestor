"""Purpose: queue adapter abstraction for local job dispatch and tests.
Owner context: Identity & Catalog.
Invariants: enqueued jobs are recorded in submission order.
Failure modes: none for in-memory implementation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from threading import Lock

from api.api_service.domain.models import IngestionJob


@dataclass
class InMemoryJobQueue:
    jobs: list[IngestionJob] = field(default_factory=list)
    _lock: Lock = field(default_factory=Lock)

    def enqueue(self, job: IngestionJob) -> None:
        with self._lock:
            self.jobs.append(job)

    def dequeue(self) -> IngestionJob | None:
        with self._lock:
            if not self.jobs:
                return None
            return self.jobs.pop(0)

    def remove(self, job_id: str) -> IngestionJob | None:
        with self._lock:
            for index, job in enumerate(self.jobs):
                if job.job_id == job_id:
                    return self.jobs.pop(index)
        return None
