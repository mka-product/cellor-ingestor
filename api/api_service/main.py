"""Purpose: API application entrypoint.
Owner context: Identity & Catalog and Delivery.
Invariants: app startup is side-effect light and dependency wiring is explicit.
Failure modes: import or dependency composition failures abort startup.
"""

from __future__ import annotations

import os
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.api_service.infrastructure.bootstrap import Container
from api.api_service.infrastructure.ingestion_runtime import InProcessIngestionRuntime
from api.api_service.infrastructure.overlay_runtime import InProcessOverlayIngestionRuntime
from api.api_service.interfaces.http.routes import router
from api.api_service.observability.logging import configure_logging

configure_logging()
container = Container()
ingestion_runtime = InProcessIngestionRuntime(container)
overlay_ingestion_runtime = InProcessOverlayIngestionRuntime(container)

app = FastAPI(title="Cellor Ingestor API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.on_event("startup")
def start_ingestion_runtime() -> None:
    if "pytest" in sys.modules:
        return
    if os.environ.get("ENABLE_IN_PROCESS_INGESTION", "true").lower() != "true":
        return
    ingestion_runtime.start()
    overlay_ingestion_runtime.start()


@app.on_event("shutdown")
def stop_ingestion_runtime() -> None:
    ingestion_runtime.stop()
    overlay_ingestion_runtime.stop()
