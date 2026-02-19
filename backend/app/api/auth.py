from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.db import add_tokens, create_user_with_credentials, get_user_by_id, get_user_with_credentials_by_email
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
