"""Purpose: file-backed overlay and review persistence for the viewer workspace.
Owner context: Viewer workspace support.
Invariants: overlays are read-only resources; annotation and comment stores remain separate from overlays.
Failure modes: malformed workspace JSON raises runtime errors and invalid identities raise LookupError.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
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
    SlideTag,
    SlideId,
)

LOGGER = logging.getLogger(__name__)


def _utc_from_string(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized)


@dataclass
class FileOverlayRepository:
    path: Path

    def __post_init__(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text(json.dumps({"slides": {}}, indent=2))

    def list_for_slide(self, slide_id: SlideId) -> list[OverlayDefinition]:
        slide = self._read()["slides"].get(slide_id.value, {})
        return [self._to_overlay(slide_id, payload) for payload in slide.get("overlays", [])]

    def get(self, slide_id: SlideId, overlay_id: OverlayId) -> OverlayDefinition | None:
        for overlay in self.list_for_slide(slide_id):
            if overlay.overlay_id == overlay_id:
                return overlay
        return None

    def save(self, overlay: OverlayDefinition) -> OverlayDefinition:
        payload = self._read()
        slide_bucket = payload["slides"].setdefault(overlay.slide_id.value, {"overlays": []})
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
        self._replace_or_append(slide_bucket["overlays"], serialized, "id")
        self._write_json_payload(payload)
        return overlay

    def delete(self, slide_id: SlideId, overlay_id: OverlayId) -> None:
        data = self._read()
        slide_bucket = data["slides"].get(slide_id.value, {})
        slide_bucket["overlays"] = [o for o in slide_bucket.get("overlays", []) if o.get("id") != overlay_id.value]
        self._write_json_payload(data)

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

    def _read(self) -> dict[str, Any]:
        payload = self._load_json_payload()
        payload.setdefault("slides", {})
        return payload

    def _load_json_payload(self) -> dict[str, Any]:
        raw = self.path.read_text()
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as error:
            decoder = json.JSONDecoder()
            try:
                payload, index = decoder.raw_decode(raw.lstrip())
            except json.JSONDecodeError:
                LOGGER.exception("Overlay store is unreadable: %s", self.path)
                raise
            trailing = raw.lstrip()[index:].strip()
            if trailing:
                LOGGER.warning("Overlay store contained trailing data and was auto-repaired: %s", self.path)
                self._write_json_payload(payload)
            else:
                LOGGER.exception("Overlay store is unreadable: %s", self.path)
                raise error
        return payload

    def _write_json_payload(self, payload: dict[str, Any]) -> None:
        self.path.write_text(json.dumps(payload, indent=2))

    def _replace_or_append(self, items: list[dict[str, Any]], value: dict[str, Any], identity_key: str) -> None:
        for index, existing in enumerate(items):
            if existing[identity_key] == value[identity_key]:
                items[index] = value
                return
        items.append(value)


@dataclass
class FileReviewRepository:
    path: Path

    def __post_init__(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text(json.dumps({"slides": {}}, indent=2))

    def list_layers_for_slide(self, slide_id: SlideId) -> list[AnnotationLayer]:
        return [
            self._to_layer(slide_id, payload)
            for payload in self._slide_bucket(slide_id).get("layers", [])
        ]

    def get_layer(self, slide_id: SlideId, layer_id: AnnotationLayerId) -> AnnotationLayer | None:
        for layer in self.list_layers_for_slide(slide_id):
            if layer.layer_id == layer_id:
                return layer
        return None

    def save_layer(self, layer: AnnotationLayer) -> AnnotationLayer:
        payload = self._read()
        bucket = payload["slides"].setdefault(layer.slide_id.value, {"layers": [], "annotations": [], "comments": [], "reviews": [], "tags": []})
        serialized = {
            "id": layer.layer_id.value,
            "name": layer.name,
            "color": layer.color,
            "isVisible": layer.is_visible,
            "isLocked": layer.is_locked,
        }
        self._replace_or_append(bucket["layers"], serialized, "id")
        self._write(payload)
        return layer

    def delete_layer(self, slide_id: SlideId, layer_id: AnnotationLayerId) -> None:
        payload = self._read()
        bucket = payload["slides"].setdefault(slide_id.value, {"layers": [], "annotations": [], "comments": [], "reviews": [], "tags": []})
        bucket["layers"] = [layer for layer in bucket["layers"] if layer["id"] != layer_id.value]
        bucket["annotations"] = [annotation for annotation in bucket["annotations"] if annotation["layerId"] != layer_id.value]
        self._write(payload)

    def list_annotations_for_slide(self, slide_id: SlideId) -> list[AnnotationFeature]:
        return [
            self._to_annotation(slide_id, payload)
            for payload in self._slide_bucket(slide_id).get("annotations", [])
        ]

    def get_annotation(self, slide_id: SlideId, annotation_id: AnnotationId) -> AnnotationFeature | None:
        for annotation in self.list_annotations_for_slide(slide_id):
            if annotation.annotation_id == annotation_id:
                return annotation
        return None

    def save_annotation(self, annotation: AnnotationFeature) -> AnnotationFeature:
        payload = self._read()
        bucket = payload["slides"].setdefault(
            annotation.slide_id.value, {"layers": [], "annotations": [], "comments": [], "reviews": [], "tags": []}
        )
        existing = next(
            (item for item in bucket["annotations"] if item["id"] == annotation.annotation_id.value),
            None,
        )
        created_at = existing.get("createdAt") if existing else annotation.created_at.isoformat().replace("+00:00", "Z")
        serialized = {
            "id": annotation.annotation_id.value,
            "layerId": annotation.layer_id.value,
            "geometry": annotation.geometry,
            "properties": annotation.properties,
            "style": annotation.style,
            "createdAt": created_at,
            "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        self._replace_or_append(bucket["annotations"], serialized, "id")
        self._write(payload)
        return self._to_annotation(annotation.slide_id, serialized)

    def delete_annotation(self, slide_id: SlideId, annotation_id: AnnotationId) -> None:
        payload = self._read()
        bucket = payload["slides"].setdefault(slide_id.value, {"layers": [], "annotations": [], "comments": [], "reviews": [], "tags": []})
        bucket["annotations"] = [item for item in bucket["annotations"] if item["id"] != annotation_id.value]
        bucket["comments"] = [item for item in bucket["comments"] if item["annotationId"] != annotation_id.value]
        bucket["reviews"] = [item for item in bucket["reviews"] if item["annotationId"] != annotation_id.value]
        self._write(payload)

    def list_comments_for_annotation(self, slide_id: SlideId, annotation_id: AnnotationId) -> list[AnnotationComment]:
        comments = [
            self._to_comment(slide_id, payload)
            for payload in self._slide_bucket(slide_id).get("comments", [])
            if payload["annotationId"] == annotation_id.value
        ]
        return sorted(comments, key=lambda item: (item.parent_comment_id.value if item.parent_comment_id else "", item.created_at))

    def list_tags_for_slide(self, slide_id: SlideId) -> list[SlideTag]:
        return [
            SlideTag(slide_id=slide_id, value=str(payload["value"]), color=str(payload.get("color", "#38bdf8")))
            for payload in self._slide_bucket(slide_id).get("tags", [])
        ]

    def replace_tags_for_slide(self, slide_id: SlideId, tags: list[SlideTag]) -> list[SlideTag]:
        payload = self._read()
        bucket = payload["slides"].setdefault(slide_id.value, {"layers": [], "annotations": [], "comments": [], "reviews": [], "tags": []})
        bucket["tags"] = [{"value": tag.value, "color": tag.color} for tag in tags]
        self._write(payload)
        return tags

    def list_reviews_for_annotation(self, slide_id: SlideId, annotation_id: AnnotationId) -> list[AnnotationReview]:
        reviews = [
            self._to_review(slide_id, payload)
            for payload in self._slide_bucket(slide_id).get("reviews", [])
            if payload["annotationId"] == annotation_id.value
        ]
        return sorted(reviews, key=lambda item: item.created_at)

    def save_review(self, review: AnnotationReview) -> AnnotationReview:
        payload = self._read()
        bucket = payload["slides"].setdefault(review.slide_id.value, {"layers": [], "annotations": [], "comments": [], "reviews": [], "tags": []})
        existing = next((item for item in bucket["reviews"] if item["id"] == review.review_id), None)
        serialized = {
            "id": review.review_id,
            "annotationId": review.annotation_id.value,
            "status": review.status,
            "reviewer": review.reviewer,
            "note": review.note,
            "createdAt": (existing.get("createdAt") if existing else review.created_at.isoformat().replace("+00:00", "Z")),
            "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        self._replace_or_append(bucket["reviews"], serialized, "id")
        self._write(payload)
        return self._to_review(review.slide_id, serialized)

    def get_comment(
        self, slide_id: SlideId, annotation_id: AnnotationId, comment_id: CommentId
    ) -> AnnotationComment | None:
        for comment in self.list_comments_for_annotation(slide_id, annotation_id):
            if comment.comment_id == comment_id:
                return comment
        return None

    def save_comment(self, comment: AnnotationComment) -> AnnotationComment:
        payload = self._read()
        bucket = payload["slides"].setdefault(comment.slide_id.value, {"layers": [], "annotations": [], "comments": [], "reviews": [], "tags": []})
        existing = next((item for item in bucket["comments"] if item["id"] == comment.comment_id.value), None)
        serialized = {
            "id": comment.comment_id.value,
            "annotationId": comment.annotation_id.value,
            "body": comment.body,
            "author": comment.author,
            "parentId": comment.parent_comment_id.value if comment.parent_comment_id else None,
            "createdAt": (existing.get("createdAt") if existing else comment.created_at.isoformat().replace("+00:00", "Z")),
            "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        self._replace_or_append(bucket["comments"], serialized, "id")
        self._write(payload)
        return self._to_comment(comment.slide_id, serialized)

    def delete_comment(self, slide_id: SlideId, annotation_id: AnnotationId, comment_id: str) -> None:
        payload = self._read()
        bucket = payload["slides"].setdefault(slide_id.value, {"layers": [], "annotations": [], "comments": [], "reviews": [], "tags": []})
        bucket["comments"] = [
            item
            for item in bucket["comments"]
            if not (
                item["annotationId"] == annotation_id.value
                and (item["id"] == comment_id or item.get("parentId") == comment_id)
            )
        ]
        self._write(payload)

    def _slide_bucket(self, slide_id: SlideId) -> dict[str, Any]:
        payload = self._read()
        return payload["slides"].setdefault(slide_id.value, {"layers": [], "annotations": [], "comments": [], "reviews": [], "tags": []})

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

    def _read(self) -> dict[str, Any]:
        payload = self._load_json_payload()
        payload.setdefault("slides", {})
        return payload

    def _write(self, payload: dict[str, Any]) -> None:
        self.path.write_text(json.dumps(payload, indent=2))

    def _load_json_payload(self) -> dict[str, Any]:
        raw = self.path.read_text()
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as error:
            decoder = json.JSONDecoder()
            try:
                payload, index = decoder.raw_decode(raw.lstrip())
            except json.JSONDecodeError:
                LOGGER.exception("Review store is unreadable: %s", self.path)
                raise
            trailing = raw.lstrip()[index:].strip()
            if trailing:
                LOGGER.warning("Review store contained trailing data and was auto-repaired: %s", self.path)
                self._write(payload)
            else:
                LOGGER.exception("Review store is unreadable: %s", self.path)
                raise error
        return payload

    def _replace_or_append(self, items: list[dict[str, Any]], value: dict[str, Any], identity_key: str) -> None:
        for index, existing in enumerate(items):
            if existing[identity_key] == value[identity_key]:
                items[index] = value
                return
        items.append(value)


@dataclass
class FileAnnotationLayerRepository:
    store: FileReviewRepository

    def list_for_slide(self, slide_id: SlideId) -> list[AnnotationLayer]:
        return self.store.list_layers_for_slide(slide_id)

    def get(self, slide_id: SlideId, layer_id: AnnotationLayerId) -> AnnotationLayer | None:
        return self.store.get_layer(slide_id, layer_id)

    def save(self, layer: AnnotationLayer) -> AnnotationLayer:
        return self.store.save_layer(layer)

    def delete(self, slide_id: SlideId, layer_id: AnnotationLayerId) -> None:
        self.store.delete_layer(slide_id, layer_id)


@dataclass
class FileAnnotationRepository:
    store: FileReviewRepository

    def list_for_slide(self, slide_id: SlideId) -> list[AnnotationFeature]:
        return self.store.list_annotations_for_slide(slide_id)

    def get(self, slide_id: SlideId, annotation_id: AnnotationId) -> AnnotationFeature | None:
        return self.store.get_annotation(slide_id, annotation_id)

    def save(self, annotation: AnnotationFeature) -> AnnotationFeature:
        return self.store.save_annotation(annotation)

    def delete(self, slide_id: SlideId, annotation_id: AnnotationId) -> None:
        self.store.delete_annotation(slide_id, annotation_id)


@dataclass
class FileCommentRepository:
    store: FileReviewRepository

    def list_for_annotation(self, slide_id: SlideId, annotation_id: AnnotationId) -> list[AnnotationComment]:
        return self.store.list_comments_for_annotation(slide_id, annotation_id)

    def save(self, comment: AnnotationComment) -> AnnotationComment:
        return self.store.save_comment(comment)

    def get(self, slide_id: SlideId, annotation_id: AnnotationId, comment_id: CommentId) -> AnnotationComment | None:
        return self.store.get_comment(slide_id, annotation_id, comment_id)

    def delete(self, slide_id: SlideId, annotation_id: AnnotationId, comment_id: str) -> None:
        self.store.delete_comment(slide_id, annotation_id, comment_id)


@dataclass
class FileTagRepository:
    store: FileReviewRepository

    def list_for_slide(self, slide_id: SlideId) -> list[SlideTag]:
        return self.store.list_tags_for_slide(slide_id)

    def replace_for_slide(self, slide_id: SlideId, tags: list[SlideTag]) -> list[SlideTag]:
        return self.store.replace_tags_for_slide(slide_id, tags)


@dataclass
class FileAnnotationReviewRepository:
    store: FileReviewRepository

    def list_for_annotation(self, slide_id: SlideId, annotation_id: AnnotationId) -> list[AnnotationReview]:
        return self.store.list_reviews_for_annotation(slide_id, annotation_id)

    def save(self, review: AnnotationReview) -> AnnotationReview:
        return self.store.save_review(review)
