# ADR-001: End-to-End WSI MVP Architecture

## Status

Accepted

## Decision

Use a monorepo with three deployable applications:

- FastAPI API service
- Python ingestion worker
- React + TypeScript web viewer

The system uses DDD layering inside each Python service and typed contracts between services and the viewer.

## Rationale

- Python offers the strongest ecosystem for WSI readers and image processing.
- FastAPI gives typed request and response contracts with OpenAPI generation.
- React + TypeScript + deck.gl provides a tractable path to a custom tile streaming viewer.
- Monorepo structure keeps contracts, docs, and verification close to implementation.

## Consequences

- Shared contracts must remain explicit JSON schema or typed model boundaries rather than implicit imports across runtimes.
- Worker publication is manifest-last to avoid mixed-version reads.
- Binary tile index format is fixed and documented before ingestion logic expands.
