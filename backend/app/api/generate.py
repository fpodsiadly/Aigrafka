import logging
from io import BytesIO
from time import perf_counter
from typing import Optional, Union
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from PIL import Image

from app.ai.gemini_client import GeminiClient
from app.ai.prompts.openvto_prompt import build_openvto_prompt
from app.ai.product_image import fetch_product_image
from app.core.config import get_settings
from app.core.db import add_tokens, deduct_tokens_if_possible
from app.core.security import get_optional_user_id

router = APIRouter()
logger = logging.getLogger(__name__)


class ImageVariant(BaseModel):
    image_base64: Optional[Union[str, dict]] = None
    mime_type: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    latency_ms: Optional[float] = None


class GenerateResponse(BaseModel):
    status: str
    image_base64: Optional[Union[str, dict]] = None  # backwards compatibility
    mime_type: Optional[str] = None  # backwards compatibility
    variants: list[ImageVariant]
    model: Optional[str] = None


settings = get_settings()
MAX_UPLOAD_BYTES = settings.max_selfie_mb * 1024 * 1024
MAX_PRODUCT_BYTES = settings.max_product_image_mb * 1024 * 1024
MAX_SIDE_PX = settings.max_side_px


def _normalize_product_url(url: str) -> str:
    cleaned = url.strip().rstrip('|').strip()
    parsed = urlparse(cleaned)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid product_url")
    return cleaned


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
        # Resize if longer side exceeds MAX_SIDE_PX
        w, h = image.size
        longer = max(w, h)
        if longer > MAX_SIDE_PX:
            scale = MAX_SIDE_PX / longer
            image = image.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        buffer = BytesIO()
        image.save(buffer, format="JPEG", quality=92)
        return buffer.getvalue()
    except HTTPException:
        raise
    except Exception as exc:  # pillow throws many possible errors
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image upload") from exc


def _validate_and_normalize_product(upload: UploadFile) -> bytes:
    try:
        if not upload.content_type or not upload.content_type.startswith("image/"):
            raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Product must be an image")

        content = upload.file.read(MAX_PRODUCT_BYTES + 1)
        if len(content) > MAX_PRODUCT_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Product image too large (max {settings.max_product_image_mb}MB)"
            )

        image = Image.open(BytesIO(content))
        image.verify()

        image = Image.open(BytesIO(content)).convert("RGB")
        w, h = image.size
        longer = max(w, h)
        if longer > MAX_SIDE_PX:
            scale = MAX_SIDE_PX / longer
            image = image.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        buffer = BytesIO()
        image.save(buffer, format="JPEG", quality=92)
        return buffer.getvalue()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid product image upload") from exc


