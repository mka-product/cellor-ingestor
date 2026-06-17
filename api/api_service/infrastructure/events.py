"""Purpose: in-memory event publisher for local execution and tests.
Owner context: Identity & Catalog.
Invariants: event order matches publish call order.
Failure modes: none.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from api.api_service.domain.events import DomainEvent


@dataclass
class InMemoryEventPublisher:
    published: list[DomainEvent] = field(default_factory=list)

    def publish(self, event: DomainEvent) -> None:
        self.published.append(event)
