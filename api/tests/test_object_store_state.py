import json

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
from api.api_service.infrastructure.object_store_state import (
    ObjectJsonDocumentStore,
    ObjectStoreCatalog,
    ObjectStoreOverlayRepository,
    ObjectStoreReviewRepository,
)


class FakeMinioProxy:
    def __init__(self) -> None:
        self.objects: dict[str, dict[str, object]] = {}

    def load_json_or_default(self, object_path: str, default: dict[str, object]) -> dict[str, object]:
        return json.loads(json.dumps(self.objects.get(object_path, default)))

    def put_json(self, object_path: str, payload: dict[str, object]) -> None:
        self.objects[object_path] = json.loads(json.dumps(payload))


def test_object_store_catalog_roundtrip() -> None:
    proxy = FakeMinioProxy()
    catalog = ObjectStoreCatalog(ObjectJsonDocumentStore(proxy, "s3://app-state/catalog/catalog.json", {"slides": [], "jobs": [], "overlay_jobs": []}))

    catalog.upsert_job({"job_id": "job-1", "slide_id": "slide-1", "version_id": "v-1", "status": "running"})
    catalog.upsert_overlay_job({"job_id": "overlay-job-1", "overlay_id": "overlay-1", "status": "succeeded"})

    assert catalog.get_job("job-1")["status"] == "running"
    assert catalog.get_overlay_job("overlay-job-1")["overlay_id"] == "overlay-1"


def test_object_store_overlay_repository_roundtrip() -> None:
    proxy = FakeMinioProxy()
    repo = ObjectStoreOverlayRepository(ObjectJsonDocumentStore(proxy, "s3://app-state/catalog/overlays.json", {"slides": {}}))
    overlay = OverlayDefinition(
        overlay_id=OverlayId("overlay-1"),
        slide_id=SlideId("slide-1"),
        name="Regions",
        kind="vector",
        features=(
            OverlayFeature(
                id="feature-1",
                name="Region 1",
                kind="polygon",
                geometry={"type": "Polygon", "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 0]]]},
                properties={"class": "tumor"},
                style_hints={"color": [1, 2, 3, 255]},
                bounds=(0.0, 0.0, 10.0, 10.0),
            ),
        ),
    )

    repo.save(overlay)
    loaded = repo.get(SlideId("slide-1"), OverlayId("overlay-1"))

    assert loaded is not None
    assert loaded.features[0].properties["class"] == "tumor"


def test_object_store_review_repository_roundtrip() -> None:
    proxy = FakeMinioProxy()
    repo = ObjectStoreReviewRepository(ObjectJsonDocumentStore(proxy, "s3://app-state/catalog/reviews.json", {"slides": {}}))
    slide_id = SlideId("slide-1")
    layer = AnnotationLayer(layer_id=AnnotationLayerId("layer-1"), slide_id=slide_id, name="Review", color="#f97316")
    annotation = AnnotationFeature(
        annotation_id=AnnotationId("annotation-1"),
        slide_id=slide_id,
        layer_id=layer.layer_id,
        geometry={"type": "Point", "coordinates": [1, 2]},
        properties={"label": "A"},
        style={"color": "#fff"},
    )
    comment = AnnotationComment(
        comment_id=CommentId("comment-1"),
        slide_id=slide_id,
        annotation_id=annotation.annotation_id,
        body="review",
        author="tester",
    )
    review = AnnotationReview(
        review_id="review-1",
        slide_id=slide_id,
        annotation_id=annotation.annotation_id,
        status="approved",
        reviewer="reviewer-1",
        note="ok",
    )

    repo.save_layer(layer)
    repo.save_annotation(annotation)
    repo.save_comment(comment)
    repo.save_review(review)
    repo.replace_tags_for_slide(slide_id, [SlideTag(slide_id=slide_id, value="priority", color="#38bdf8")])

    assert repo.get_layer(slide_id, layer.layer_id) is not None
    assert repo.get_annotation(slide_id, annotation.annotation_id) is not None
    assert repo.get_comment(slide_id, annotation.annotation_id, comment.comment_id) is not None
    assert repo.list_reviews_for_annotation(slide_id, annotation.annotation_id)[0].status == "approved"
    assert repo.list_tags_for_slide(slide_id)[0].value == "priority"


def test_object_store_revision_guard_rejects_stale_write() -> None:
    proxy = FakeMinioProxy()
    store = ObjectJsonDocumentStore(proxy, "s3://app-state/catalog/catalog.json", {"slides": [], "jobs": [], "overlay_jobs": []})
    _, revision = store.read()
    store.write({"slides": [], "jobs": [{"job_id": "job-1"}], "overlay_jobs": []}, revision)

    try:
        store.write({"slides": [], "jobs": [{"job_id": "job-2"}], "overlay_jobs": []}, revision)
    except ValueError as error:
        assert "stale object-store write rejected" in str(error)
    else:  # pragma: no cover - defensive
        raise AssertionError("expected stale object-store write rejection")
