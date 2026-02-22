from typing import Optional

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
    fitStyle: Optional[str] = None
    consentGiven: bool = False
    category: Optional[str] = None
    productUrl: Optional[str] = None
    selfieUrl: Optional[str] = None


class UpsertProfileRequest(BaseModel):
    userId: str = Field(..., min_length=1)
    height: str = Field(..., min_length=0)
    chest: str = Field(..., min_length=0)
    waist: str = Field(..., min_length=0)
    hips: str = Field(..., min_length=0)
    fitStyle: Optional[str] = None
    consentGiven: bool = False
    category: Optional[str] = None
    productUrl: Optional[str] = None
    selfieUrl: Optional[str] = None


@router.get("/{user_id}", response_model=ProfileResponse)
def get_profile(user_id: str, current_user_id: str = Depends(get_current_user_id)) -> ProfileResponse:
    if current_user_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    profile = get_profile_by_user_id(user_id)
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")

    return ProfileResponse(**profile)


@router.post("", response_model=ProfileResponse)
def save_profile(body: UpsertProfileRequest, current_user_id: str = Depends(get_current_user_id)) -> ProfileResponse:
    if current_user_id != body.userId:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    saved = upsert_profile(
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
