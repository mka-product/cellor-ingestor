"""Purpose: read MinIO-backed artifacts and rewrite internal object URLs for browser access.
Owner context: Delivery.
Invariants: `s3://bucket/key` paths resolve deterministically through the API storage proxy.
Failure modes: missing objects raise adapter exceptions mapped to HTTP 404 or 502.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from io import BytesIO
from typing import Any

from minio import Minio
from minio.error import S3Error


@dataclass
class MinioProxy:
    client: Minio
    public_base_path: str = "/storage"
    storage_bucket: str = ""  # when non-empty, all virtual buckets map into this single real bucket

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

    def load_json_or_default(self, object_path: str, default: dict[str, Any]) -> dict[str, Any]:
        try:
            payload = self.load_json(object_path)
        except S3Error as error:
            if error.code in {"NoSuchKey", "NoSuchBucket", "NoSuchObject"}:
                return default
            raise
        return dict(payload)

    def put_json(self, object_path: str, payload: dict[str, Any]) -> None:
        self.put_bytes(object_path, json.dumps(payload, indent=2).encode("utf-8"), "application/json")

    def object_exists(self, object_path: str) -> bool:
        bucket, key = self.split_uri(object_path)
        try:
            self.client.stat_object(bucket, key)
        except S3Error as error:
            if error.code in {"NoSuchKey", "NoSuchBucket", "NoSuchObject"}:
                return False
            raise
        return True

    def put_bytes(self, object_path: str, payload: bytes, media_type: str = "application/octet-stream") -> None:
        bucket, key = self.split_uri(object_path)
        if not self.client.bucket_exists(bucket):
            self.client.make_bucket(bucket)
        self.client.put_object(bucket, key, BytesIO(payload), len(payload), content_type=media_type)

    def proxy_url(self, object_path: str) -> str:
        bucket, key = self.split_uri(object_path)
        return f"{self.public_base_path}/{bucket}/{key}"

    def rewrite_payload(self, payload: object) -> object:
        return self._rewrite(payload)

    def _rewrite(self, payload: object) -> object:
        if isinstance(payload, dict):
            return {key: self._rewrite(value) for key, value in payload.items()}
        if isinstance(payload, list):
            return [self._rewrite(item) for item in payload]
        if isinstance(payload, str) and payload.startswith("s3://"):
            return self.proxy_url(payload)
        return payload

    def split_uri(self, path: str) -> tuple[str, str]:
        stripped = path.removeprefix("s3://")
        virtual_bucket, key = stripped.split("/", 1)
        if self.storage_bucket:
            return self.storage_bucket, f"{virtual_bucket}/{key}"
        return virtual_bucket, key

    def _split(self, path: str) -> tuple[str, str]:
        return self.split_uri(path)

    def probe(self) -> dict:
        try:
            buckets = [b.name for b in self.client.list_buckets()]
            if self.storage_bucket and self.storage_bucket not in buckets:
                return {"reachable": True, "bucket_ok": False, "error": f"bucket '{self.storage_bucket}' not found"}
            return {"reachable": True, "bucket_ok": True, "error": None}
        except Exception as exc:
            return {"reachable": False, "bucket_ok": False, "error": str(exc)}
