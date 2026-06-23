from __future__ import annotations

import logging
import os

import httpx
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger("cellor.auth")

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
        jwt_kid = header.get("kid")
        jwt_alg = header.get("alg", "RS256")
        key_data = next((k for k in jwks.get("keys", []) if k.get("kid") == jwt_kid), None)
        if not key_data:
            available = [k.get("kid") for k in jwks.get("keys", [])]
            raise ValueError(f"no matching key: jwt_kid={jwt_kid!r} alg={jwt_alg!r} jwks_kids={available}")
        kty = key_data.get("kty", "RSA")
        if kty == "EC":
            public_key = jwt.algorithms.ECAlgorithm.from_jwk(key_data)
        else:
            public_key = jwt.algorithms.RSAAlgorithm.from_jwk(key_data)
        return jwt.decode(token, public_key, algorithms=[jwt_alg], options={"verify_aud": False})
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("token verify failed: %s", exc)
        raise HTTPException(status_code=401, detail="Invalid token") from exc


_bearer = HTTPBearer(auto_error=False)


def require_auth(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    return verify_token(credentials.credentials if credentials else None)
