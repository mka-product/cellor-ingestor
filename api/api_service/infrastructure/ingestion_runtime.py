"""Purpose: in-process ingestion runtime for local API-hosted worker execution.
Owner context: Ingestion and Delivery.
Invariants: queued jobs are consumed serially inside the API process; published manifests remain worker-owned outputs.
Failure modes: missing source versions or reader failures mark only the affected job as failed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event, Lock, Thread
from time import perf_counter

from api.api_service.domain.models import IngestionJob, JobStatus, utc_now
from api.api_service.infrastructure.bootstrap import Container
from worker.worker_service.domain.models import IngestionRequest
from worker.worker_service.infrastructure.bootstrap import Container as WorkerContainer


@dataclass
class InProcessIngestionRuntime:
    container: Container
    poll_interval_seconds: float = 0.5
    staging_root: Path = Path("/tmp/cellor-api-worker")
    _stop_event: Event = field(default_factory=Event)
    _thread: Thread | None = None
    _cancelled_job_ids: set[str] = field(default_factory=set)
    _cancel_lock: Lock = field(default_factory=Lock)

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = Thread(target=self._run_loop, name="cellor-api-worker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        self._thread = None

    def cancel(self, job_id: str) -> bool:
        removed = self.container.queue.remove(job_id)
        if removed is None:
            job = self.container.jobs.get(job_id)
            if job is None or job.status not in {JobStatus.PENDING, JobStatus.RUNNING}:
                return False
            with self._cancel_lock:
                self._cancelled_job_ids.add(job_id)
            try:
                existing_payload = self.container.catalog.get_job(job_id)
                progress_percent = float(existing_payload.get("progress_percent", 0.0))
                display_name = str(existing_payload.get("display_name", job.slide_id.value))
            except Exception:
                progress_percent = 0.0
                display_name = job.slide_id.value
            self.container.catalog.upsert_job(
                {
                    "job_id": job.job_id,
                    "slide_id": job.slide_id.value,
                    "version_id": job.version_id.value,
                    "status": "running" if job.status == JobStatus.RUNNING else "pending",
                    "display_name": display_name,
                    "progress_percent": 100.0 if job.status == JobStatus.PENDING else progress_percent,
                    "stage": "cancelling",
                    "message": "Cancellation requested",
                    "updated_at": utc_now().isoformat(),
                }
            )
            if job.status == JobStatus.PENDING:
                self._mark_cancelled(job, "Cancelled before worker pickup")
            return True
        self._mark_cancelled(removed, "Cancelled before worker pickup")
        return True

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            job = self.container.queue.dequeue()
            if job is None:
                self._stop_event.wait(self.poll_interval_seconds)
                continue
            self._process_job(job)

    def _process_job(self, job: IngestionJob) -> None:
        version = self.container.versions.get(job.slide_id, job.version_id)
        if version is None:
            self._mark_failed(job, "Missing slide version for queued job")
            return
        try:
            payload = self.container.catalog.get_job(job.job_id)
        except LookupError:
            payload = {}
        reader_backend = str(payload.get("reader_backend", "fastslide"))
        metadata_backend = str(payload.get("metadata_backend", "openslide"))
        display_name = str(payload.get("display_name") or Path(version.original_path.value).name or job.slide_id.value)
        job.mark_running()
        self.container.jobs.save(job)
        self.container.catalog.upsert_job(
            {
                "job_id": job.job_id,
                "slide_id": job.slide_id.value,
                "version_id": job.version_id.value,
                "status": JobStatus.RUNNING.value,
                "display_name": display_name,
                "reader_backend": reader_backend,
                "metadata_backend": metadata_backend,
                "progress_percent": 1.0,
                "stage": "starting",
                "message": "Worker bootstrapped",
                "started_at": job.updated_at.isoformat(),
                "updated_at": job.updated_at.isoformat(),
                "metrics": {},
            }
        )
        self.staging_root.mkdir(parents=True, exist_ok=True)
        filename = Path(version.original_path.value).name or f"{job.slide_id.value}.bin"
        started = perf_counter()
        try:
            source_bytes, _ = self.container.minio_proxy.get_s3_bytes(version.original_path.value)
            with TemporaryDirectory(dir=self.staging_root) as temporary_dir:
                local_original = Path(temporary_dir) / filename
                local_original.write_bytes(source_bytes)
                worker = WorkerContainer(
                    root=self.staging_root,
                    storage_backend="minio",
                    reader_backend=reader_backend,
                    metadata_backend=metadata_backend,
                    catalog_path=self.container.settings.catalog_path,
                )
                ingestion_service = worker.ingestion_service
                ingestion_service.bind_job(job_id=job.job_id, reader_backend=reader_backend)
                ingestion_service.set_cancel_checker(lambda: self._is_cancel_requested(job.job_id))
                publication = ingestion_service.ingest(
                    IngestionRequest(
                        slide_id=job.slide_id.value,
                        version_id=job.version_id.value,
                        checksum=job.checksum.value,
                        original_path=str(local_original),
                    )
                )
                slide = self.container.slides.get(job.slide_id)
                if slide is not None:
                    slide.latest_version_id = job.version_id
                    self.container.slides.save(slide)
                version.manifest_path = publication.manifest_path
                self.container.versions.save(version)
                job.mark_succeeded()
                self.container.jobs.save(job)
                elapsed_seconds = round(perf_counter() - started, 3)
                self.container.catalog.upsert_slide(
                    {
                        "slide_id": publication.slide_id,
                        "version_id": publication.version_id,
                        "display_name": publication.source_name,
                        "checksum": publication.source_checksum,
                        "manifest_path": publication.manifest_path,
                        "thumbnail_path": publication.thumbnail_path,
                        "metrics": {
                            "elapsed_seconds": elapsed_seconds,
                            "level_count": publication.level_count,
                            "tile_count": publication.tile_count,
                            "non_empty_tile_count": publication.non_empty_tile_count,
                            "group_count": publication.group_count,
                            "artifact_bytes": publication.artifact_bytes,
                            "timings": publication.timings,
                        },
                    }
                )
                self.container.catalog.upsert_job(
                    {
                        "job_id": job.job_id,
                        "slide_id": job.slide_id.value,
                        "version_id": job.version_id.value,
                        "status": JobStatus.SUCCEEDED.value,
                        "display_name": publication.source_name,
                        "reader_backend": reader_backend,
                        "metadata_backend": metadata_backend,
                        "progress_percent": 100.0,
                        "stage": "published",
                        "message": "Manifest published",
                        "updated_at": job.updated_at.isoformat(),
                        "metrics": {
                            "elapsed_seconds": elapsed_seconds,
                            "level_count": publication.level_count,
                            "tile_count": publication.tile_count,
                            "non_empty_tile_count": publication.non_empty_tile_count,
                            "group_count": publication.group_count,
                            "artifact_bytes": publication.artifact_bytes,
                            "timings": publication.timings,
                        },
                    }
                )
        except Exception as error:
            if self._is_cancel_requested(job.job_id):
                self._mark_cancelled(job, "Cancelled during ingestion")
                return
            self._mark_failed(job, str(error))
        finally:
            self._clear_cancel_request(job.job_id)

    def _mark_failed(self, job: IngestionJob, message: str) -> None:
        job.mark_failed()
        self.container.jobs.save(job)
        self.container.catalog.upsert_job(
            {
                "job_id": job.job_id,
                "slide_id": job.slide_id.value,
                "version_id": job.version_id.value,
                "status": JobStatus.FAILED.value,
                "progress_percent": 100.0,
                "stage": "failed",
                "message": message,
                "updated_at": job.updated_at.isoformat(),
            }
        )

    def _mark_cancelled(self, job: IngestionJob, message: str) -> None:
        job.mark_failed()
        self.container.jobs.save(job)
        self.container.catalog.upsert_job(
            {
                "job_id": job.job_id,
                "slide_id": job.slide_id.value,
                "version_id": job.version_id.value,
                "status": "failed",
                "display_name": self.container.catalog.get_job(job.job_id).get("display_name", job.slide_id.value)
                if hasattr(self.container.catalog, "get_job")
                else job.slide_id.value,
                "progress_percent": 100.0,
                "stage": "cancelled",
                "message": message,
                "updated_at": job.updated_at.isoformat(),
            }
        )

    def _is_cancel_requested(self, job_id: str) -> bool:
        with self._cancel_lock:
            return job_id in self._cancelled_job_ids

    def _clear_cancel_request(self, job_id: str) -> None:
        with self._cancel_lock:
            self._cancelled_job_ids.discard(job_id)
