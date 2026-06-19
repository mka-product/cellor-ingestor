# S3-Native Collaboration, Overlay Ingestion, and Operations Plan

## Summary

Extend the current WSI platform into an S3-native, multi-user workspace where persistent state lives in object storage rather than a database. The target model is:

- `Slide` has attached `OverlaySet` resources and `Tag` resources.
- `AnnotationLayer` belongs to a `Slide`.
- `Annotation` belongs to an `AnnotationLayer`.
- `Comment` and `Review` belong to an `Annotation`.
- `PresenceSession` supports live cursor and viewport sharing across users.

The system must continue to run with only S3-compatible storage such as S3 or MinIO as the persistence substrate. Application services may keep short-lived in-memory caches and ephemeral websocket session state, but all durable entities, manifests, overlay artifacts, review records, and operational logs must remain reconstructible from object storage.

This plan keeps the existing WSI ingest and deck.gl viewer path, adds a dedicated overlay ingestion pipeline for vector and tiled-score overlays, introduces collaborative presence, and adds topbar-accessible operations pages for slide and overlay uploads plus ingestion monitoring.

## Current Gap

The current repo already provides:

- WSI upload, ingestion, derived manifest publication, and deck.gl viewing.
- Viewer-side overlays as read-only JSON-backed resources.
- Annotation layers, annotations, and comments persisted in file-backed JSON stores.
- A viewer workspace with deck.gl rendering, editable annotations, metadata, minimap, scale bar, and draggable panels.

The missing capabilities are:

- first-class `Tag` and `Review` entities
- durable multi-user collaboration presence and cursor sharing
- overlay ingestion instead of manual overlay registration
- support for multiple overlay source formats:
  - GeoJSON
  - GeoParquet
  - JSON tile-grid payloads like the provided `full_result.json`
- a streaming overlay artifact format with LOD, clustering, class/score metadata, and chunked loading
- operations pages for slide upload/monitoring and overlay upload/monitoring
- a storage model that treats S3-compatible object storage as the system of record for durable state

## Inputs Confirmed From The Attached Overlay Example

The provided [full_result.json](</Users/mkaroui/Downloads/full_result.json>) is not plain feature JSON. It contains:

- `slide_grid_config` with grid dimensions, tile dimensions, slide dimensions, level, and MPP
- `heatmaps` with tile-grid coordinates and parallel score arrays
- `max_clusters` serialized as cluster blocks with coordinates, per-cell scores, and predictive flags
- slide-level summary values such as label, score, threshold, and matter statistics

That means the overlay pipeline must support a `tiled-score overlay` class in addition to simple vectors. It should not coerce this payload into naïve flat GeoJSON at ingest time or the viewer will lose the advantages of sparse loading, clustering, and score-aware rendering.

## Principles

- Follow DDD boundaries strictly: `domain` stays framework-free, `application` owns orchestration, `infrastructure` owns S3/MinIO, parquet, websocket, and file-codec details.
- Manifest-last and publication-last remain non-negotiable for both WSI and overlays.
- All durable records must be derivable from S3-like storage only.
- External contracts are versioned and immutable once published.
- Multi-user collaboration state is split into:
  - durable review state in object storage
  - ephemeral presence state in websocket/process memory
- Every new module must declare purpose, owner context, invariants, and failure modes.

## Bounded Contexts And Ownership

### Identity & Catalog

Owns:

- `Slide`
- `SlideVersion`
- `OverlaySet`
- `OverlayVersion`
- `Tag`
- `IngestionJob`
- `OverlayIngestionJob`

Public interfaces:

- `POST /uploads/initiate`
- `POST /uploads/complete`
- `POST /overlay-uploads/initiate`
- `POST /overlay-uploads/complete`
- `GET /slides`
- `GET /slides/{slideId}`
- `GET /slides/{slideId}/tags`
- `PUT /slides/{slideId}/tags`

### WSI Ingestion

Owns:

- original slide ingestion
- pyramid generation
- tile groups
- tile indexes
- manifest publication

