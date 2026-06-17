"""Purpose: ingestion orchestration from original slide to published manifest.
Owner context: Ingestion.
Invariants: manifest publication happens after all artifacts are written.
Failure modes: failures emit typed events and never publish partial manifests as ready.
"""

from __future__ import annotations

import io
import json
import math
import os
import resource
import sys
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from multiprocessing import get_context
from pathlib import Path
from time import perf_counter

from PIL import Image

from worker.worker_service.application.ports import (
    ArtifactStore,
    EventSink,
    IndexEncoder,
    ManifestSink,
    MetadataReader,
    SlideReader,
    SlideSource,
)
from worker.worker_service.domain.events import ingestion_completed, ingestion_failed, ingestion_started, manifest_published
from worker.worker_service.domain.models import IngestionRequest, ManifestPublication, PyramidLevelSpec, SlideMetadata, TileIndexEntry, utc_now
from worker.worker_service.infrastructure.reader import open_slide_source

try:
    import psutil
except ImportError:  # pragma: no cover - exercised in docker runtime
    psutil = None


@dataclass(frozen=True)
class TissueMaskIndex:
    """Purpose: fast coarse tissue lookups to skip obviously blank group regions.
    Owner context: Ingestion.
    Invariants: mask only skips when the sampled region is confidently blank.
    Failure modes: ambiguous or tiny regions default to `True` to avoid false negatives.
    """

    width: int
    height: int
    integral: list[list[int]]

    def has_tissue(
        self,
        left: int,
        top: int,
        right: int,
        bottom: int,
        slide_width: int,
        slide_height: int,
    ) -> bool:
        mask_left = max(0, math.floor((left / slide_width) * self.width) - 1)
        mask_top = max(0, math.floor((top / slide_height) * self.height) - 1)
        mask_right = min(self.width, math.ceil((right / slide_width) * self.width) + 1)
        mask_bottom = min(self.height, math.ceil((bottom / slide_height) * self.height) + 1)
        if mask_left >= mask_right or mask_top >= mask_bottom:
            return True
        tissue = (
            self.integral[mask_bottom][mask_right]
            - self.integral[mask_top][mask_right]
            - self.integral[mask_bottom][mask_left]
            + self.integral[mask_top][mask_left]
        )
        return tissue > 0


@dataclass(frozen=True)
class GroupRenderTask:
    level_number: int
    downsample: int
    tile_size: int
    group_size: tuple[int, int]
    tiles_x: int
    tiles_y: int
    group_x: int
    group_y: int
    group_id: int


@dataclass(frozen=True)
class GroupRenderBatch:
    reader_backend: str
    original_path: str
    tasks: tuple[GroupRenderTask, ...]


@dataclass
class GroupRenderResult:
    group_id: int
    payload: bytes
    entries: list[TileIndexEntry]
    non_empty_tiles: int


@dataclass
class GroupRenderBatchResult:
    groups: list[GroupRenderResult]
    read_seconds: float
    encode_seconds: float
    resource_metrics: dict[str, float]


def _chunked(tasks: list[GroupRenderTask], chunk_size: int) -> list[tuple[GroupRenderTask, ...]]:
    return [tuple(tasks[index : index + chunk_size]) for index in range(0, len(tasks), chunk_size)]


def _tile_is_empty(tile: Image.Image) -> bool:
    extrema = tile.getextrema()
    if not isinstance(extrema, tuple):
        return False
    if extrema and isinstance(extrema[0], tuple):
        return all(channel == (255, 255) for channel in extrema)
    return extrema == (255, 255)


def _normalize_max_rss_mb(raw_value: float) -> float:
    if os.name == "posix" and os.uname().sysname == "Darwin":
        return raw_value / (1024 * 1024)
    return raw_value / 1024


