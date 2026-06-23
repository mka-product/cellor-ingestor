"""Purpose: environment-backed runtime settings for API deployment.
Owner context: Delivery.
Invariants: defaults support local Docker deployment without extra configuration.
Failure modes: invalid environment values trigger startup errors.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    state_backend: str
    catalog_path: Path
    overlays_path: Path
    reviews_path: Path
    catalog_uri: str
    overlays_uri: str
    reviews_uri: str
    minio_endpoint: str
    minio_access_key: str
    minio_secret_key: str
    minio_secure: bool
    storage_bucket: str  # when set, all s3:// URIs are mapped into this single bucket

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            state_backend=os.environ.get("STATE_BACKEND", "file"),
            catalog_path=Path(os.environ.get("CATALOG_PATH", ".artifacts/catalog/catalog.json")),
            overlays_path=Path(os.environ.get("OVERLAYS_PATH", ".artifacts/catalog/overlays.json")),
            reviews_path=Path(os.environ.get("REVIEWS_PATH", ".artifacts/catalog/reviews.json")),
            catalog_uri=os.environ.get("CATALOG_URI", "s3://app-state/catalog/catalog.json"),
            overlays_uri=os.environ.get("OVERLAYS_URI", "s3://app-state/catalog/overlays.json"),
            reviews_uri=os.environ.get("REVIEWS_URI", "s3://app-state/catalog/reviews.json"),
            minio_endpoint=os.environ.get("MINIO_ENDPOINT", "minio:9000"),
            minio_access_key=os.environ.get("MINIO_ACCESS_KEY", "minioadmin"),
            minio_secret_key=os.environ.get("MINIO_SECRET_KEY", "minioadmin"),
            minio_secure=os.environ.get("MINIO_SECURE", "false").lower() == "true",
            storage_bucket=os.environ.get("STORAGE_BUCKET", ""),
        )
