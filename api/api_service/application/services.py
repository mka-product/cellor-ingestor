"""Purpose: application use cases for upload initiation, completion, and manifest lookup.
Owner context: Identity & Catalog and Delivery.
Invariants: use cases remain deterministic and repository-backed; no HTTP logic lives here.
Failure modes: missing resources raise LookupError; duplicate identities remain idempotent.
"""

from __future__ import annotations

import hashlib
import tempfile
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from time import perf_counter
from typing import Any
from api.api_service.application.review_validation import validate_annotation_geometry
from api.api_service.application.overlay_artifacts import publish_overlay_artifacts, publish_streaming_geoparquet_artifacts
from api.api_service.application.overlay_delivery import build_overlay_manifest, load_overlay_chunk
from api.api_service.application.overlay_ingestion import parse_overlay_source, to_overlay_definition
from uuid import uuid4

from api.api_service.application.dto import (
    CompleteUploadCommand,
    IngestionJobView,
    InitiateUploadCommand,
    SlideVersionView,
    UploadInitiation,
)
from api.api_service.application.ports import (
    AnnotationLayerRepository,
    AnnotationRepository,
    CommentRepository,
    EventPublisher,
    IngestionJobRepository,
    JobQueue,
    OverlayRepository,
    ReviewRepository,
    SlideRepository,
    TagRepository,
    SlideVersionRepository,
)
from api.api_service.domain.events import IngestionRequested, OriginalUploaded
from api.api_service.domain.models import (
    AnnotationComment,
    AnnotationFeature,
    AnnotationId,
    AnnotationLayer,
    AnnotationLayerId,
    AnnotationReview,
    Checksum,
    CommentId,
    IngestionJob,
    OverlayDefinition,
    OverlayId,
    SlideTag,
    Slide,
    SlideId,
    SlideVersion,
    StoragePath,
    VersionId,
    utc_now,
)


class UploadApplicationService:
    def __init__(
        self,
        slides: SlideRepository,
        versions: SlideVersionRepository,
        jobs: IngestionJobRepository,
        events: EventPublisher,
        queue: JobQueue,
        catalog,
    ) -> None:
        self._slides = slides
        self._versions = versions
        self._jobs = jobs
        self._events = events
        self._queue = queue
        self._catalog = catalog

    def initiate(self, command: InitiateUploadCommand) -> UploadInitiation:
        slide_id = f"slide-{uuid4().hex[:12]}"
        version_id = f"v-{uuid4().hex[:12]}"
        object_path = f"s3://raw/{slide_id}/{version_id}/original/{command.filename}"
        upload_url = f"https://uploads.local/{slide_id}/{version_id}"
        return UploadInitiation(
            slide_id=slide_id,
            version_id=version_id,
            upload_url=upload_url,
            object_path=object_path,
        )

    def complete(self, command: CompleteUploadCommand) -> IngestionJobView:
        slide_id = SlideId(command.slide_id)
        version_id = VersionId(command.version_id)
        checksum = Checksum(command.checksum)

        existing_version = self._versions.get(slide_id, version_id)
        if existing_version is None:
            duplicate = self._versions.find_by_checksum(checksum.value)
            version = duplicate or SlideVersion(
                slide_id=slide_id,
                version_id=version_id,
                original_path=StoragePath(command.original_path),
                checksum=checksum,
            )
            self._versions.save(version)
            slide = self._slides.get(slide_id) or Slide(slide_id=slide_id)
            slide.latest_version_id = version.version_id
            self._slides.save(slide)
            self._events.publish(
                OriginalUploaded(
                    slide_id=version.slide_id.value,
                    version_id=version.version_id.value,
                    checksum=version.checksum.value,
                    original_path=version.original_path.value,
                )
            )
        else:
            version = existing_version

        existing_job = self._jobs.get_by_version(version.slide_id, version.version_id)
        display_name = Path(command.original_path).name or command.slide_id
        if existing_job is not None:
            return IngestionJobView(
                job_id=existing_job.job_id,
                slide_id=existing_job.slide_id.value,
                version_id=existing_job.version_id.value,
                status=existing_job.status.value,
                display_name=display_name,
                reader_backend=command.reader_backend or "fastslide",
                metadata_backend=command.metadata_backend or "openslide",
                progress_percent=0.0,
                stage="queued",
                message="Job already queued",
            )

        job = IngestionJob(
            job_id=f"job-{uuid4().hex[:12]}",
            slide_id=version.slide_id,
            version_id=version.version_id,
            checksum=version.checksum,
        )
        self._jobs.save(job)
        self._queue.enqueue(job)
        self._catalog.upsert_job(
            {
                "job_id": job.job_id,
                "slide_id": job.slide_id.value,
                "version_id": job.version_id.value,
                "status": job.status.value,
                "display_name": display_name,
                "checksum": job.checksum.value,
                "original_path": command.original_path,
                "reader_backend": command.reader_backend or "fastslide",
                "metadata_backend": command.metadata_backend or "openslide",
                "progress_percent": 0.0,
                "stage": "queued",
                "message": "Awaiting worker pickup",
                "started_at": None,
                "updated_at": job.updated_at.isoformat(),
            }
        )
        self._events.publish(
            IngestionRequested(
                job_id=job.job_id,
                slide_id=job.slide_id.value,
                version_id=job.version_id.value,
            )
        )
        return IngestionJobView(
            job_id=job.job_id,
            slide_id=job.slide_id.value,
            version_id=job.version_id.value,
            status=job.status.value,
            display_name=display_name,
            reader_backend=command.reader_backend or "fastslide",
            metadata_backend=command.metadata_backend or "openslide",
            progress_percent=0.0,
            stage="queued",
            message="Awaiting worker pickup",
        )


