"""Purpose: API application entrypoint.
Owner context: Identity & Catalog and Delivery.
Invariants: app startup is side-effect light and dependency wiring is explicit.
Failure modes: import or dependency composition failures abort startup.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from api.api_service.auth import verify_token
from api.api_service.infrastructure.bootstrap import Container
from api.api_service.interfaces.http.routes import router
from api.api_service.observability.logging import configure_logging

configure_logging()
container = Container()

_enable_ingestion = os.environ.get("ENABLE_IN_PROCESS_INGESTION", "true").lower() == "true"
if _enable_ingestion:
    from api.api_service.infrastructure.ingestion_runtime import InProcessIngestionRuntime
    from api.api_service.infrastructure.overlay_runtime import InProcessOverlayIngestionRuntime
    ingestion_runtime = InProcessIngestionRuntime(container)
    overlay_ingestion_runtime = InProcessOverlayIngestionRuntime(container)
else:
    ingestion_runtime = None
    overlay_ingestion_runtime = None

_cors_origins = [o for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o]

app = FastAPI(title="Cellor Ingestor API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
_PROTECTED_PREFIXES = ("/slides", "/uploads", "/overlay-uploads", "/jobs", "/overlay-jobs", "/readers")


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if not any(path.startswith(p) for p in _PROTECTED_PREFIXES):
        return await call_next(request)
    if request.method == "OPTIONS":
        return await call_next(request)
    auth_header = request.headers.get("authorization", "")
    token = auth_header.removeprefix("Bearer ").strip() if auth_header.startswith("Bearer ") else None
    try:
        verify_token(token)
    except Exception:
        return JSONResponse({"detail": "Not authenticated"}, status_code=401)
    return await call_next(request)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


app.include_router(router)

# Serve the built React frontend — mount last so API routes take precedence
_static_dir = os.environ.get("STATIC_DIR", "")
if _static_dir and Path(_static_dir).exists():
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="static")


@app.on_event("startup")
def start_ingestion_runtime() -> None:
    if "pytest" in sys.modules:
        return
    if ingestion_runtime is not None:
        ingestion_runtime.start()
    if overlay_ingestion_runtime is not None:
        overlay_ingestion_runtime.start()


@app.on_event("shutdown")
def stop_ingestion_runtime() -> None:
    if ingestion_runtime is not None:
        ingestion_runtime.stop()
    if overlay_ingestion_runtime is not None:
        overlay_ingestion_runtime.stop()