No contract change other than catalog links and operations reporting.

### Overlay Ingestion

Owns:

- overlay source parsing
- overlay normalization
- overlay chunking/planning
- overlay LOD summaries
- clustering artifacts
- overlay manifest publication

Input formats:

- `geojson`
- `geoparquet`
- `tile-grid-json`

Derived artifact outputs:

- overlay manifest
- per-layer summaries
- class legend
- chunk index
- vector or score chunks
- optional cluster-summary chunks

### Review & Collaboration

Owns:

- `AnnotationLayer`
- `Annotation`
- `Comment`
- `Review`
- `PresenceSession`
- `SharedCursor`
- `SharedViewport`

Public interfaces:

- annotation and comment endpoints
- review endpoints
- websocket presence channel

### Delivery

Owns:

- immutable object path generation
- public proxy mapping
- cache policy
- signed access seam if needed later

### Operations Workspace

Owns:

- upload pages
- ingestion monitoring tables
- status polling
- operational filtering and drilldown

This is a frontend context backed by catalog/job APIs, not a separate business domain.

## Persistent Storage Model In S3-Compatible Storage

Durable state must live as versioned objects. Recommended layout:

```text
s3://app-root/
  catalog/
    slides.json
    slide/{slideId}.json
    jobs/{jobId}.json
    overlay-jobs/{jobId}.json
  review/
    slides/{slideId}/layers.json
    slides/{slideId}/annotations.json
    slides/{slideId}/comments.json
    slides/{slideId}/reviews.json
    slides/{slideId}/tags.json
  raw/
    slides/{slideId}/{versionId}/original
    overlays/{slideId}/{overlaySetId}/{versionId}/source
  derived/
    wsi/v1/{slideId}/{versionId}/...
    overlays/v1/{slideId}/{overlaySetId}/{versionId}/manifest.json
    overlays/v1/{slideId}/{overlaySetId}/{versionId}/index.bin
    overlays/v1/{slideId}/{overlaySetId}/{versionId}/chunks/{chunkId}.bin
    overlays/v1/{slideId}/{overlaySetId}/{versionId}/clusters/{clusterId}.bin
  audit/
    events/{yyyy}/{mm}/{dd}/...
```

Rules:

- no bucket listing in runtime request paths
- all externally visible paths are deterministic
- mutable pointers stay in catalog objects only
- derived artifacts are immutable and versioned
- review JSON documents use optimistic replace semantics with ETag or version fields

## Overlay Artifact Contract

### Overlay manifest

Introduce `overlay-manifest-v1`:

```json
{
  "schema": "overlay-manifest-v1",
  "slideId": "cmu-1-svs",
  "overlaySetId": "tls-heatmap",
  "versionId": "v1",
  "kind": "tiled-score",
  "coordinateSpace": {
    "origin": "top-left",
    "unit": "level-0-pixel"
  },
  "sourceFormat": "tile-grid-json",
  "grid": {
    "level": 16,
    "tileWidth": 224,
    "tileHeight": 224,
    "gridWidth": 48552,
    "gridHeight": 24985,
    "slideWidth": 97103,
    "slideHeight": 49969,
    "mpp": 0.5
  },
  "classes": [
    {
      "id": "tls",
      "label": "TLS",
      "scoreKey": "score",
      "palette": "viridis"
    }
  ],
  "lods": [
    {
      "level": 0,
      "chunkIndexPath": ".../lods/0/index.bin",
      "clusterIndexPath": ".../lods/0/clusters.bin"
    }
  ],
  "summary": {
    "label": "Presence of TLS",
    "score": 0.5667,
    "threshold": 0.5
  }
}
```

### Chunk format families

Supported families:

- `vector-chunk`
  - polygons, polylines, points
- `score-grid-chunk`
  - sparse tile coordinates
  - per-cell scores
  - per-cell flags
- `cluster-summary-chunk`
  - cluster block bounds
  - aggregate stats
  - preview geometry

### Viewer contract

The viewer should resolve:

- visible overlay chunks by viewport + zoom
- cluster summaries at low zoom
- raw cells/features at higher zoom
- styling metadata from manifest class definitions

The overlay viewer should not need the entire overlay payload in memory.

## Domain Model Extensions

### New entities

- `OverlaySet`: logical overlay identity attached to a slide
- `OverlayVersion`: immutable source upload plus derived overlay artifacts
- `Tag`: lightweight slide tag attached to slide identity
- `Review`: annotation review state with status, author, note, timestamps
- `PresenceSession`: ephemeral collaborator session keyed by user and slide

### Relationship rules

- a `Slide` may have many `OverlaySet`
- a `Slide` may have many `Tag`
- an `AnnotationLayer` belongs to one `Slide`
- an `Annotation` belongs to one `AnnotationLayer`
- a `Comment` belongs to one `Annotation`
- a `Review` belongs to one `Annotation`
- overlay features are separate from review persistence
- presence state is never stored inside annotation documents

## Implementation Phases

### Phase 1: Catalog And Domain Expansion

Result:

- extend glossary, context map, and contracts for `OverlaySet`, `OverlayVersion`, `Tag`, `Review`, and `PresenceSession`
- add S3-backed repositories for tags and reviews
- add object-store document versioning strategy for JSON documents

Timing:

- `3 days`

Metrics:

- `100%` new payloads schema-validated
- zero cross-context direct file access outside repository abstractions
- all durable entities reload correctly from object storage on process restart

Tests:

- repository roundtrip tests for tags, reviews, overlay versions
- optimistic replace/version conflict tests
- OpenAPI generation and schema validation tests

Playbook:

- repository interface first
- object-store layout documented before code
- no route-local persistence logic

### Phase 2: Overlay Ingestion Contracts And Artifact Specs

Result:

- `overlay-manifest-v1`
- binary or compact JSON index spec for overlay chunk lookup
- documented source adapters for:
  - GeoJSON
  - GeoParquet
  - tile-grid JSON
- provenance and class/score semantics documented

Timing:

- `3 days`

Metrics:

- one canonical normalized coordinate contract
- zero ambiguous score/class field names in review
- attachment example payload from `full_result.json` represented losslessly

Tests:

- contract golden tests
- normalization tests for each source format
- sample `full_result.json` adapter fixture test

Playbook:

- write contracts first
- publish example fixture files under tests
- document failure modes for malformed or partial overlay uploads

### Phase 3: Overlay Ingestion Worker

Result:

- async overlay ingestion jobs
- source upload completion endpoint
- adapter pipeline:
  - parse source
  - normalize coordinates
  - derive class legend
  - build chunk indexes
  - build cluster summaries
  - publish overlay manifest last

Timing:

- `6 days`

Metrics:

- pilot overlay ingestion `< 5 min` for representative GeoParquet and tile-grid payloads
- worker RSS `< 2.5 GB` for representative overlays
- no published manifest on failed overlay ingest
- sparse tile-grid overlays preserve score fidelity `100%` against source fixture

Tests:

- idempotent retry test
- unsupported format test
- malformed chunk rejection test
- golden manifest/index/chunk tests
- score-grid roundtrip test using attached JSON fixture

Playbook:

- staging prefix first, publication last
- provenance on every derived artifact
- chunk planner isolated behind application service

### Phase 4: Overlay Delivery And Viewer Streaming

Result:

- overlay list/detail endpoints backed by overlay manifests rather than static JSON
- chunk fetch endpoints or direct derived object access
- viewer overlay client with viewport-aware chunk planner
- low-zoom cluster rendering, high-zoom raw feature/cell rendering

Timing:

- `5 days`

Metrics:

- first overlay paint `< 1 s` after base slide ready for representative overlays
- visible overlay chunk overfetch `< 15%`
- no full-overlay download for chunked overlays
- overlay memory budget `< 250 MB` in representative sessions

Tests:

- chunk planner unit tests
- LOD selection tests
- tile-grid score rendering tests
- class legend/style binding tests
- chunk cache eviction tests