def _snapshot_resource_metrics(target: str) -> dict[str, float]:
    usage = resource.getrusage(resource.RUSAGE_SELF if target == "self" else resource.RUSAGE_CHILDREN)
    metrics = {
        f"{target}_cpu_user_seconds": usage.ru_utime,
        f"{target}_cpu_system_seconds": usage.ru_stime,
        f"{target}_max_rss_mb": _normalize_max_rss_mb(float(usage.ru_maxrss)),
        f"{target}_voluntary_context_switches": float(usage.ru_nvcsw),
        f"{target}_involuntary_context_switches": float(usage.ru_nivcsw),
    }
    if psutil is not None and target == "self":
        process = psutil.Process()
        memory = process.memory_info()
        metrics[f"{target}_rss_mb"] = memory.rss / (1024 * 1024)
        try:
            io_counters = process.io_counters()
            metrics[f"{target}_read_mb"] = io_counters.read_bytes / (1024 * 1024)
            metrics[f"{target}_write_mb"] = io_counters.write_bytes / (1024 * 1024)
        except Exception:
            pass
    return metrics


def _metric_delta(after: dict[str, float], before: dict[str, float]) -> dict[str, float]:
    delta: dict[str, float] = {}
    for key, after_value in after.items():
        before_value = before.get(key, 0.0)
        if key.endswith("_max_rss_mb") or key.endswith("_rss_mb"):
            delta[key] = max(after_value, before_value)
        else:
            delta[key] = after_value - before_value
    return delta


def _render_group_batch(batch: GroupRenderBatch) -> GroupRenderBatchResult:
    before = _snapshot_resource_metrics("self")
    source = open_slide_source(batch.reader_backend, batch.original_path)
    try:
        rendered_groups: list[GroupRenderResult] = []
        read_seconds = 0.0
        encode_seconds = 0.0
        for task in batch.tasks:
            group_buffer = io.BytesIO()
            entries: list[TileIndexEntry] = []
            offset = 0
            non_empty_tiles = 0
            for local_y in range(task.group_size[1]):
                for local_x in range(task.group_size[0]):
                    tile_x = task.group_x * task.group_size[0] + local_x
                    tile_y = task.group_y * task.group_size[1] + local_y
                    if tile_x >= task.tiles_x or tile_y >= task.tiles_y:
                        continue
                    read_started = perf_counter()
                    tile = source.read_tile(tile_x, tile_y, task.tile_size, task.downsample).convert("RGB")
                    read_seconds += perf_counter() - read_started
                    payload = b""
                    flags = 1 if _tile_is_empty(tile) else 4
                    if flags != 1:
                        non_empty_tiles += 1
                        encode_started = perf_counter()
                        tile_buffer = io.BytesIO()
                        tile.save(tile_buffer, format="JPEG", quality=85)
                        payload = tile_buffer.getvalue()
                        group_buffer.write(len(payload).to_bytes(4, "little"))
                        group_buffer.write(payload)
                        encode_seconds += perf_counter() - encode_started
                    entries.append(
                        TileIndexEntry(
                            tile_x=tile_x,
                            tile_y=tile_y,
                            group_id=task.group_id,
                            offset=offset,
                            length=len(payload),
                            flags=flags,
                        )
                    )
                    if flags != 1:
                        offset += 4 + len(payload)
            rendered_groups.append(
                GroupRenderResult(
                    group_id=task.group_id,
                    payload=group_buffer.getvalue(),
                    entries=entries,
                    non_empty_tiles=non_empty_tiles,
                )
            )
        after = _snapshot_resource_metrics("self")
        return GroupRenderBatchResult(
            groups=rendered_groups,
            read_seconds=read_seconds,
            encode_seconds=encode_seconds,
            resource_metrics=_metric_delta(after, before),
        )
    finally:
        source.close()


