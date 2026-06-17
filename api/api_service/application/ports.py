"""Purpose: application service ports for persistence, events, and queueing.
Owner context: Identity & Catalog and Delivery.
Invariants: interfaces stay framework-agnostic and side-effect semantics are explicit.
Failure modes: adapter implementations raise infrastructure errors on IO issues.
"""

from __future__ import annotations

from typing import Protocol

from api.api_service.domain.events import DomainEvent
from api.api_service.domain.models import (
    AnnotationComment,
    AnnotationFeature,
    AnnotationId,
    AnnotationLayer,
    AnnotationLayerId,
    IngestionJob,
    OverlayDefinition,
    OverlayId,
    Slide,
    SlideId,
    SlideVersion,
    VersionId,
)


class SlideRepository(Protocol):
    def get(self, slide_id: SlideId) -> Slide | None: ...

    def save(self, slide: Slide) -> None: ...


class SlideVersionRepository(Protocol):
    def get(self, slide_id: SlideId, version_id: VersionId) -> SlideVersion | None: ...

    def find_by_checksum(self, checksum: str) -> SlideVersion | None: ...

    def save(self, version: SlideVersion) -> None: ...


class IngestionJobRepository(Protocol):
    def get_by_version(self, slide_id: SlideId, version_id: VersionId) -> IngestionJob | None: ...

    def get(self, job_id: str) -> IngestionJob | None: ...

    def save(self, job: IngestionJob) -> None: ...


class EventPublisher(Protocol):
    def publish(self, event: DomainEvent) -> None: ...


class JobQueue(Protocol):
    def enqueue(self, job: IngestionJob) -> None: ...


class OverlayRepository(Protocol):
    def list_for_slide(self, slide_id: SlideId) -> list[OverlayDefinition]: ...

    def get(self, slide_id: SlideId, overlay_id: OverlayId) -> OverlayDefinition | None: ...


class AnnotationLayerRepository(Protocol):
    def list_for_slide(self, slide_id: SlideId) -> list[AnnotationLayer]: ...

    def get(self, slide_id: SlideId, layer_id: AnnotationLayerId) -> AnnotationLayer | None: ...

    def save(self, layer: AnnotationLayer) -> AnnotationLayer: ...

    def delete(self, slide_id: SlideId, layer_id: AnnotationLayerId) -> None: ...


class AnnotationRepository(Protocol):
    def list_for_slide(self, slide_id: SlideId) -> list[AnnotationFeature]: ...

    def get(self, slide_id: SlideId, annotation_id: AnnotationId) -> AnnotationFeature | None: ...

    def save(self, annotation: AnnotationFeature) -> AnnotationFeature: ...

    def delete(self, slide_id: SlideId, annotation_id: AnnotationId) -> None: ...


class CommentRepository(Protocol):
    def list_for_annotation(self, slide_id: SlideId, annotation_id: AnnotationId) -> list[AnnotationComment]: ...

    def save(self, comment: AnnotationComment) -> AnnotationComment: ...

    def get(self, slide_id: SlideId, annotation_id: AnnotationId, comment_id: CommentId) -> AnnotationComment | None: ...

    def delete(self, slide_id: SlideId, annotation_id: AnnotationId, comment_id: str) -> None: ...
