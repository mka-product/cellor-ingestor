"""Purpose: compose API dependencies for local runtime and tests.
Owner context: Identity & Catalog and Delivery.
Invariants: a single container owns repository state for one app instance.
Failure modes: incorrect wiring causes startup failure.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from minio import Minio

from api.api_service.application.services import (
    CatalogQueryService,
    OverlayIngestionApplicationService,
    OverlayQueryService,
    ReviewApplicationService,
    UploadApplicationService,
)
from api.api_service.infrastructure.catalog import FileCatalog
from api.api_service.infrastructure.events import InMemoryEventPublisher
from api.api_service.infrastructure.minio_proxy import MinioProxy
from api.api_service.infrastructure.object_store_state import (
    ObjectJsonDocumentStore,
    ObjectStoreAnnotationLayerRepository,
    ObjectStoreAnnotationRepository,
    ObjectStoreAnnotationReviewRepository,
    ObjectStoreCatalog,
    ObjectStoreCommentRepository,
    ObjectStoreOverlayRepository,
    ObjectStoreReviewRepository,
    ObjectStoreTagRepository,
)
from api.api_service.infrastructure.queue import InMemoryJobQueue
from api.api_service.infrastructure.repositories import (
    InMemoryIngestionJobRepository,
    InMemorySlideRepository,
    InMemorySlideVersionRepository,
)
from api.api_service.infrastructure.settings import Settings
from api.api_service.infrastructure.workspace_store import (
    FileAnnotationLayerRepository,
    FileAnnotationReviewRepository,
    FileAnnotationRepository,
    FileCommentRepository,
    FileOverlayRepository,
    FileReviewRepository,
    FileTagRepository,
)


@dataclass
class Container:
    settings: Settings = field(default_factory=Settings.from_env)
    slides: InMemorySlideRepository = field(default_factory=InMemorySlideRepository)
    versions: InMemorySlideVersionRepository = field(default_factory=InMemorySlideVersionRepository)
    jobs: InMemoryIngestionJobRepository = field(default_factory=InMemoryIngestionJobRepository)
    events: InMemoryEventPublisher = field(default_factory=InMemoryEventPublisher)
    queue: InMemoryJobQueue = field(default_factory=InMemoryJobQueue)

    def __post_init__(self) -> None:
        self.minio_proxy = MinioProxy(
            Minio(
                self.settings.minio_endpoint,
                access_key=self.settings.minio_access_key,
                secret_key=self.settings.minio_secret_key,
                secure=self.settings.minio_secure,
            ),
            storage_bucket=self.settings.storage_bucket,
        )
        if self.settings.state_backend == "object_store":
            self.catalog = ObjectStoreCatalog(
                ObjectJsonDocumentStore(self.minio_proxy, self.settings.catalog_uri, {"slides": [], "jobs": [], "overlay_jobs": []})
            )
            self.overlays = ObjectStoreOverlayRepository(
                ObjectJsonDocumentStore(self.minio_proxy, self.settings.overlays_uri, {"slides": {}})
            )
            self.review_store = ObjectStoreReviewRepository(
                ObjectJsonDocumentStore(self.minio_proxy, self.settings.reviews_uri, {"slides": {}})
            )
            self.annotation_layers = ObjectStoreAnnotationLayerRepository(self.review_store)
            self.annotations = ObjectStoreAnnotationRepository(self.review_store)
            self.comments = ObjectStoreCommentRepository(self.review_store)
            self.tags = ObjectStoreTagRepository(self.review_store)
            self.reviews = ObjectStoreAnnotationReviewRepository(self.review_store)
        else:
            self.catalog = FileCatalog(self.settings.catalog_path)
            self.overlays = FileOverlayRepository(self.settings.overlays_path)
            self.review_store = FileReviewRepository(self.settings.reviews_path)
            self.annotation_layers = FileAnnotationLayerRepository(self.review_store)
            self.annotations = FileAnnotationRepository(self.review_store)
            self.comments = FileCommentRepository(self.review_store)
            self.tags = FileTagRepository(self.review_store)
            self.reviews = FileAnnotationReviewRepository(self.review_store)

    @property
    def upload_service(self) -> UploadApplicationService:
        return UploadApplicationService(self.slides, self.versions, self.jobs, self.events, self.queue, self.catalog)

    @property
    def catalog_service(self) -> CatalogQueryService:
        return CatalogQueryService(self.slides, self.versions)

    @property
    def overlay_service(self) -> OverlayQueryService:
        return OverlayQueryService(self.overlays, self.minio_proxy)

    @property
    def overlay_ingestion_service(self) -> OverlayIngestionApplicationService:
        return OverlayIngestionApplicationService(self.overlays, self.catalog, self.minio_proxy)

    @property
    def review_service(self) -> ReviewApplicationService:
        return ReviewApplicationService(self.annotation_layers, self.annotations, self.comments, self.tags, self.reviews)
