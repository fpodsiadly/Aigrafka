import logging
from io import BytesIO
from time import perf_counter
from urllib.parse import urlparse

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, HttpUrl
from PIL import Image

from app.ai.gemini_client import GeminiClient
from app.ai.prompts.openvto_prompt import build_openvto_prompt
from app.ai.product_image import fetch_product_image
from app.core.config import get_settings

router = APIRouter()
logger = logging.getLogger(__name__)


class ImageVariant(BaseModel):
    image_base64: str | dict | None = None
    mime_type: str | None = None
    width: int | None = None
    height: int | None = None
    latency_ms: float | None = None


class GenerateResponse(BaseModel):
    status: str
    image_base64: str | dict | None = None  # backwards compatibility
    mime_type: str | None = None  # backwards compatibility
    variants: list[ImageVariant]
    model: str | None = None


def _ensure_reserved(product_url: str) -> None:
    domain = urlparse(product_url).netloc
    if not domain.endswith("reserved.com"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only reserved.com is supported in demo")


settings = get_settings()
MAX_UPLOAD_BYTES = settings.max_selfie_mb * 1024 * 1024
MAX_PRODUCT_BYTES = settings.max_product_image_mb * 1024 * 1024
MAX_SIDE_PX = settings.max_side_px


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
    product_url: HttpUrl | None = Form(None),
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
) -> GenerateResponse:
    t_enter = perf_counter()
    if not product_url and not product_image_1 and not product_image_2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide product_url or upload a product image."
        )

    selfie_bytes = _validate_and_normalize_selfie(selfie)

    used_upload = False
    product_image_bytes: bytes | None = None

    for candidate in (product_image_1, product_image_2):
        if candidate is None:
            continue
        if candidate.filename:
            product_image_bytes = _validate_and_normalize_product(candidate)
            used_upload = True
            break

    if product_image_bytes is None:
        if not product_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Product image not provided"
            )
        _ensure_reserved(str(product_url))
        try:
            product_image_bytes = await fetch_product_image(str(product_url))
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    product_ref = "uploaded product image" if used_upload else str(product_url)
    prompt = build_openvto_prompt(
        product_ref,
        is_upload=used_upload,
        category=category,
        fit_style=fit_style,
        height_cm=height_cm,
        chest_cm=chest_cm,
        waist_cm=waist_cm,
        hips_cm=hips_cm,
    )
    variant_count = max(1, min(variants or settings.variants, settings.variants))

    model_map = {
        "banana": "gemini-2.5-flash-image",
        "banana-pro": "gemini-3-pro-image-preview",
    }
    chosen_model = model_map.get(model_choice) if model_choice else None

    client = GeminiClient(model=chosen_model)
    successful: list[ImageVariant] = []
    fallbacks: list[ImageVariant] = []
    first_model_ms: float | None = None

    logger.info(
        "generate_tryon start product_url=%s used_upload=%s variants=%d model=%s",
        product_url,
        used_upload,
        variant_count,
        client.model,
    )

    for _ in range(variant_count):
        started = perf_counter()
        result = await client.generate_image(
            prompt=prompt,
            selfie_bytes=selfie_bytes,
            product_image_bytes=product_image_bytes,
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
