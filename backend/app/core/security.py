from datetime import datetime, timedelta, timezone
from uuid import uuid4

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import get_settings
from app.core.redis_client import get_redis_client

bearer_required = HTTPBearer(auto_error=True)
bearer_optional = HTTPBearer(auto_error=False)
DEMO_USER_ID = "demo"
DEMO_EMAIL = "demo@aigrafka.local"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "email": email,
        "jti": uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_exp_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def _revoked_key(jti: str) -> str:
    return f"jwt:revoked:{jti}"


def is_token_revoked(jti: str | None) -> bool:
    """Best-effort revocation check. Fails open if Redis is unavailable."""
    if not jti:
        return False
    client = get_redis_client()
    if not client:
        return False
    try:
        return bool(client.get(_revoked_key(jti)))
    except Exception:
        return False


def revoke_token(payload: dict) -> None:
    """Add a token's jti to the denylist until its natural expiry."""
    jti = payload.get("jti")
    if not jti:
        return
    client = get_redis_client()
    if not client:
        return
    exp = payload.get("exp")
    now = int(datetime.now(timezone.utc).timestamp())
    ttl = max(1, int(exp) - now) if exp else 3600
    try:
        client.setex(_revoked_key(jti), ttl, "1")
    except Exception:
        pass


def create_demo_access_token() -> str:
    return create_access_token(DEMO_USER_ID, DEMO_EMAIL)


def is_demo_user_id(user_id: str | None) -> bool:
    return user_id == DEMO_USER_ID


def decode_access_token(token: str) -> dict:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        if not payload.get("sub"):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        if is_token_revoked(payload.get("jti")):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has been revoked")
        return payload
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token") from exc


def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_required),
) -> str:
    payload = decode_access_token(credentials.credentials)
    return str(payload["sub"])


def get_optional_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_optional),
) -> str | None:
    if credentials is None:
        return None
    payload = decode_access_token(credentials.credentials)
    return str(payload["sub"])
