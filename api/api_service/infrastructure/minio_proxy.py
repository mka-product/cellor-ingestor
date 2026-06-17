"""Purpose: read MinIO-backed artifacts and rewrite internal object URLs for browser access.
Owner context: Delivery.
Invariants: `s3://bucket/key` paths resolve deterministically through the API storage proxy.
Failure modes: missing objects raise adapter exceptions mapped to HTTP 404 or 502.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from minio import Minio


@dataclass
class MinioProxy:
    client: Minio
    public_base_path: str = "/storage"

    def get_bytes(self, bucket: str, object_path: str) -> tuple[bytes, str]:
        response = self.client.get_object(bucket, object_path)
        try:
            payload = response.read()
            content_type = response.headers.get("Content-Type", "application/octet-stream")
            return payload, content_type
        finally:
            response.close()
            response.release_conn()

    def load_manifest(self, manifest_path: str) -> dict[str, object]:
        manifest = self.load_json(manifest_path)
        return self._rewrite(manifest)

    def get_s3_bytes(self, object_path: str) -> tuple[bytes, str]:
        bucket, key = self._split(object_path)
        return self.get_bytes(bucket, key)

    def load_json(self, object_path: str) -> dict[str, object]:
        payload, _ = self.get_s3_bytes(object_path)
        return json.loads(payload.decode("utf-8"))

    def proxy_url(self, object_path: str) -> str:
        bucket, key = self._split(object_path)
        return f"{self.public_base_path}/{bucket}/{key}"

    def _rewrite(self, payload: object) -> object:
        if isinstance(payload, dict):
            return {key: self._rewrite(value) for key, value in payload.items()}
        if isinstance(payload, list):
            return [self._rewrite(item) for item in payload]
        if isinstance(payload, str) and payload.startswith("s3://"):
            return self.proxy_url(payload)
        return payload

    def _split(self, path: str) -> tuple[str, str]:
        stripped = path.removeprefix("s3://")
        return stripped.split("/", 1)
