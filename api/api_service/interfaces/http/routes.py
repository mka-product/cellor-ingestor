"""Purpose: HTTP routes for upload orchestration and catalog queries.
Owner context: Identity & Catalog and Delivery.
Invariants: routes delegate to application services only.
Failure modes: missing resources map to 404, invalid payloads to 422.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status

from api.api_service.application.dto import CompleteUploadCommand, InitiateUploadCommand
from api.api_service.infrastructure.bootstrap import Container
from api.api_service.interfaces.http.schemas import (
    AnnotationLayerRequest,
    AnnotationLayerResponse,
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
    OverlayDetailResponse,
    OverlaySummaryResponse,
    SlideResponse,
    SlideListItem,
    UploadInitiationResponse,
)

router = APIRouter()


def get_container() -> Container:
    from api.api_service.main import container

    return container


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
        result = container.catalog_service.get_slide(slide_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return SlideResponse(**result.__dict__)


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
    for slide in container.catalog.list_slides():
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
    return JobProgressResponse(**job)


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
