"""Purpose: validate review-domain payloads before repository persistence.
Owner context: Viewer workspace support.
Invariants: annotation geometry must be a valid Point, LineString, Polygon, or MultiPolygon payload.
Failure modes: malformed geometry raises ValueError with a user-safe message.
"""

from __future__ import annotations


def _is_finite_position(value: object) -> bool:
    return (
        isinstance(value, list)
        and len(value) >= 2
        and isinstance(value[0], (int, float))
        and isinstance(value[1], (int, float))
    )


def _positions_equal(left: list[object], right: list[object]) -> bool:
    return left[0] == right[0] and left[1] == right[1]


def _is_valid_ring(ring: object) -> bool:
    if not isinstance(ring, list):
        return False
    positions = [point for point in ring if _is_finite_position(point)]
    if len(positions) < 4:
        return False
    if not _positions_equal(positions[0], positions[-1]):
        return False
    unique = {(float(point[0]), float(point[1])) for point in positions[:-1]}
    return len(unique) >= 3


def validate_annotation_geometry(geometry: dict[str, object]) -> None:
    geometry_type = str(geometry.get("type", ""))
    coordinates = geometry.get("coordinates")

    if geometry_type == "Point":
        if not _is_finite_position(coordinates):
            raise ValueError("invalid point annotation geometry")
        return

    if geometry_type == "LineString":
        if not isinstance(coordinates, list) or len([point for point in coordinates if _is_finite_position(point)]) < 2:
            raise ValueError("invalid line annotation geometry")
        return

    if geometry_type == "Polygon":
        if not isinstance(coordinates, list) or not coordinates or not any(_is_valid_ring(ring) for ring in coordinates):
            raise ValueError("invalid polygon annotation geometry")
        return

    if geometry_type == "MultiPolygon":
        if (
            not isinstance(coordinates, list)
            or not coordinates
            or not any(isinstance(polygon, list) and any(_is_valid_ring(ring) for ring in polygon) for polygon in coordinates)
        ):
            raise ValueError("invalid multipolygon annotation geometry")
        return

    raise ValueError("unsupported annotation geometry type")
