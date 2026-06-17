import json
from pathlib import Path

from jsonschema import validate


def test_manifest_schema_matches_worker_output_shape() -> None:
    schema = json.loads(Path("docs/contracts/manifest.schema.json").read_text())
    sample = {
        "schema": "wsi-tile-manifest-v1",
        "slideId": "slide-1",
        "versionId": "v-1",
        "width": 2048,
        "height": 1536,
        "tileSize": 512,
        "groupSize": [4, 4],
        "levels": [
            {
                "level": 0,
                "downsample": 1,
                "width": 2048,
                "height": 1536,
                "tilesX": 4,
                "tilesY": 3,
                "indexPath": "s3://derived/v1/slide-1/v-1/levels/0/index.bin",
            }
        ],
        "artifacts": {
            "manifestPath": "s3://derived/v1/slide-1/v-1/manifest.json",
            "thumbnailPath": "s3://derived/v1/slide-1/v-1/thumbnail.jpg",
        },
        "metadata": {
            "vendor": "hamamatsu",
            "objectivePower": 40,
            "micronsPerPixel": {"x": 0.23, "y": 0.23, "source": "vendor"},
            "sourceProperties": {"hamamatsu.SourceLens": "40"},
        },
        "provenance": {
            "ingestionVersion": "0.1.0",
            "sourceChecksum": "sha256:abc",
            "publishedAt": "2026-06-16T00:00:00Z",
        },
    }
    validate(instance=sample, schema=schema)
