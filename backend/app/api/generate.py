from io import BytesIO
from urllib.parse import urlparse

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from pydantic import BaseModel, HttpUrl
from PIL import Image

from app.ai.gemini_client import GeminiClient
from app.ai.prompts.openvto_prompt import build_openvto_prompt
from app.ai.product_image import fetch_product_image
from app.core.config import get_settings

router = APIRouter()


class GenerateResponse(BaseModel):
    status: str
    image_base64: str | dict | None = None
    mime_type: str | None = None


def _ensure_reserved(product_url: str) -> None:
    domain = urlparse(product_url).netloc
    if not domain.endswith("reserved.com"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only reserved.com is supported in demo")


settings = get_settings()
MAX_UPLOAD_BYTES = settings.max_selfie_mb * 1024 * 1024


def _validate_and_normalize_selfie(upload: UploadFile) -> bytes:
    try:
        if not upload.content_type or not upload.content_type.startswith("image/"):
            raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Selfie must be an image")

        content = upload.file.read(MAX_UPLOAD_BYTES + 1)
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Selfie too large (max {settings.max_selfie_mb}MB)"
            )

        image = Image.open(BytesIO(content))
        image.verify()

        # Normalize to JPEG to keep format predictable for downstream AI
        image = Image.open(BytesIO(content)).convert("RGB")
        buffer = BytesIO()
        image.save(buffer, format="JPEG", quality=92)
        return buffer.getvalue()
    except HTTPException:
        raise
    except Exception as exc:  # pillow throws many possible errors
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image upload") from exc


@router.post("/generate", response_model=GenerateResponse)
async def generate_tryon(product_url: HttpUrl, selfie: UploadFile = File(...)) -> GenerateResponse:
    _ensure_reserved(str(product_url))
    selfie_bytes = _validate_and_normalize_selfie(selfie)
    try:
        product_image_bytes = await fetch_product_image(str(product_url))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    prompt = build_openvto_prompt(str(product_url))

    client = GeminiClient()
    result = await client.generate_image(prompt=prompt, selfie_bytes=selfie_bytes, product_image_bytes=product_image_bytes)

    return GenerateResponse(
        status=result.get("status", "generated"),
        image_base64=result.get("image_base64"),
        mime_type=result.get("mime_type", "image/jpeg")
    )