Playbook:

- overlay fetch logic separate from deck.gl layer composition
- cluster and raw render paths tested independently
- no viewer component directly parses raw source upload formats

### Phase 5: Review, Tags, And Annotation Relationships

Result:

- slide tags UI and persistence
- annotation reviews with status, reviewer, note, timestamp
- comment reply/delete preserved
- tags and reviews visible in workspace and operations pages

Timing:

- `3 days`

Metrics:

- `100%` review actions traceable to user and slide
- tag add/remove p95 `< 200 ms`
- annotation review update p95 `< 300 ms`

Tests:

- tag CRUD tests
- review CRUD and status transition tests
- annotation-to-review relationship tests

Playbook:

- tags stay attached to slide, not viewer session
- reviews stay attached to annotation, not comments

### Phase 6: Live Presence And Cursor Sharing

Result:

- websocket presence service
- live shared cursor position
- live shared viewport state:
  - zoom
  - center
  - optional rotation
- collaborator indicators in viewer

Timing:

- `4 days`

Metrics:

- presence broadcast latency p95 `< 150 ms` on local/pilot setup
- stale session cleanup `< 30 s`
- reconnect recovery `< 5 s`

Tests:

- websocket session join/leave tests
- heartbeat expiry tests
- shared cursor payload validation tests
- viewer presence rendering regression tests

Playbook:

- presence is ephemeral and not stored as durable review state
- correlation ids in websocket logs
- input throttling on cursor updates

### Phase 7: Operations Workspace For Slide Upload And Monitoring

Result:

- topbar route for slide operations page
- slide upload workflow with multipart initiation/completion
- jobs table with:
  - slide id
  - version
  - status
  - stage
  - progress
  - reader backend
  - metadata backend
  - ingestion timing
  - artifact links

Timing:

- `4 days`

Metrics:

- job table refresh p95 `< 400 ms`
- progress visibility for `100%` active jobs
- upload completion acknowledgment `< 500 ms`

Tests:

- upload form integration tests
- job status polling tests
- progress formatting tests
- row action/accessibility tests

Playbook:

- no operational state hidden only in browser memory
- all displayed job data sourced from API contracts

### Phase 8: Operations Workspace For Overlay Upload And Monitoring

Result:

- topbar route for overlay operations page
- overlay upload form with source format selection
- format-specific validation hints
- overlay jobs table with:
  - slide
  - overlay set
  - source format
  - job status
  - stage
  - timing
  - output manifest link

Timing:

- `4 days`

Metrics:

- source validation feedback `< 300 ms` for local file metadata checks
- `100%` overlay jobs visible in monitoring table
- overlay upload completion endpoint retry-safe

Tests:

- upload form tests for GeoJSON, GeoParquet, tile-grid JSON
- malformed upload validation tests
- job polling and status transition tests

Playbook:

- format sniffing isolated from controllers
- upload UI never assumes full file can be parsed in browser

### Phase 9: S3-Native Hardening And Acceptance

Result:

- replace remaining local durable assumptions with object-store-backed repositories
- ETag or object-version-aware write strategy
- object-store runbook and backup/restore validation
- final benchmark and acceptance report

Timing:

- `4 days`

Metrics:

- restart recovery from object storage `100%`
- no mandatory database dependency
- object-store conflict handling covered for all mutable documents
- end-to-end pilot acceptance pass green

Tests:

- MinIO integration suite
- concurrent write conflict tests
- cold restart recovery test
- end-to-end upload -> ingest -> review -> overlay -> collaboration scenario

Playbook:

- persist only durable truth in object storage
- treat process memory and websockets as disposable runtime state

## API Additions

### Slide and tag APIs

- `GET /slides`
- `GET /slides/{slideId}`
- `GET /slides/{slideId}/tags`
- `PUT /slides/{slideId}/tags`

### Overlay upload and monitoring APIs