class CatalogQueryService:
    def __init__(self, slides: SlideRepository, versions: SlideVersionRepository) -> None:
        self._slides = slides
        self._versions = versions

    def get_slide(self, slide_id: str) -> SlideVersionView:
        slide = self._slides.get(SlideId(slide_id))
        if slide is None or slide.latest_version_id is None:
            raise LookupError("slide not found")
        version = self._versions.get(slide.slide_id, slide.latest_version_id)
        if version is None:
            raise LookupError("slide version not found")
        return SlideVersionView(
            slide_id=version.slide_id.value,
            version_id=version.version_id.value,
            checksum=version.checksum.value,
            manifest_path=version.manifest_path,
        )

    def get_manifest_path(self, slide_id: str, version_id: str) -> str:
        version = self._versions.get(SlideId(slide_id), VersionId(version_id))
        if version is None or version.manifest_path is None:
            raise LookupError("manifest not available")
        return version.manifest_path


class OverlayQueryService:
    def __init__(self, overlays: OverlayRepository, minio_proxy=None) -> None:
        self._overlays = overlays
        self._minio_proxy = minio_proxy

    def list_overlays(self, slide_id: str) -> list[dict[str, object]]:
        payload: list[dict[str, object]] = []
        for overlay in self._overlays.list_for_slide(SlideId(slide_id)):
            feature_count = int(overlay.metadata.get("featureCount", len(overlay.features)))
            payload.append(
                {
                    "id": overlay.overlay_id.value,
                    "name": overlay.name,
                    "kind": overlay.kind,
                    "featureCount": feature_count,
                    "legend": list(overlay.legend),
                }
            )
        return payload

    def get_overlay(self, slide_id: str, overlay_id: str) -> dict[str, object]:
        overlay = self._overlays.get(SlideId(slide_id), OverlayId(overlay_id))
        if overlay is None:
            raise LookupError("overlay not found")
        manifest = self.get_overlay_manifest(slide_id, overlay_id)
        metadata = {
            key: value
            for key, value in overlay.metadata.items()
            if key not in {"deliveryManifest", "chunkPaths"}
        }
        return {
            "id": overlay.overlay_id.value,
            "name": overlay.name,
            "kind": overlay.kind,
            "sourceFormat": overlay.source_format,
            "versionId": overlay.version_id,
            "metadata": metadata,
            "delivery": {
                "manifestPath": f"/slides/{overlay.slide_id.value}/overlays/{overlay.overlay_id.value}/manifest",
                "detailMode": "inline" if overlay.features else "chunked",
                "chunkCount": len(manifest["chunking"]["chunks"]),
            },
            "features": [
                {
                    "id": feature.id,
                    "name": feature.name,
                    "kind": feature.kind,
                    "geometry": feature.geometry,
                    "properties": feature.properties,
                    "styleHints": feature.style_hints,
                    "bounds": list(feature.bounds),
                }
                for feature in overlay.features
            ],
            "legend": list(overlay.legend),
        }

    def get_overlay_manifest(self, slide_id: str, overlay_id: str) -> dict[str, object]:
        overlay = self._overlays.get(SlideId(slide_id), OverlayId(overlay_id))
        if overlay is None:
            raise LookupError("overlay not found")
        if isinstance(overlay.metadata.get("deliveryManifest"), dict):
            return dict(overlay.metadata["deliveryManifest"])
        return build_overlay_manifest(overlay)

    def get_overlay_chunk(self, slide_id: str, overlay_id: str, chunk_id: str, representation: str | None = None) -> dict[str, object]:
        overlay = self._overlays.get(SlideId(slide_id), OverlayId(overlay_id))
        if overlay is None:
            raise LookupError("overlay not found")
        if isinstance(overlay.metadata.get("deliveryManifest"), dict) and self._minio_proxy is not None:
            chunks = overlay.metadata["deliveryManifest"].get("chunking", {}).get("chunks", [])
            chunk = next((item for item in chunks if item.get("id") == chunk_id), None)
            if isinstance(chunk, dict):
                if representation and isinstance(chunk.get("representations"), dict):
                    summary = chunk["representations"].get(representation)
                    if isinstance(summary, dict) and isinstance(summary.get("path"), str):
                        return self._minio_proxy.load_json(str(summary["path"]))
                if isinstance(chunk.get("path"), str):
                    return self._minio_proxy.load_json(str(chunk["path"]))
        if not overlay.features:
            if self._minio_proxy is None:
                raise LookupError("overlay chunk not found")
            chunk_paths = overlay.metadata.get("chunkPaths", {})
            if not isinstance(chunk_paths, dict) or chunk_id not in chunk_paths:
                raise LookupError("overlay chunk not found")
            return self._minio_proxy.load_json(str(chunk_paths[chunk_id]))
        return load_overlay_chunk(overlay, chunk_id)


