from __future__ import annotations

from fastapi import APIRouter, Depends, Form, HTTPException
from pydantic import BaseModel

from api.api_service.auth import (
    UserStore,
    create_token,
    hash_password,
    require_auth,
    verify_password,
)
from api.api_service.infrastructure.bootstrap import Container

auth_router = APIRouter(prefix="/auth", tags=["auth"])


def get_container() -> Container:
    from api.api_service.main import container
    return container


class SignupRequest(BaseModel):
    email: str
    password: str
    first_name: str
    last_name: str


class UserResponse(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


def _token_for(user: dict) -> str:
    return create_token({
        "sub": user["email"],
        "user_id": user["id"],
        "email": user["email"],
        "first_name": user["first_name"],
        "last_name": user["last_name"],
    })


def _user_response(user: dict) -> UserResponse:
    return UserResponse(id=user["id"], email=user["email"], first_name=user["first_name"], last_name=user["last_name"])


@auth_router.post("/signup", response_model=AuthResponse, status_code=201)
def signup(payload: SignupRequest, container: Container = Depends(get_container)) -> AuthResponse:
    if len(payload.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    store: UserStore = container.user_store
    try:
        user = store.create(
            email=payload.email.lower().strip(),
            hashed_password=hash_password(payload.password),
            first_name=payload.first_name.strip(),
            last_name=payload.last_name.strip(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return AuthResponse(access_token=_token_for(user), user=_user_response(user))


@auth_router.post("/token", response_model=AuthResponse)
def login(
    username: str = Form(...),
    password: str = Form(...),
    container: Container = Depends(get_container),
) -> AuthResponse:
    store: UserStore = container.user_store
    user = store.get_by_email(username.lower().strip())
    if not user or not verify_password(password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return AuthResponse(access_token=_token_for(user), user=_user_response(user))


@auth_router.get("/me", response_model=UserResponse)
def me(claims: dict = Depends(require_auth)) -> UserResponse:
    return UserResponse(
        id=claims.get("user_id", ""),
        email=claims.get("email", ""),
        first_name=claims.get("first_name", ""),
        last_name=claims.get("last_name", ""),
    )
