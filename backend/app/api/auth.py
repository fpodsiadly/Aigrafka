from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token as google_id_token

from app.core.config import get_settings
from app.core.db import (
    add_tokens,
    create_user_with_credentials,
    get_or_create_user_by_email,
    get_user_by_id,
    get_user_with_credentials_by_email,
)
from app.core.security import create_access_token, get_current_user_id, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    password: str = Field(..., min_length=6, max_length=128)


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    password: str = Field(..., min_length=6, max_length=128)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    email: str
    tokens: int


class MeResponse(BaseModel):
    user_id: str
    email: str
    tokens: int


class TopupRequest(BaseModel):
    amount: int = Field(..., ge=1, le=10000)


class GoogleAuthRequest(BaseModel):
    id_token: str = Field(..., min_length=20)


class GoogleClientIdResponse(BaseModel):
    enabled: bool
    client_id: Optional[str] = None


@router.post("/register", response_model=AuthResponse)
def register(body: RegisterRequest) -> AuthResponse:
    if "@" not in body.email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email")

    settings = get_settings()
    password_hash = hash_password(body.password)

    try:
        user = create_user_with_credentials(body.email, password_hash, settings.initial_user_tokens)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already exists") from exc

    token = create_access_token(str(user["id"]), str(user["email"]))
    return AuthResponse(
        access_token=token,
        user_id=str(user["id"]),
        email=str(user["email"]),
        tokens=int(user["tokens"]),
    )


@router.post("/login", response_model=AuthResponse)
def login(body: LoginRequest) -> AuthResponse:
    if "@" not in body.email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email")

    user = get_user_with_credentials_by_email(body.email)
    if not user or not verify_password(body.password, str(user["password_hash"])):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    token = create_access_token(str(user["id"]), str(user["email"]))
    return AuthResponse(
        access_token=token,
        user_id=str(user["id"]),
        email=str(user["email"]),
        tokens=int(user["tokens"]),
    )


@router.get("/me", response_model=MeResponse)
def me(user_id: str = Depends(get_current_user_id)) -> MeResponse:
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return MeResponse(user_id=str(user["id"]), email=str(user["email"]), tokens=int(user["tokens"]))


@router.post("/topup", response_model=MeResponse)
def topup(body: TopupRequest, user_id: str = Depends(get_current_user_id)) -> MeResponse:
    try:
        tokens = add_tokens(user_id, body.amount)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found") from exc

    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    return MeResponse(user_id=str(user["id"]), email=str(user["email"]), tokens=tokens)


@router.get("/google/client-id", response_model=GoogleClientIdResponse)
def get_google_client_id() -> GoogleClientIdResponse:
    settings = get_settings()
    client_id = (settings.google_client_id or "").strip()
    if not client_id:
        return GoogleClientIdResponse(enabled=False, client_id=None)
    return GoogleClientIdResponse(enabled=True, client_id=client_id)


@router.post("/google", response_model=AuthResponse)
def login_with_google(body: GoogleAuthRequest) -> AuthResponse:
    settings = get_settings()
    client_id = (settings.google_client_id or "").strip()
    if not client_id:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google sign-in is not configured")

    try:
        claims = google_id_token.verify_oauth2_token(body.id_token, GoogleRequest(), client_id)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google token") from exc

    email = str(claims.get("email") or "").strip().lower()
    email_verified = bool(claims.get("email_verified"))
    if not email or not email_verified:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google account email is not verified")

    user = get_or_create_user_by_email(email, settings.initial_user_tokens)
    token = create_access_token(str(user["id"]), str(user["email"]))
    return AuthResponse(
        access_token=token,
        user_id=str(user["id"]),
        email=str(user["email"]),
        tokens=int(user["tokens"]),
    )