class OverlayIngestionApplicationService:
    def __init__(self, overlays: OverlayRepository, catalog, minio_proxy=None) -> None:
        self._overlays = overlays
        self._catalog = catalog
        self._minio_proxy = minio_proxy

    def stage_upload(
        self,
        *,
        slide_id: str,
        filename: str,
        source_format: str,
        payload: bytes,
        display_name: str | None = None,
    ) -> dict[str, object]:
        overlay_id = f"overlay-{uuid4().hex[:12]}"
        version_id = f"v-{uuid4().hex[:12]}"
        job_id = f"overlay-job-{uuid4().hex[:12]}"
        checksum = f"sha256:{hashlib.sha256(payload).hexdigest()}"
        started_at = utc_now().isoformat()
        if self._minio_proxy is not None:
            object_path = f"s3://raw-overlays/{slide_id}/{overlay_id}/{filename}"
            self._minio_proxy.put_bytes(object_path, payload, "application/octet-stream")
        else:
            import os
            staging_dir = Path(os.environ.get("OVERLAY_STAGING_DIR", ".artifacts/overlay-staging")) / slide_id / overlay_id
            staging_dir.mkdir(parents=True, exist_ok=True)
            local_path = staging_dir / filename
            local_path.write_bytes(payload)
            object_path = f"file://{local_path.resolve()}"
        staged = {
            "job_id": job_id,
            "slide_id": slide_id,
            "overlay_id": overlay_id,
            "version_id": version_id,
            "filename": filename,
            "name": display_name or Path(filename).stem,
            "source_format": source_format,
            "status": "pending",
            "stage": "queued",
            "progress_percent": 0.0,
            "message": "Awaiting overlay worker pickup",
            "feature_count": 0,
            "kind": None,
            "checksum": checksum,
            "runtime_format": None,
            "started_at": started_at,
            "updated_at": started_at,
            "metrics": {},
            "artifact": {},
            "object_path": object_path,
        }
        self._catalog.upsert_overlay_job(staged)
        return staged

    def process_staged_upload(self, staged: dict[str, object]) -> dict[str, object]:
        object_path = str(staged["object_path"])
        if object_path.startswith("file://"):
            payload = Path(object_path.removeprefix("file://")).read_bytes()
        elif self._minio_proxy is not None:
            payload, _ = self._minio_proxy.get_s3_bytes(object_path)
        else:
            raise RuntimeError("overlay staging requires object storage or local file path")
        return self._ingest_payload(
            slide_id=str(staged["slide_id"]),
            overlay_id=str(staged["overlay_id"]),
            version_id=str(staged["version_id"]),
            job_id=str(staged["job_id"]),
            filename=str(staged["filename"]),
            source_format=str(staged["source_format"]),
            payload=payload,
            checksum=str(staged["checksum"]),
            display_name=str(staged.get("name") or Path(str(staged["filename"])).stem),
            started_at=str(staged["started_at"]),
            progress_callback=lambda stage, progress, message: self._catalog.upsert_overlay_job(
                {
                    "job_id": str(staged["job_id"]),
                    "status": "running",
                    "stage": stage,
                    "progress_percent": progress,
                    "message": message,
                    "updated_at": utc_now().isoformat(),
                }
            ),
        )

    def ingest_upload(
        self,
        *,
        slide_id: str,
        filename: str,
        source_format: str,
        payload: bytes,
        display_name: str | None = None,
    ) -> dict[str, object]:
        overlay_id = f"overlay-{uuid4().hex[:12]}"
        version_id = f"v-{uuid4().hex[:12]}"
        job_id = f"overlay-job-{uuid4().hex[:12]}"
        checksum = f"sha256:{hashlib.sha256(payload).hexdigest()}"
        started_at = utc_now().isoformat()
        return self._ingest_payload(
            slide_id=slide_id,
            overlay_id=overlay_id,
            version_id=version_id,
            job_id=job_id,
            filename=filename,
            source_format=source_format,
            payload=payload,
            checksum=checksum,
            display_name=display_name or Path(filename).stem,
            started_at=started_at,
        )

    def _ingest_payload(
        self,
        *,
        slide_id: str,
        overlay_id: str,
        version_id: str,
        job_id: str,
        filename: str,
        source_format: str,
        payload: bytes,
        checksum: str,
        display_name: str,
        started_at: str,
        progress_callback=None,
    ) -> dict[str, object]:
        started = perf_counter()
        self._catalog.upsert_overlay_job(
            {
                "job_id": job_id,
                "slide_id": slide_id,
                "overlay_id": overlay_id,
                "version_id": version_id,
                "filename": filename,
                "name": display_name,
                "source_format": source_format,
                "status": "running",
                "stage": "parsing",
                "progress_percent": 10.0,
                "message": "Parsing overlay source",
                "started_at": started_at,
                "updated_at": started_at,
                "metrics": {},
            }
        )
        suffix = Path(filename).suffix or ".bin"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
            handle.write(payload)
            temp_path = Path(handle.name)
        try:
            if source_format == "geoparquet" and self._minio_proxy is not None:
                streamed = publish_streaming_geoparquet_artifacts(
                    self._minio_proxy,
                    slide_id=slide_id,
                    overlay_id=overlay_id,
                    version_id=version_id,
                    overlay_name=display_name,
                    source_format=source_format,
                    source_path=temp_path,
                    progress_callback=progress_callback,
                )
                parse_seconds = streamed.parse_elapsed_seconds
                publish_seconds = streamed.publish_elapsed_seconds
                metadata = {
                    "runtimeFormat": streamed.publication.runtime_format,
                    "artifact": streamed.publication.artifact,
                    "chunkPaths": streamed.publication.chunk_paths,
                    "featureCount": streamed.feature_count,
                    "bounds": list(streamed.bounds),
                    "deliveryManifest": streamed.publication.delivery_manifest or streamed.manifest,
                }
                overlay = OverlayDefinition(
                    overlay_id=OverlayId(overlay_id),
                    slide_id=SlideId(slide_id),
                    name=display_name,
                    kind="vector",
                    features=(),
                    legend=tuple(streamed.legend),
                    source_format=source_format,
                    version_id=version_id,
                    metadata=metadata,
                )
                chunk_count = len(streamed.manifest["chunking"]["chunks"])
                feature_count = streamed.feature_count
            else:
                parse_started = perf_counter()
                parsed = parse_overlay_source(temp_path, source_format, display_name)
                parse_seconds = round(perf_counter() - parse_started, 3)
                overlay = to_overlay_definition(slide_id, overlay_id, version_id, parsed)
                publish_seconds = 0.0
                if self._minio_proxy is not None and source_format != "ovsi":
                    publish_started = perf_counter()
                    publication = publish_overlay_artifacts(self._minio_proxy, overlay)
                    publish_seconds = round(perf_counter() - publish_started, 3)
                    metadata = deepcopy(overlay.metadata)
                    metadata["runtimeFormat"] = publication.runtime_format
                    metadata["artifact"] = publication.artifact
                    metadata["chunkPaths"] = publication.chunk_paths
                    if publication.delivery_manifest is not None:
                        metadata["deliveryManifest"] = publication.delivery_manifest
                    overlay = replace(overlay, metadata=metadata)
                chunk_count = len(build_overlay_manifest(overlay)["chunking"]["chunks"])
                feature_count = len(overlay.features)
            finished_at = utc_now().isoformat()
            self._overlays.save(overlay)
            result = {
                "job_id": job_id,
                "slide_id": slide_id,
                "overlay_id": overlay.overlay_id.value,
                "version_id": overlay.version_id,
                "filename": filename,
                "name": overlay.name,
                "source_format": overlay.source_format,
                "status": "succeeded",
                "stage": "published",
                "progress_percent": 100.0,
                "message": f"Published {feature_count} features",
                "feature_count": feature_count,
                "kind": overlay.kind,
                "checksum": checksum,
                "runtime_format": overlay.metadata.get("runtimeFormat"),
                "artifact": overlay.metadata.get("artifact"),
                "started_at": started_at,
                "updated_at": finished_at,
                "metrics": {
                    "elapsed_seconds": round(perf_counter() - started, 3),
                    "parse_seconds": parse_seconds,
                    "publish_seconds": publish_seconds,
                    "feature_count": feature_count,
                    "chunk_count": chunk_count,
                },
            }
            self._catalog.upsert_overlay_job(result)
            return result
        except Exception as error:
            failed_at = utc_now().isoformat()
            self._catalog.upsert_overlay_job(
                {
                    "job_id": job_id,
                    "slide_id": slide_id,
                    "overlay_id": overlay_id,
                    "version_id": version_id,
                    "filename": filename,
                    "name": display_name,
                    "source_format": source_format,
                    "status": "failed",
                    "stage": "failed",
                    "progress_percent": 100.0,
                    "message": str(error),
                    "started_at": started_at,
                    "updated_at": failed_at,
                    "metrics": {"elapsed_seconds": round(perf_counter() - started, 3)},
                }
            )
            raise
        finally:
            temp_path.unlink(missing_ok=True)

    def list_jobs(self) -> list[dict[str, object]]:
        return self._catalog.list_overlay_jobs()

    def get_job(self, job_id: str) -> dict[str, object]:
        return self._catalog.get_overlay_job(job_id)


