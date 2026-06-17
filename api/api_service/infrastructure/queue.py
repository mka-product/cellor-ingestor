"""Purpose: queue adapter abstraction for local job dispatch and tests.
Owner context: Identity & Catalog.
Invariants: enqueued jobs are recorded in submission order.
Failure modes: none for in-memory implementation.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from api.api_service.domain.models import IngestionJob


@dataclass
class InMemoryJobQueue:
    jobs: list[IngestionJob] = field(default_factory=list)

    def enqueue(self, job: IngestionJob) -> None:
        self.jobs.append(job)
