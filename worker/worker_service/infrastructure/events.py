"""Purpose: in-memory event sink for worker tests and local execution.
Owner context: Ingestion.
Invariants: preserves event order.
Failure modes: none.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from worker.worker_service.domain.events import WorkerEvent


@dataclass
class InMemoryEventSink:
    events: list[WorkerEvent] = field(default_factory=list)

    def publish(self, event: WorkerEvent) -> None:
        self.events.append(event)
