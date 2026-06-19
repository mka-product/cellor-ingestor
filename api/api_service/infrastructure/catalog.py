"""Purpose: file-backed slide catalog shared with the worker.
Owner context: Delivery and Identity & Catalog.
Invariants: catalog file shape stays stable and is read fresh for every request.
Failure modes: malformed or missing catalog files raise runtime errors.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass
class FileCatalog:
    path: Path

    def __post_init__(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text(json.dumps({"slides": [], "jobs": [], "overlay_jobs": []}, indent=2))

    def list_slides(self) -> list[dict[str, object]]:
        return self._read()["slides"]

    def get_slide(self, slide_id: str) -> dict[str, object]:
        for slide in self.list_slides():
            if slide["slide_id"] == slide_id:
                return slide
        raise LookupError("slide not found")

    def get_slide_version(self, slide_id: str, version_id: str) -> dict[str, object]:
        for slide in self.list_slides():
            if slide["slide_id"] == slide_id and slide["version_id"] == version_id:
                return slide
        raise LookupError("slide version not found")

    def list_jobs(self) -> list[dict[str, object]]:
        return self._read()["jobs"]

    def list_overlay_jobs(self) -> list[dict[str, object]]:
        return self._read()["overlay_jobs"]

    def get_job(self, job_id: str) -> dict[str, object]:
        for job in self.list_jobs():
            if job["job_id"] == job_id:
                return job
        raise LookupError("job not found")

    def upsert_job(self, payload: dict[str, object]) -> None:
        catalog = self._read()
        for index, job in enumerate(catalog["jobs"]):
            if job["job_id"] == payload["job_id"]:
                catalog["jobs"][index] = {**catalog["jobs"][index], **payload}
                self._write(catalog)
                return
        catalog["jobs"].append(payload)
        self._write(catalog)

    def upsert_slide(self, payload: dict[str, object]) -> None:
        catalog = self._read()
        for index, slide in enumerate(catalog["slides"]):
            if slide["slide_id"] == payload["slide_id"] and slide["version_id"] == payload["version_id"]:
                catalog["slides"][index] = {**catalog["slides"][index], **payload}
                self._write(catalog)
                return
        catalog["slides"].append(payload)
        self._write(catalog)

    def get_overlay_job(self, job_id: str) -> dict[str, object]:
        for job in self.list_overlay_jobs():
            if job["job_id"] == job_id:
                return job
        raise LookupError("overlay job not found")

    def upsert_overlay_job(self, payload: dict[str, object]) -> None:
        catalog = self._read()
        for index, job in enumerate(catalog["overlay_jobs"]):
            if job["job_id"] == payload["job_id"]:
                catalog["overlay_jobs"][index] = {**catalog["overlay_jobs"][index], **payload}
                self._write(catalog)
                return
        catalog["overlay_jobs"].append(payload)
        self._write(catalog)

    def _read(self) -> dict[str, list[dict[str, object]]]:
        payload = json.loads(self.path.read_text())
        payload.setdefault("slides", [])
        payload.setdefault("jobs", [])
        payload.setdefault("overlay_jobs", [])
        return payload

    def _write(self, payload: dict[str, list[dict[str, object]]]) -> None:
        self.path.write_text(json.dumps(payload, indent=2))
