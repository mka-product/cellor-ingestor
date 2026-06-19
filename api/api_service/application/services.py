"""Purpose: application use cases for upload initiation, completion, and manifest lookup.
Owner context: Identity & Catalog and Delivery.
Invariants: use cases remain deterministic and repository-backed; no HTTP logic lives here.
Failure modes: missing resources raise LookupError; duplicate identities remain idempotent.
"""

from __future__ import annotations

from api.api_service.application.review_validation import validate_annotation_geometry
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
    SlideRepository,
    SlideVersionRepository,
)
from api.api_service.domain.events import IngestionRequested, OriginalUploaded
from api.api_service.domain.models import (
    AnnotationComment,
    AnnotationFeature,
    AnnotationId,
    AnnotationLayer,
    AnnotationLayerId,
    Checksum,
    CommentId,
    IngestionJob,
    OverlayId,
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
        if existing_job is not None:
            return IngestionJobView(
                job_id=existing_job.job_id,
                slide_id=existing_job.slide_id.value,
                version_id=existing_job.version_id.value,
                status=existing_job.status.value,
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
    def __init__(self, overlays: OverlayRepository) -> None:
        self._overlays = overlays

    def list_overlays(self, slide_id: str) -> list[dict[str, object]]:
        payload: list[dict[str, object]] = []
        for overlay in self._overlays.list_for_slide(SlideId(slide_id)):
            payload.append(
                {
                    "id": overlay.overlay_id.value,
                    "name": overlay.name,
                    "kind": overlay.kind,
                    "featureCount": len(overlay.features),
                    "legend": list(overlay.legend),
                }
            )
        return payload

    def get_overlay(self, slide_id: str, overlay_id: str) -> dict[str, object]:
        overlay = self._overlays.get(SlideId(slide_id), OverlayId(overlay_id))
        if overlay is None:
            raise LookupError("overlay not found")
        return {
            "id": overlay.overlay_id.value,
            "name": overlay.name,
            "kind": overlay.kind,
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


class ReviewApplicationService:
    def __init__(
        self,
        layers: AnnotationLayerRepository,
        annotations: AnnotationRepository,
        comments: CommentRepository,
    ) -> None:
        self._layers = layers
        self._annotations = annotations
        self._comments = comments

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
