"""Purpose: generate canonical OVSI and OVSIP-style overlay artifacts from normalized overlay definitions.
Owner context: Overlay Ingestion and Delivery.
Invariants: artifact paths are deterministic for one slide, overlay, and version; manifest publication happens after artifact writes.
Failure modes: artifact generation errors abort publication and leave no manifest metadata on the overlay definition.
"""

from __future__ import annotations

import json
import math
import tempfile
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter
from typing import Any

import duckdb
from shapely.geometry import shape
from shapely import wkb, wkt

from api.api_service.application.overlay_delivery import build_overlay_manifest, load_overlay_chunk
from api.api_service.domain.models import OverlayDefinition
from api.api_service.infrastructure.minio_proxy import MinioProxy

INLINE_OVSI_THRESHOLD = 2000
SIMPLIFIED_MIN_POINTS = 6
SIMPLIFIED_MAX_POINTS = 8


@dataclass(frozen=True)
class OverlayArtifactPublication:
    runtime_format: str
    artifact: dict[str, Any]
    chunk_paths: dict[str, str]
    delivery_manifest: dict[str, Any] | None = None


@dataclass(frozen=True)
class StreamingOverlayPublication:
    publication: OverlayArtifactPublication
    manifest: dict[str, Any]
    feature_count: int
    legend: list[dict[str, Any]]
    bounds: tuple[float, float, float, float]
    parse_elapsed_seconds: float
    publish_elapsed_seconds: float


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


def _feature_bounds_from_payload(feature: dict[str, Any]) -> tuple[float, float, float, float]:
    bounds = feature.get("bounds", [0.0, 0.0, 0.0, 0.0])
    return (
        float(bounds[0]),
        float(bounds[1]),
        float(bounds[2]),
        float(bounds[3]),
    )


def _feature_class_from_payload(feature: dict[str, Any]) -> str:
    properties = feature.get("properties", {})
    return str(properties.get("class") or properties.get("label") or "default")


def _feature_score_from_payload(feature: dict[str, Any]) -> float:
    value = feature.get("properties", {}).get("score")
    return float(value) if isinstance(value, (int, float)) else 0.0


_OD_FIELD_CANDIDATES = ("od", "OD", "optical_density", "od_nucleus", "od_cytoplasm", "od_membrane")


def _feature_od_from_payload(feature: dict[str, Any]) -> float | None:
    props = feature.get("properties", {})
    for key in _OD_FIELD_CANDIDATES:
        v = props.get(key)
        if isinstance(v, (int, float)) and math.isfinite(float(v)):
            return float(v)
    return None


def _feature_color_from_payload(feature: dict[str, Any]) -> tuple[int, int, int, int]:
    color = feature.get("styleHints", {}).get("color")
    if isinstance(color, list) and len(color) >= 3:
        return (
            int(color[0]),
            int(color[1]),
            int(color[2]),
            int(color[3]) if len(color) > 3 else 180,
        )
    return (56, 189, 248, 180)


def _ring_without_closure(ring: list[list[float]]) -> list[list[float]]:
    if len(ring) >= 2 and ring[0] == ring[-1]:
        return ring[:-1]
    return ring


def _close_ring(ring: list[list[float]]) -> list[list[float]]:
    if not ring:
        return ring
    return ring if ring[0] == ring[-1] else [*ring, ring[0]]


def _point_line_distance(point: list[float], start: list[float], end: list[float]) -> float:
    x0, y0 = point[0], point[1]
    x1, y1 = start[0], start[1]
    x2, y2 = end[0], end[1]
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x0 - x1, y0 - y1)
    return abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / math.hypot(dx, dy)


def _rdp(points: list[list[float]], epsilon: float) -> list[list[float]]:
    if len(points) <= 2:
        return list(points)
    max_distance = -1.0
    split_index = -1
    start = points[0]
    end = points[-1]
    for index in range(1, len(points) - 1):
        distance = _point_line_distance(points[index], start, end)
        if distance > max_distance:
            max_distance = distance
            split_index = index
    if max_distance > epsilon and split_index != -1:
        left = _rdp(points[: split_index + 1], epsilon)
        right = _rdp(points[split_index:], epsilon)
        return [*left[:-1], *right]
    return [start, end]


