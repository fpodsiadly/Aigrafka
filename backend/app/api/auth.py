from collections import defaultdict, deque
from threading import Lock
from time import monotonic
from typing import Deque, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
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

_RATE_LIMIT_BUCKETS: Dict[str, Deque[float]] = defaultdict(deque)
_RATE_LIMIT_LOCK = Lock()
_NEXT_BUCKET_CLEANUP_AT = 0.0

LOGIN_WINDOW_SEC = 5 * 60
LOGIN_MAX_PER_IP = 30
LOGIN_MAX_PER_IP_EMAIL = 10
REGISTER_WINDOW_SEC = 15 * 60
REGISTER_MAX_PER_IP = 15
REGISTER_MAX_PER_IP_EMAIL = 5
RATE_LIMIT_CLEANUP_INTERVAL_SEC = 60
MAX_RATE_LIMIT_WINDOW_SEC = max(LOGIN_WINDOW_SEC, REGISTER_WINDOW_SEC)


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        first = forwarded_for.split(",")[0].strip()
        if first:
            return first
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _enforce_rate_limit(bucket_key: str, max_requests: int, window_seconds: int) -> None:
    global _NEXT_BUCKET_CLEANUP_AT

    now = monotonic()
    with _RATE_LIMIT_LOCK:
        if now >= _NEXT_BUCKET_CLEANUP_AT:
            stale_cutoff = now - MAX_RATE_LIMIT_WINDOW_SEC
            for key, existing_bucket in list(_RATE_LIMIT_BUCKETS.items()):
                while existing_bucket and existing_bucket[0] <= stale_cutoff:
                    existing_bucket.popleft()
                if not existing_bucket:
                    _RATE_LIMIT_BUCKETS.pop(key, None)
            _NEXT_BUCKET_CLEANUP_AT = now + RATE_LIMIT_CLEANUP_INTERVAL_SEC

        bucket = _RATE_LIMIT_BUCKETS[bucket_key]
        cutoff = now - window_seconds
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()

        if len(bucket) >= max_requests:
            retry_after = max(1, int(window_seconds - (now - bucket[0])))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many attempts. Retry in {retry_after}s",
                headers={"Retry-After": str(retry_after)},
            )

        bucket.append(now)


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
def register(body: RegisterRequest, request: Request) -> AuthResponse:
    email = _normalize_email(body.email)
    if "@" not in email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email")

    client_ip = _client_ip(request)
    _enforce_rate_limit(f"register:ip:{client_ip}", REGISTER_MAX_PER_IP, REGISTER_WINDOW_SEC)
    _enforce_rate_limit(f"register:ip-email:{client_ip}:{email}", REGISTER_MAX_PER_IP_EMAIL, REGISTER_WINDOW_SEC)

    settings = get_settings()
    password_hash = hash_password(body.password)

    try:
        user = create_user_with_credentials(email, password_hash, settings.initial_user_tokens)
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
def login(body: LoginRequest, request: Request) -> AuthResponse:
    email = _normalize_email(body.email)
    if "@" not in email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email")

    client_ip = _client_ip(request)
    _enforce_rate_limit(f"login:ip:{client_ip}", LOGIN_MAX_PER_IP, LOGIN_WINDOW_SEC)
    _enforce_rate_limit(f"login:ip-email:{client_ip}:{email}", LOGIN_MAX_PER_IP_EMAIL, LOGIN_WINDOW_SEC)

    user = get_user_with_credentials_by_email(email)
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
def topup(body: TopupRequest, request: Request, user_id: str = Depends(get_current_user_id)) -> MeResponse:
    settings = get_settings()
    client_host = (request.client.host if request.client else "").strip().lower()
    localhost_hosts = {"localhost", "127.0.0.1", "::1"}
    if not settings.dev_mode and client_host not in localhost_hosts:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manual top-up is disabled outside dev mode")

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
