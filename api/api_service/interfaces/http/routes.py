"""Purpose: HTTP routes for upload orchestration and catalog queries.
Owner context: Identity & Catalog and Delivery.
Invariants: routes delegate to application services only.
Failure modes: missing resources map to 404, invalid payloads to 422.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, WebSocket, WebSocketDisconnect, status

from api.api_service.application.dto import CompleteUploadCommand, InitiateUploadCommand
from api.api_service.auth import verify_token
from api.api_service.infrastructure.bootstrap import Container
from api.api_service.interfaces.http.schemas import (
    AnnotationLayerRequest,
    AnnotationLayerResponse,
    AnnotationReviewRequest,
    AnnotationReviewResponse,
    AnnotationRequest,
    AnnotationResponse,
    AvailableReader,
    CommentRequest,
    CommentResponse,
    CompleteUploadRequest,
    IngestionJobResponse,
    InitiateUploadRequest,
    JobProgressResponse,
    ManifestResponse,
    OverlayChunkResponse,
    OverlayManifestResponse,
    OverlayDetailResponse,
    OverlaySummaryResponse,
    OverlayUploadResponse,
    SlideResponse,
    SlideTagRequest,
    SlideTagResponse,
    SlideListItem,
    UploadInitiationResponse,
)

router = APIRouter()
_presence_rooms: dict[str, list[WebSocket]] = {}


def _normalize_job_payload(job: dict[str, object]) -> dict[str, object]:
    payload = dict(job)
    payload.setdefault("display_name", str(payload.get("slide_id", "slide")))
    payload.setdefault("reader_backend", "fastslide")
    payload.setdefault("metadata_backend", "openslide")
    payload.setdefault("progress_percent", 0.0)
    payload.setdefault("stage", "queued")
    payload.setdefault("metrics", {})
    return payload


def _resolve_job_display_name(payload: dict[str, object], container: Container) -> str:
    display_name = str(payload.get("display_name") or payload.get("slide_id") or "slide")
    if display_name != str(payload.get("slide_id", "")):
        return display_name
    slide_id = str(payload.get("slide_id", ""))
    version_id = str(payload.get("version_id", ""))
    if not slide_id or not version_id:
        return display_name
    try:
        slide = container.catalog.get_slide_version(slide_id, version_id)
    except LookupError:
        return display_name
    return str(slide.get("display_name", display_name))


def _normalize_slide_payload(slide: dict[str, object]) -> dict[str, object]:
    payload = dict(slide)
    payload.setdefault("display_name", str(payload.get("slide_id", "slide")))
    payload.setdefault("checksum", "")
    metrics = payload.get("metrics")
    if not isinstance(metrics, dict):
        payload["metrics"] = None
        return payload
    required_metric_keys = {
        "elapsed_seconds",
        "level_count",
        "tile_count",
        "non_empty_tile_count",
        "group_count",
        "artifact_bytes",
    }
    if any(metrics.get(key) is None for key in required_metric_keys):
        payload["metrics"] = None
    return payload


def _normalize_overlay_job_payload(job: dict[str, object]) -> dict[str, object]:
    payload = dict(job)
    filename = str(payload.get("filename", "overlay"))
    stem = Path(filename).stem or "overlay"
    payload.setdefault("name", stem)
    payload.setdefault("source_format", "geojson")
    payload.setdefault("status", "pending")
    payload.setdefault("stage", "queued")
    payload.setdefault("progress_percent", 0.0)
    payload.setdefault("feature_count", 0)
    payload.setdefault("metrics", {})
    payload.setdefault("artifact", {})
    return payload


def get_container() -> Container:
    from api.api_service.main import container

    return container


def get_ingestion_runtime():
    from api.api_service.main import ingestion_runtime

    return ingestion_runtime


def get_overlay_ingestion_runtime():
    from api.api_service.main import overlay_ingestion_runtime

    return overlay_ingestion_runtime


@router.post("/uploads/initiate", response_model=UploadInitiationResponse)
def initiate_upload(payload: InitiateUploadRequest, container: Container = Depends(get_container)) -> UploadInitiationResponse:
    result = container.upload_service.initiate(
        InitiateUploadCommand(filename=payload.filename, checksum=payload.checksum)
    )
    return UploadInitiationResponse(**result.__dict__)


@router.post("/uploads/complete", response_model=IngestionJobResponse)
def complete_upload(payload: CompleteUploadRequest, container: Container = Depends(get_container)) -> IngestionJobResponse:
    result = container.upload_service.complete(
        CompleteUploadCommand(
            slide_id=payload.slide_id,
            version_id=payload.version_id,
            checksum=payload.checksum,
            original_path=payload.original_path,
            reader_backend=payload.reader_backend,
            metadata_backend=payload.metadata_backend,
        )
    )
    return IngestionJobResponse(**result.__dict__)


@router.get("/slides/{slide_id}", response_model=SlideResponse)
def get_slide(slide_id: str, container: Container = Depends(get_container)) -> SlideResponse:
    try:
        slide = _normalize_slide_payload(container.catalog.get_slide(slide_id))
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    manifest_path = slide.get("manifest_path")
    return SlideResponse(
        slide_id=str(slide["slide_id"]),
        version_id=str(slide["version_id"]),
        checksum=str(slide.get("checksum", "")),
        manifest_path=container.minio_proxy.proxy_url(str(manifest_path)) if manifest_path else None,
    )


@router.get("/slides/{slide_id}/versions/{version_id}/manifest", response_model=ManifestResponse)
def get_manifest(slide_id: str, version_id: str, container: Container = Depends(get_container)) -> ManifestResponse:
    try:
        manifest_path = container.catalog.get_slide_version(slide_id, version_id)["manifest_path"]
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return ManifestResponse(manifest_path=container.minio_proxy.proxy_url(str(manifest_path)))


@router.get("/slides", response_model=list[SlideListItem])
def list_slides(container: Container = Depends(get_container)) -> list[SlideListItem]:
    slides = []
    for raw_slide in container.catalog.list_slides():
        slide = _normalize_slide_payload(raw_slide)
        slides.append(
            SlideListItem(
                slide_id=str(slide["slide_id"]),
                version_id=str(slide["version_id"]),
                display_name=str(slide.get("display_name", slide["slide_id"])),
                checksum=str(slide["checksum"]),
                manifest_path=container.minio_proxy.proxy_url(str(slide["manifest_path"])),
                thumbnail_path=container.minio_proxy.proxy_url(str(slide["thumbnail_path"]))
                if slide.get("thumbnail_path")
                else None,
                metrics=slide.get("metrics"),
            )
        )
    return slides


@router.get("/slides/{slide_id}/versions/{version_id}/manifest/content")
def get_manifest_content(slide_id: str, version_id: str, container: Container = Depends(get_container)) -> dict[str, object]:
    try:
        manifest_path = str(container.catalog.get_slide_version(slide_id, version_id)["manifest_path"])
        return container.minio_proxy.load_manifest(manifest_path)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/jobs/{job_id}", response_model=JobProgressResponse)
def get_job(job_id: str, container: Container = Depends(get_container)) -> JobProgressResponse:
    try:
        job = container.catalog.get_job(job_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    payload = _normalize_job_payload(job)
    payload["display_name"] = _resolve_job_display_name(payload, container)
    return JobProgressResponse(**payload)


@router.get("/jobs", response_model=list[JobProgressResponse])
def list_jobs(container: Container = Depends(get_container)) -> list[JobProgressResponse]:
    responses: list[JobProgressResponse] = []
    for job in container.catalog.list_jobs():
        payload = _normalize_job_payload(job)
        payload["display_name"] = _resolve_job_display_name(payload, container)
        responses.append(JobProgressResponse(**payload))
    return responses


@router.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_job(job_id: str, container: Container = Depends(get_container)) -> Response:
    try:
        payload = _normalize_job_payload(container.catalog.get_job(job_id))
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    if payload["status"] not in {"pending", "running"}:
        raise HTTPException(status_code=409, detail="only pending or running jobs can be cancelled")
    runtime = get_ingestion_runtime()
    if not runtime.cancel(job_id):
        raise HTTPException(status_code=409, detail="job is no longer queued")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/uploads/file", response_model=IngestionJobResponse)
async def upload_slide_file(
    file: UploadFile = File(...),
    reader_backend: str = Form(default="fastslide"),
    metadata_backend: str = Form(default="openslide"),
    container: Container = Depends(get_container),
) -> IngestionJobResponse:
    payload = await file.read()
    checksum = f"sha256:{hashlib.sha256(payload).hexdigest()}"
    initiation = container.upload_service.initiate(
        InitiateUploadCommand(filename=file.filename or "slide.bin", checksum=checksum)
    )
    container.minio_proxy.put_bytes(initiation.object_path, payload, file.content_type or "application/octet-stream")
    result = container.upload_service.complete(
        CompleteUploadCommand(
            slide_id=initiation.slide_id,
            version_id=initiation.version_id,
            checksum=checksum,
            original_path=initiation.object_path,
            reader_backend=reader_backend,
            metadata_backend=metadata_backend,
        )
    )
    return IngestionJobResponse(**result.__dict__)


@router.get("/overlay-jobs", response_model=list[OverlayUploadResponse])
def list_overlay_jobs(container: Container = Depends(get_container)) -> list[OverlayUploadResponse]:
    return [OverlayUploadResponse(**_normalize_overlay_job_payload(payload)) for payload in container.overlay_ingestion_service.list_jobs()]


@router.get("/overlay-jobs/{job_id}", response_model=OverlayUploadResponse)
def get_overlay_job(job_id: str, container: Container = Depends(get_container)) -> OverlayUploadResponse:
    try:
        job = container.overlay_ingestion_service.get_job(job_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return OverlayUploadResponse(**_normalize_overlay_job_payload(job))


@router.get("/readers", response_model=list[AvailableReader])
def list_readers() -> list[AvailableReader]:
    return [
        AvailableReader(
            backend="fastslide",
            is_default=True,
            is_recommended=True,
            label="FastSlide",
            supports_render=True,
            supports_metadata=True,
            is_default_metadata=False,
        ),
        AvailableReader(
            backend="openslide",
            is_default=False,
            is_recommended=False,
            label="OpenSlide",
            supports_render=True,
            supports_metadata=True,
            is_default_metadata=True,
        ),
        AvailableReader(
            backend="pyvips",
            is_default=False,
            is_recommended=False,
            label="PyVips",
            supports_render=True,
            supports_metadata=True,
            is_default_metadata=False,
        ),
        AvailableReader(
            backend="local",
            is_default=False,
            is_recommended=False,
            label="Local Test Reader",
            supports_render=True,
            supports_metadata=True,
            is_default_metadata=False,
        ),
    ]


@router.get("/storage/{bucket}/{object_path:path}")
def get_storage_object(bucket: str, object_path: str, container: Container = Depends(get_container)) -> Response:
    try:
        payload, content_type = container.minio_proxy.get_bytes(bucket, object_path)
    except Exception as error:  # pragma: no cover - integration path
        raise HTTPException(status_code=404, detail=str(error)) from error
    return Response(content=payload, media_type=content_type)


@router.get("/slides/{slide_id}/overlays", response_model=list[OverlaySummaryResponse])
def list_overlays(slide_id: str, container: Container = Depends(get_container)) -> list[OverlaySummaryResponse]:
    return [OverlaySummaryResponse(**payload) for payload in container.overlay_service.list_overlays(slide_id)]


@router.get("/slides/{slide_id}/overlays/{overlay_id}", response_model=OverlayDetailResponse)
def get_overlay(slide_id: str, overlay_id: str, container: Container = Depends(get_container)) -> OverlayDetailResponse:
    try:
        payload = container.overlay_service.get_overlay(slide_id, overlay_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return OverlayDetailResponse(**payload)


@router.get("/slides/{slide_id}/overlays/{overlay_id}/manifest", response_model=OverlayManifestResponse)
def get_overlay_manifest(slide_id: str, overlay_id: str, container: Container = Depends(get_container)) -> OverlayManifestResponse:
    try:
        payload = container.overlay_service.get_overlay_manifest(slide_id, overlay_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return OverlayManifestResponse(**container.minio_proxy.rewrite_payload(payload))


@router.get("/slides/{slide_id}/overlays/{overlay_id}/chunks/{chunk_id}", response_model=OverlayChunkResponse)
def get_overlay_chunk(
    slide_id: str,
    overlay_id: str,
    chunk_id: str,
    representation: Optional[str] = None,
    container: Container = Depends(get_container),
) -> OverlayChunkResponse:
    try:
        payload = container.overlay_service.get_overlay_chunk(slide_id, overlay_id, chunk_id, representation=representation)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return OverlayChunkResponse(**payload)


@router.post("/overlay-uploads/file", response_model=OverlayUploadResponse)
async def upload_overlay_file(
    slide_id: str = Form(...),
    source_format: str = Form(...),
    display_name: Optional[str] = Form(default=None),
    file: UploadFile = File(...),
    container: Container = Depends(get_container),
) -> OverlayUploadResponse:
    payload = await file.read()
    try:
        runtime = get_overlay_ingestion_runtime()
        if runtime.is_running():
            result = container.overlay_ingestion_service.stage_upload(
                slide_id=slide_id,
                filename=file.filename or "overlay.bin",
                source_format=source_format,
                payload=payload,
                display_name=display_name,
            )
            runtime.enqueue(result)
        else:
            result = container.overlay_ingestion_service.ingest_upload(
                slide_id=slide_id,
                filename=file.filename or "overlay.bin",
                source_format=source_format,
                payload=payload,
                display_name=display_name,
            )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return OverlayUploadResponse(**result)


@router.get("/slides/{slide_id}/overlays/{overlay_id}/legend", response_model=list[dict[str, object]])
def get_overlay_legend(slide_id: str, overlay_id: str, container: Container = Depends(get_container)) -> list[dict[str, object]]:
    try:
        payload = container.overlay_service.get_overlay(slide_id, overlay_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return list(payload.get("legend", []))


@router.get("/slides/{slide_id}/annotation-layers", response_model=list[AnnotationLayerResponse])
def list_annotation_layers(slide_id: str, container: Container = Depends(get_container)) -> list[AnnotationLayerResponse]:
    return [AnnotationLayerResponse(**payload) for payload in container.review_service.list_layers(slide_id)]


@router.get("/slides/{slide_id}/tags", response_model=list[SlideTagResponse])
def list_tags(slide_id: str, container: Container = Depends(get_container)) -> list[SlideTagResponse]:
    return [SlideTagResponse(**payload) for payload in container.review_service.list_tags(slide_id)]


@router.put("/slides/{slide_id}/tags", response_model=list[SlideTagResponse])
def replace_tags(
    slide_id: str, payload: list[SlideTagRequest], container: Container = Depends(get_container)
) -> list[SlideTagResponse]:
    return [SlideTagResponse(**item) for item in container.review_service.replace_tags(slide_id, [item.model_dump() for item in payload])]


@router.put("/slides/{slide_id}/annotation-layers", response_model=AnnotationLayerResponse)
def save_annotation_layer(
    slide_id: str,
    payload: AnnotationLayerRequest,
    container: Container = Depends(get_container),
) -> AnnotationLayerResponse:
    result = container.review_service.save_layer(
        slide_id,
        layer_id=payload.id,
        name=payload.name,
        color=payload.color,
        is_visible=payload.isVisible,
        is_locked=payload.isLocked,
    )
    return AnnotationLayerResponse(**result)


@router.delete("/slides/{slide_id}/annotation-layers/{layer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_annotation_layer(slide_id: str, layer_id: str, container: Container = Depends(get_container)) -> Response:
    container.review_service.delete_layer(slide_id, layer_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/slides/{slide_id}/annotations", response_model=list[AnnotationResponse])
def list_annotations(slide_id: str, container: Container = Depends(get_container)) -> list[AnnotationResponse]:
    return [AnnotationResponse(**payload) for payload in container.review_service.list_annotations(slide_id)]


@router.put("/slides/{slide_id}/annotations", response_model=AnnotationResponse)
def save_annotation(
    slide_id: str, payload: AnnotationRequest, container: Container = Depends(get_container)
) -> AnnotationResponse:
    try:
        result = container.review_service.save_annotation(
            slide_id,
            annotation_id=payload.id,
            layer_id=payload.layerId,
            geometry=payload.geometry,
            properties=payload.properties,
            style=payload.style,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return AnnotationResponse(**result)


@router.delete("/slides/{slide_id}/annotations/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_annotation(slide_id: str, annotation_id: str, container: Container = Depends(get_container)) -> Response:
    container.review_service.delete_annotation(slide_id, annotation_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/slides/{slide_id}/annotations/{annotation_id}/reviews", response_model=list[AnnotationReviewResponse])
def list_reviews(slide_id: str, annotation_id: str, container: Container = Depends(get_container)) -> list[AnnotationReviewResponse]:
    return [AnnotationReviewResponse(**payload) for payload in container.review_service.list_reviews(slide_id, annotation_id)]


@router.put("/slides/{slide_id}/annotations/{annotation_id}/reviews/{review_id}", response_model=AnnotationReviewResponse)
def save_review(
    slide_id: str,
    annotation_id: str,
    review_id: str,
    payload: AnnotationReviewRequest,
    container: Container = Depends(get_container),
) -> AnnotationReviewResponse:
    result = container.review_service.save_review(
        slide_id,
        annotation_id,
        review_id=review_id if review_id != "new" else payload.id,
        status=payload.status,
        reviewer=payload.reviewer,
        note=payload.note,
    )
    return AnnotationReviewResponse(**result)


@router.get("/slides/{slide_id}/annotations/{annotation_id}/comments", response_model=list[CommentResponse])
def list_comments(
    slide_id: str, annotation_id: str, container: Container = Depends(get_container)
) -> list[CommentResponse]:
    return [CommentResponse(**payload) for payload in container.review_service.list_comments(slide_id, annotation_id)]


@router.post("/slides/{slide_id}/annotations/{annotation_id}/comments", response_model=CommentResponse)
def create_comment(
    slide_id: str,
    annotation_id: str,
    payload: CommentRequest,
    container: Container = Depends(get_container),
) -> CommentResponse:
    result = container.review_service.save_comment(
        slide_id,
        annotation_id,
        comment_id=None,
        body=payload.body,
        author=payload.author,
        parent_id=payload.parentId,
    )
    return CommentResponse(**result)


@router.patch("/slides/{slide_id}/annotations/{annotation_id}/comments/{comment_id}", response_model=CommentResponse)
def update_comment(
    slide_id: str,
    annotation_id: str,
    comment_id: str,
    payload: CommentRequest,
    container: Container = Depends(get_container),
) -> CommentResponse:
    try:
        result = container.review_service.update_comment(
            slide_id, annotation_id, comment_id, body=payload.body, author=payload.author
        )
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return CommentResponse(**result)


@router.delete(
    "/slides/{slide_id}/annotations/{annotation_id}/comments/{comment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_comment(
    slide_id: str,
    annotation_id: str,
    comment_id: str,
    container: Container = Depends(get_container),
) -> Response:
    container.review_service.delete_comment(slide_id, annotation_id, comment_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.websocket("/slides/{slide_id}/presence")
async def slide_presence(slide_id: str, websocket: WebSocket, token: str | None = Query(None)) -> None:
    try:
        verify_token(token)
    except HTTPException:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    room = _presence_rooms.setdefault(slide_id, [])
    room.append(websocket)
    try:
        await websocket.send_json({"type": "presence.sync", "slideId": slide_id, "participants": len(room)})
        while True:
            payload = await websocket.receive_text()
            for peer in list(room):
                if peer is websocket:
                    continue
                try:
                    await peer.send_text(payload)
                except Exception:
                    if peer in room:
                        room.remove(peer)
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in room:
            room.remove(websocket)
        message = json.dumps({"type": "presence.sync", "slideId": slide_id, "participants": len(room)})
        for peer in list(room):
            try:
                await peer.send_text(message)
            except Exception:
                if peer in room:
                    room.remove(peer)
