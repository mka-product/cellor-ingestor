from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
import threading
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger("cellor.auth")

_JWT_SECRET: str = os.environ.get("JWT_SECRET_KEY", "")
_JWT_ALGORITHM = "HS256"
_TOKEN_LIFETIME_DAYS = 30
_USERS_URI = "auth/users.json"


def _secret() -> str:
    if not _JWT_SECRET:
        logger.warning("JWT_SECRET_KEY not set — using ephemeral key; sessions will not survive restarts")
        return "cellor-dev-ephemeral"
    return _JWT_SECRET


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000)
    return f"pbkdf2:sha256:200000:{salt}:{dk.hex()}"


def verify_password(password: str, hashed: str) -> bool:
    try:
        _, algo, iters, salt, dk_stored = hashed.split(":")
        dk = hashlib.pbkdf2_hmac(algo, password.encode(), salt.encode(), int(iters))
        return hmac.compare_digest(dk.hex(), dk_stored)
    except Exception:
        return False


def create_token(claims: dict[str, Any]) -> str:
    payload = {
        **claims,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(days=_TOKEN_LIFETIME_DAYS),
    }
    return jwt.encode(payload, _secret(), algorithm=_JWT_ALGORITHM)


def verify_token(token: str | None) -> dict[str, Any]:
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        return jwt.decode(token, _secret(), algorithms=[_JWT_ALGORITHM])
    except Exception as exc:
        logger.warning("token verify failed: %s", exc)
        raise HTTPException(status_code=401, detail="Invalid token") from exc


_bearer = HTTPBearer(auto_error=False)


def require_auth(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    return verify_token(credentials.credentials if credentials else None)


class UserStore:
    def __init__(self, proxy: Any) -> None:
        self._proxy = proxy
        self._lock = threading.Lock()

    def _read(self) -> dict[str, Any]:
        return self._proxy.load_json_or_default(_USERS_URI, {"users": {}})

    def _write(self, data: dict[str, Any]) -> None:
        self._proxy.put_json(_USERS_URI, data)

    def get_by_email(self, email: str) -> dict[str, Any] | None:
        return self._read()["users"].get(email)

    def create(self, email: str, hashed_password: str, first_name: str, last_name: str) -> dict[str, Any]:
        with self._lock:
            data = self._read()
            if email in data["users"]:
                raise ValueError("email already registered")
            user: dict[str, Any] = {
                "id": str(uuid.uuid4()),
                "email": email,
                "hashed_password": hashed_password,
                "first_name": first_name,
                "last_name": last_name,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            data["users"][email] = user
            self._write(data)
            return user
