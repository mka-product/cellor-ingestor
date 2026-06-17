"""Purpose: local and OpenSlide-backed readers for ingestion.
Owner context: Ingestion.
Invariants: readers expose deterministic tile and thumbnail operations.
Failure modes: unsupported or missing slides raise ValueError or FileNotFoundError.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

from worker.worker_service.application.ports import MetadataReader, SlideSource
from worker.worker_service.domain.models import IngestionRequest, SlideMetadata

try:
    import openslide
except ImportError:  # pragma: no cover - exercised in docker runtime
    openslide = None

try:
    import pyvips
except ImportError:  # pragma: no cover - exercised in docker runtime
    pyvips = None

try:
    import fastslide
except ImportError:  # pragma: no cover - exercised in docker runtime
    fastslide = None


def open_slide_source(reader_backend: str, original_path: str) -> SlideSource:
    request = IngestionRequest(slide_id="runtime", version_id="runtime", checksum="runtime", original_path=original_path)
    if reader_backend == "openslide":
        reader = OpenSlideReader()
    elif reader_backend == "fastslide":
        reader = FastSlideReader()
    elif reader_backend == "pyvips":
        reader = PyVipsReader()
    else:
        reader = LocalSlideReader()
    return reader.open(request)


def build_metadata_reader(metadata_backend: str, render_backend: str) -> MetadataReader:
    if metadata_backend == "render":
        metadata_backend = render_backend
    if metadata_backend == "openslide":
        return OpenSlideMetadataReader()
    if metadata_backend == "pyvips":
        return PyVipsMetadataReader()
    if metadata_backend == "fastslide":
        return FastSlideMetadataReader()
    return LocalMetadataReader()


def _parse_float(value: object) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if math.isfinite(parsed):
        return parsed
    return None


def _normalize_source_properties(properties: object) -> dict[str, str]:
    if not isinstance(properties, dict):
        return {}
    return {str(key): str(value) for key, value in properties.items()}


def _metadata_from_properties(
    properties: dict[str, str],
    *,
    vendor: str | None = None,
    default_source: str = "vendor",
) -> SlideMetadata:
    objective = _parse_float(
        properties.get("openslide.objective-power")
        or properties.get("hamamatsu.SourceLens")
        or properties.get("aperio.AppMag")
        or properties.get("objective_power")
    )
    mpp_x = _parse_float(properties.get("openslide.mpp-x") or properties.get("mpp_x"))
    mpp_y = _parse_float(properties.get("openslide.mpp-y") or properties.get("mpp_y"))
    mpp_source = default_source if mpp_x or mpp_y else None
    return SlideMetadata(
        vendor=vendor or properties.get("openslide.vendor") or properties.get("vendor"),
        objective_power=objective,
        microns_per_pixel_x=mpp_x,
        microns_per_pixel_y=mpp_y,
        mpp_source=mpp_source,
        source_properties=properties,
    )


class PillowSlideSource:
    def __init__(self, image: Image.Image) -> None:
        self._image = image

    @property
    def dimensions(self) -> tuple[int, int]:
        return self._image.size

    def get_thumbnail(self, max_size: tuple[int, int]) -> Image.Image:
        thumbnail = self._image.copy()
        thumbnail.thumbnail(max_size)
        return thumbnail

    def describe(self) -> SlideMetadata:
        return SlideMetadata(vendor="local", source_properties={"reader": "pillow"})

    def read_tile(self, tile_x: int, tile_y: int, tile_size: int, downsample: int) -> Image.Image:
        left = tile_x * tile_size * downsample
        upper = tile_y * tile_size * downsample
        right = min(left + tile_size * downsample, self._image.width)
        lower = min(upper + tile_size * downsample, self._image.height)
        tile = Image.new("RGB", (tile_size, tile_size), color=(255, 255, 255))
        crop = self._image.crop((left, upper, right, lower))
        if downsample > 1:
            crop = crop.resize(
                (
                    max(1, math.ceil((right - left) / downsample)),
                    max(1, math.ceil((lower - upper) / downsample)),
                ),
                Image.Resampling.BILINEAR,
            )
        tile.paste(crop, (0, 0))
        return tile

    def close(self) -> None:
        self._image.close()


class OpenSlideSource:
    def __init__(self, slide: "openslide.OpenSlide") -> None:
        self._slide = slide

    @property
    def dimensions(self) -> tuple[int, int]:
        return self._slide.dimensions

    def describe(self) -> SlideMetadata:
        properties = _normalize_source_properties(dict(self._slide.properties))
        vendor = None
        if openslide is not None:
            vendor = properties.get(getattr(openslide, "PROPERTY_NAME_VENDOR", "openslide.vendor"))
        return _metadata_from_properties(properties, vendor=vendor, default_source="openslide")

    def get_thumbnail(self, max_size: tuple[int, int]) -> Image.Image:
        return self._slide.get_thumbnail(max_size)

    def read_tile(self, tile_x: int, tile_y: int, tile_size: int, downsample: int) -> Image.Image:
        level = self._slide.get_best_level_for_downsample(downsample)
        level_downsample = float(self._slide.level_downsamples[level])
        base_left = tile_x * tile_size * downsample
        base_top = tile_y * tile_size * downsample
        request_width = max(1, math.ceil((tile_size * downsample) / level_downsample))
        request_height = max(1, math.ceil((tile_size * downsample) / level_downsample))
        region = self._slide.read_region((base_left, base_top), level, (request_width, request_height)).convert("RGB")
        if region.size != (tile_size, tile_size):
            region = region.resize((tile_size, tile_size), Image.Resampling.BILINEAR)
        return region

    def close(self) -> None:
        self._slide.close()


class FastSlideSource:
    """Purpose: fastslide-backed slide access with native Python bindings.
    Owner context: Ingestion.
    Invariants: exposes deterministic dimensions, thumbnails, and tile reads.
    Failure modes: unsupported formats or native reader failures bubble as adapter errors.
    """

    def __init__(self, slide: "fastslide.FastSlide") -> None:
        self._slide = slide

    @property
    def dimensions(self) -> tuple[int, int]:
        width, height = self._slide.dimensions
        return int(width), int(height)

    def describe(self) -> SlideMetadata:
        properties = _normalize_source_properties(getattr(self._slide, "properties", {}))
        metadata = _metadata_from_properties(properties, default_source="vendor")
        if metadata.vendor is None:
            metadata = SlideMetadata(
                vendor="fastslide",
                objective_power=metadata.objective_power,
                microns_per_pixel_x=metadata.microns_per_pixel_x,
                microns_per_pixel_y=metadata.microns_per_pixel_y,
                mpp_source=metadata.mpp_source,
                source_properties=metadata.source_properties,
            )
        return metadata

    def get_thumbnail(self, max_size: tuple[int, int]) -> Image.Image:
        width, height = self.dimensions
        scale = min(max_size[0] / width, max_size[1] / height, 1.0)
        target_width = max(1, math.ceil(width * scale))
        target_height = max(1, math.ceil(height * scale))
        level = self._slide.get_best_level_for_downsample(1 / scale if scale > 0 else 1)
        level_width, level_height = self._slide.level_dimensions[level]
        image = self._slide.read_region(location=(0, 0), level=level, size=(int(level_width), int(level_height)))
        thumbnail = Image.fromarray(image.numpy())
        if thumbnail.size != (target_width, target_height):
            thumbnail = thumbnail.resize((target_width, target_height), Image.Resampling.BILINEAR)
        return thumbnail.convert("RGB")

    def read_tile(self, tile_x: int, tile_y: int, tile_size: int, downsample: int) -> Image.Image:
        level = self._slide.get_best_level_for_downsample(downsample)
        left_level0 = tile_x * tile_size * downsample
        top_level0 = tile_y * tile_size * downsample
        left, top = self._slide.convert_level0_to_level_native(int(left_level0), int(top_level0), int(level))
        level_downsample = float(self._slide.level_downsamples[level])
        level_width, level_height = self._slide.level_dimensions[level]
        request_width = max(1, math.ceil((tile_size * downsample) / level_downsample))
        request_height = max(1, math.ceil((tile_size * downsample) / level_downsample))
        request_width = max(1, min(request_width, int(level_width) - int(left)))
        request_height = max(1, min(request_height, int(level_height) - int(top)))
        image = self._slide.read_region(location=(int(left), int(top)), level=int(level), size=(request_width, request_height))
        region = Image.fromarray(image.numpy()).convert("RGB")
        if region.size != (tile_size, tile_size):
            region = region.resize((tile_size, tile_size), Image.Resampling.BILINEAR)
        return region

    def close(self) -> None:
        self._slide.close()


class VipsSlideSource:
    """Purpose: pyvips-backed slide access for faster random tile reads.
    Owner context: Ingestion.
    Invariants: exposes the same tile contract as other slide sources.
    Failure modes: invalid vendor level metadata or crop failures bubble as adapter errors.
    """

    def __init__(self, path: Path) -> None:
        if pyvips is None:
            raise RuntimeError("pyvips is not installed")
        self._path = path
        self._base = pyvips.Image.openslideload(str(path), level=0, access="random")
        self._openslide = openslide.OpenSlide(str(path)) if openslide is not None else None
        self._dimensions = (self._base.width, self._base.height)
        self._levels: dict[int, pyvips.Image] = {0: self._base}
        self._level_downsamples: list[float] = [1.0]
        level = 1
        while True:
            try:
                image = pyvips.Image.openslideload(str(path), level=level, access="random")
            except Exception:
                break
            self._levels[level] = image
            self._level_downsamples.append(self._dimensions[0] / image.width if image.width else 1.0)
            level += 1

    @property
    def dimensions(self) -> tuple[int, int]:
        return self._dimensions

    def describe(self) -> SlideMetadata:
        if self._openslide is not None:
            properties = _normalize_source_properties(dict(self._openslide.properties))
            return _metadata_from_properties(properties, default_source="openslide")
        return SlideMetadata(vendor="pyvips", source_properties={"reader": "pyvips"})

    def get_thumbnail(self, max_size: tuple[int, int]) -> Image.Image:
        if self._openslide is not None:
            return self._openslide.get_thumbnail(max_size).convert("RGB")
        scale = min(max_size[0] / self._dimensions[0], max_size[1] / self._dimensions[1], 1.0)
        thumbnail = self._base.resize(scale)
        return self._to_pil(thumbnail)

    def read_tile(self, tile_x: int, tile_y: int, tile_size: int, downsample: int) -> Image.Image:
        level = self._best_level_for_downsample(downsample)
        image = self._levels[level]
        level_downsample = self._level_downsamples[level]
        left = int((tile_x * tile_size * downsample) / level_downsample)
        top = int((tile_y * tile_size * downsample) / level_downsample)
        request_width = max(1, math.ceil((tile_size * downsample) / level_downsample))
        request_height = max(1, math.ceil((tile_size * downsample) / level_downsample))
        crop_width = max(1, min(request_width, image.width - left))
        crop_height = max(1, min(request_height, image.height - top))
        region = image.crop(max(0, left), max(0, top), crop_width, crop_height)
        if region.width != tile_size or region.height != tile_size:
            scale_x = tile_size / region.width
            scale_y = tile_size / region.height
            if abs(scale_x - scale_y) < 1e-6:
                region = region.resize(scale_x)
            else:
                region = region.affine([scale_x, 0, 0, scale_y], interpolate=pyvips.Interpolate.new("bilinear"))
            if region.width != tile_size or region.height != tile_size:
                region = region.embed(0, 0, tile_size, tile_size, extend="white")
        return self._to_pil(region)

    def close(self) -> None:
        if self._openslide is not None:
            self._openslide.close()
        self._levels.clear()

    def _best_level_for_downsample(self, downsample: int) -> int:
        for index, level_downsample in enumerate(self._level_downsamples):
            if level_downsample >= downsample:
                return index
        return len(self._level_downsamples) - 1

    def _to_pil(self, image: "pyvips.Image") -> Image.Image:
        if image.bands > 3:
            image = image.extract_band(0, n=3)
        if image.bands == 1:
            image = image.bandjoin([image, image])
        memory = image.write_to_memory()
        return Image.frombytes("RGB", (image.width, image.height), memory)


class LocalSlideReader:
    def open(self, request: IngestionRequest) -> SlideSource:
        path = Path(request.original_path)
        if path.exists():
            return PillowSlideSource(Image.open(path))
        if request.original_path.endswith((".svs", ".ndpi", ".tiff", ".tif")):
            image = Image.new("RGB", (2048, 1536), color=(255, 255, 255))
            draw = ImageDraw.Draw(image)
            draw.rectangle((128, 128, 1700, 1200), fill=(180, 20, 50))
            draw.ellipse((600, 300, 1300, 1000), fill=(240, 200, 30))
            return PillowSlideSource(image)
        raise ValueError("unsupported original path for local reader")


class LocalMetadataReader:
    def describe(self, request: IngestionRequest) -> SlideMetadata:
        path = Path(request.original_path)
        if path.exists():
            return SlideMetadata(vendor="local", source_properties={"reader": "pillow", "source_name": path.name})
        return SlideMetadata(vendor="local", source_properties={"reader": "pillow"})


class OpenSlideReader:
    def open(self, request: IngestionRequest) -> SlideSource:
        path = Path(request.original_path)
        if not path.exists():
            raise FileNotFoundError(request.original_path)
        if openslide is None:
            raise RuntimeError("openslide-python is not installed")
        return OpenSlideSource(openslide.OpenSlide(str(path)))


class OpenSlideMetadataReader:
    def describe(self, request: IngestionRequest) -> SlideMetadata:
        path = Path(request.original_path)
        if not path.exists():
            raise FileNotFoundError(request.original_path)
        if openslide is None:
            raise RuntimeError("openslide-python is not installed")
        slide = openslide.OpenSlide(str(path))
        try:
            return OpenSlideSource(slide).describe()
        finally:
            slide.close()


class PyVipsReader:
    def open(self, request: IngestionRequest) -> SlideSource:
        path = Path(request.original_path)
        if not path.exists():
            raise FileNotFoundError(request.original_path)
        if pyvips is None:
            raise RuntimeError("pyvips is not installed")
        return VipsSlideSource(path)


class PyVipsMetadataReader:
    def describe(self, request: IngestionRequest) -> SlideMetadata:
        path = Path(request.original_path)
        if not path.exists():
            raise FileNotFoundError(request.original_path)
        source = VipsSlideSource(path)
        try:
            return source.describe()
        finally:
            source.close()


class FastSlideReader:
    def open(self, request: IngestionRequest) -> SlideSource:
        path = Path(request.original_path)
        if not path.exists():
            raise FileNotFoundError(request.original_path)
        if fastslide is None:
            raise RuntimeError("fastslide is not installed")
        return FastSlideSource(fastslide.FastSlide.from_file_path(str(path)))


class FastSlideMetadataReader:
    def describe(self, request: IngestionRequest) -> SlideMetadata:
        path = Path(request.original_path)
        if not path.exists():
            raise FileNotFoundError(request.original_path)
        if fastslide is None:
            raise RuntimeError("fastslide is not installed")
        slide = fastslide.FastSlide.from_file_path(str(path))
        try:
            return FastSlideSource(slide).describe()
        finally:
            slide.close()
