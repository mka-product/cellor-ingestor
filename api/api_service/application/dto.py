"""Purpose: application command and query DTOs for upload and catalog use cases.
Owner context: Identity & Catalog and Delivery.
Invariants: DTOs are serializable and carry no behavior.
Failure modes: invalid inputs are rejected by API request models before mapping here.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class InitiateUploadCommand:
    filename: str
    checksum: str


@dataclass(frozen=True)
class CompleteUploadCommand:
    slide_id: str
    version_id: str
    checksum: str
    original_path: str
    reader_backend: str | None = None
    metadata_backend: str | None = None


@dataclass(frozen=True)
class UploadInitiation:
    slide_id: str
    version_id: str
    upload_url: str
    object_path: str


@dataclass(frozen=True)
class SlideVersionView:
    slide_id: str
    version_id: str
    checksum: str
    manifest_path: str | None


@dataclass(frozen=True)
class IngestionJobView:
    job_id: str
    slide_id: str
    version_id: str
    status: str
    display_name: str | None = None
    reader_backend: str | None = None
    metadata_backend: str | None = None
    progress_percent: float | None = None
    stage: str | None = None
    message: str | None = None