@router.post("/generate", response_model=GenerateResponse)
async def generate_tryon(
    product_url: Optional[str] = Form(None),
    selfie: UploadFile = File(...),
    category: Optional[str] = Form(None),
    fit_style: Optional[str] = Form(None),
    height_cm: Optional[str] = Form(None),
    chest_cm: Optional[str] = Form(None),
    waist_cm: Optional[str] = Form(None),
    hips_cm: Optional[str] = Form(None),
    model_choice: Optional[str] = Form(None),
    variants: Optional[int] = Form(None),
    product_image_1: Optional[UploadFile] = File(None),
    product_image_2: Optional[UploadFile] = File(None),
    user_id: Optional[str] = Depends(get_optional_user_id),
) -> GenerateResponse:
    t_enter = perf_counter()
    normalized_product_url: Optional[str] = None
    if product_url:
        normalized_product_url = _normalize_product_url(product_url)

    if not normalized_product_url and not product_image_1 and not product_image_2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide product_url or upload a product image."
        )

    selfie_bytes = _validate_and_normalize_selfie(selfie)

    used_upload = False
    primary_product_image_bytes: Optional[bytes] = None
    secondary_product_image_bytes: Optional[bytes] = None

    if product_image_1 and product_image_1.filename:
        primary_product_image_bytes = _validate_and_normalize_product(product_image_1)
        used_upload = True

    if product_image_2 and product_image_2.filename:
        secondary_product_image_bytes = _validate_and_normalize_product(product_image_2)
        used_upload = True

    if primary_product_image_bytes is None and secondary_product_image_bytes is not None:
        primary_product_image_bytes = secondary_product_image_bytes
        secondary_product_image_bytes = None

    if primary_product_image_bytes is None:
        if not normalized_product_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Product image not provided"
            )
        try:
            primary_product_image_bytes = await fetch_product_image(normalized_product_url)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    product_ref = "uploaded product image" if used_upload else str(normalized_product_url)
    requested_variants = variants if variants is not None else settings.variants
    variant_count = max(1, min(requested_variants, 3))

    back_reference_available = secondary_product_image_bytes is not None

    chosen_model = "gemini-3.1-flash-image-preview"

    client = GeminiClient(model=chosen_model)
    successful: list[ImageVariant] = []
    fallbacks: list[ImageVariant] = []
    first_model_ms: Optional[float] = None

    logger.info(
        "generate_tryon start product_url=%s used_upload=%s variants=%d back_reference=%s model=%s",
        normalized_product_url,
        used_upload,
        variant_count,
        back_reference_available,
        client.model,
    )

    charged_tokens = 0
    if user_id:
        charged_tokens = variant_count * settings.token_cost_per_stylization
        updated_tokens = deduct_tokens_if_possible(user_id, charged_tokens)
        if updated_tokens is None:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=f"Insufficient tokens. Required: {charged_tokens}",
            )

    try:
        for index in range(variant_count):
            variant_number = index + 1
            prompt = build_openvto_prompt(
                product_ref,
                is_upload=used_upload,
                category=category,
                fit_style=fit_style,
                height_cm=height_cm,
                chest_cm=chest_cm,
                waist_cm=waist_cm,
                hips_cm=hips_cm,
                variants=variant_count,
                variant_index=variant_number,
                back_reference_available=back_reference_available,
            )

            current_product_image_bytes = primary_product_image_bytes
            if variant_count == 3 and variant_number == 3 and secondary_product_image_bytes is not None:
                current_product_image_bytes = secondary_product_image_bytes

            started = perf_counter()
            result = await client.generate_image(
                prompt=prompt,
                selfie_bytes=selfie_bytes,
                product_image_bytes=current_product_image_bytes,
            )
            latency_ms = (perf_counter() - started) * 1000.0
            if first_model_ms is None:
                first_model_ms = latency_ms

            width = height = None
            try:
                b = result.get("image_base64")
                if isinstance(b, str):
                    from base64 import b64decode

                    img_bytes = b64decode(b)
                    img = Image.open(BytesIO(img_bytes))
                    width, height = img.size
            except Exception:
                width = height = None

            variant = ImageVariant(
                image_base64=result.get("image_base64"),
                mime_type=result.get("mime_type", "image/jpeg"),
                width=width,
                height=height,
                latency_ms=latency_ms,
            )

            if result.get("status") == "generated" and variant.image_base64:
                successful.append(variant)
            else:
                fallbacks.append(variant)
    except Exception:
        if user_id and charged_tokens > 0:
            add_tokens(user_id, charged_tokens)
        raise

    variants_payload = successful or fallbacks
    first = variants_payload[0] if variants_payload else None
    overall_status = "generated" if successful else "fallback" if variants_payload else "failed"

    total_ms = (perf_counter() - t_enter) * 1000.0
    logger.info(
        "generate_tryon done status=%s variants=%d model=%s total_ms=%.1f first_model_ms=%.1f",
        overall_status,
        len(variants_payload),
        client.model,
        total_ms,
        first_model_ms or -1.0,
    )

    return GenerateResponse(
        status=overall_status,
        image_base64=first.image_base64 if first else None,
        mime_type=first.mime_type if first else None,
        variants=variants_payload,
        model=client.model,
    )
