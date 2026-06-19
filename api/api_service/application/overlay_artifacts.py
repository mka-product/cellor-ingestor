"""Purpose: generate canonical OVSI and OVSIP-style overlay artifacts from normalized overlay definitions.
Owner context: Overlay Ingestion and Delivery.
Invariants: artifact paths are deterministic for one slide, overlay, and version; manifest publication happens after artifact writes.
Failure modes: artifact generation errors abort publication and leave no manifest metadata on the overlay definition.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from api.api_service.application.overlay_delivery import build_overlay_manifest, load_overlay_chunk
from api.api_service.domain.models import OverlayDefinition
from api.api_service.infrastructure.minio_proxy import MinioProxy

INLINE_OVSI_THRESHOLD = 2000


@dataclass(frozen=True)
class OverlayArtifactPublication:
    runtime_format: str
    artifact: dict[str, Any]
    chunk_paths: dict[str, str]


def _artifact_root(overlay: OverlayDefinition) -> str:
    return f"s3://derived/overlays/v1/{overlay.slide_id.value}/{overlay.overlay_id.value}/{overlay.version_id}"


def _chunk_document(overlay: OverlayDefinition, chunk_id: str) -> dict[str, Any]:
    payload = load_overlay_chunk(overlay, chunk_id)
    return {
        "schema": "ovsib-v1",
        "slideId": overlay.slide_id.value,
        "overlayId": overlay.overlay_id.value,
        "versionId": overlay.version_id,
        "chunkId": chunk_id,
        **payload,
    }


def publish_overlay_artifacts(proxy: MinioProxy, overlay: OverlayDefinition) -> OverlayArtifactPublication:
    """Write immutable overlay artifacts and return manifest metadata describing them."""
    manifest = build_overlay_manifest(overlay)
    root = _artifact_root(overlay)
    chunk_paths: dict[str, str] = {}
    chunk_summaries = manifest["chunking"]["chunks"]

    if len(overlay.features) <= INLINE_OVSI_THRESHOLD:
        ovsi_path = f"{root}/overlay.ovsi"
        ovsi_payload = {
            "schema": "ovsi-v1",
            "manifest": manifest,
            "chunks": [_chunk_document(overlay, chunk["id"]) for chunk in chunk_summaries],
        }
        proxy.put_bytes(ovsi_path, json.dumps(ovsi_payload, indent=2).encode("utf-8"), "application/vnd.ovsi")
        return OverlayArtifactPublication(
            runtime_format="ovsi",
            artifact={"layout": "single-file", "ovsiPath": ovsi_path, "manifestPath": None, "indexPath": None},
            chunk_paths={},
        )

    manifest_path = f"{root}/overlay.ovsip/manifest.ovsim"
    index_path = f"{root}/overlay.ovsip/index.ovsii"
    styles_path = f"{root}/overlay.ovsip/styles/default.ovsis"
    for chunk in chunk_summaries:
        chunk_id = str(chunk["id"])
        chunk_path = f"{root}/overlay.ovsip/blocks/{chunk_id}.ovsib"
        proxy.put_bytes(chunk_path, json.dumps(_chunk_document(overlay, chunk_id), indent=2).encode("utf-8"), "application/json")
        chunk_paths[chunk_id] = chunk_path

    package_manifest = {
        "schema": "ovsim-v1",
        "slideId": overlay.slide_id.value,
        "overlayId": overlay.overlay_id.value,
        "versionId": overlay.version_id,
        "kind": overlay.kind,
        "legend": list(overlay.legend),
        "metadata": dict(overlay.metadata),
        "chunks": [
            {
                "id": chunk["id"],
                "bounds": chunk["bounds"],
                "featureCount": chunk["featureCount"],
                "blockPath": chunk_paths[str(chunk["id"])],
            }
            for chunk in chunk_summaries
        ],
    }
    package_index = {
        "schema": "ovsii-v1",
        "chunkCount": len(chunk_summaries),
        "chunks": [
            {
                "id": chunk["id"],
                "bounds": chunk["bounds"],
                "featureCount": chunk["featureCount"],
                "blockPath": chunk_paths[str(chunk["id"])],
            }
            for chunk in chunk_summaries
        ],
    }
    style_manifest = {"schema": "ovsis-v1", "legend": list(overlay.legend)}
    proxy.put_bytes(manifest_path, json.dumps(package_manifest, indent=2).encode("utf-8"), "application/json")
    proxy.put_bytes(index_path, json.dumps(package_index, indent=2).encode("utf-8"), "application/json")
    proxy.put_bytes(styles_path, json.dumps(style_manifest, indent=2).encode("utf-8"), "application/json")
    return OverlayArtifactPublication(
        runtime_format="ovsi",
        artifact={
            "layout": "package",
            "ovsiPath": None,
            "manifestPath": manifest_path,
            "indexPath": index_path,
            "stylePath": styles_path,
        },
        chunk_paths=chunk_paths,
    )
