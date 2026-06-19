"""Purpose: derive stable overlay delivery manifests and chunk payloads from stored overlays.
Owner context: Delivery.
Invariants: chunk ids are deterministic for one overlay version and chunk membership depends only on feature bounds.
Failure modes: malformed feature bounds degrade to empty chunks rather than mutating source overlay state.
"""

from __future__ import annotations

import math
from typing import Any

from api.api_service.domain.models import OverlayDefinition, OverlayFeature

DEFAULT_CHUNK_SIZE = 2048.0


def _feature_bounds(feature: OverlayFeature) -> tuple[float, float, float, float]:
    min_x, min_y, max_x, max_y = feature.bounds
    return float(min_x), float(min_y), float(max_x), float(max_y)


def overlay_bounds(overlay: OverlayDefinition) -> tuple[float, float, float, float]:
    if not overlay.features:
        return (0.0, 0.0, 0.0, 0.0)
    min_x = math.inf
    min_y = math.inf
    max_x = -math.inf
    max_y = -math.inf
    for feature in overlay.features:
        feature_min_x, feature_min_y, feature_max_x, feature_max_y = _feature_bounds(feature)
        min_x = min(min_x, feature_min_x)
        min_y = min(min_y, feature_min_y)
        max_x = max(max_x, feature_max_x)
        max_y = max(max_y, feature_max_y)
    if math.isinf(min_x) or math.isinf(min_y):
        return (0.0, 0.0, 0.0, 0.0)
    return (min_x, min_y, max_x, max_y)


def _chunk_size(overlay: OverlayDefinition) -> float:
    grid = overlay.metadata.get("grid", {})
    if isinstance(grid, dict):
        tile_width = grid.get("tile_width") or grid.get("tileWidth")
        tile_height = grid.get("tile_height") or grid.get("tileHeight")
        if isinstance(tile_width, (int, float)) and isinstance(tile_height, (int, float)):
            return max(float(tile_width), float(tile_height), 1.0) * 8.0
    return DEFAULT_CHUNK_SIZE


def _chunk_identity(chunk_x: int, chunk_y: int) -> str:
    return f"chunk-{chunk_x}-{chunk_y}"


def _intersects(
    left_a: float,
    top_a: float,
    right_a: float,
    bottom_a: float,
    left_b: float,
    top_b: float,
    right_b: float,
    bottom_b: float,
) -> bool:
    return not (right_a < left_b or right_b < left_a or bottom_a < top_b or bottom_b < top_a)


def build_overlay_manifest(overlay: OverlayDefinition) -> dict[str, Any]:
    """Build a deterministic spatial manifest without mutating the stored overlay."""
    chunk_size = _chunk_size(overlay)
    bounds = overlay_bounds(overlay)
    min_x, min_y, max_x, max_y = bounds
    chunks: dict[str, dict[str, Any]] = {}
    for feature in overlay.features:
        feature_min_x, feature_min_y, feature_max_x, feature_max_y = _feature_bounds(feature)
        start_x = int(math.floor(feature_min_x / chunk_size))
        start_y = int(math.floor(feature_min_y / chunk_size))
        end_x = int(math.floor(feature_max_x / chunk_size))
        end_y = int(math.floor(feature_max_y / chunk_size))
        for chunk_x in range(start_x, end_x + 1):
            for chunk_y in range(start_y, end_y + 1):
                chunk_id = _chunk_identity(chunk_x, chunk_y)
                if chunk_id not in chunks:
                    left = chunk_x * chunk_size
                    top = chunk_y * chunk_size
                    chunks[chunk_id] = {
                        "id": chunk_id,
                        "bounds": [left, top, left + chunk_size, top + chunk_size],
                        "featureCount": 0,
                        "path": f"chunks/{chunk_id}",
                    }
                chunks[chunk_id]["featureCount"] += 1
    chunk_path_overrides = overlay.metadata.get("chunkPaths", {})
    ordered_chunks = []
    for item in sorted(chunks.values(), key=lambda item: item["id"]):
        chunk_id = str(item["id"])
        if isinstance(chunk_path_overrides, dict) and chunk_id in chunk_path_overrides:
            item = {**item, "path": str(chunk_path_overrides[chunk_id])}
        ordered_chunks.append(item)
    return {
        "schema": "overlay-manifest-v1",
        "slideId": overlay.slide_id.value,
        "overlayId": overlay.overlay_id.value,
        "name": overlay.name,
        "kind": overlay.kind,
        "versionId": overlay.version_id,
        "sourceFormat": overlay.source_format,
        "coordinateSpace": {"origin": "top-left", "unit": "level-0-pixel"},
        "runtimeFormat": str(overlay.metadata.get("runtimeFormat", "inline")),
        "artifact": dict(overlay.metadata.get("artifact", {})),
        "featureCount": len(overlay.features),
        "bounds": [min_x, min_y, max_x, max_y],
        "legend": list(overlay.legend),
        "metadata": dict(overlay.metadata),
        "chunking": {
            "strategy": "spatial-fixed-grid",
            "chunkSize": chunk_size,
            "chunks": ordered_chunks,
        },
    }


def load_overlay_chunk(overlay: OverlayDefinition, chunk_id: str) -> dict[str, Any]:
    """Resolve one manifest chunk into a transport payload for the viewer."""
    manifest = build_overlay_manifest(overlay)
    chunk = next((item for item in manifest["chunking"]["chunks"] if item["id"] == chunk_id), None)
    if chunk is None:
        raise LookupError("overlay chunk not found")
    left, top, right, bottom = [float(value) for value in chunk["bounds"]]
    features = [
        {
            "id": feature.id,
            "name": feature.name,
            "kind": feature.kind,
            "geometry": feature.geometry,
            "properties": feature.properties,
            "styleHints": feature.style_hints,
            "bounds": list(feature.bounds),
        }
        for feature in overlay.features
        if _intersects(*_feature_bounds(feature), left, top, right, bottom)
    ]
    return {
        "id": chunk_id,
        "bounds": chunk["bounds"],
        "featureCount": len(features),
        "features": features,
    }
