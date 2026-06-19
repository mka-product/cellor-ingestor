"""Purpose: persist catalog, overlays, and review state in S3-compatible object storage.
Owner context: Delivery and Review & Collaboration support.
Invariants: durable state is stored as deterministic JSON objects with embedded revision metadata.
Failure modes: missing objects hydrate from defaults; malformed objects raise runtime errors before mutation.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from api.api_service.domain.models import (
    AnnotationComment,
    AnnotationFeature,
    AnnotationId,
    AnnotationLayer,
    AnnotationLayerId,
    AnnotationReview,
    CommentId,
    OverlayDefinition,
    OverlayFeature,
    OverlayId,
    SlideId,
    SlideTag,
)
from api.api_service.infrastructure.minio_proxy import MinioProxy
from api.api_service.infrastructure.workspace_store import _utc_from_string


def _revision_document(payload: dict[str, Any], revision: int) -> dict[str, Any]:
    return {"revision": revision, "payload": payload}


@dataclass
class ObjectJsonDocumentStore:
    proxy: MinioProxy
    uri: str
    default_payload: dict[str, Any]

    def read(self) -> tuple[dict[str, Any], int]:
        document = self.proxy.load_json_or_default(self.uri, _revision_document(self.default_payload, 0))
        if "payload" in document and "revision" in document:
            return dict(document["payload"]), int(document.get("revision", 0))
        return dict(document), 0

    def write(self, payload: dict[str, Any], previous_revision: int | None = None) -> int:
        _, current_revision = self.read()
        if previous_revision is not None and previous_revision != current_revision:
            raise ValueError("stale object-store write rejected")
        next_revision = current_revision + 1
        self.proxy.put_json(self.uri, _revision_document(payload, next_revision))
        return next_revision


@dataclass
class ObjectStoreCatalog:
    store: ObjectJsonDocumentStore

    def list_slides(self) -> list[dict[str, object]]:
        payload, _ = self.store.read()
        payload.setdefault("slides", [])
        return payload["slides"]

    def get_slide(self, slide_id: str) -> dict[str, object]:
        for slide in self.list_slides():
            if slide["slide_id"] == slide_id:
                return slide
        raise LookupError("slide not found")

    def get_slide_version(self, slide_id: str, version_id: str) -> dict[str, object]:
        for slide in self.list_slides():
            if slide["slide_id"] == slide_id and slide["version_id"] == version_id:
                return slide
        raise LookupError("slide version not found")

    def list_jobs(self) -> list[dict[str, object]]:
        payload, _ = self.store.read()
        payload.setdefault("jobs", [])
        return payload["jobs"]

    def list_overlay_jobs(self) -> list[dict[str, object]]:
        payload, _ = self.store.read()
        payload.setdefault("overlay_jobs", [])
        return payload["overlay_jobs"]

    def get_job(self, job_id: str) -> dict[str, object]:
        for job in self.list_jobs():
            if job["job_id"] == job_id:
                return job
        raise LookupError("job not found")

    def get_overlay_job(self, job_id: str) -> dict[str, object]:
        for job in self.list_overlay_jobs():
            if job["job_id"] == job_id:
                return job
        raise LookupError("overlay job not found")

    def upsert_job(self, payload: dict[str, object]) -> None:
        document, revision = self.store.read()
        document.setdefault("slides", [])
        document.setdefault("jobs", [])
        document.setdefault("overlay_jobs", [])
        for index, job in enumerate(document["jobs"]):
            if job["job_id"] == payload["job_id"]:
                document["jobs"][index] = {**document["jobs"][index], **payload}
                self.store.write(document, revision)
                return
        document["jobs"].append(payload)
        self.store.write(document, revision)

    def upsert_slide(self, payload: dict[str, object]) -> None:
        document, revision = self.store.read()
        document.setdefault("slides", [])
        document.setdefault("jobs", [])
        document.setdefault("overlay_jobs", [])
        for index, slide in enumerate(document["slides"]):
            if slide["slide_id"] == payload["slide_id"] and slide["version_id"] == payload["version_id"]:
                document["slides"][index] = {**document["slides"][index], **payload}
                self.store.write(document, revision)
                return
        document["slides"].append(payload)
        self.store.write(document, revision)

    def upsert_overlay_job(self, payload: dict[str, object]) -> None:
        document, revision = self.store.read()
        document.setdefault("slides", [])
        document.setdefault("jobs", [])
        document.setdefault("overlay_jobs", [])
        for index, job in enumerate(document["overlay_jobs"]):
            if job["job_id"] == payload["job_id"]:
                document["overlay_jobs"][index] = {**document["overlay_jobs"][index], **payload}
                self.store.write(document, revision)
                return
        document["overlay_jobs"].append(payload)
        self.store.write(document, revision)


@dataclass
class ObjectStoreOverlayRepository:
    store: ObjectJsonDocumentStore

    def list_for_slide(self, slide_id: SlideId) -> list[OverlayDefinition]:
        document, _ = self.store.read()
        slide = document.setdefault("slides", {}).get(slide_id.value, {})
        return [self._to_overlay(slide_id, payload) for payload in slide.get("overlays", [])]

    def get(self, slide_id: SlideId, overlay_id: OverlayId) -> OverlayDefinition | None:
        for overlay in self.list_for_slide(slide_id):
            if overlay.overlay_id == overlay_id:
                return overlay
        return None

    def save(self, overlay: OverlayDefinition) -> OverlayDefinition:
        document, revision = self.store.read()
        slides = document.setdefault("slides", {})
        slide_bucket = slides.setdefault(overlay.slide_id.value, {"overlays": []})
        serialized = {
            "id": overlay.overlay_id.value,
            "name": overlay.name,
            "kind": overlay.kind,
            "sourceFormat": overlay.source_format,
            "versionId": overlay.version_id,
            "metadata": overlay.metadata,
            "legend": list(overlay.legend),
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
        }
        _replace_or_append(slide_bucket["overlays"], serialized, "id")
        self.store.write(document, revision)
        return overlay

    def _to_overlay(self, slide_id: SlideId, payload: dict[str, Any]) -> OverlayDefinition:
        return OverlayDefinition(
            overlay_id=OverlayId(str(payload["id"])),
            slide_id=slide_id,
            name=str(payload["name"]),
            kind=str(payload.get("kind", "vector")),
            features=tuple(
                OverlayFeature(
                    id=str(feature["id"]),
                    name=str(feature.get("name", feature["id"])),
                    kind=str(feature["kind"]),
                    geometry=dict(feature["geometry"]),
                    properties=dict(feature.get("properties", {})),
                    style_hints=dict(feature.get("styleHints", {})),
                    bounds=tuple(float(value) for value in feature.get("bounds", [0, 0, 0, 0])),
                )
                for feature in payload.get("features", [])
            ),
            legend=tuple(dict(item) for item in payload.get("legend", [])),
            source_format=str(payload.get("sourceFormat", "manual")),
            version_id=str(payload.get("versionId", "v1")),
            metadata=dict(payload.get("metadata", {})),
        )


@dataclass
class ObjectStoreReviewRepository:
    store: ObjectJsonDocumentStore

    def list_layers_for_slide(self, slide_id: SlideId) -> list[AnnotationLayer]:
        return [self._to_layer(slide_id, payload) for payload in self._slide_bucket(slide_id).get("layers", [])]

    def get_layer(self, slide_id: SlideId, layer_id: AnnotationLayerId) -> AnnotationLayer | None:
        for layer in self.list_layers_for_slide(slide_id):
            if layer.layer_id == layer_id:
                return layer
        return None

    def save_layer(self, layer: AnnotationLayer) -> AnnotationLayer:
        payload, revision = self._read()
        bucket = payload["slides"].setdefault(layer.slide_id.value, _empty_slide_bucket())
        serialized = {
            "id": layer.layer_id.value,
            "name": layer.name,
            "color": layer.color,
            "isVisible": layer.is_visible,
            "isLocked": layer.is_locked,
        }
        _replace_or_append(bucket["layers"], serialized, "id")
        self._write(payload, revision)
        return layer

    def delete_layer(self, slide_id: SlideId, layer_id: AnnotationLayerId) -> None:
        payload, revision = self._read()
        bucket = payload["slides"].setdefault(slide_id.value, _empty_slide_bucket())
        bucket["layers"] = [layer for layer in bucket["layers"] if layer["id"] != layer_id.value]
        bucket["annotations"] = [annotation for annotation in bucket["annotations"] if annotation["layerId"] != layer_id.value]
        self._write(payload, revision)

    def list_annotations_for_slide(self, slide_id: SlideId) -> list[AnnotationFeature]:
        return [self._to_annotation(slide_id, payload) for payload in self._slide_bucket(slide_id).get("annotations", [])]

    def get_annotation(self, slide_id: SlideId, annotation_id: AnnotationId) -> AnnotationFeature | None:
        for annotation in self.list_annotations_for_slide(slide_id):
            if annotation.annotation_id == annotation_id:
                return annotation
        return None

    def save_annotation(self, annotation: AnnotationFeature) -> AnnotationFeature:
        payload, revision = self._read()
        bucket = payload["slides"].setdefault(annotation.slide_id.value, _empty_slide_bucket())
        existing = next((item for item in bucket["annotations"] if item["id"] == annotation.annotation_id.value), None)
        serialized = {
            "id": annotation.annotation_id.value,
            "layerId": annotation.layer_id.value,
            "geometry": annotation.geometry,
            "properties": annotation.properties,
            "style": annotation.style,
            "createdAt": existing.get("createdAt") if existing else annotation.created_at.isoformat().replace("+00:00", "Z"),
            "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        _replace_or_append(bucket["annotations"], serialized, "id")
        self._write(payload, revision)
        return self._to_annotation(annotation.slide_id, serialized)

    def delete_annotation(self, slide_id: SlideId, annotation_id: AnnotationId) -> None:
        payload, revision = self._read()
        bucket = payload["slides"].setdefault(slide_id.value, _empty_slide_bucket())
        bucket["annotations"] = [item for item in bucket["annotations"] if item["id"] != annotation_id.value]
        bucket["comments"] = [item for item in bucket["comments"] if item["annotationId"] != annotation_id.value]
        bucket["reviews"] = [item for item in bucket["reviews"] if item["annotationId"] != annotation_id.value]
        self._write(payload, revision)

    def list_comments_for_annotation(self, slide_id: SlideId, annotation_id: AnnotationId) -> list[AnnotationComment]:
        comments = [
            self._to_comment(slide_id, payload)
            for payload in self._slide_bucket(slide_id).get("comments", [])
            if payload["annotationId"] == annotation_id.value
        ]
        return sorted(comments, key=lambda item: (item.parent_comment_id.value if item.parent_comment_id else "", item.created_at))

    def get_comment(self, slide_id: SlideId, annotation_id: AnnotationId, comment_id: CommentId) -> AnnotationComment | None:
        for comment in self.list_comments_for_annotation(slide_id, annotation_id):
            if comment.comment_id == comment_id:
                return comment
        return None

    def save_comment(self, comment: AnnotationComment) -> AnnotationComment:
        payload, revision = self._read()
        bucket = payload["slides"].setdefault(comment.slide_id.value, _empty_slide_bucket())
        existing = next((item for item in bucket["comments"] if item["id"] == comment.comment_id.value), None)
        serialized = {
            "id": comment.comment_id.value,
            "annotationId": comment.annotation_id.value,
            "body": comment.body,
            "author": comment.author,
            "parentId": comment.parent_comment_id.value if comment.parent_comment_id else None,
            "createdAt": existing.get("createdAt") if existing else comment.created_at.isoformat().replace("+00:00", "Z"),
            "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        _replace_or_append(bucket["comments"], serialized, "id")
        self._write(payload, revision)
        return self._to_comment(comment.slide_id, serialized)

    def delete_comment(self, slide_id: SlideId, annotation_id: AnnotationId, comment_id: str) -> None:
        payload, revision = self._read()
        bucket = payload["slides"].setdefault(slide_id.value, _empty_slide_bucket())
        bucket["comments"] = [
            item
            for item in bucket["comments"]
            if not (
                item["annotationId"] == annotation_id.value
                and (item["id"] == comment_id or item.get("parentId") == comment_id)
            )
        ]
        self._write(payload, revision)

    def list_tags_for_slide(self, slide_id: SlideId) -> list[SlideTag]:
        return [
            SlideTag(slide_id=slide_id, value=str(payload["value"]), color=str(payload.get("color", "#38bdf8")))
            for payload in self._slide_bucket(slide_id).get("tags", [])
        ]

    def replace_tags_for_slide(self, slide_id: SlideId, tags: list[SlideTag]) -> list[SlideTag]:
        payload, revision = self._read()
        bucket = payload["slides"].setdefault(slide_id.value, _empty_slide_bucket())
        bucket["tags"] = [{"value": tag.value, "color": tag.color} for tag in tags]
        self._write(payload, revision)
        return tags

    def list_reviews_for_annotation(self, slide_id: SlideId, annotation_id: AnnotationId) -> list[AnnotationReview]:
        reviews = [
            self._to_review(slide_id, payload)
            for payload in self._slide_bucket(slide_id).get("reviews", [])
            if payload["annotationId"] == annotation_id.value
        ]
        return sorted(reviews, key=lambda item: item.created_at)

    def save_review(self, review: AnnotationReview) -> AnnotationReview:
        payload, revision = self._read()
        bucket = payload["slides"].setdefault(review.slide_id.value, _empty_slide_bucket())
        existing = next((item for item in bucket["reviews"] if item["id"] == review.review_id), None)
        serialized = {
            "id": review.review_id,
            "annotationId": review.annotation_id.value,
            "status": review.status,
            "reviewer": review.reviewer,
            "note": review.note,
            "createdAt": existing.get("createdAt") if existing else review.created_at.isoformat().replace("+00:00", "Z"),
            "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        _replace_or_append(bucket["reviews"], serialized, "id")
        self._write(payload, revision)
        return self._to_review(review.slide_id, serialized)

    def _slide_bucket(self, slide_id: SlideId) -> dict[str, Any]:
        payload, _ = self._read()
        return payload["slides"].setdefault(slide_id.value, _empty_slide_bucket())

    def _read(self) -> tuple[dict[str, Any], int]:
        payload, revision = self.store.read()
        payload.setdefault("slides", {})
        return payload, revision

    def _write(self, payload: dict[str, Any], revision: int) -> None:
        self.store.write(payload, revision)

    def _to_layer(self, slide_id: SlideId, payload: dict[str, Any]) -> AnnotationLayer:
        return AnnotationLayer(
            layer_id=AnnotationLayerId(str(payload["id"])),
            slide_id=slide_id,
            name=str(payload["name"]),
            color=str(payload.get("color", "#38bdf8")),
            is_visible=bool(payload.get("isVisible", True)),
            is_locked=bool(payload.get("isLocked", False)),
        )

    def _to_annotation(self, slide_id: SlideId, payload: dict[str, Any]) -> AnnotationFeature:
        return AnnotationFeature(
            annotation_id=AnnotationId(str(payload["id"])),
            slide_id=slide_id,
            layer_id=AnnotationLayerId(str(payload["layerId"])),
            geometry=dict(payload["geometry"]),
            properties=dict(payload.get("properties", {})),
            style=dict(payload.get("style", {})),
            created_at=_utc_from_string(payload.get("createdAt")),
            updated_at=_utc_from_string(payload.get("updatedAt")),
        )

    def _to_comment(self, slide_id: SlideId, payload: dict[str, Any]) -> AnnotationComment:
        return AnnotationComment(
            comment_id=CommentId(str(payload["id"])),
            slide_id=slide_id,
            annotation_id=AnnotationId(str(payload["annotationId"])),
            body=str(payload["body"]),
            author=str(payload.get("author", "local-user")),
            parent_comment_id=CommentId(str(payload["parentId"])) if payload.get("parentId") else None,
            created_at=_utc_from_string(payload.get("createdAt")),
            updated_at=_utc_from_string(payload.get("updatedAt")),
        )

    def _to_review(self, slide_id: SlideId, payload: dict[str, Any]) -> AnnotationReview:
        return AnnotationReview(
            review_id=str(payload["id"]),
            slide_id=slide_id,
            annotation_id=AnnotationId(str(payload["annotationId"])),
            status=str(payload.get("status", "pending")),
            reviewer=str(payload.get("reviewer", "local-user")),
            note=str(payload.get("note", "")),
            created_at=_utc_from_string(payload.get("createdAt")),
            updated_at=_utc_from_string(payload.get("updatedAt")),
        )


def _replace_or_append(items: list[dict[str, Any]], value: dict[str, Any], identity_key: str) -> None:
    for index, existing in enumerate(items):
        if existing[identity_key] == value[identity_key]:
            items[index] = value
            return
    items.append(value)


def _empty_slide_bucket() -> dict[str, Any]:
    return {"layers": [], "annotations": [], "comments": [], "reviews": [], "tags": []}


@dataclass
class ObjectStoreAnnotationLayerRepository:
    store: ObjectStoreReviewRepository

    def list_for_slide(self, slide_id: SlideId) -> list[AnnotationLayer]:
        return self.store.list_layers_for_slide(slide_id)

    def get(self, slide_id: SlideId, layer_id: AnnotationLayerId) -> AnnotationLayer | None:
        return self.store.get_layer(slide_id, layer_id)

    def save(self, layer: AnnotationLayer) -> AnnotationLayer:
        return self.store.save_layer(layer)

    def delete(self, slide_id: SlideId, layer_id: AnnotationLayerId) -> None:
        self.store.delete_layer(slide_id, layer_id)


@dataclass
class ObjectStoreAnnotationRepository:
    store: ObjectStoreReviewRepository

    def list_for_slide(self, slide_id: SlideId) -> list[AnnotationFeature]:
        return self.store.list_annotations_for_slide(slide_id)

    def get(self, slide_id: SlideId, annotation_id: AnnotationId) -> AnnotationFeature | None:
        return self.store.get_annotation(slide_id, annotation_id)

    def save(self, annotation: AnnotationFeature) -> AnnotationFeature:
        return self.store.save_annotation(annotation)

    def delete(self, slide_id: SlideId, annotation_id: AnnotationId) -> None:
        self.store.delete_annotation(slide_id, annotation_id)


@dataclass
class ObjectStoreCommentRepository:
    store: ObjectStoreReviewRepository

    def list_for_annotation(self, slide_id: SlideId, annotation_id: AnnotationId) -> list[AnnotationComment]:
        return self.store.list_comments_for_annotation(slide_id, annotation_id)

    def save(self, comment: AnnotationComment) -> AnnotationComment:
        return self.store.save_comment(comment)

    def get(self, slide_id: SlideId, annotation_id: AnnotationId, comment_id: CommentId) -> AnnotationComment | None:
        return self.store.get_comment(slide_id, annotation_id, comment_id)

    def delete(self, slide_id: SlideId, annotation_id: AnnotationId, comment_id: str) -> None:
        self.store.delete_comment(slide_id, annotation_id, comment_id)


@dataclass
class ObjectStoreTagRepository:
    store: ObjectStoreReviewRepository

    def list_for_slide(self, slide_id: SlideId) -> list[SlideTag]:
        return self.store.list_tags_for_slide(slide_id)

    def replace_for_slide(self, slide_id: SlideId, tags: list[SlideTag]) -> list[SlideTag]:
        return self.store.replace_tags_for_slide(slide_id, tags)


@dataclass
class ObjectStoreAnnotationReviewRepository:
    store: ObjectStoreReviewRepository

    def list_for_annotation(self, slide_id: SlideId, annotation_id: AnnotationId) -> list[AnnotationReview]:
        return self.store.list_reviews_for_annotation(slide_id, annotation_id)

    def save(self, review: AnnotationReview) -> AnnotationReview:
        return self.store.save_review(review)
