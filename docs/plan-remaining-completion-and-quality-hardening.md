# Remaining Completion And Quality Hardening Plan

## Summary

This plan closes the remaining gap between the current MVP state and the target architecture already defined in [docs/plan-s3-native-collaboration-and-overlay-ingestion.md](/Users/mkaroui/cellor-ingestor/docs/plan-s3-native-collaboration-and-overlay-ingestion.md).

The current system already provides:

- WSI upload and ingestion
- deck.gl viewer workspace
- manual annotations, comments, tags, and reviews
- overlay upload for `geojson`, `geoparquet`, `tile-grid-json`, and placeholder `ovsi`
- overlay manifest and chunk endpoints
- viewport-aware overlay chunk loading with bounded cache
- local operations pages
- ephemeral websocket cursor presence

The remaining work is concentrated in five areas:

1. true S3-native durable persistence
2. real OVSI and OVSIP artifact generation and runtime loading
3. collaboration hardening beyond local cursor presence
4. operations and observability hardening
5. full local verification with frontend build, automated browser flows, and performance baselines

This plan follows the project playbooks:

- DDD layers remain strict
- contracts are explicit and versioned
- infrastructure is isolated behind ports
- every module declares purpose, owner context, invariants, and failure modes
- tests cover invariants, recovery, and performance-sensitive paths before merge

## Quality Targets

Current internal review scores:

- architecture and separation of concerns: `82/100`
- code maintainability: `76/100`
- correctness confidence: `72/100`
- test coverage confidence: `68/100`
- production readiness against plan: `61/100`
- overall: `72/100`

Target scores after this plan:

- architecture and separation of concerns: `90/100`
- code maintainability: `86/100`
- correctness confidence: `85/100`
- test coverage confidence: `84/100`
- production readiness against plan: `82/100`
- overall: `85/100`

## Remaining Gap

### 1. Durable persistence is still local-file backed

Current state:

- review, tags, comments, overlays, and catalog jobs are still persisted through local JSON files in API infrastructure
- this does not fully satisfy the object-storage-only persistence model from the main plan

Required outcome:

- all durable entities must be reconstructible from S3-compatible storage such as S3 or MinIO
- local file persistence may remain only as a dev-only adapter if explicitly configured

### 2. OVSI support is only partial

Current state:

- the repo understands `ovsi` as a source format and exposes `overlay-manifest-v1`
- delivery currently uses API chunk endpoints over normalized feature payloads
- there is no true `.ovsi` byte-range reader
- there is no true `.ovsip` package builder with `ovsim`, `ovsii`, `ovsib`, and `ovsis`

Required outcome:

- small overlays can publish immutable single-file `.ovsi`
- large overlays can publish immutable `.ovsip` packages
- the viewer can consume those artifacts through a dedicated overlay runtime client

### 3. Collaboration is only partially implemented

Current state:

- live cursor presence works through a process-local websocket room
- viewport sharing is not implemented
- multi-instance coordination is not implemented
- presence lifecycle, throttling, and stale-session handling are still weak

Required outcome:

- shared cursor and shared viewport state
- reconnect-safe and heartbeat-aware presence behavior
- collaboration model that still keeps presence ephemeral while durable review state remains in object storage

### 4. Operations and observability are still thin

Current state:

- operations pages exist
- job listing exists
- upload and overlay upload flows exist
- there is limited provenance drilldown, weak failure taxonomy exposure, and no serious operational dashboards

Required outcome:

- better monitoring pages and API responses
- structured metrics for overlay chunk loading, cache hit and miss behavior, ingestion timing, and job failures
- supportable local and pilot operations workflow

### 5. Local verification is incomplete

Current state:

- backend tests pass
- frontend runtime features were validated interactively but not fully formalized in automated browser coverage
- frontend build and test were not executed from the earlier review environment

Required outcome:

- reliable local `npm test`, `npm run build`, backend tests, and browser-driven end-to-end flows
- repeatable local smoke suite for viewer, uploads, overlays, annotations, and presence

## Implementation Phases

### Phase 1. S3-native repository migration

Goal:

- replace local JSON durable adapters with object-storage-backed repositories while preserving ports and application services

Implementation:

- add `S3CatalogRepository`, `S3ReviewRepository`, `S3OverlayRepository`, and `S3AuditRepository` under `api/api_service/infrastructure/`
- keep current file repositories only as local fallback adapters selected by config
- store slide catalog, jobs, tags, reviews, comments, annotation layers, and annotation features in deterministic object paths
- add optimistic replace semantics using object version or explicit revision fields
- ensure write paths are atomic from the application point of view
- keep infrastructure details fully hidden behind existing repository ports

