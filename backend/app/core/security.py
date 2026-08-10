from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import get_settings

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
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_exp_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


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
