from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.api_service.infrastructure.bootstrap import Container

system_router = APIRouter(prefix="/system", tags=["system"])


def get_container() -> Container:
    from api.api_service.main import container
    return container


class StorageConfigRequest(BaseModel):
    endpoint: str
    access_key: str
    secret_key: str = ""
    bucket: str
    secure: bool = True


@system_router.get("/storage")
def storage_status(container: Container = Depends(get_container)) -> dict:
    probe = container.minio_proxy.probe()
    return {
        "endpoint": container._current_endpoint,
        "bucket": container._current_bucket,
        "secure": container._current_secure,
        **probe,
    }


@system_router.post("/storage")
def storage_reconfigure(
    payload: StorageConfigRequest,
    container: Container = Depends(get_container),
) -> dict:
    secret = payload.secret_key or container.settings.minio_secret_key
    try:
        container.reconfigure_storage(payload.endpoint, payload.access_key, secret, payload.bucket, payload.secure)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    probe = container.minio_proxy.probe()
    return {
        "endpoint": container._current_endpoint,
        "bucket": container._current_bucket,
        "secure": container._current_secure,
        **probe,
    }