Expected result:

- all durable state required by the main plan is stored in S3-like storage
- local file persistence becomes optional and clearly marked as dev-only

Metrics:

- `100%` of durable entities persisted through object-store adapter in MinIO local deployment
- optimistic conflict coverage on all mutable review documents
- no runtime bucket listing in request paths

Tests:

- repository roundtrip tests against MinIO
- optimistic write conflict tests
- restart and rehydrate tests proving persistence survives API restart
- migration parity tests between file adapter and object-store adapter

Timing:

- `4 days`

### Phase 2. OVSI and OVSIP writer pipeline

Goal:

- implement real delivery artifact generation instead of only normalized feature chunks returned by the API

Implementation:

- define internal writer modules:
  - `ovsi_writer.py`
  - `ovsip_writer.py`
  - `ovsi_index.py`
  - `ovsi_manifest.py`
- convert overlay ingest outputs into:
  - single-file `.ovsi` for smaller overlays
  - `.ovsip` package for larger overlays
- write `ovsim`, `ovsii`, `ovsib`, and `ovsis`
- preserve `overlay-manifest-v1` as the stable external contract
- store generated artifacts under deterministic immutable derived paths
- publish overlay manifest last

Expected result:

- uploaded overlays produce canonical immutable runtime artifacts
- the API serves manifests and artifact paths rather than remaining the only chunk source

Metrics:

- `100%` manifest-to-artifact path consistency
- no published manifest on failed overlay ingest
- representative tile-grid JSON overlay ingest `< 5 min`
- worker RSS `< 2.5 GB` for representative overlay generation

Tests:

- golden artifact structure tests for `.ovsi` and `.ovsip`
- index lookup tests
- manifest-last publication tests
- malformed overlay source rejection tests

Timing:

- `5 days`

### Phase 3. Viewer overlay runtime client

Goal:

- move the viewer from API-normalized chunk loading toward true OVSI semantics

Implementation:

- create frontend overlay runtime modules under `web/src/viewer/`:
  - `ovsiClient.ts`
  - `ovsiPlanner.ts`
  - `ovsiLoader.ts`
  - `ovsiCache.ts`
- support:
  - viewport-aware block planning
  - request coalescing
  - LOD-aware block selection
  - cluster-summary loading for lower zooms
  - score and class metadata retention
- keep existing `overlay-manifest-v1` as the only stable external contract
- preserve inline and API-chunk fallback for development and migration safety

Expected result:

- viewer consumes overlay runtime artifacts directly and efficiently
- large overlays no longer depend on the API returning full feature payloads for interactive viewing

Metrics:

- overlay viewport update response p95 `< 250 ms` locally after warm cache
- overlay block cache hit ratio `>= 75%` during repeated pan loops
- no full-overlay memory residency required for representative large overlays

Tests:

- planner unit tests
- block selection correctness tests
- request coalescing tests
- overlay cache hit and eviction tests
- viewer regression tests for chunked overlay rendering

Timing:

- `4 days`

### Phase 4. Collaboration hardening

Goal:

- complete the collaboration model with viewport sharing and resilient presence behavior

Implementation:

- extend websocket payloads to carry:
  - cursor position
  - zoom level
  - viewport center or bounds
  - client timestamp
- add throttling and heartbeat semantics
- add stale-session expiry
- make presence adapter pluggable so local in-memory transport can later be swapped for Redis or another shared ephemeral bus if needed
- render remote viewport indicators in the viewer workspace
- keep collaboration state explicitly separated from durable review state

Expected result:

- multiple users can share both cursor and viewport awareness
- reconnects and abandoned sessions no longer leave stale ghost participants

Metrics:

- presence latency p95 `< 150 ms` on local MinIO/docker setup
- stale session cleanup `< 15 s`
- zero durable writes for ephemeral presence updates

Tests:

- websocket join, heartbeat, broadcast, and leave tests
- stale session expiry tests
- browser multi-context cursor and viewport sharing tests

Timing:

- `3 days`

### Phase 5. Operations and observability hardening

Goal:

- make uploads, overlays, and runtime behavior operable and diagnosable

Implementation:

- expand operations pages to show:
  - job stage
  - duration
  - artifact counts
  - source format
  - runtime format
  - failure reason
  - provenance and version metadata
- expose overlay runtime metrics:
  - manifest loads
  - block loads
  - cache hits and misses
  - visible block count
