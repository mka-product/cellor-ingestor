"""Purpose: normalize uploaded overlay source files into overlay definitions usable by the viewer.
Owner context: Overlay Ingestion.
Invariants: emitted overlay features use top-left image-space coordinates and include deterministic bounds.
Failure modes: unsupported formats or malformed payloads raise ValueError before publication.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pyarrow.parquet as pq
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry
from shapely import wkb, wkt

from api.api_service.domain.models import OverlayDefinition, OverlayFeature, OverlayId, SlideId


@dataclass(frozen=True)
class ParsedOverlay:
    name: str
    kind: str
    features: list[OverlayFeature]
    legend: list[dict[str, Any]]
    metadata: dict[str, Any]
    source_format: str


def _geometry_kind(type_name: str) -> str:
    if type_name in {"Point", "MultiPoint"}:
        return "point"
    if type_name in {"LineString", "MultiLineString"}:
        return "polyline"
    return "polygon"


def _geometry_bounds(geometry: dict[str, Any]) -> tuple[float, float, float, float]:
    geom = shape(geometry)
    min_x, min_y, max_x, max_y = geom.bounds
    return (float(min_x), float(min_y), float(max_x), float(max_y))


def _overlay_feature(feature_id: str, name: str, geometry: dict[str, Any], properties: dict[str, Any], style_hints: dict[str, Any]) -> OverlayFeature:
    return OverlayFeature(
        id=feature_id,
        name=name,
        kind=_geometry_kind(str(geometry["type"])),
        geometry=geometry,
        properties=properties,
        style_hints=style_hints,
        bounds=_geometry_bounds(geometry),
    )


def _parse_geojson(payload: dict[str, Any], name: str) -> ParsedOverlay:
    if payload.get("type") != "FeatureCollection":
        raise ValueError("geojson overlay must be a FeatureCollection")
    features: list[OverlayFeature] = []
    legend_keys: set[str] = set()
    legend: list[dict[str, Any]] = []
    for index, feature in enumerate(payload.get("features", [])):
        geometry = feature.get("geometry")
        if not isinstance(geometry, dict) or "type" not in geometry:
            continue
        properties = dict(feature.get("properties", {}))
        label = str(properties.get("class") or properties.get("label") or "")
        if label and label not in legend_keys:
            legend.append({"label": label})
            legend_keys.add(label)
        features.append(
            _overlay_feature(
                str(feature.get("id") or f"feature-{index + 1}"),
                str(feature.get("properties", {}).get("name") or feature.get("id") or f"Feature {index + 1}"),
                geometry,
                properties,
                {},
            )
        )
    return ParsedOverlay(name=name, kind="vector", features=features, legend=legend, metadata={"runtimeFormat": "inline"}, source_format="geojson")


def _decode_geometry_cell(cell: Any) -> BaseGeometry:
    if isinstance(cell, bytes):
        return wkb.loads(cell)
    if isinstance(cell, str):
        stripped = cell.strip()
        if stripped.startswith("{"):
            return shape(json.loads(stripped))
        return wkt.loads(stripped)
    raise ValueError("unsupported geoparquet geometry cell")


def _parse_geoparquet(path: Path, name: str) -> ParsedOverlay:
    table = pq.read_table(path)
    column_names = table.column_names
    geometry_column = next((candidate for candidate in ("geometry", "geom", "wkb_geometry") if candidate in column_names), None)
    if geometry_column is None:
        raise ValueError("geoparquet overlay missing geometry column")
    features: list[OverlayFeature] = []
    legend_keys: set[str] = set()
    legend: list[dict[str, Any]] = []
    geometry_values = table[geometry_column].to_pylist()
    rows = table.to_pylist()
    for index, row in enumerate(rows):
        geom = _decode_geometry_cell(geometry_values[index])
        geometry = json.loads(json.dumps(geom.__geo_interface__))
        properties = {key: value for key, value in row.items() if key != geometry_column}
        label = str(properties.get("class") or properties.get("label") or "")
        if label and label not in legend_keys:
            legend.append({"label": label})
            legend_keys.add(label)
        features.append(
            _overlay_feature(
                str(properties.get("id") or f"feature-{index + 1}"),
                str(properties.get("name") or properties.get("id") or f"Feature {index + 1}"),
                geometry,
                properties,
                {},
            )
        )
    return ParsedOverlay(name=name, kind="vector", features=features, legend=legend, metadata={"runtimeFormat": "inline"}, source_format="geoparquet")


def _cluster_polygon(coordinates: list[list[list[int]]], tile_width: float, tile_height: float) -> dict[str, Any]:
    xs = [point[0] for row in coordinates for point in row]
    ys = [point[1] for row in coordinates for point in row]
    min_x = min(xs) * tile_width
    min_y = min(ys) * tile_height
    max_x = (max(xs) + 1) * tile_width
    max_y = (max(ys) + 1) * tile_height
    return {
        "type": "Polygon",
        "coordinates": [[[min_x, min_y], [max_x, min_y], [max_x, max_y], [min_x, max_y], [min_x, min_y]]],
    }


def _parse_tile_grid_json(payload: dict[str, Any], name: str) -> ParsedOverlay:
    results = payload.get("results")
    if not isinstance(results, dict):
        raise ValueError("tile-grid overlay missing results object")
    grid = dict(results.get("slide_grid_config", {}))
    if not grid:
        raise ValueError("tile-grid overlay missing slide_grid_config")
    tile_width = float(grid.get("tile_width", 1))
    tile_height = float(grid.get("tile_height", 1))
    features: list[OverlayFeature] = []
    legend = [{"label": str(results.get("label", "score")), "palette": "viridis"}]

    for index, cluster_raw in enumerate(results.get("max_clusters", [])[:500]):
        cluster = json.loads(cluster_raw) if isinstance(cluster_raw, str) else cluster_raw
        coordinates = cluster.get("coordinates")
        if not isinstance(coordinates, list) or not coordinates:
            continue
        geometry = _cluster_polygon(coordinates, tile_width, tile_height)
        max_score = max((max(row) for row in cluster.get("scores", []) if row), default=0.0)
        features.append(
            _overlay_feature(
                feature_id=f"cluster-{index + 1}",
                name=f"Cluster {index + 1}",
                geometry=geometry,
                properties={
                    "class": str(results.get("label", "score")),
                    "score": max_score,
                    "isPredictive": any(value == 1 for row in cluster.get("is_predictive", []) for value in row),
                },
                style_hints={},
            )
        )

    heatmap_coordinates = list(results.get("heatmaps", [{}])[0].get("coordinates", []))
    heatmap_scores = list(results.get("heatmaps", [{}])[0].get("scores", []))
    scored_points = sorted(zip(heatmap_coordinates, heatmap_scores), key=lambda entry: float(entry[1]), reverse=True)[:2000]
    for index, (coordinate, score) in enumerate(scored_points):
        if not isinstance(coordinate, list) or len(coordinate) < 2:
            continue
        x = float(coordinate[0]) * tile_width + tile_width / 2
        y = float(coordinate[1]) * tile_height + tile_height / 2
        features.append(
            _overlay_feature(
                feature_id=f"cell-{index + 1}",
                name=f"Cell {index + 1}",
                geometry={"type": "Point", "coordinates": [x, y]},
                properties={"class": str(results.get("label", "score")), "score": float(score)},
                style_hints={},
            )
        )

    metadata = {
        "runtimeFormat": "inline",
        "overlayType": "tiled-score",
        "grid": grid,
        "summary": {
            "score": results.get("score"),
            "label": results.get("label"),
            "labelValue": results.get("label_value"),
            "threshold": results.get("threshold"),
            "matterSurface": results.get("matter_surface"),
        },
    }
    return ParsedOverlay(name=name, kind="tiled-score", features=features, legend=legend, metadata=metadata, source_format="tile-grid-json")


def parse_overlay_source(source_path: Path, source_format: str, display_name: str) -> ParsedOverlay:
    source_format = source_format.lower()
    if source_format == "geojson":
        return _parse_geojson(json.loads(source_path.read_text()), display_name)
    if source_format == "tile-grid-json":
        return _parse_tile_grid_json(json.loads(source_path.read_text()), display_name)
    if source_format == "geoparquet":
        return _parse_geoparquet(source_path, display_name)
    if source_format == "ovsi":
        return ParsedOverlay(
            name=display_name,
            kind="ovsi",
            features=[],
            legend=[],
            metadata={"runtimeFormat": "ovsi", "sourcePath": str(source_path)},
            source_format="ovsi",
        )
    raise ValueError(f"unsupported overlay source format '{source_format}'")


def to_overlay_definition(slide_id: str, overlay_id: str, version_id: str, parsed: ParsedOverlay) -> OverlayDefinition:
    return OverlayDefinition(
        overlay_id=OverlayId(overlay_id),
        slide_id=SlideId(slide_id),
        name=parsed.name,
        kind=parsed.kind,
        features=tuple(parsed.features),
        legend=tuple(parsed.legend),
        source_format=parsed.source_format,
        version_id=version_id,
        metadata=parsed.metadata,
    )