def _downsample_ring(points: list[list[float]], target_vertices: int) -> list[list[float]]:
    if len(points) <= target_vertices:
        return list(points)
    selected: list[list[float]] = []
    last_index = len(points) - 1
    for position in range(target_vertices):
        index = round((position * last_index) / max(1, target_vertices - 1))
        selected.append(points[index])
    deduped: list[list[float]] = []
    for point in selected:
        if not deduped or point != deduped[-1]:
            deduped.append(point)
    return deduped


def _simplify_ring(ring: list[list[float]], min_points: int = SIMPLIFIED_MIN_POINTS, max_points: int = SIMPLIFIED_MAX_POINTS) -> list[list[float]]:
    open_ring = _ring_without_closure(ring)
    if len(open_ring) <= max_points:
        return _close_ring(open_ring)
    bbox_x = [point[0] for point in open_ring]
    bbox_y = [point[1] for point in open_ring]
    diagonal = math.hypot(max(bbox_x) - min(bbox_x), max(bbox_y) - min(bbox_y))
    low = 0.0
    high = max(diagonal, 1.0)
    best_under = None
    best_over = None
    for _ in range(24):
        epsilon = (low + high) / 2.0
        candidate = _rdp([*open_ring, open_ring[0]], epsilon)
        candidate_open = _ring_without_closure(candidate)
        point_count = len(candidate_open)
        if min_points <= point_count <= max_points:
            return _close_ring(candidate_open)
        if point_count > max_points:
            best_over = candidate_open
            low = epsilon
        else:
            best_under = candidate_open
            high = epsilon
    if best_over and len(best_over) >= 3:
        return _close_ring(_downsample_ring(best_over, max_points))
    if best_under and len(best_under) >= 3:
        if len(best_under) < min_points:
            return _close_ring(_downsample_ring(open_ring, min(max_points, max(min_points, len(open_ring)))))
        return _close_ring(best_under)
    return _close_ring(_downsample_ring(open_ring, max_points))


def _simplify_polygon_geometry(geometry: dict[str, Any]) -> dict[str, Any]:
    geometry_type = str(geometry.get("type") or "")
    coordinates = geometry.get("coordinates")
    if geometry_type == "Polygon" and isinstance(coordinates, list) and coordinates:
        rings: list[list[list[float]]] = []
        for index, ring in enumerate(coordinates):
            if not isinstance(ring, list) or len(ring) < 4:
                return geometry
            simplified_ring = _simplify_ring(
                [[float(point[0]), float(point[1])] for point in ring if isinstance(point, list) and len(point) >= 2],
                min_points=SIMPLIFIED_MIN_POINTS if index == 0 else 4,
                max_points=SIMPLIFIED_MAX_POINTS if index == 0 else 6,
            )
            rings.append(simplified_ring)
        return {"type": "Polygon", "coordinates": rings}
    if geometry_type == "MultiPolygon" and isinstance(coordinates, list):
        polygons: list[list[list[list[float]]]] = []
        for polygon in coordinates:
            if not isinstance(polygon, list) or not polygon:
                return geometry
            rings: list[list[list[float]]] = []
            for index, ring in enumerate(polygon):
                if not isinstance(ring, list) or len(ring) < 4:
                    return geometry
                simplified_ring = _simplify_ring(
                    [[float(point[0]), float(point[1])] for point in ring if isinstance(point, list) and len(point) >= 2],
                    min_points=SIMPLIFIED_MIN_POINTS if index == 0 else 4,
                    max_points=SIMPLIFIED_MAX_POINTS if index == 0 else 6,
                )
                rings.append(simplified_ring)
            polygons.append(rings)
        return {"type": "MultiPolygon", "coordinates": polygons}
    return geometry