- add structured log fields for slide id, overlay id, job id, version id, and correlation id
- document local runbooks for:
  - failed slide ingest
  - failed overlay ingest
  - viewer overlay loading failure
  - websocket presence failure

Expected result:

- developers and operators can understand where failures happen and what artifacts were produced

Metrics:

- `100%` job records expose stage and timing fields
- `100%` runtime logs include correlation identifiers
- local troubleshooting path documented for all primary failure classes

Tests:

- contract tests for new job payload fields
- log field contract tests
- browser smoke tests for operations pages

Timing:

- `3 days`

### Phase 6. Code-quality refactor and boundary cleanup

Goal:

- improve maintainability and raise the code-quality score without changing public behavior

Implementation:

- split remaining large viewer modules, especially:
  - `ViewerWorkspace.tsx`
  - overlay runtime wiring
  - presence wiring
  - operations page data orchestration
- extract dedicated hooks and helpers:
  - `useOverlayRuntime`
  - `usePresenceChannel`
  - `useOperationsPolling`
- keep DDD boundaries explicit:
  - `domain/` contract-only
  - `viewer/` client interaction and runtime logic
  - `infrastructure/` transport and persistence
  - UI components declarative and thin
- add missing module docstrings to all new helpers

Expected result:

- viewer and API code become easier to reason about, test, and extend

Metrics:

- `ViewerWorkspace.tsx` reduced substantially in orchestration complexity
- no new mixed-concern modules introduced
- review findings for boundary leakage reduced to zero

Tests:

- no direct business-logic-in-component regressions
- hook-level unit tests for extracted runtime logic

Timing:

- `3 days`

### Phase 7. Full local verification and score-raising gate

Goal:

- convert the current partial confidence into a measurable acceptance gate

Implementation:

- run and keep green:
  - backend tests
  - frontend unit tests
  - frontend production build
  - end-to-end smoke tests with Playwright
- add Playwright coverage for:
  - open viewer
  - search and open slide
  - create annotation
  - add comment and review
  - upload overlay
  - render overlay
  - open second browser context and verify cursor and viewport sharing
  - open operations pages and verify job visibility
- maintain a local test fixture set under deterministic paths

Expected result:

- local verification becomes repeatable and can be used as a release gate

Metrics:

- `100%` local acceptance suite green before merge
- browser smoke suite runtime `< 10 min`
- no unresolved critical browser-console errors in acceptance flows

Tests:

- Playwright suite
- build verification
- MinIO-backed local integration run

Timing:

- `2 days`

## Recommended Execution Order

1. S3-native repository migration
2. OVSI and OVSIP writer pipeline
3. Viewer overlay runtime client
4. Collaboration hardening
5. Operations and observability hardening
6. Code-quality refactor and boundary cleanup
7. Full local verification and score-raising gate

Reasoning:

- persistence and artifact generation define the real runtime seam
- viewer runtime should consume the canonical artifact format rather than another temporary format
- collaboration and operations hardening are safer after the storage and runtime contracts settle
- final refactor and verification should lock in the architecture rather than predate it

## Local Verification Plan

### Backend

- run `python3 -m pytest api/tests/test_api.py -q`
- add MinIO-backed repository and overlay artifact tests
- add integration tests for object-store persistence and restart recovery

### Frontend

- run `npm install`
- run `npm run test`
- run `npm run build`

### Browser automation

- use Playwright for:
  - viewer smoke
  - annotation workflow
  - overlay upload and render
  - operations pages
  - multi-context collaboration

### Local stack

- run API, worker, web, and MinIO together
- verify both fresh ingest and reload-from-storage behavior

## Acceptance Gate

The plan is complete only when all of the following are true:

- durable mutable state is stored in S3-compatible storage
- overlay ingest emits canonical immutable runtime artifacts
- viewer consumes manifest-driven overlay runtime with OVSI semantics
- cursor and viewport presence both function locally
- operations pages expose timing, status, and failure visibility
- backend tests, frontend tests, production build, and Playwright smoke all pass locally

## Expected Score Improvement

If all phases are completed and verified:

- architecture and separation of concerns: `90/100`
- code maintainability: `86/100`
- correctness confidence: `85/100`
- test coverage confidence: `84/100`
- production readiness against plan: `82/100`
- overall: `85/100`

## Notes

- The environment used for the earlier automated work did not expose `node` on `PATH`, so frontend build verification could not be executed from that session.
- This plan explicitly includes local browser and build verification so that score improvements are tied to measured outcomes rather than inspection only.
