import asyncio
import base64
import ipaddress
import logging
from io import BytesIO
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from PIL import Image
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.db import add_tokens, deduct_tokens_if_possible
from app.core.metrics import track_generate_request
from app.core.queue import enqueue_job
from app.core.rate_limit import enforce_generate_rate_limit
from app.core.security import get_optional_user_id

router = APIRouter()
logger = logging.getLogger(__name__)

settings = get_settings()
MAX_UPLOAD_BYTES = settings.max_selfie_mb * 1024 * 1024
MAX_PRODUCT_BYTES = settings.max_product_image_mb * 1024 * 1024
MAX_SIDE_PX = settings.max_side_px


class GenerateJobResponse(BaseModel):
    job_id: str
    status: str = "queued"
    message: str = "Generation queued. Poll /jobs/{job_id} for status."


def _normalize_product_url(url: str) -> str:
    cleaned = url.strip().rstrip('|').strip()
    parsed = urlparse(cleaned)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid product_url")
    hostname = (parsed.hostname or '').lower().strip('[]')
    if hostname in ('localhost', '0.0.0.0', '::1'):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid product_url")
    try:
        ip = ipaddress.ip_address(hostname)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_unspecified:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid product_url")
    except ValueError:
        pass
    return cleaned


def _validate_and_normalize_image(upload: UploadFile, max_bytes: int, label: str) -> bytes:
    try:
        if not upload.content_type or not upload.content_type.startswith("image/"):
            raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=f"{label} must be an image")

        content = upload.file.read(max_bytes + 1)
        if len(content) > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"{label} too large (max {max_bytes // (1024 * 1024)}MB)"
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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid {label} upload") from exc


@router.post("/generate", response_model=GenerateJobResponse)
async def generate_tryon(
    request: Request,
    product_url: str | None = Form(None),
    selfie: UploadFile = File(...),
    category: str | None = Form(None),
    fit_style: str | None = Form(None),
    height_cm: str | None = Form(None),
    chest_cm: str | None = Form(None),
    waist_cm: str | None = Form(None),
    hips_cm: str | None = Form(None),
    model_choice: str | None = Form(None),
    variants: int | None = Form(None),
    product_image_1: UploadFile | None = File(None),
    product_image_2: UploadFile | None = File(None),
    user_id: str | None = Depends(get_optional_user_id),
) -> GenerateJobResponse:
    await enforce_generate_rate_limit(request, user_id)

    normalized_product_url: str | None = None
    if product_url:
        normalized_product_url = _normalize_product_url(product_url)

    if not normalized_product_url and not product_image_1 and not product_image_2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide product_url or upload a product image."
        )

    selfie_bytes = await asyncio.to_thread(_validate_and_normalize_image, selfie, MAX_UPLOAD_BYTES, "Selfie")

    used_upload = False
    primary_product_image_bytes: bytes | None = None
    secondary_product_image_bytes: bytes | None = None

    if product_image_1 and product_image_1.filename:
        primary_product_image_bytes = await asyncio.to_thread(
            _validate_and_normalize_image, product_image_1, MAX_PRODUCT_BYTES, "Product image"
        )
        used_upload = True

    if product_image_2 and product_image_2.filename:
        secondary_product_image_bytes = await asyncio.to_thread(
            _validate_and_normalize_image, product_image_2, MAX_PRODUCT_BYTES, "Product image 2"
        )
        used_upload = True

    if primary_product_image_bytes is None and secondary_product_image_bytes is not None:
        primary_product_image_bytes = secondary_product_image_bytes
        secondary_product_image_bytes = None

    if primary_product_image_bytes is None and not normalized_product_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Product image not provided")

    product_ref = "uploaded product image" if used_upload else str(normalized_product_url)

    _FEMININE_SWIMWEAR_KEYWORDS = {
        "bikini", "swimsuit", "swimwear", "bathing suit", "one-piece", "monokini",
        "strój kąpielowy", "kostium kąpielowy", "góra od bikini", "dół od bikini",
        "bikini top", "bikini bottom", "lingerie", "bielizna", "bra", "biustonosz",
    }
    if fit_style == "masculine" and category:
        cat_lower = category.lower()
        if any(kw in cat_lower for kw in _FEMININE_SWIMWEAR_KEYWORDS):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="incompatible_category:masculine_swimwear",
            )

    requested_variants = variants if variants is not None else settings.variants
    variant_count = max(1, min(requested_variants, 3))
    back_reference_available = secondary_product_image_bytes is not None

    charged_tokens = 0
    if user_id and not settings.dev_mode:
        charged_tokens = variant_count * settings.token_cost_per_stylization
        updated_tokens = await deduct_tokens_if_possible(user_id, charged_tokens)
        if updated_tokens is None:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=f"Insufficient tokens. Required: {charged_tokens}",
            )

    payload = {
        "product_url": normalized_product_url,
        "selfie_b64": base64.b64encode(selfie_bytes).decode("ascii"),
        "product_image_1_b64": base64.b64encode(primary_product_image_bytes).decode("ascii") if primary_product_image_bytes else None,
        "product_image_2_b64": base64.b64encode(secondary_product_image_bytes).decode("ascii") if secondary_product_image_bytes else None,
        "category": category,
        "fit_style": fit_style,
        "height_cm": height_cm,
        "chest_cm": chest_cm,
        "waist_cm": waist_cm,
        "hips_cm": hips_cm,
        "variant_count": variant_count,
        "model_choice": model_choice,
        "user_id": user_id,
        "charged_tokens": charged_tokens,
        "used_upload": used_upload,
        "product_ref": product_ref,
        "back_reference_available": back_reference_available,
    }

    try:
        job_id = await enqueue_job(payload)
    except Exception as exc:
        # Enqueue failed after charging: refund to avoid losing user tokens.
        if charged_tokens > 0 and user_id:
            try:
                await add_tokens(user_id, charged_tokens)
            except Exception:
                logger.exception("Failed to refund tokens after enqueue failure user=%s", user_id)
        track_generate_request("enqueue_failed")
        logger.exception("generate_tryon enqueue failed user=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Generation queue unavailable. Please try again.",
        ) from exc

    track_generate_request("queued")
    logger.info("generate_tryon queued job_id=%s user=%s variants=%d", job_id, user_id, variant_count)
    return GenerateJobResponse(job_id=job_id)
