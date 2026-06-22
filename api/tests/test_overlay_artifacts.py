import json
import math

from api.api_service.application.overlay_artifacts import publish_overlay_artifacts
from api.api_service.application.overlay_delivery import build_overlay_manifest
from api.api_service.domain.models import OverlayDefinition, OverlayFeature, OverlayId, SlideId


class FakeProxy:
    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}

    def put_bytes(self, object_path: str, payload: bytes, media_type: str = "application/octet-stream") -> None:
        self.objects[object_path] = (payload, media_type)


def _overlay(feature_count: int) -> OverlayDefinition:
    return OverlayDefinition(
        overlay_id=OverlayId("overlay-1"),
        slide_id=SlideId("slide-1"),
        name="Overlay",
        kind="vector",
        features=tuple(
            OverlayFeature(
                id=f"feature-{index}",
                name=f"Feature {index}",
                kind="point",
                geometry={"type": "Point", "coordinates": [float(index), float(index)]},
                properties={},
                style_hints={},
                bounds=(float(index), float(index), float(index), float(index)),
            )
            for index in range(feature_count)
        ),
    )


def test_small_overlay_publishes_single_file_ovsi() -> None:
    proxy = FakeProxy()
    publication = publish_overlay_artifacts(proxy, _overlay(10))

    assert publication.runtime_format == "ovsi"
    assert publication.artifact["layout"] == "single-file"
    assert publication.artifact["ovsiPath"] in proxy.objects


def test_large_overlay_publishes_package_blocks() -> None:
    proxy = FakeProxy()
    overlay = _overlay(2500)
    publication = publish_overlay_artifacts(proxy, overlay)

    assert publication.artifact["layout"] == "package"
    assert publication.artifact["manifestPath"] in proxy.objects
    assert publication.artifact["indexPath"] in proxy.objects
    assert publication.chunk_paths
    assert publication.delivery_manifest is not None
    chunk_entry = publication.delivery_manifest["chunking"]["chunks"][0]
    assert chunk_entry["path"].startswith("s3://derived/overlays/")
    assert set(chunk_entry["representations"]) == {"raw", "simplified", "cluster"}
    assert chunk_entry["representations"]["cluster"]["featureCount"] > 0

    overlay = OverlayDefinition(
        overlay_id=overlay.overlay_id,
        slide_id=overlay.slide_id,
        name=overlay.name,
        kind=overlay.kind,
        features=overlay.features,
        legend=overlay.legend,
        source_format=overlay.source_format,
        version_id=overlay.version_id,
        metadata={
            "runtimeFormat": publication.runtime_format,
            "artifact": publication.artifact,
            "chunkPaths": publication.chunk_paths,
            "deliveryManifest": publication.delivery_manifest,
        },
    )
    manifest = build_overlay_manifest(overlay)
    first_chunk = manifest["chunking"]["chunks"][0]
    assert first_chunk["path"].startswith("s3://derived/overlays/")


def test_simplified_representation_preserves_one_polygon_per_feature() -> None:
    proxy = FakeProxy()
    polygon = []
    for index in range(24):
        angle = (math.pi * 2 * index) / 24
        radius = 90.0 if index % 2 == 0 else 54.0
        polygon.append([1000.0 + math.cos(angle) * radius, 1200.0 + math.sin(angle) * radius])
    polygon.append(polygon[0])
    overlay = OverlayDefinition(
        overlay_id=OverlayId("overlay-poly"),
        slide_id=SlideId("slide-poly"),
        name="Polygon Overlay",
        kind="vector",
        features=tuple(
            OverlayFeature(
                id=f"feature-{index}",
                name=f"Feature {index}",
                kind="polygon",
                geometry={"type": "Polygon", "coordinates": [polygon]},
                properties={"class": "tumor"},
                style_hints={},
                bounds=(910.0, 1110.0, 1090.0, 1290.0),
            )
            for index in range(2001)
        ),
    )

    publication = publish_overlay_artifacts(proxy, overlay)
    chunk_entry = publication.delivery_manifest["chunking"]["chunks"][0]
    simplified_path = chunk_entry["representations"]["simplified"]["path"]
    simplified_payload = json.loads(proxy.objects[simplified_path][0].decode("utf-8"))
    raw_count = int(chunk_entry["representations"]["raw"]["featureCount"])

    assert simplified_payload["featureCount"] == raw_count
    first_ring = simplified_payload["features"][0]["geometry"]["coordinates"][0]
    assert 7 <= len(first_ring) <= 9
