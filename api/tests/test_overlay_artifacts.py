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

    overlay = OverlayDefinition(
        overlay_id=overlay.overlay_id,
        slide_id=overlay.slide_id,
        name=overlay.name,
        kind=overlay.kind,
        features=overlay.features,
        legend=overlay.legend,
        source_format=overlay.source_format,
        version_id=overlay.version_id,
        metadata={"runtimeFormat": publication.runtime_format, "artifact": publication.artifact, "chunkPaths": publication.chunk_paths},
    )
    manifest = build_overlay_manifest(overlay)
    first_chunk = manifest["chunking"]["chunks"][0]
    assert first_chunk["path"].startswith("s3://derived/overlays/")
