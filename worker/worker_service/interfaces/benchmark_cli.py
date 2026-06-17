"""Purpose: benchmark supported reader backends on representative slides and persist a comparison report.
Owner context: Ingestion.
Invariants: benchmarks use the same ingest contract as production worker runs.
Failure modes: reader errors are captured in the report without aborting the whole benchmark suite.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

from worker.worker_service.domain.models import IngestionRequest
from worker.worker_service.infrastructure.bootstrap import Container


def sha256_for(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def sanitize(name: str) -> str:
    return name.lower().replace(".", "-")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", default="test_dataset")
    parser.add_argument("--output-root", default=".artifacts/benchmarks")
    parser.add_argument("--catalog-path", default=".artifacts/benchmarks/catalog.json")
    parser.add_argument("--report-dir", default="benchmarks")
    parser.add_argument("--storage-backend", default="local", choices=["local", "minio"])
    parser.add_argument("--readers", nargs="+", default=["fastslide", "openslide"])
    parser.add_argument("--metadata-backend", default="openslide", choices=["openslide", "fastslide", "pyvips", "local", "render"])
    parser.add_argument("--max-workers", type=int, default=6)
    parser.add_argument("--chunk-group-count", type=int, default=16)
    parser.add_argument("--tissue-mask-size", type=int, default=1536)
    parser.add_argument("--upload-workers", type=int, default=8)
    args = parser.parse_args()

    dataset_dir = Path(args.dataset_dir)
    slides = sorted(path for path in dataset_dir.iterdir() if path.suffix.lower() in {".svs", ".ndpi"})
    report_rows: list[dict[str, object]] = []
    failures: list[dict[str, str]] = []

    for slide_path in slides:
        checksum = sha256_for(slide_path)
        for reader_backend in args.readers:
            slide_id = f"benchmark-{sanitize(slide_path.name)}-{reader_backend}"
            version_id = "v1"
            container = Container(
                root=Path(args.output_root),
                storage_backend=args.storage_backend,
                reader_backend=reader_backend,
                metadata_backend=args.metadata_backend,
                catalog_path=Path(args.catalog_path),
                max_workers=args.max_workers,
                chunk_group_count=args.chunk_group_count,
                tissue_mask_size=args.tissue_mask_size,
                upload_workers=args.upload_workers,
            )
            service = container.ingestion_service
            service.bind_job(job_id=f"benchmark-{slide_id}", reader_backend=reader_backend)
            started = perf_counter()
            try:
                publication = service.ingest(
                    IngestionRequest(
                        slide_id=slide_id,
                        version_id=version_id,
                        checksum=checksum,
                        original_path=str(slide_path),
                    )
                )
            except Exception as error:
                failures.append({"slide": slide_path.name, "reader": reader_backend, "error": str(error)})
                continue
            elapsed_seconds = perf_counter() - started
            report_rows.append(
                {
                    "slide": slide_path.name,
                    "reader_backend": reader_backend,
                    "elapsed_seconds": round(elapsed_seconds, 3),
                    "artifact_bytes": publication.artifact_bytes,
                    "level_count": publication.level_count,
                    "tile_count": publication.tile_count,
                    "self_max_rss_mb": publication.timings.get("self_max_rss_mb"),
                    "children_max_rss_mb": publication.timings.get("children_max_rss_mb"),
                    "child_worker_peak_rss_mb_max": max(
                        (value for key, value in publication.timings.items() if key.endswith("child_worker_peak_rss_mb_max")),
                        default=0.0,
                    ),
                    "children_cpu_user_seconds": publication.timings.get("children_cpu_user_seconds"),
                    "children_cpu_system_seconds": publication.timings.get("children_cpu_system_seconds"),
                }
            )

    grouped: dict[str, list[dict[str, object]]] = {}
    for row in report_rows:
        grouped.setdefault(str(row["slide"]), []).append(row)

    recommended_by_slide: dict[str, str] = {}
    for slide_name, rows in grouped.items():
        best = min(rows, key=lambda row: float(row["elapsed_seconds"]))
        recommended_by_slide[slide_name] = str(best["reader_backend"])

    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    report = {
        "generated_at": generated_at,
        "readers": args.readers,
        "results": report_rows,
        "recommended_by_slide": recommended_by_slide,
        "failures": failures,
    }

    report_dir = Path(args.report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    json_path = report_dir / f"reader-benchmark-{stamp}.json"
    md_path = report_dir / f"reader-benchmark-{stamp}.md"
    json_path.write_text(json.dumps(report, indent=2))
    md_path.write_text(render_markdown(report_rows, recommended_by_slide, failures, generated_at))
    print(json.dumps({"json_report": str(json_path), "markdown_report": str(md_path), "recommended_by_slide": recommended_by_slide}, indent=2))


def render_markdown(
    rows: list[dict[str, object]],
    recommended_by_slide: dict[str, str],
    failures: list[dict[str, str]],
    generated_at: str,
) -> str:
    lines = [
        "# Reader Benchmark",
        "",
        f"Generated at: `{generated_at}`",
        "",
        "| Slide | Reader | Elapsed (s) | Child Peak RSS MB | Parent Peak RSS MB | Child CPU User s | Child CPU System s |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in rows:
        lines.append(
            f"| {row['slide']} | {row['reader_backend']} | {row['elapsed_seconds']} | "
            f"{row['child_worker_peak_rss_mb_max']} | {row['self_max_rss_mb']} | "
            f"{row['children_cpu_user_seconds']} | {row['children_cpu_system_seconds']} |"
        )
    lines.extend(["", "## Recommended Readers", ""])
    for slide, reader in recommended_by_slide.items():
        lines.append(f"- `{slide}`: `{reader}`")
    if failures:
        lines.extend(["", "## Failures", ""])
        for failure in failures:
            lines.append(f"- `{failure['slide']}` with `{failure['reader']}`: {failure['error']}")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    main()