class ReviewApplicationService:
    def __init__(
        self,
        layers: AnnotationLayerRepository,
        annotations: AnnotationRepository,
        comments: CommentRepository,
        tags: TagRepository,
        reviews: ReviewRepository,
    ) -> None:
        self._layers = layers
        self._annotations = annotations
        self._comments = comments
        self._tags = tags
        self._reviews = reviews

    def list_layers(self, slide_id: str) -> list[dict[str, object]]:
        return [
            {
                "id": layer.layer_id.value,
                "name": layer.name,
                "color": layer.color,
                "isVisible": layer.is_visible,
                "isLocked": layer.is_locked,
            }
            for layer in self._layers.list_for_slide(SlideId(slide_id))
        ]

    def save_layer(
        self,
        slide_id: str,
        *,
        layer_id: str | None,
        name: str,
        color: str,
        is_visible: bool,
        is_locked: bool,
    ) -> dict[str, object]:
        persisted = self._layers.save(
            AnnotationLayer(
                layer_id=AnnotationLayerId(layer_id or f"layer-{uuid4().hex[:12]}"),
                slide_id=SlideId(slide_id),
                name=name,
                color=color,
                is_visible=is_visible,
                is_locked=is_locked,
            )
        )
        return {
            "id": persisted.layer_id.value,
            "name": persisted.name,
            "color": persisted.color,
            "isVisible": persisted.is_visible,
            "isLocked": persisted.is_locked,
        }

    def delete_layer(self, slide_id: str, layer_id: str) -> None:
        self._layers.delete(SlideId(slide_id), AnnotationLayerId(layer_id))

    def list_annotations(self, slide_id: str) -> list[dict[str, object]]:
        return [
            {
                "id": annotation.annotation_id.value,
                "layerId": annotation.layer_id.value,
                "geometry": annotation.geometry,
                "properties": annotation.properties,
                "style": annotation.style,
                "createdAt": annotation.created_at.isoformat().replace("+00:00", "Z"),
                "updatedAt": annotation.updated_at.isoformat().replace("+00:00", "Z"),
            }
            for annotation in self._annotations.list_for_slide(SlideId(slide_id))
        ]

    def save_annotation(
        self,
        slide_id: str,
        *,
        annotation_id: str | None,
        layer_id: str,
        geometry: dict[str, object],
        properties: dict[str, object],
        style: dict[str, object],
    ) -> dict[str, object]:
        validate_annotation_geometry(geometry)
        persisted = self._annotations.save(
            AnnotationFeature(
                annotation_id=AnnotationId(annotation_id or f"annotation-{uuid4().hex[:12]}"),
                slide_id=SlideId(slide_id),
                layer_id=AnnotationLayerId(layer_id),
                geometry=geometry,
                properties=properties,
                style=style,
            )
        )
        return {
            "id": persisted.annotation_id.value,
            "layerId": persisted.layer_id.value,
            "geometry": persisted.geometry,
            "properties": persisted.properties,
            "style": persisted.style,
            "createdAt": persisted.created_at.isoformat().replace("+00:00", "Z"),
            "updatedAt": persisted.updated_at.isoformat().replace("+00:00", "Z"),
        }

    def delete_annotation(self, slide_id: str, annotation_id: str) -> None:
        self._annotations.delete(SlideId(slide_id), AnnotationId(annotation_id))

    def list_comments(self, slide_id: str, annotation_id: str) -> list[dict[str, object]]:
        return [
            {
                "id": comment.comment_id.value,
                "annotationId": comment.annotation_id.value,
                "body": comment.body,
                "author": comment.author,
                "parentId": comment.parent_comment_id.value if comment.parent_comment_id else None,
                "createdAt": comment.created_at.isoformat().replace("+00:00", "Z"),
                "updatedAt": comment.updated_at.isoformat().replace("+00:00", "Z"),
            }
            for comment in self._comments.list_for_annotation(SlideId(slide_id), AnnotationId(annotation_id))
        ]

    def save_comment(
        self,
        slide_id: str,
        annotation_id: str,
        *,
        comment_id: str | None,
        body: str,
        author: str,
        parent_id: str | None,
    ) -> dict[str, object]:
        existing = None
        if comment_id:
            existing = self._comments.get(SlideId(slide_id), AnnotationId(annotation_id), CommentId(comment_id))
        persisted = self._comments.save(
            AnnotationComment(
                comment_id=CommentId(comment_id or f"comment-{uuid4().hex[:12]}"),
                slide_id=SlideId(slide_id),
                annotation_id=AnnotationId(annotation_id),
                body=body,
                author=author,
                parent_comment_id=CommentId(parent_id) if parent_id else None,
                created_at=existing.created_at if existing else utc_now(),
            )
        )
        return {
            "id": persisted.comment_id.value,
            "annotationId": persisted.annotation_id.value,
            "body": persisted.body,
            "author": persisted.author,
            "parentId": persisted.parent_comment_id.value if persisted.parent_comment_id else None,
            "createdAt": persisted.created_at.isoformat().replace("+00:00", "Z"),
            "updatedAt": persisted.updated_at.isoformat().replace("+00:00", "Z"),
        }

    def update_comment(self, slide_id: str, annotation_id: str, comment_id: str, *, body: str, author: str) -> dict[str, object]:
        existing = self._comments.get(SlideId(slide_id), AnnotationId(annotation_id), CommentId(comment_id))
        if existing is None:
            raise LookupError(f"comment '{comment_id}' not found")
        return self.save_comment(
            slide_id,
            annotation_id,
            comment_id=comment_id,
            body=body,
            author=author or existing.author,
            parent_id=existing.parent_comment_id.value if existing.parent_comment_id else None,
        )

    def delete_comment(self, slide_id: str, annotation_id: str, comment_id: str) -> None:
        self._comments.delete(SlideId(slide_id), AnnotationId(annotation_id), comment_id)

    def list_tags(self, slide_id: str) -> list[dict[str, object]]:
        return [{"value": tag.value, "color": tag.color} for tag in self._tags.list_for_slide(SlideId(slide_id))]

    def replace_tags(self, slide_id: str, tags: list[dict[str, object]]) -> list[dict[str, object]]:
        persisted = self._tags.replace_for_slide(
            SlideId(slide_id),
            [SlideTag(slide_id=SlideId(slide_id), value=str(tag["value"]), color=str(tag.get("color", "#38bdf8"))) for tag in tags],
        )
        return [{"value": tag.value, "color": tag.color} for tag in persisted]

    def list_reviews(self, slide_id: str, annotation_id: str) -> list[dict[str, object]]:
        return [
            {
                "id": review.review_id,
                "annotationId": review.annotation_id.value,
                "status": review.status,
                "reviewer": review.reviewer,
                "note": review.note,
                "createdAt": review.created_at.isoformat().replace("+00:00", "Z"),
                "updatedAt": review.updated_at.isoformat().replace("+00:00", "Z"),
            }
            for review in self._reviews.list_for_annotation(SlideId(slide_id), AnnotationId(annotation_id))
        ]

    def save_review(self, slide_id: str, annotation_id: str, *, review_id: str | None, status: str, reviewer: str, note: str) -> dict[str, object]:
        persisted = self._reviews.save(
            AnnotationReview(
                review_id=review_id or f"review-{uuid4().hex[:12]}",
                slide_id=SlideId(slide_id),
                annotation_id=AnnotationId(annotation_id),
                status=status,
                reviewer=reviewer,
                note=note,
            )
        )
        return {
            "id": persisted.review_id,
            "annotationId": persisted.annotation_id.value,
            "status": persisted.status,
            "reviewer": persisted.reviewer,
            "note": persisted.note,
            "createdAt": persisted.created_at.isoformat().replace("+00:00", "Z"),
            "updatedAt": persisted.updated_at.isoformat().replace("+00:00", "Z"),
        }
