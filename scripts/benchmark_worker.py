"""Simple local benchmark for the ingestion worker MVP."""

from __future__ import annotations

import tempfile
import time
from pathlib import Path

from PIL import Image, ImageDraw

from worker.worker_service.domain.models import IngestionRequest
from worker.worker_service.infrastructure.bootstrap import Container


def main() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        slide = root / "benchmark.tiff"
        image = Image.new("RGB", (4096, 3072), color=(255, 255, 255))
        draw = ImageDraw.Draw(image)
        draw.rectangle((128, 128, 3500, 2500), fill=(120, 0, 0))
        image.save(slide)

        container = Container(root=root / "out")
        started = time.perf_counter()
        container.ingestion_service.ingest(
            IngestionRequest(
                slide_id="benchmark-slide",
                version_id="v-1",
                checksum="sha256:benchmark",
                original_path=str(slide),
            )
        )
        elapsed = time.perf_counter() - started
        print(f"ingestion_seconds={elapsed:.3f}")


if __name__ == "__main__":
    main()