class IngestionApplicationService:
    def __init__(
        self,
        reader: SlideReader,
        metadata_reader: MetadataReader,
        store: ArtifactStore,
        events: EventSink,
        index_encoder: IndexEncoder,
        manifest_sink: ManifestSink,
        ingestion_version: str = "0.1.0",
        tile_size: int = 512,
        group_size: tuple[int, int] = (4, 4),
        reader_backend: str = "local",
        max_workers: int = 4,
        chunk_group_count: int = 8,
        tissue_mask_size: int = 1024,
        progress_sink=None,
    ) -> None:
        self._reader = reader
        self._metadata_reader = metadata_reader
        self._store = store
        self._events = events
        self._index_encoder = index_encoder
        self._manifest_sink = manifest_sink
        self._ingestion_version = ingestion_version
        self._tile_size = tile_size
        self._group_size = group_size
        self._reader_backend = reader_backend
        self._max_workers = max_workers
        self._chunk_group_count = chunk_group_count
        self._tissue_mask_size = tissue_mask_size
        self._progress_sink = progress_sink
        self._job_id: str | None = None

    def bind_job(self, job_id: str, reader_backend: str | None = None) -> None:
        self._job_id = job_id
        if reader_backend is not None:
            self._reader_backend = reader_backend

    def ingest(self, request: IngestionRequest) -> ManifestPublication:
        self._events.publish(ingestion_started(request.slide_id, request.version_id))
        self._report_progress(request, 2.0, "opening", "Opening slide")
        source = None
        self_before = _snapshot_resource_metrics("self")
        children_before = _snapshot_resource_metrics("children")
        try:
            source = self._reader.open(request)
            publication = self._build_artifacts(request, source)
            self._report_progress(request, 96.0, "uploading", "Uploading derived artifacts")
            publication.timings["upload_non_manifest_seconds"] = round(
                self._store.flush_pending(exclude_paths={publication.manifest_path}),
                3,
            )
            self._report_progress(request, 99.0, "publishing", "Publishing manifest")
            publication.timings["upload_manifest_seconds"] = round(
                self._store.flush_pending(paths=[publication.manifest_path]),
                3,
            )
            self_after = _snapshot_resource_metrics("self")
            children_after = _snapshot_resource_metrics("children")
            publication.timings.update(
                {
                    key: round(value, 3)
                    for key, value in {
                        **_metric_delta(self_after, self_before),
                        **_metric_delta(children_after, children_before),
                    }.items()
                }
            )
            self._manifest_sink.mark_manifest_ready(request.slide_id, request.version_id, publication.manifest_path)
            self._report_progress(request, 100.0, "published", "Manifest published", status="succeeded")
            self._events.publish(ingestion_completed(request.slide_id, request.version_id))
            self._events.publish(manifest_published(request.slide_id, request.version_id))
            return publication
        except Exception:
            self._report_progress(request, 100.0, "failed", "Ingestion failed", status="failed")
            self._events.publish(ingestion_failed(request.slide_id, request.version_id))
            raise
        finally:
            if source is not None:
                source.close()

    def _build_artifacts(self, request: IngestionRequest, source: SlideSource) -> ManifestPublication:
        width, height = source.dimensions
        metadata = self._describe_metadata(request, source)
        manifest_path = self._manifest_path(request)
        thumbnail_path = self._thumbnail_path(request)

        timings: dict[str, float] = {"process_workers": float(self._max_workers)}
        thumbnail_started = perf_counter()
        self._report_progress(request, 5.0, "thumbnail", "Rendering thumbnail")
        thumbnail = source.get_thumbnail((512, 512)).convert("RGB")
        thumb_buffer = io.BytesIO()
        thumbnail.save(thumb_buffer, format="JPEG", quality=80)
        self._store.write_bytes(thumbnail_path, thumb_buffer.getvalue(), "image/jpeg")
        artifact_bytes = len(thumb_buffer.getvalue())
        timings["thumbnail_seconds"] = round(perf_counter() - thumbnail_started, 3)

        mask_started = perf_counter()
        self._report_progress(request, 10.0, "mask", "Building tissue mask")
        tissue_mask = self._build_tissue_mask(source)
        timings["mask_seconds"] = round(perf_counter() - mask_started, 3)

        levels: list[PyramidLevelSpec] = []
        level_number = 0
        downsample = 1
        total_tiles = 0
        non_empty_tiles = 0
        group_count = 0
        while True:
            level_width = max(1, math.ceil(width / downsample))
            level_height = max(1, math.ceil(height / downsample))
            level_progress = 15.0 + (level_number * 10.0)
            self._report_progress(
                request,
                min(level_progress, 90.0),
                f"level-{level_number}",
                f"Rendering level {level_number} (downsample {downsample})",
            )
            level, level_group_count, level_tiles, level_non_empty, level_bytes, level_timings = self._write_level(
                request=request,
                slide_width=width,
                slide_height=height,
                level_number=level_number,
                downsample=downsample,
                level_width=level_width,
                level_height=level_height,
                tissue_mask=tissue_mask,
            )
            levels.append(level)
            total_tiles += level_tiles
            non_empty_tiles += level_non_empty
            group_count += level_group_count
            artifact_bytes += level_bytes
            timings.update({f"level_{level_number}_{name}": round(value, 3) for name, value in level_timings.items()})
            if level_width <= self._tile_size and level_height <= self._tile_size:
                break
            level_number += 1
            downsample *= 2

        publication = ManifestPublication(
            slide_id=request.slide_id,
            version_id=request.version_id,
            width=width,
            height=height,
            tile_size=self._tile_size,
            group_size=self._group_size,
            levels=levels,
            manifest_path=manifest_path,
            thumbnail_path=thumbnail_path,
            source_checksum=request.checksum,
            ingestion_version=self._ingestion_version,
            metadata=metadata,
            source_name=Path(request.original_path).name,
            level_count=len(levels),
            tile_count=total_tiles,
            non_empty_tile_count=non_empty_tiles,
            group_count=group_count,
            artifact_bytes=artifact_bytes,
            timings=timings,
        )

        manifest = {
            "schema": "wsi-tile-manifest-v1",
            "slideId": publication.slide_id,
            "versionId": publication.version_id,
            "width": publication.width,
            "height": publication.height,
            "tileSize": publication.tile_size,
            "groupSize": list(publication.group_size),
            "levels": [
                {
                    "level": level.level,
                    "downsample": level.downsample,
                    "width": level.width,
                    "height": level.height,
                    "tilesX": level.tiles_x,
                    "tilesY": level.tiles_y,
                    "indexPath": level.index_path,
                }
                for level in publication.levels
            ],
            "artifacts": {
                "manifestPath": publication.manifest_path,
                "thumbnailPath": publication.thumbnail_path,
            },
            "metadata": self._serialize_metadata(publication.metadata),
            "provenance": {
                "ingestionVersion": publication.ingestion_version,
                "sourceChecksum": publication.source_checksum,
                "publishedAt": publication.published_at.isoformat().replace("+00:00", "Z"),
                "sourceName": publication.source_name,
                "metrics": {
                    "levelCount": publication.level_count,
                    "tileCount": publication.tile_count,
                    "nonEmptyTileCount": publication.non_empty_tile_count,
                    "groupCount": publication.group_count,
                    "artifactBytes": publication.artifact_bytes,
                },
            },
        }
        manifest_started = perf_counter()
        manifest_bytes = json.dumps(manifest, indent=2).encode("utf-8")
        self._store.write_bytes(manifest_path, manifest_bytes, "application/json")
        publication.artifact_bytes += len(manifest_bytes)
        publication.timings["manifest_seconds"] = round(perf_counter() - manifest_started, 3)
        return publication

    def _describe_metadata(self, request: IngestionRequest, source: SlideSource) -> SlideMetadata:
        try:
            metadata = self._metadata_reader.describe(request)
        except Exception:
            metadata = source.describe()
        if (metadata.microns_per_pixel_x is None and metadata.microns_per_pixel_y is None) or metadata.vendor is None:
            fallback = source.describe()
            return SlideMetadata(
                vendor=metadata.vendor or fallback.vendor,
                objective_power=metadata.objective_power or fallback.objective_power,
                microns_per_pixel_x=metadata.microns_per_pixel_x or fallback.microns_per_pixel_x,
                microns_per_pixel_y=metadata.microns_per_pixel_y or fallback.microns_per_pixel_y,
                mpp_source=metadata.mpp_source or fallback.mpp_source,
                source_properties={**fallback.source_properties, **metadata.source_properties},
            )
        return metadata

    def _serialize_metadata(self, metadata) -> dict[str, object]:
        payload: dict[str, object] = {}
        if metadata.vendor:
            payload["vendor"] = metadata.vendor
        if metadata.objective_power is not None:
            payload["objectivePower"] = metadata.objective_power
        if metadata.microns_per_pixel_x is not None or metadata.microns_per_pixel_y is not None:
            payload["micronsPerPixel"] = {
                "x": metadata.microns_per_pixel_x,
                "y": metadata.microns_per_pixel_y,
                "source": metadata.mpp_source or "vendor",
            }
        if metadata.source_properties:
            payload["sourceProperties"] = metadata.source_properties
        return payload

    def _build_tissue_mask(self, source: SlideSource) -> TissueMaskIndex:
        thumbnail = source.get_thumbnail((self._tissue_mask_size, self._tissue_mask_size)).convert("L")
        width, height = thumbnail.size
        pixels = thumbnail.load()
        integral = [[0] * (width + 1) for _ in range(height + 1)]
        for y in range(1, height + 1):
            row_total = 0
            for x in range(1, width + 1):
                row_total += 1 if pixels[x - 1, y - 1] < 250 else 0
                integral[y][x] = integral[y - 1][x] + row_total
        return TissueMaskIndex(width=width, height=height, integral=integral)

    def _write_level(
        self,
        request: IngestionRequest,
        slide_width: int,
        slide_height: int,
        level_number: int,
        downsample: int,
        level_width: int,
        level_height: int,
        tissue_mask: TissueMaskIndex,
    ) -> tuple[PyramidLevelSpec, int, int, int, int, dict[str, float]]:
        tiles_x = math.ceil(level_width / self._tile_size)
        tiles_y = math.ceil(level_height / self._tile_size)
        groups_x = math.ceil(tiles_x / self._group_size[0])
        groups_y = math.ceil(tiles_y / self._group_size[1])
        group_count = groups_x * groups_y
        total_tiles = tiles_x * tiles_y
        entries: list[TileIndexEntry] = []
        render_tasks: list[GroupRenderTask] = []
        skipped_groups = 0

        for group_y in range(groups_y):
            for group_x in range(groups_x):
                group_id = group_y * groups_x + group_x
                if not self._group_has_tissue(
                    tissue_mask=tissue_mask,
                    slide_width=slide_width,
                    slide_height=slide_height,
                    group_x=group_x,
                    group_y=group_y,
                    downsample=downsample,
                ):
                    skipped_groups += 1
                    entries.extend(self._empty_group_entries(group_x, group_y, group_id, tiles_x, tiles_y))
                    continue
                render_tasks.append(
                    GroupRenderTask(
                        level_number=level_number,
                        downsample=downsample,
                        tile_size=self._tile_size,
                        group_size=self._group_size,
                        tiles_x=tiles_x,
                        tiles_y=tiles_y,
                        group_x=group_x,
                        group_y=group_y,
                        group_id=group_id,
                    )
                )

        timings = {"skipped_groups": float(skipped_groups)}
        rendered_groups: list[GroupRenderResult] = []
        read_seconds = 0.0
        encode_seconds = 0.0
        child_peak_rss_mb_max = 0.0
        child_peak_rss_mb_sum = 0.0
        child_cpu_user_seconds = 0.0
        child_cpu_system_seconds = 0.0
        render_wall_started = perf_counter()
        if render_tasks:
            batches = [
                GroupRenderBatch(
                    reader_backend=self._reader_backend,
                    original_path=request.original_path,
                    tasks=batch,
                )
                for batch in _chunked(render_tasks, max(1, self._chunk_group_count))
            ]
            if self._max_workers <= 1 or len(batches) == 1:
                batch_results = [_render_group_batch(batch) for batch in batches]
            else:
                with ProcessPoolExecutor(
                    max_workers=min(self._max_workers, len(batches)),
                    mp_context=get_context("spawn"),
                ) as executor:
                    batch_results = list(executor.map(_render_group_batch, batches))
            for batch_result in batch_results:
                rendered_groups.extend(batch_result.groups)
                read_seconds += batch_result.read_seconds
                encode_seconds += batch_result.encode_seconds
                child_peak_rss_mb_max = max(
                    child_peak_rss_mb_max,
                    batch_result.resource_metrics.get("self_max_rss_mb", 0.0),
                )
                child_peak_rss_mb_sum += batch_result.resource_metrics.get("self_max_rss_mb", 0.0)
                child_cpu_user_seconds += batch_result.resource_metrics.get("self_cpu_user_seconds", 0.0)
                child_cpu_system_seconds += batch_result.resource_metrics.get("self_cpu_system_seconds", 0.0)
        timings["render_wall_seconds"] = perf_counter() - render_wall_started
        timings["read_seconds"] = read_seconds
        timings["encode_seconds"] = encode_seconds
        timings["child_worker_peak_rss_mb_max"] = child_peak_rss_mb_max
        timings["child_worker_peak_rss_mb_sum"] = child_peak_rss_mb_sum
        timings["child_worker_cpu_user_seconds"] = child_cpu_user_seconds
        timings["child_worker_cpu_system_seconds"] = child_cpu_system_seconds

        artifact_bytes = 0
        non_empty_tiles = 0
        for group in sorted(rendered_groups, key=lambda item: item.group_id):
            entries.extend(group.entries)
            non_empty_tiles += group.non_empty_tiles
            if group.payload:
                group_path = self._group_path(request, level_number, group.group_id)
                artifact_bytes += len(group.payload)
                self._store.write_bytes(group_path, group.payload, "application/octet-stream")

        entries.sort(key=lambda entry: (entry.tile_y, entry.tile_x))
        index_started = perf_counter()
        index_path = self._index_path(request, level_number)
        index_payload = self._index_encoder.encode(entries)
        timings["index_seconds"] = perf_counter() - index_started
        artifact_bytes += len(index_payload)
        self._store.write_bytes(index_path, index_payload, "application/octet-stream")
        return (
            PyramidLevelSpec(
                level=level_number,
                downsample=downsample,
                width=level_width,
                height=level_height,
                tiles_x=tiles_x,
                tiles_y=tiles_y,
                index_path=index_path,
            ),
            group_count,
            total_tiles,
            non_empty_tiles,
            artifact_bytes,
            timings,
        )

    def _group_has_tissue(
        self,
        tissue_mask: TissueMaskIndex,
        slide_width: int,
        slide_height: int,
        group_x: int,
        group_y: int,
        downsample: int,
    ) -> bool:
        left = group_x * self._group_size[0] * self._tile_size * downsample
        top = group_y * self._group_size[1] * self._tile_size * downsample
        right = min(left + (self._group_size[0] * self._tile_size * downsample), slide_width)
        bottom = min(top + (self._group_size[1] * self._tile_size * downsample), slide_height)
        return tissue_mask.has_tissue(left, top, right, bottom, slide_width, slide_height)

    def _empty_group_entries(
        self,
        group_x: int,
        group_y: int,
        group_id: int,
        tiles_x: int,
        tiles_y: int,
    ) -> list[TileIndexEntry]:
        entries: list[TileIndexEntry] = []
        for local_y in range(self._group_size[1]):
            for local_x in range(self._group_size[0]):
                tile_x = group_x * self._group_size[0] + local_x
                tile_y = group_y * self._group_size[1] + local_y
                if tile_x >= tiles_x or tile_y >= tiles_y:
                    continue
                entries.append(
                    TileIndexEntry(
                        tile_x=tile_x,
                        tile_y=tile_y,
                        group_id=group_id,
                        offset=0,
                        length=0,
                        flags=1,
                    )
                )
        return entries

    def _manifest_path(self, request: IngestionRequest) -> str:
        return f"s3://derived/v1/{request.slide_id}/{request.version_id}/manifest.json"

    def _thumbnail_path(self, request: IngestionRequest) -> str:
        return f"s3://derived/v1/{request.slide_id}/{request.version_id}/thumbnail.jpg"

    def _index_path(self, request: IngestionRequest, level: int) -> str:
        return f"s3://derived/v1/{request.slide_id}/{request.version_id}/levels/{level}/index.bin"

    def _group_path(self, request: IngestionRequest, level: int, group_id: int) -> str:
        return f"s3://derived/v1/{request.slide_id}/{request.version_id}/levels/{level}/groups/{group_id:05d}.tilepack"

    def _report_progress(
        self,
        request: IngestionRequest,
        progress_percent: float,
        stage: str,
        message: str,
        status: str = "running",
    ) -> None:
        if self._job_id and self._progress_sink is not None:
            self._progress_sink.upsert_job(
                {
                    "job_id": self._job_id,
                    "slide_id": request.slide_id,
                    "version_id": request.version_id,
                    "status": status,
                    "reader_backend": self._reader_backend,
                    "progress_percent": round(progress_percent, 1),
                    "stage": stage,
                    "message": message,
                    "updated_at": utc_now().isoformat(),
                }
            )
        print(
            json.dumps(
                {
                    "type": "progress",
                    "job_id": self._job_id,
                    "slide_id": request.slide_id,
                    "version_id": request.version_id,
                    "reader_backend": self._reader_backend,
                    "status": status,
                    "progress_percent": round(progress_percent, 1),
                    "stage": stage,
                    "message": message,
                }
            ),
            file=sys.stderr,
            flush=True,
        )
