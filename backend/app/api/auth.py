import asyncio
from collections import defaultdict, deque
from threading import Lock
from time import monotonic

from fastapi import APIRouter, Depends, HTTPException, Request, status
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token as google_id_token
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.db import (
    add_tokens,
    create_user_with_credentials,
    get_or_create_user_by_email,
    get_user_by_id,
    get_user_with_credentials_by_email,
)
from app.core.network import client_ip as _client_ip
from app.core.security import (
    DEMO_EMAIL,
    DEMO_USER_ID,
    create_access_token,
    create_demo_access_token,
    get_current_user_id,
    hash_password,
    is_demo_user_id,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

_RATE_LIMIT_BUCKETS: dict[str, deque[float]] = defaultdict(deque)
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
    client_id: str | None = None


class DemoAccessResponse(BaseModel):
    enabled: bool


@router.post("/register", response_model=AuthResponse)
async def register(body: RegisterRequest, request: Request) -> AuthResponse:
    email = _normalize_email(body.email)
    if "@" not in email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email")

    client_ip = _client_ip(request)
    _enforce_rate_limit(f"register:ip:{client_ip}", REGISTER_MAX_PER_IP, REGISTER_WINDOW_SEC)
    _enforce_rate_limit(f"register:ip-email:{client_ip}:{email}", REGISTER_MAX_PER_IP_EMAIL, REGISTER_WINDOW_SEC)

    settings = get_settings()
    password_hash = await asyncio.to_thread(hash_password, body.password)

    try:
        user = await create_user_with_credentials(email, password_hash, settings.initial_user_tokens)
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
async def login(body: LoginRequest, request: Request) -> AuthResponse:
    email = _normalize_email(body.email)
    if "@" not in email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email")

    client_ip = _client_ip(request)
    _enforce_rate_limit(f"login:ip:{client_ip}", LOGIN_MAX_PER_IP, LOGIN_WINDOW_SEC)
    _enforce_rate_limit(f"login:ip-email:{client_ip}:{email}", LOGIN_MAX_PER_IP_EMAIL, LOGIN_WINDOW_SEC)

    user = await get_user_with_credentials_by_email(email)
    password_ok = bool(user) and await asyncio.to_thread(
        verify_password, body.password, str(user["password_hash"])
    )
    if not password_ok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    token = create_access_token(str(user["id"]), str(user["email"]))
    return AuthResponse(
        access_token=token,
        user_id=str(user["id"]),
        email=str(user["email"]),
        tokens=int(user["tokens"]),
    )


@router.get("/me", response_model=MeResponse)
async def me(user_id: str = Depends(get_current_user_id)) -> MeResponse:
    if is_demo_user_id(user_id):
        return MeResponse(user_id=DEMO_USER_ID, email=DEMO_EMAIL, tokens=999)
    user = await get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return MeResponse(user_id=str(user["id"]), email=str(user["email"]), tokens=int(user["tokens"]))


@router.get("/demo", response_model=DemoAccessResponse)
def demo_access_status() -> DemoAccessResponse:
    return DemoAccessResponse(enabled=get_settings().demo_access_enabled)


@router.post("/demo", response_model=AuthResponse)
async def start_demo_access() -> AuthResponse:
    if not get_settings().demo_access_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Demo access is disabled")
    return AuthResponse(
        access_token=create_demo_access_token(),
        user_id=DEMO_USER_ID,
        email=DEMO_EMAIL,
        tokens=999,
    )


@router.post("/topup", response_model=MeResponse)
async def topup(body: TopupRequest, request: Request, user_id: str = Depends(get_current_user_id)) -> MeResponse:
    settings = get_settings()
    client_host = (request.client.host if request.client else "").strip().lower()
    localhost_hosts = {"localhost", "127.0.0.1", "::1"}
    if not settings.dev_mode and client_host not in localhost_hosts:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manual top-up is disabled outside dev mode")

    try:
        tokens = await add_tokens(user_id, body.amount)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found") from exc

    user = await get_user_by_id(user_id)
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
async def login_with_google(body: GoogleAuthRequest, request: Request) -> AuthResponse:
    settings = get_settings()
    client_ip = _client_ip(request)
    _enforce_rate_limit(f"google:ip:{client_ip}", settings.google_login_rate_limit_per_minute, 60)

    client_id = (settings.google_client_id or "").strip()
    if not client_id:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google sign-in is not configured")

    try:
        claims = await asyncio.to_thread(
            google_id_token.verify_oauth2_token, body.id_token, GoogleRequest(), client_id
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Nieprawidłowy token Google — spróbuj zalogować się ponownie.") from exc

    email = str(claims.get("email") or "").strip().lower()
    email_verified = bool(claims.get("email_verified"))
    if not email or not email_verified:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Konto Google nie ma zweryfikowanego adresu e-mail.")

    try:
        user = await get_or_create_user_by_email(email, settings.initial_user_tokens)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Błąd bazy danych — spróbuj ponownie za chwilę.",
        ) from exc

    token = create_access_token(str(user["id"]), str(user["email"]))
    return AuthResponse(
        access_token=token,
        user_id=str(user["id"]),
        email=str(user["email"]),
        tokens=int(user["tokens"]),
    )
