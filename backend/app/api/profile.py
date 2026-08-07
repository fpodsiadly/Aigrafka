
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.db import get_profile_by_user_id, upsert_profile
from app.core.security import get_current_user_id

router = APIRouter(prefix="/profile", tags=["profile"])


class ProfileResponse(BaseModel):
    userId: str
    height: str
    chest: str
    waist: str
    hips: str
    fitStyle: str | None = None
    consentGiven: bool = False
    category: str | None = None
    productUrl: str | None = None
    selfieUrl: str | None = None


class UpsertProfileRequest(BaseModel):
    userId: str = Field(..., min_length=1, max_length=64)
    height: str = Field(default="", max_length=8)
    chest: str = Field(default="", max_length=8)
    waist: str = Field(default="", max_length=8)
    hips: str = Field(default="", max_length=8)
    fitStyle: str | None = Field(default=None, max_length=32)
    consentGiven: bool = False
    category: str | None = Field(default=None, max_length=200)
    productUrl: str | None = Field(default=None, max_length=2048)
    selfieUrl: str | None = Field(default=None, max_length=2048)


@router.get("/{user_id}", response_model=ProfileResponse)
async def get_profile(user_id: str, current_user_id: str = Depends(get_current_user_id)) -> ProfileResponse:
    if current_user_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    profile = await get_profile_by_user_id(user_id)
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")

    return ProfileResponse(**profile)


@router.post("", response_model=ProfileResponse)
async def save_profile(body: UpsertProfileRequest, current_user_id: str = Depends(get_current_user_id)) -> ProfileResponse:
    if current_user_id != body.userId:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    saved = await upsert_profile(
        user_id=body.userId,
        height=body.height,
        chest=body.chest,
        waist=body.waist,
        hips=body.hips,
        fit_style=body.fitStyle,
        consent_given=body.consentGiven,
        category=body.category,
        product_url=body.productUrl,
        selfie_url=body.selfieUrl,
    )
    return ProfileResponse(**saved)