def _representation_feature(
    *,
    feature_id: str,
    name: str,
    kind: str,
    geometry: dict[str, Any],
    properties: dict[str, Any],
    style_hints: dict[str, Any],
    bounds: tuple[float, float, float, float],
) -> dict[str, Any]:
    return {
        "id": feature_id,
        "name": name,
        "kind": kind,
        "geometry": geometry,
        "properties": properties,
        "styleHints": style_hints,
        "bounds": [bounds[0], bounds[1], bounds[2], bounds[3]],
    }


def _build_cluster_summary(features: list[dict[str, Any]], chunk_bounds: tuple[float, float, float, float]) -> list[dict[str, Any]]:
    min_x, min_y, max_x, max_y = chunk_bounds
    bin_size = max((max_x - min_x) / 3.0, (max_y - min_y) / 3.0, 96.0)
    bins: dict[str, dict[str, Any]] = {}
    for feature in features:
        feature_min_x, feature_min_y, feature_max_x, feature_max_y = _feature_bounds_from_payload(feature)
        center_x = (feature_min_x + feature_max_x) / 2.0
        center_y = (feature_min_y + feature_max_y) / 2.0
        class_name = _feature_class_from_payload(feature)
        bin_x = int(math.floor((center_x - min_x) / bin_size))
        bin_y = int(math.floor((center_y - min_y) / bin_size))
        key = f"{class_name}:{bin_x}:{bin_y}"
        color = _feature_color_from_payload(feature)
        od = _feature_od_from_payload(feature)
        entry = bins.setdefault(
            key,
            {
                "count": 0,
                "score_sum": 0.0,
                "center_x_sum": 0.0,
                "center_y_sum": 0.0,
                "color_sum": [0, 0, 0],
                "class_name": class_name,
                "od_sum": 0.0,
                "od_count": 0,
            },
        )
        entry["count"] += 1
        entry["score_sum"] += _feature_score_from_payload(feature)
        entry["center_x_sum"] += center_x
        entry["center_y_sum"] += center_y
        entry["color_sum"][0] += color[0]
        entry["color_sum"][1] += color[1]
        entry["color_sum"][2] += color[2]
        if od is not None:
            entry["od_sum"] += od
            entry["od_count"] += 1

    summary_features: list[dict[str, Any]] = []
    for index, (key, entry) in enumerate(sorted(bins.items())):
        count = max(1, int(entry["count"]))
        centroid_x = entry["center_x_sum"] / count
        centroid_y = entry["center_y_sum"] / count
        radius = max(10.0, min(48.0, 10.0 + math.log2(count + 1) * 5.0))
        opacity = max(0.28, min(0.88, 0.32 + math.log2(count + 1) / 10.0))
        summary_features.append(
            _representation_feature(
                feature_id=f"cluster:{key}:{index}",
                name=f"{entry['class_name']} ({count})",
                kind="point",
                geometry={"type": "Point", "coordinates": [centroid_x, centroid_y]},
                properties={
                    "class": entry["class_name"],
                    "count": count,
                    "score": entry["score_sum"] / count,
                    "isCluster": True,
                    "ovsiRepresentation": "cluster",
                    **({"od": entry["od_sum"] / entry["od_count"]} if entry["od_count"] > 0 else {}),
                },
                style_hints={
                    "color": [
                        round(entry["color_sum"][0] / count),
                        round(entry["color_sum"][1] / count),
                        round(entry["color_sum"][2] / count),
                        round(opacity * 255),
                    ],
                    "strokeWidth": 0,
                    "opacity": opacity,
                    "clusterGlowOpacity": max(0.08, opacity * 0.28),
                    "clusterCoreOpacity": max(0.3, min(0.92, opacity * 0.92)),
                    "radius": radius,
                    "isCluster": True,
                    "ovsiRepresentation": "cluster",
                },
                bounds=(centroid_x - radius, centroid_y - radius, centroid_x + radius, centroid_y + radius),
            )
        )
    return summary_features


