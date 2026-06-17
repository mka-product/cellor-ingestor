import json
from pathlib import Path

import pytest
from PIL import Image

from worker.worker_service.domain.models import IngestionRequest, SlideMetadata, TileIndexEntry
from worker.worker_service.application.services import IngestionApplicationService
from worker.worker_service.infrastructure.bootstrap import Container
from worker.worker_service.infrastructure.index import BinaryIndexCodec


def test_binary_index_roundtrip() -> None:
    codec = BinaryIndexCodec()
    entries = [TileIndexEntry(tile_x=1, tile_y=2, group_id=3, offset=4, length=5, flags=4)]
    payload = codec.encode(entries)
    decoded = codec.decode(payload)
    assert decoded == entries


def test_ingestion_publishes_manifest_last(tmp_path: Path) -> None:
    input_path = tmp_path / "sample.tiff"
    image = Image.new("RGB", (1024, 768), color=(255, 255, 255))
    image.paste(Image.new("RGB", (300, 300), color=(10, 20, 30)), (100, 100))
    image.save(input_path)

    container = Container(root=tmp_path / "out", max_workers=1, reader_backend="local")
    service = container.ingestion_service
    service.bind_job("job-slide-1", "local")
    publication = service.ingest(
        IngestionRequest(
            slide_id="slide-1",
            version_id="v-1",
            checksum="sha256:abc",
            original_path=str(input_path),
        )
    )

    manifest_path = publication.manifest_path.removeprefix("s3://")
    manifest_file = container.root / manifest_path
    assert manifest_file.exists()
    assert container.registry.list_slides()[0]["manifest_path"] == publication.manifest_path
    assert publication.timings["thumbnail_seconds"] >= 0
    assert "self_cpu_user_seconds" in publication.timings
    assert "children_cpu_user_seconds" in publication.timings
    assert container.registry.list_jobs()
    assert container.registry.get_job("job-slide-1")["status"] == "succeeded"
    manifest = json.loads(manifest_file.read_text())
    assert manifest["schema"] == "wsi-tile-manifest-v1"
    assert manifest["levels"]
    assert manifest["metadata"]["vendor"] == "local"


def test_blank_tile_skip_marks_empty_entries(tmp_path: Path) -> None:
    input_path = tmp_path / "blank.tiff"
    Image.new("RGB", (512, 512), color=(255, 255, 255)).save(input_path)
    container = Container(root=tmp_path / "out", max_workers=1, reader_backend="local")

    publication = container.ingestion_service.ingest(
        IngestionRequest(
            slide_id="slide-blank",
            version_id="v-1",
            checksum="sha256:blank",
            original_path=str(input_path),
        )
    )
    level_path = publication.levels[0].index_path.removeprefix("s3://")
    payload = (container.root / level_path).read_bytes()
    entries = container.index_codec.decode(payload)
    assert entries
    assert all(entry.flags == 1 for entry in entries)


def test_unsupported_input_emits_failure_event(tmp_path: Path) -> None:
    container = Container(root=tmp_path / "out", max_workers=1, reader_backend="local")
    with pytest.raises(ValueError):
        container.ingestion_service.ingest(
            IngestionRequest(
                slide_id="slide-bad",
                version_id="v-1",
                checksum="sha256:bad",
                original_path="unsupported.xyz",
            )
        )
    assert container.events.events[-1].name == "IngestionFailed"


def test_metadata_reader_preferred_over_render_backend(tmp_path: Path) -> None:
    class FakeSource:
        @property
        def dimensions(self) -> tuple[int, int]:
            return (1024, 768)

        def describe(self) -> SlideMetadata:
            return SlideMetadata(vendor="fastslide", source_properties={"reader": "fastslide"})

        def get_thumbnail(self, max_size: tuple[int, int]) -> Image.Image:
            return Image.new("RGB", (256, 256), color=(255, 255, 255))

        def read_tile(self, tile_x: int, tile_y: int, tile_size: int, downsample: int) -> Image.Image:
            return Image.new("RGB", (tile_size, tile_size), color=(240, 240, 240))

        def close(self) -> None:
            return None

    class FakeReader:
        def open(self, request: IngestionRequest) -> FakeSource:
            return FakeSource()

    class PreferredMetadataReader:
        def describe(self, request: IngestionRequest) -> SlideMetadata:
            return SlideMetadata(
                vendor="hamamatsu",
                microns_per_pixel_x=0.23,
                microns_per_pixel_y=0.24,
                mpp_source="openslide",
                source_properties={"openslide.vendor": "hamamatsu"},
            )

    container = Container(root=tmp_path / "out", max_workers=1, reader_backend="local")
    service = IngestionApplicationService(
        reader=FakeReader(),
        metadata_reader=PreferredMetadataReader(),
        store=container.store,
        events=container.events,
        index_encoder=container.index_codec,
        manifest_sink=container.registry,
        reader_backend="fastslide",
        max_workers=1,
        progress_sink=container.registry,
    )

    publication = service.ingest(
        IngestionRequest(
            slide_id="slide-meta",
            version_id="v-1",
            checksum="sha256:meta",
            original_path=str(tmp_path / "meta.svs"),
        )
    )
    assert publication.metadata.vendor == "hamamatsu"
    assert publication.metadata.mpp_source == "openslide"
    manifest = json.loads((container.root / publication.manifest_path.removeprefix("s3://")).read_text())
    assert manifest["metadata"]["micronsPerPixel"]["source"] == "openslide"
