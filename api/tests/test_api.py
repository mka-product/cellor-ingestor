import json
from pathlib import Path

from fastapi.testclient import TestClient
from jsonschema import validate

from api.api_service.main import app, container


client = TestClient(app)


def _reset_workspace_files() -> None:
    container.overlays.path.write_text(json.dumps({"slides": {}}, indent=2))
    container.review_store.path.write_text(json.dumps({"slides": {}}, indent=2))


def test_upload_completion_is_idempotent() -> None:
    initiation = client.post(
        "/uploads/initiate",
        json={"filename": "slide.svs", "checksum": "sha256:abc"},
    )
    payload = initiation.json()

    request = {
        "slide_id": payload["slide_id"],
        "version_id": payload["version_id"],
        "checksum": "sha256:abc",
        "original_path": payload["object_path"],
        "reader_backend": "fastslide",
        "metadata_backend": "openslide",
    }
    first = client.post("/uploads/complete", json=request)
    second = client.post("/uploads/complete", json=request)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["job_id"] == second.json()["job_id"]
    assert first.json()["reader_backend"] == "fastslide"
    assert first.json()["metadata_backend"] == "openslide"
    assert len(container.queue.jobs) >= 1


def test_job_progress_lookup_returns_shared_catalog_record() -> None:
    container.catalog.upsert_job(
        {
            "job_id": "job-test",
            "slide_id": "slide-1",
            "version_id": "v-1",
            "status": "running",
            "reader_backend": "fastslide",
            "metadata_backend": "openslide",
            "progress_percent": 25.0,
            "stage": "level-0",
            "message": "Rendering level 0",
            "started_at": None,
            "updated_at": "2026-06-16T00:00:00Z",
        }
    )
    response = client.get("/jobs/job-test")
    assert response.status_code == 200
    assert response.json()["reader_backend"] == "fastslide"
    assert response.json()["metadata_backend"] == "openslide"
    assert response.json()["progress_percent"] == 25.0


def test_readers_route_lists_fastslide_as_default() -> None:
    response = client.get("/readers")
    assert response.status_code == 200
    payload = response.json()
    assert payload[0]["backend"] == "fastslide"
    assert payload[0]["is_default"] is True
    assert any(reader["backend"] == "openslide" and reader["is_default_metadata"] is True for reader in payload)


def test_slide_lookup_returns_404_without_manifest() -> None:
    response = client.get("/slides/missing")
    assert response.status_code == 404


def test_openapi_generation_contains_upload_routes() -> None:
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert "/uploads/initiate" in schema["paths"]
    assert "/uploads/complete" in schema["paths"]


def test_manifest_schema_document_is_valid_json_schema() -> None:
    schema = json.loads((Path(__file__).resolve().parents[2] / "docs/contracts/manifest.schema.json").read_text())
    sample = {
        "schema": "wsi-tile-manifest-v1",
        "slideId": "slide-1",
        "versionId": "v-1",
        "width": 1000,
        "height": 800,
        "tileSize": 512,
        "groupSize": [4, 4],
        "levels": [
            {
                "level": 0,
                "downsample": 1,
                "width": 1000,
                "height": 800,
                "tilesX": 2,
                "tilesY": 2,
                "indexPath": "levels/0/index.bin",
            }
        ],
        "artifacts": {
            "manifestPath": "manifest.json",
            "thumbnailPath": "thumbnail.jpg",
        },
        "metadata": {
            "vendor": "aperio",
            "objectivePower": 20,
            "micronsPerPixel": {"x": 0.25, "y": 0.25, "source": "openslide"},
            "sourceProperties": {"openslide.vendor": "aperio"},
        },
        "provenance": {
            "ingestionVersion": "0.1.0",
            "sourceChecksum": "sha256:abc",
            "publishedAt": "2026-06-16T00:00:00Z",
        },
    }
    validate(instance=sample, schema=schema)