def _build_simplified_summary(
    features: list[dict[str, Any]],
    chunk_bounds: tuple[float, float, float, float],
) -> list[dict[str, Any]]:
    del chunk_bounds
    summary_features: list[dict[str, Any]] = []
    for feature in features:
        geometry = feature.get("geometry")
        if not isinstance(geometry, dict):
            continue
        summary_features.append(
            _representation_feature(
                feature_id=f"simplified:{feature.get('id')}",
                name=str(feature.get("name") or _feature_class_from_payload(feature)),
                kind=str(feature.get("kind") or "polygon"),
                geometry=_simplify_polygon_geometry(geometry),
                properties={
                    **dict(feature.get("properties") or {}),
                    "isSimplified": True,
                    "ovsiRepresentation": "simplified",
                },
                style_hints={
                    **dict(feature.get("styleHints") or {}),
                    "isSimplified": True,
                    "ovsiRepresentation": "simplified",
                },
                bounds=_feature_bounds_from_payload(feature),
            )
        )
    return summary_features


def _build_representation_payloads(
    *,
    root: str,
    slide_id: str,
    overlay_id: str,
    version_id: str,
    chunk_id: str,
    chunk_bounds: list[float],
    features: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    bounds_tuple = (float(chunk_bounds[0]), float(chunk_bounds[1]), float(chunk_bounds[2]), float(chunk_bounds[3]))
    payloads = {
        "raw": {
            "path": f"{root}/overlay.ovsip/blocks/{chunk_id}.ovsib",
            "payload": {
                "schema": "ovsib-v1",
                "slideId": slide_id,
                "overlayId": overlay_id,
                "versionId": version_id,
                "chunkId": chunk_id,
                "id": chunk_id,
                "bounds": chunk_bounds,
                "featureCount": len(features),
                "representation": "raw",
                "features": features,
            },
        },
        "simplified": {
            "path": f"{root}/overlay.ovsip/summaries/simplified/{chunk_id}.ovsib",
            "payload": {
                "schema": "ovsib-v1",
                "slideId": slide_id,
                "overlayId": overlay_id,
                "versionId": version_id,
                "chunkId": chunk_id,
                "id": chunk_id,
                "bounds": chunk_bounds,
                "featureCount": 0,
                "representation": "simplified",
                "features": _build_simplified_summary(features, bounds_tuple),
            },
        },
        "cluster": {
            "path": f"{root}/overlay.ovsip/summaries/cluster/{chunk_id}.ovsib",
            "payload": {
                "schema": "ovsib-v1",
                "slideId": slide_id,
                "overlayId": overlay_id,
                "versionId": version_id,
                "chunkId": chunk_id,
                "id": chunk_id,
                "bounds": chunk_bounds,
                "featureCount": 0,
                "representation": "cluster",
                "features": _build_cluster_summary(features, bounds_tuple),
            },
        },
    }
    for value in payloads.values():
        value["payload"]["featureCount"] = len(value["payload"]["features"])
    return payloads


def _geometry_kind(type_name: str) -> str:
    if type_name in {"Point", "MultiPoint"}:
        return "point"
    if type_name in {"LineString", "MultiLineString"}:
        return "polyline"
    return "polygon"


def _decode_geometry_cell(cell: Any):
    if isinstance(cell, bytes):
        return wkb.loads(cell)
    if isinstance(cell, str):
        stripped = cell.strip()
        if stripped.startswith("{"):
            return shape(json.loads(stripped))
        return wkt.loads(stripped)
    raise ValueError("unsupported geoparquet geometry cell")


def _chunk_identity(chunk_x: int, chunk_y: int) -> str:
    return f"chunk-{chunk_x}-{chunk_y}"


def publish_streaming_geoparquet_artifacts(
    proxy: MinioProxy,
    *,
    slide_id: str,
    overlay_id: str,
    version_id: str,
    overlay_name: str,
    source_format: str,
    source_path: Path,
    progress_callback: Any | None = None,
    chunk_size: float = 2048.0,
    batch_size: int = 5000,
) -> StreamingOverlayPublication:
    """Stream a Geoparquet overlay into chunk artifacts without materializing the full feature set."""
    parse_started = perf_counter()
    escaped_path = str(source_path).replace("'", "''")
    connection = duckdb.connect()
    try:
        total_rows = int(connection.execute(f"select count(*) from read_parquet('{escaped_path}')").fetchone()[0])
        cursor = connection.execute(f"select * from read_parquet('{escaped_path}')")
        column_names = [column[0] for column in cursor.description]
        geometry_column = next((candidate for candidate in ("geometry", "geom", "wkb_geometry") if candidate in column_names), None)
        if geometry_column is None:
            raise ValueError("geoparquet overlay missing geometry column")

        root = f"s3://derived/overlays/v1/{slide_id}/{overlay_id}/{version_id}"
        chunk_summaries: dict[str, dict[str, Any]] = {}
        legend_keys: set[str] = set()
        legend: list[dict[str, Any]] = []
        global_min_x = math.inf
        global_min_y = math.inf
        global_max_x = -math.inf
        global_max_y = -math.inf
        feature_count = 0
        processed_rows = 0
        publish_started: float | None = None

        with tempfile.TemporaryDirectory(prefix="cellor-overlay-stream-") as temp_dir:
            temp_root = Path(temp_dir)
            chunk_handles: dict[str, Any] = {}

            try:
                while True:
                    rows = cursor.fetchmany(batch_size)
                    if not rows:
                        break
                    for row in rows:
                        record = dict(zip(column_names, row))
                        geom = _decode_geometry_cell(record[geometry_column])
                        geometry = json.loads(json.dumps(geom.__geo_interface__))
                        min_x, min_y, max_x, max_y = [float(value) for value in geom.bounds]
                        global_min_x = min(global_min_x, min_x)
                        global_min_y = min(global_min_y, min_y)
                        global_max_x = max(global_max_x, max_x)
                        global_max_y = max(global_max_y, max_y)
                        properties = {key: value for key, value in record.items() if key != geometry_column}
                        label = str(properties.get("class") or properties.get("label") or "")
                        if label and label not in legend_keys:
                            legend.append({"label": label})
                            legend_keys.add(label)
                        feature_count += 1
                        feature_payload = {
                            "id": str(properties.get("id") or properties.get("cell_id") or f"feature-{feature_count}"),
                            "name": str(properties.get("name") or properties.get("cell_id") or f"Feature {feature_count}"),
                            "kind": _geometry_kind(str(geometry["type"])),
                            "geometry": geometry,
                            "properties": properties,
                            "styleHints": {},
                            "bounds": [min_x, min_y, max_x, max_y],
                        }
                        start_x = int(math.floor(min_x / chunk_size))
                        start_y = int(math.floor(min_y / chunk_size))
                        end_x = int(math.floor(max_x / chunk_size))
                        end_y = int(math.floor(max_y / chunk_size))
                        line = json.dumps(feature_payload, separators=(",", ":")) + "\n"
                        for chunk_x in range(start_x, end_x + 1):
                            for chunk_y in range(start_y, end_y + 1):
                                chunk_id = _chunk_identity(chunk_x, chunk_y)
                                left = chunk_x * chunk_size
                                top = chunk_y * chunk_size
                                summary = chunk_summaries.setdefault(
                                    chunk_id,
                                    {
                                        "id": chunk_id,
                                        "bounds": [left, top, left + chunk_size, top + chunk_size],
                                        "featureCount": 0,
                                    },
                                )
                                summary["featureCount"] += 1
                                handle = chunk_handles.get(chunk_id)
                                if handle is None:
                                    handle = (temp_root / f"{chunk_id}.jsonl").open("a", encoding="utf-8")
                                    chunk_handles[chunk_id] = handle
                                handle.write(line)
                    processed_rows += len(rows)
                    if progress_callback is not None and total_rows > 0:
                        progress_callback("parsing", round(10.0 + 60.0 * (processed_rows / total_rows), 2), f"Parsed {processed_rows}/{total_rows} overlay rows")
            finally:
                for handle in chunk_handles.values():
                    handle.close()

            parse_elapsed_seconds = perf_counter() - parse_started
            publish_started = perf_counter()
            ordered_chunks = [chunk_summaries[key] for key in sorted(chunk_summaries)]
            chunk_paths: dict[str, str] = {}
            chunk_entries: list[dict[str, Any]] = []
            for index, chunk in enumerate(ordered_chunks):
                chunk_id = str(chunk["id"])
                chunk_file = temp_root / f"{chunk_id}.jsonl"
                features = [json.loads(line) for line in chunk_file.read_text(encoding="utf-8").splitlines() if line]
                representation_payloads = _build_representation_payloads(
                    root=root,
                    slide_id=slide_id,
                    overlay_id=overlay_id,
                    version_id=version_id,
                    chunk_id=chunk_id,
                    chunk_bounds=list(chunk["bounds"]),
                    features=features,
                )
                for value in representation_payloads.values():
                    proxy.put_bytes(value["path"], json.dumps(value["payload"], indent=2).encode("utf-8"), "application/json")
                chunk_paths[chunk_id] = str(representation_payloads["raw"]["path"])
                chunk_entries.append(
                    {
                        "id": chunk_id,
                        "bounds": list(chunk["bounds"]),
                        "featureCount": len(features),
                        "path": str(representation_payloads["raw"]["path"]),
                        "representations": {
                            name: {
                                "path": str(value["path"]),
                                "featureCount": int(value["payload"]["featureCount"]),
                            }
                            for name, value in representation_payloads.items()
                        },
                    }
                )
                if progress_callback is not None and ordered_chunks:
                    progress_callback(
                        "publishing",
                        round(70.0 + 29.0 * ((index + 1) / len(ordered_chunks)), 2),
                        f"Published overlay chunk {index + 1}/{len(ordered_chunks)}",
                    )

        if math.isinf(global_min_x) or math.isinf(global_min_y):
            bounds = (0.0, 0.0, 0.0, 0.0)
        else:
            bounds = (global_min_x, global_min_y, global_max_x, global_max_y)

        manifest = {
            "schema": "overlay-manifest-v1",
            "slideId": slide_id,
            "overlayId": overlay_id,
            "name": overlay_name,
            "kind": "vector",
            "versionId": version_id,
            "sourceFormat": source_format,
            "coordinateSpace": {"origin": "top-left", "unit": "level-0-pixel"},
            "runtimeFormat": "ovsi",
            "artifact": {},
            "featureCount": feature_count,
            "bounds": list(bounds),
            "legend": legend,
            "metadata": {},
            "chunking": {
                "strategy": "spatial-fixed-grid",
                "chunkSize": chunk_size,
                "chunks": chunk_entries,
            },
        }

        manifest_path = f"{root}/overlay.ovsip/manifest.ovsim"
        index_path = f"{root}/overlay.ovsip/index.ovsii"
        styles_path = f"{root}/overlay.ovsip/styles/default.ovsis"
        artifact = {
            "layout": "package",
            "ovsiPath": None,
            "manifestPath": manifest_path,
            "indexPath": index_path,
            "stylePath": styles_path,
        }
        manifest["artifact"] = artifact
        manifest["metadata"] = {"runtimeFormat": "ovsi", "artifact": artifact, "chunkPaths": chunk_paths}
        package_manifest = {
            "schema": "ovsim-v1",
            "slideId": slide_id,
            "overlayId": overlay_id,
            "versionId": version_id,
            "kind": "vector",
            "legend": legend,
            "metadata": manifest["metadata"],
            "chunks": [
                {
                    "id": chunk["id"],
                    "bounds": chunk["bounds"],
                    "featureCount": chunk["featureCount"],
                    "blockPath": chunk["path"],
                    "representations": chunk["representations"],
                }
                for chunk in chunk_entries
            ],
        }
        package_index = {
            "schema": "ovsii-v1",
            "chunkCount": len(chunk_entries),
            "chunks": [
                {
                    "id": chunk["id"],
                    "bounds": chunk["bounds"],
                    "featureCount": chunk["featureCount"],
                    "blockPath": chunk["path"],
                    "representations": chunk["representations"],
                }
                for chunk in chunk_entries
            ],
        }
        style_manifest = {"schema": "ovsis-v1", "legend": legend}
        proxy.put_bytes(manifest_path, json.dumps(package_manifest, indent=2).encode("utf-8"), "application/json")
        proxy.put_bytes(index_path, json.dumps(package_index, indent=2).encode("utf-8"), "application/json")
        proxy.put_bytes(styles_path, json.dumps(style_manifest, indent=2).encode("utf-8"), "application/json")
        return StreamingOverlayPublication(
            publication=OverlayArtifactPublication(runtime_format="ovsi", artifact=artifact, chunk_paths=chunk_paths, delivery_manifest=manifest),
            manifest=manifest,
            feature_count=feature_count,
            legend=legend,
            bounds=bounds,
            parse_elapsed_seconds=round(parse_elapsed_seconds, 3),
            publish_elapsed_seconds=round((perf_counter() - publish_started) if publish_started is not None else 0.0, 3),
        )
    finally:
        connection.close()


def publish_overlay_artifacts(proxy: MinioProxy, overlay: OverlayDefinition) -> OverlayArtifactPublication:
    """Write immutable overlay artifacts and return manifest metadata describing them."""
    manifest = build_overlay_manifest(overlay)
    root = _artifact_root(overlay)
    chunk_paths: dict[str, str] = {}
    chunk_entries: list[dict[str, Any]] = []
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
        raw_payload = _chunk_document(overlay, chunk_id)
        representation_payloads = _build_representation_payloads(
            root=root,
            slide_id=overlay.slide_id.value,
            overlay_id=overlay.overlay_id.value,
            version_id=overlay.version_id,
            chunk_id=chunk_id,
            chunk_bounds=list(chunk["bounds"]),
            features=list(raw_payload["features"]),
        )
        for value in representation_payloads.values():
            proxy.put_bytes(value["path"], json.dumps(value["payload"], indent=2).encode("utf-8"), "application/json")
        chunk_paths[chunk_id] = str(representation_payloads["raw"]["path"])
        chunk_entries.append(
            {
                "id": chunk_id,
                "bounds": list(chunk["bounds"]),
                "featureCount": int(chunk["featureCount"]),
                "path": str(representation_payloads["raw"]["path"]),
                "representations": {
                    name: {
                        "path": str(value["path"]),
                        "featureCount": int(value["payload"]["featureCount"]),
                    }
                    for name, value in representation_payloads.items()
                },
            }
        )

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
                "blockPath": chunk["path"],
                "representations": chunk["representations"],
            }
            for chunk in chunk_entries
        ],
    }
    package_index = {
        "schema": "ovsii-v1",
        "chunkCount": len(chunk_entries),
        "chunks": [
            {
                "id": chunk["id"],
                "bounds": chunk["bounds"],
                "featureCount": chunk["featureCount"],
                "blockPath": chunk["path"],
                "representations": chunk["representations"],
            }
            for chunk in chunk_entries
        ],
    }
    style_manifest = {"schema": "ovsis-v1", "legend": list(overlay.legend)}
    proxy.put_bytes(manifest_path, json.dumps(package_manifest, indent=2).encode("utf-8"), "application/json")
    proxy.put_bytes(index_path, json.dumps(package_index, indent=2).encode("utf-8"), "application/json")
    proxy.put_bytes(styles_path, json.dumps(style_manifest, indent=2).encode("utf-8"), "application/json")
    artifact = {
        "layout": "package",
        "ovsiPath": None,
        "manifestPath": manifest_path,
        "indexPath": index_path,
        "stylePath": styles_path,
    }
    delivery_manifest = {
        **manifest,
        "artifact": artifact,
        "metadata": {
            **dict(overlay.metadata),
            "runtimeFormat": "ovsi",
            "artifact": artifact,
            "chunkPaths": chunk_paths,
        },
        "chunking": {
            **dict(manifest["chunking"]),
            "chunks": chunk_entries,
        },
    }
    return OverlayArtifactPublication(
        runtime_format="ovsi",
        artifact=artifact,
        chunk_paths=chunk_paths,
        delivery_manifest=delivery_manifest,
    )
