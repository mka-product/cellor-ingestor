"""Purpose: run staged overlay ingestion jobs asynchronously inside the API process.
Owner context: Overlay Ingestion and Delivery.
Invariants: upload requests return after staging; parsing and publication happen off the request thread.
Failure modes: bad sources mark only the affected overlay job as failed and leave the API responsive.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from threading import Event, Lock, Thread

from api.api_service.infrastructure.bootstrap import Container


@dataclass
class InProcessOverlayIngestionRuntime:
    container: Container
    poll_interval_seconds: float = 0.2
    _stop_event: Event = field(default_factory=Event)
    _thread: Thread | None = None
    _queue: list[dict[str, object]] = field(default_factory=list)
    _lock: Lock = field(default_factory=Lock)

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = Thread(target=self._run_loop, name="cellor-overlay-worker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        self._thread = None

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def enqueue(self, staged: dict[str, object]) -> None:
        with self._lock:
            self._queue.append(dict(staged))

    def _dequeue(self) -> dict[str, object] | None:
        with self._lock:
            if not self._queue:
                return None
            return self._queue.pop(0)

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            staged = self._dequeue()
            if staged is None:
                self._stop_event.wait(self.poll_interval_seconds)
                continue
            self._process(staged)

    def _process(self, staged: dict[str, object]) -> None:
        try:
            self.container.overlay_ingestion_service.process_staged_upload(staged)
        except Exception:
            # Failure state is already persisted by the application service.
            return