def test_overlay_and_review_routes_roundtrip() -> None:
    _reset_workspace_files()
    container.overlays.path.write_text(
        json.dumps(
            {
                "slides": {
                    "slide-1": {
                        "overlays": [
                            {
                                "id": "overlay-1",
                                "name": "Tumor Regions",
                                "kind": "vector",
                                "legend": [{"label": "tumor", "color": "#38bdf8"}],
                                "features": [
                                    {
                                        "id": "feature-1",
                                        "name": "Region 1",
                                        "kind": "polygon",
                                        "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 0]]]},
                                        "properties": {"class": "tumor"},
                                        "styleHints": {"color": [56, 189, 248, 255]},
                                        "bounds": [0, 0, 10, 10],
                                    }
                                ],
                            }
                        ]
                    }
                }
            },
            indent=2,
        )
    )

    overlays = client.get("/slides/slide-1/overlays")
    assert overlays.status_code == 200
    assert overlays.json()[0]["id"] == "overlay-1"

    overlay_detail = client.get("/slides/slide-1/overlays/overlay-1")
    assert overlay_detail.status_code == 200
    assert overlay_detail.json()["features"][0]["id"] == "feature-1"

    layer_response = client.put(
        "/slides/slide-1/annotation-layers",
        json={"name": "Review Layer", "color": "#f97316", "isVisible": True, "isLocked": False},
    )
    assert layer_response.status_code == 200
    layer_id = layer_response.json()["id"]

    annotation_response = client.put(
        "/slides/slide-1/annotations",
        json={
            "layerId": layer_id,
            "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [100, 0], [100, 100], [0, 0]]]},
            "properties": {"label": "ROI"},
            "style": {"color": "#f97316"},
        },
    )
    assert annotation_response.status_code == 200
    annotation_id = annotation_response.json()["id"]

    comment_response = client.post(
        f"/slides/slide-1/annotations/{annotation_id}/comments",
        json={"body": "Looks good", "author": "reviewer"},
    )
    assert comment_response.status_code == 200
    assert comment_response.json()["body"] == "Looks good"
    assert comment_response.json()["parentId"] is None
    assert comment_response.json()["updatedAt"]

    reply_response = client.post(
        f"/slides/slide-1/annotations/{annotation_id}/comments",
        json={"body": "Reply note", "author": "reviewer-2", "parentId": comment_response.json()["id"]},
    )
    assert reply_response.status_code == 200
    assert reply_response.json()["parentId"] == comment_response.json()["id"]

    update_response = client.patch(
        f"/slides/slide-1/annotations/{annotation_id}/comments/{comment_response.json()['id']}",
        json={"body": "Looks great", "author": "reviewer"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["body"] == "Looks great"

    list_comments = client.get(f"/slides/slide-1/annotations/{annotation_id}/comments")
    assert list_comments.status_code == 200
    assert len(list_comments.json()) == 2


def test_annotation_validation_returns_422_for_invalid_polygon() -> None:
    _reset_workspace_files()
    layer_response = client.put(
        "/slides/slide-invalid/annotation-layers",
        json={"name": "Review Layer", "color": "#f97316", "isVisible": True, "isLocked": False},
    )
    layer_id = layer_response.json()["id"]

    response = client.put(
        "/slides/slide-invalid/annotations",
        json={
            "layerId": layer_id,
            "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [100, 0], [0, 0]]]},
            "properties": {"label": "Broken"},
            "style": {"color": "#f97316"},
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "invalid polygon annotation geometry"


def test_overlay_detail_returns_404_for_missing_overlay() -> None:
    response = client.get("/slides/missing-slide/overlays/missing-overlay")
    assert response.status_code == 404


def test_deleting_annotation_removes_comment_thread() -> None:
    _reset_workspace_files()
    layer_response = client.put(
        "/slides/slide-delete/annotation-layers",
        json={"name": "Delete Layer", "color": "#22c55e", "isVisible": True, "isLocked": False},
    )
    layer_id = layer_response.json()["id"]

    annotation_response = client.put(
        "/slides/slide-delete/annotations",
        json={
            "layerId": layer_id,
            "geometry": {"type": "Point", "coordinates": [12, 18]},
            "properties": {"label": "Point A"},
            "style": {},
        },
    )
    annotation_id = annotation_response.json()["id"]

    client.post(
        f"/slides/slide-delete/annotations/{annotation_id}/comments",
        json={"body": "temporary note", "author": "tester"},
    )

    delete_response = client.delete(f"/slides/slide-delete/annotations/{annotation_id}")
    assert delete_response.status_code == 204

    comments_response = client.get(f"/slides/slide-delete/annotations/{annotation_id}/comments")
    assert comments_response.status_code == 200
    assert comments_response.json() == []


def test_delete_comment_endpoint_removes_comment() -> None:
    _reset_workspace_files()
    layer_response = client.put(
        "/slides/slide-comment-delete/annotation-layers",
        json={"name": "Delete Comment Layer", "color": "#22c55e", "isVisible": True, "isLocked": False},
    )
    annotation_response = client.put(
        "/slides/slide-comment-delete/annotations",
        json={
            "layerId": layer_response.json()["id"],
            "geometry": {"type": "Point", "coordinates": [1, 2]},
            "properties": {"label": "Delete me"},
            "style": {},
        },
    )
    annotation_id = annotation_response.json()["id"]
    comment_response = client.post(
        f"/slides/slide-comment-delete/annotations/{annotation_id}/comments",
        json={"body": "temporary note", "author": "tester"},
    )
    delete_response = client.delete(
        f"/slides/slide-comment-delete/annotations/{annotation_id}/comments/{comment_response.json()['id']}"
    )
    assert delete_response.status_code == 204
    comments_response = client.get(f"/slides/slide-comment-delete/annotations/{annotation_id}/comments")
    assert comments_response.json() == []