- `POST /overlay-uploads/initiate`
- `POST /overlay-uploads/complete`
- `GET /overlay-jobs/{jobId}`
- `GET /slides/{slideId}/overlays`
- `GET /slides/{slideId}/overlays/{overlayId}`
- `GET /slides/{slideId}/overlays/{overlayId}/manifest`
- `GET /slides/{slideId}/overlays/{overlayId}/chunks?...`

### Review APIs

- `GET /slides/{slideId}/annotations/{annotationId}/reviews`
- `PUT /slides/{slideId}/annotations/{annotationId}/reviews/{reviewId}`

### Presence APIs

- `WS /slides/{slideId}/presence`

## Frontend Routing Plan

Topbar should expose three durable workspace routes:

- `/viewer/:slideId`
- `/operations/slides`
- `/operations/overlays`

Viewer route:

- WSI, overlays, annotations, comments, reviews, tags, presence

Slide operations route:

- upload slides
- monitor WSI ingestion jobs

Overlay operations route:

- upload overlays
- monitor overlay ingestion jobs

## Recommended Implementation Details

### Overlay input adapters

- `GeoJSON`
  - parse features directly
  - normalize to image-space coordinates
- `GeoParquet`
  - read parquet metadata and geometry columns
  - project/normalize before chunking
- `tile-grid-json`
  - preserve grid semantics
  - chunk sparse coordinates and score arrays by viewport-relevant block
  - derive cluster summaries for low zoom

### Object-store repositories

Use append-safe or replace-safe repository adapters with:

- read current object
- validate version or ETag
- merge or replace through application service
- write new object atomically from the application point of view

### Presence transport

Use websocket hub with:

- per-slide room
- heartbeat
- throttled cursor broadcast
- viewport update throttling
- optional future server fanout via object-store-backed pub/sub replacement seam if scaling beyond one node

## Performance Targets

- slide ingest remains within current pilot targets
- overlay ingest for representative tile-grid JSON `< 5 min`
- viewer first useful WSI render `< 2 s`
- overlay first paint `< 1 s` after overlay selection
- annotation save p95 `< 300 ms`
- review action p95 `< 300 ms`
- presence latency p95 `< 150 ms`
- job table refresh p95 `< 400 ms`

## Test Strategy

### Unit

- overlay source adapters
- chunk index encoding/decoding
- cluster planner
- tag and review validators
- presence payload validation
- S3 repository optimistic write behavior

### Integration

- overlay upload completion -> job enqueue -> worker -> manifest publish
- slide upload completion -> WSI worker -> manifest publish
- annotation + review persistence through object-store repositories
- websocket presence join/broadcast/leave

### End-to-end

- upload slide, ingest, open viewer
- upload overlay, ingest, stream overlay at multiple zoom levels
- create annotation, add comment, add review
- connect second user, see shared cursor and viewport
- restart services, verify durable state still available from object storage

## ADR Follow-Ups

Add or update:

- `ADR-002`: S3-compatible storage as the durable system of record
- `ADR-003`: overlay-manifest-v1 and chunked overlay delivery
- `ADR-004`: collaboration presence split between durable review state and ephemeral websocket state
- `ADR-005`: operations workspace routes and monitoring model

## Sequencing Recommendation

Implement in this order:

1. catalog/domain expansion
2. overlay contracts and artifact specs
3. overlay ingestion worker
4. overlay delivery and viewer streaming
5. review and tags
6. slide and overlay operations pages
7. live presence
8. S3-native hardening and acceptance

Reason:

- overlay contract decisions constrain both worker and viewer
- operations pages depend on stable job APIs
- presence should be added after durable review state and viewer routing are stable

## Expected Outcome

At the end of this plan, the system will support:

- S3-native deployment with MinIO or S3 as durable persistence
- WSI upload, ingestion, monitoring, and viewing
- overlay upload, ingestion, monitoring, and streaming
- slide tags
- annotation layers, annotations, comments, and reviews
- live cursor and viewport sharing
- a topbar that routes between the viewer and both operations pages

without introducing a mandatory database dependency.
