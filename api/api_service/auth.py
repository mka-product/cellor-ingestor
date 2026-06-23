from __future__ import annotations

import os

import httpx
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_JWKS_URL: str = os.environ.get("SUPABASE_JWKS_URL", "")
_jwks_cache: dict = {}


def _load_jwks() -> dict:
    global _jwks_cache
    if _jwks_cache:
        return _jwks_cache
    response = httpx.get(_JWKS_URL, timeout=10)
    response.raise_for_status()
    _jwks_cache = response.json()
    return _jwks_cache


def verify_token(token: str | None) -> dict:
    if not _JWKS_URL:
        # Dev mode: no JWKS configured, skip verification
        return {"sub": "dev-user", "email": "dev@local"}
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        jwks = _load_jwks()
        header = jwt.get_unverified_header(token)
        key_data = next((k for k in jwks["keys"] if k.get("kid") == header.get("kid")), None)
        if not key_data:
            raise ValueError("unknown signing key")
        public_key = jwt.algorithms.RSAAlgorithm.from_jwk(key_data)
        return jwt.decode(token, public_key, algorithms=["RS256"], options={"verify_aud": False})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc


_bearer = HTTPBearer(auto_error=False)


def require_auth(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    return verify_token(credentials.credentials if credentials else None)
