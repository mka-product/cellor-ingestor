"""Purpose: ingestion domain entities and immutable specifications.
Owner context: Ingestion.
Invariants: ingestion output is deterministic for a given checksum and pipeline version.
Failure modes: invalid dimensions, tile sizes, or paths raise ValueError.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class PyramidLevelSpec:
    level: int
    downsample: int
    width: int
    height: int
    tiles_x: int
    tiles_y: int
    index_path: str


@dataclass(frozen=True)
class TileIndexEntry:
    tile_x: int
    tile_y: int
    group_id: int
    offset: int
    length: int
    flags: int
    codec: int = 1


@dataclass(frozen=True)
class DerivedArtifact:
    path: str
    media_type: str


@dataclass
class IngestionRequest:
    slide_id: str
    version_id: str
    checksum: str
    original_path: str


@dataclass(frozen=True)
class SlideMetadata:
    vendor: str | None = None
    objective_power: float | None = None
    microns_per_pixel_x: float | None = None
    microns_per_pixel_y: float | None = None
    mpp_source: str | None = None
    source_properties: dict[str, str] = field(default_factory=dict)


@dataclass
class ManifestPublication:
    slide_id: str
    version_id: str
    width: int
    height: int
    tile_size: int
    group_size: tuple[int, int]
    levels: list[PyramidLevelSpec]
    manifest_path: str
    thumbnail_path: str
    source_checksum: str
    ingestion_version: str
    metadata: SlideMetadata = field(default_factory=SlideMetadata)
    source_name: str = ""
    level_count: int = 0
    tile_count: int = 0
    non_empty_tile_count: int = 0
    group_count: int = 0
    artifact_bytes: int = 0
    timings: dict[str, float] = field(default_factory=dict)
    published_at: datetime = field(default_factory=utc_now)
