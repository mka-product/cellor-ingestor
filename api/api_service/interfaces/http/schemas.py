"""Purpose: HTTP request and response schemas for the API service.
Owner context: Identity & Catalog and Delivery.
Invariants: payloads are fully typed and validated by FastAPI/Pydantic.
Failure modes: invalid requests return 422 with field-level errors.
"""

from __future__ import annotations

from typing import Dict, Optional

from pydantic import BaseModel, ConfigDict, Field


class InitiateUploadRequest(BaseModel):
    filename: str = Field(min_length=1)
    checksum: str = Field(min_length=1)


class UploadInitiationResponse(BaseModel):
    slide_id: str
    version_id: str
    upload_url: str
    object_path: str


class CompleteUploadRequest(BaseModel):
    slide_id: str = Field(min_length=1)
    version_id: str = Field(min_length=1)
    checksum: str = Field(min_length=1)
    original_path: str = Field(min_length=1)
    reader_backend: Optional[str] = Field(default=None, pattern="^(fastslide|openslide|pyvips|local)$")
    metadata_backend: Optional[str] = Field(default=None, pattern="^(openslide|fastslide|pyvips|local|render)$")


class IngestionJobResponse(BaseModel):
    job_id: str
    slide_id: str
    version_id: str
    status: str
    display_name: Optional[str] = None
    reader_backend: Optional[str] = None
    metadata_backend: Optional[str] = None
    progress_percent: Optional[float] = None
    stage: Optional[str] = None
    message: Optional[str] = None
    started_at: Optional[str] = None
    updated_at: Optional[str] = None
    metrics: dict[str, object] = Field(default_factory=dict)


class SlideResponse(BaseModel):
    slide_id: str
    version_id: str
    checksum: str
    manifest_path: Optional[str] = None


class ManifestResponse(BaseModel):
    manifest_path: str


class SlideMetrics(BaseModel):
    elapsed_seconds: float
    level_count: int
    tile_count: int
    non_empty_tile_count: int
    group_count: int
    artifact_bytes: int
    timings: Optional[Dict[str, float]] = None


class SlideListItem(BaseModel):
    slide_id: str
    version_id: str
    display_name: str
    checksum: str
    manifest_path: str
    thumbnail_path: Optional[str] = None
    metrics: Optional[SlideMetrics] = None


class AvailableReader(BaseModel):
    backend: str
    is_default: bool
    is_recommended: bool
    label: str
    supports_render: bool = True
    supports_metadata: bool = True
    is_default_metadata: bool = False


class JobProgressResponse(BaseModel):
    job_id: str
    slide_id: str
    version_id: str
    status: str
    display_name: str
    reader_backend: str
    metadata_backend: str
    progress_percent: float
    stage: str
    message: Optional[str] = None
    started_at: Optional[str] = None
    updated_at: Optional[str] = None
    metrics: dict[str, object] = Field(default_factory=dict)


class OverlaySummaryResponse(BaseModel):
    id: str
    name: str
    kind: str
    featureCount: int
    legend: list[dict[str, object]] = Field(default_factory=list)


class OverlayFeatureResponse(BaseModel):
    id: str
    name: str
    kind: str
    geometry: dict[str, object]
    properties: dict[str, object] = Field(default_factory=dict)
    styleHints: dict[str, object] = Field(default_factory=dict)
    bounds: list[float] = Field(default_factory=list)


class OverlayDetailResponse(BaseModel):
    id: str
    name: str
    kind: str
    sourceFormat: Optional[str] = None
    versionId: Optional[str] = None
    metadata: dict[str, object] = Field(default_factory=dict)
    delivery: dict[str, object] = Field(default_factory=dict)
    features: list[OverlayFeatureResponse]
    legend: list[dict[str, object]] = Field(default_factory=list)


class OverlayChunkSummaryResponse(BaseModel):
    id: str
    bounds: list[float] = Field(default_factory=list)
    featureCount: int
    path: str


class OverlayManifestResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    schema_name: str = Field(alias="schema")
    slideId: str
    overlayId: str
    name: str
    kind: str
    versionId: str
    sourceFormat: str
    coordinateSpace: dict[str, object] = Field(default_factory=dict)
    runtimeFormat: str
    artifact: dict[str, object] = Field(default_factory=dict)
    featureCount: int
    bounds: list[float] = Field(default_factory=list)
    legend: list[dict[str, object]] = Field(default_factory=list)
    metadata: dict[str, object] = Field(default_factory=dict)
    chunking: dict[str, object] = Field(default_factory=dict)


class OverlayChunkResponse(BaseModel):
    id: str
    bounds: list[float] = Field(default_factory=list)
    featureCount: int
    features: list[OverlayFeatureResponse] = Field(default_factory=list)


class OverlayUploadResponse(BaseModel):
    job_id: str
    slide_id: str
    overlay_id: str
    version_id: str
    filename: str
    name: str
    source_format: str
    status: str
    stage: str
    progress_percent: float
    message: Optional[str] = None
    feature_count: int = 0
    kind: Optional[str] = None
    checksum: Optional[str] = None
    runtime_format: Optional[str] = None
    started_at: Optional[str] = None
    updated_at: Optional[str] = None
    metrics: dict[str, object] = Field(default_factory=dict)
    artifact: dict[str, object] = Field(default_factory=dict)


class SlideTagRequest(BaseModel):
    value: str = Field(min_length=1)
    color: str = Field(default="#38bdf8", min_length=4)


class SlideTagResponse(BaseModel):
    value: str
    color: str


class AnnotationReviewRequest(BaseModel):
    id: Optional[str] = None
    status: str = Field(min_length=1)
    reviewer: str = Field(default="local-user", min_length=1)
    note: str = ""


class AnnotationReviewResponse(BaseModel):
    id: str
    annotationId: str
    status: str
    reviewer: str
    note: str
    createdAt: str
    updatedAt: str


class AnnotationLayerRequest(BaseModel):
    id: Optional[str] = None
    name: str = Field(min_length=1)
    color: str = Field(default="#38bdf8", min_length=4)
    isVisible: bool = True
    isLocked: bool = False


class AnnotationLayerResponse(BaseModel):
    id: str
    name: str
    color: str
    isVisible: bool
    isLocked: bool


class AnnotationRequest(BaseModel):
    id: Optional[str] = None
    layerId: str = Field(min_length=1)
    geometry: dict[str, object]
    properties: dict[str, object] = Field(default_factory=dict)
    style: dict[str, object] = Field(default_factory=dict)


class AnnotationResponse(BaseModel):
    id: str
    layerId: str
    geometry: dict[str, object]
    properties: dict[str, object]
    style: dict[str, object]
    createdAt: str
    updatedAt: str


class CommentRequest(BaseModel):
    body: str = Field(min_length=1)
    author: str = Field(default="local-user", min_length=1)
    parentId: Optional[str] = None


class CommentResponse(BaseModel):
    id: str
    annotationId: str
    body: str
    author: str
    parentId: Optional[str] = None
    createdAt: str
    updatedAt: str
