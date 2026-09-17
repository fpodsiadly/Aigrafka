import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token as google_id_token
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.db import (
    add_tokens,
    delete_credentials_for_email,
    get_or_create_user_by_email,
    get_user_by_id,
)
from app.core.network import client_ip as _client_ip
from app.core.rate_limit import enforce_auth_rate_limit
from app.core.security import (
    DEMO_EMAIL,
    DEMO_USER_ID,
    bearer_required,
    create_access_token,
    create_demo_access_token,
    decode_access_token,
    get_current_user_id,
    is_demo_user_id,
    revoke_token,
)

router = APIRouter(prefix="/auth", tags=["auth"])

def _enforce_rate_limit(bucket_key: str, max_requests: int, window_seconds: int) -> None:
    enforce_auth_rate_limit(bucket_key, max_requests, window_seconds)


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


@router.post("/logout")
def logout(credentials: HTTPAuthorizationCredentials = Depends(bearer_required)) -> dict[str, bool]:
    """Revoke the presented token so it cannot be reused (e.g. after compromise)."""
    payload = decode_access_token(credentials.credentials)
    revoke_token(payload)
    return {"ok": True}


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
async def topup(body: TopupRequest, user_id: str = Depends(get_current_user_id)) -> MeResponse:
    settings = get_settings()
    # Peer-address ("localhost") checks are unreliable behind a reverse proxy
    # that terminates on loopback (e.g. Render), where every external client
    # appears local. Gate strictly on DEV_MODE instead.
    if not settings.dev_mode:
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
        # Google verified ownership of this email. Invalidate any pre-existing
        # password credential (which this app never email-verifies) so an
        # attacker who pre-registered the address cannot retain access.
        await delete_credentials_for_email(email)
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
