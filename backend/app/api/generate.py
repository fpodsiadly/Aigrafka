import asyncio
import ipaddress
import json
import logging
from io import BytesIO
from time import perf_counter
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from PIL import Image

from app.ai.garment_policy import validate_garment_category
from app.core.config import get_settings
from app.core.db import deduct_tokens_if_possible
from app.core.metrics import track_generate_request
from app.core.queue import create_job, renew_job_lease, update_job_status
from app.core.rate_limit import enforce_generate_rate_limit
from app.core.result_images import build_result_image_url, store_result_image
from app.core.security import get_optional_user_id, is_demo_user_id
from app.core.worker import generate_from_payload

router = APIRouter()
logger = logging.getLogger(__name__)
# Strong references to in-flight async generations; asyncio only keeps weak
# references to tasks, so an unreferenced task could be garbage-collected.
_background_generations: set[asyncio.Task] = set()
# Lease renewal period of in-process generations (see claim_orphaned_job).
JOB_HEARTBEAT_SECONDS = 15

settings = get_settings()
MAX_UPLOAD_BYTES = settings.max_selfie_mb * 1024 * 1024
MAX_PRODUCT_BYTES = settings.max_product_image_mb * 1024 * 1024
MAX_SIDE_PX = settings.max_side_px
MAX_IMAGE_PIXELS = 50_000_000
# Let Pillow abort decompression bombs before allocating a full RGB buffer.
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

# Upper bounds for free-text fields interpolated into model prompts, to prevent
# prompt bloat / token-cost amplification.
_TEXT_FIELD_LIMITS = {
    "category": 200,
    "fit_style": 32,
    "model_choice": 64,
    "mode": 16,
    "fresh": 8,
    "product_name": 300,
    "product_details": 2000,
    "garment_size": 32,
    "size_chest_range": 32,
    "size_waist_range": 32,
    "size_hips_range": 32,
    "height_cm": 16,
    "chest_cm": 16,
    "waist_cm": 16,
    "hips_cm": 16,
}


def _bound_text(value: str | None, field: str) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    limit = _TEXT_FIELD_LIMITS.get(field, 200)
    if len(trimmed) > limit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field} exceeds maximum length of {limit} characters",
        )
    return trimmed


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
        # Re-open and check declared dimensions from the header BEFORE decoding
        # into a full RGB buffer, so a small highly-compressed bomb cannot force
        # a large allocation first.
        probe = Image.open(BytesIO(content))
        w, h = probe.size
        if w * h > MAX_IMAGE_PIXELS:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=f"{label} has too many pixels",
            )
        image = probe.convert("RGB")
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


async def _attach_image_url(variant: dict, base_url: str, owner_id: str | None = None) -> None:
    """Move a variant's image into short-lived storage and expose it by URL."""
    if not variant.get("image_base64") or not variant.get("mime_type"):
        return
    token = await store_result_image(variant["image_base64"], variant["mime_type"], owner_id)
    if token:
        variant["image_url"] = build_result_image_url(base_url, token)
        variant.pop("image_base64", None)


async def _start_async_generation(payload: dict, base_url: str, variant_count: int, telemetry: dict) -> str | None:
    """Create a job and run the generation in this process in the background.

    Production runs no separate worker, so the job is not put on the worker
    queue; the job record only carries status and (partial) results for
    polling via GET /jobs/{id}. Returns None when Redis is unavailable.
    """
    try:
        job_id = await create_job(
            {"user_id": payload.get("user_id"), "charged_tokens": payload.get("charged_tokens", 0)}
        )
    except Exception:
        logger.exception("Could not create async generation job")
        return None

    task = asyncio.create_task(_run_async_generation(job_id, payload, base_url, variant_count, telemetry))
    _background_generations.add(task)
    task.add_done_callback(_background_generations.discard)
    return job_id


async def _run_async_generation(job_id: str, payload: dict, base_url: str, variant_count: int, telemetry: dict) -> None:
    owner_id = payload.get("user_id")
    partial: list[dict | None] = [None] * variant_count
    lock = asyncio.Lock()

    async def publish_variant(index: int, variant: dict) -> None:
        await _attach_image_url(variant, base_url, owner_id)
        # Serialise snapshot writes so a slower write never overwrites a newer one.
        async with lock:
            partial[index] = variant
            await update_job_status(job_id, "running", result={"status": "running", "variants": partial})

    async def heartbeat() -> None:
        while True:
            await asyncio.sleep(JOB_HEARTBEAT_SECONDS)
            await asyncio.to_thread(renew_job_lease, job_id)

    heartbeat_task = asyncio.create_task(heartbeat())
    try:
        await update_job_status(job_id, "running", result={"status": "running", "variants": partial})
        result = await generate_from_payload(
            payload,
            operation_id=job_id,
            telemetry=telemetry,
            on_variant=publish_variant,
        )
        await asyncio.gather(
            *[_attach_image_url(variant, base_url, owner_id) for variant in result.get("variants", [])]
        )
        track_generate_request(result.get("status", "completed"))
        await update_job_status(job_id, "completed", result=result)
    except Exception:
        logger.exception("Async generation job %s failed", job_id)
        track_generate_request("failed")
        try:
            await update_job_status(job_id, "failed", error="Generation failed.")
        except Exception:
            logger.exception("Could not mark job %s as failed", job_id)
    finally:
        heartbeat_task.cancel()


@router.post("/generate")
async def generate_tryon(
    request: Request,
    response: Response,
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
    mode: str | None = Form(None),
    fresh: str | None = Form(None),
    product_name: str | None = Form(None),
    product_details: str | None = Form(None),
    garment_size: str | None = Form(None),
    size_chest_range: str | None = Form(None),
    size_waist_range: str | None = Form(None),
    size_hips_range: str | None = Form(None),
    user_id: str | None = Depends(get_optional_user_id),
) -> dict:
    total_started = getattr(request.state, "request_started_perf", perf_counter())
    telemetry = {
        "upload_ms": (perf_counter() - total_started) * 1000.0,
        "rate_limit_ms": 0.0,
        "normalize_ms": 0.0,
        "redis_ms": 0.0,
        "product_fetch_ms": 0.0,
        "gemini_ms": 0.0,
        "response_encode_ms": 0.0,
        "total_ms": 0.0,
        "cache_hit": False,
    }
    rate_limit_started = perf_counter()
    await enforce_generate_rate_limit(request, user_id)
    telemetry["rate_limit_ms"] = (perf_counter() - rate_limit_started) * 1000.0

    category = _bound_text(category, "category")
    fit_style = _bound_text(fit_style, "fit_style")
    model_choice = _bound_text(model_choice, "model_choice")
    mode = _bound_text(mode, "mode")
    # "Generate more" asks for new renders instead of the cached ones.
    fresh_requested = (_bound_text(fresh, "fresh") or "").lower() in {"1", "true"}
    # Product name/description read from the shop page; cleaned again when
    # inserted into the prompt.
    product_name = _bound_text(product_name, "product_name")
    product_details = _bound_text(product_details, "product_details")
    # Chosen size and that size's body ranges from the shop size chart; parsed
    # and validated when the fit description is built.
    garment_size = _bound_text(garment_size, "garment_size")
    size_ranges = {
        f"size_{name}_range": _bound_text(value, f"size_{name}_range")
        for name, value in (("chest", size_chest_range), ("waist", size_waist_range), ("hips", size_hips_range))
    }
    height_cm = _bound_text(height_cm, "height_cm")
    chest_cm = _bound_text(chest_cm, "chest_cm")
    waist_cm = _bound_text(waist_cm, "waist_cm")
    hips_cm = _bound_text(hips_cm, "hips_cm")
    category_prompt_label = validate_garment_category(category, fit_style)

    normalized_product_url: str | None = None
    if product_url:
        normalized_product_url = _normalize_product_url(product_url)

    if not normalized_product_url and not product_image_1 and not product_image_2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide product_url or upload a product image."
        )

    normalize_started = perf_counter()
    normalization_tasks = [
        asyncio.to_thread(_validate_and_normalize_image, selfie, MAX_UPLOAD_BYTES, "Selfie")
    ]
    if product_image_1 and product_image_1.filename:
        normalization_tasks.append(
            asyncio.to_thread(_validate_and_normalize_image, product_image_1, MAX_PRODUCT_BYTES, "Product image")
        )
    if product_image_2 and product_image_2.filename:
        normalization_tasks.append(
            asyncio.to_thread(_validate_and_normalize_image, product_image_2, MAX_PRODUCT_BYTES, "Product image 2")
        )
    normalized_images = await asyncio.gather(*normalization_tasks)
    telemetry["normalize_ms"] = (perf_counter() - normalize_started) * 1000.0

    selfie_bytes = normalized_images[0]
    normalized_index = 1
    primary_product_image_bytes: bytes | None = None
    secondary_product_image_bytes: bytes | None = None
    if product_image_1 and product_image_1.filename:
        primary_product_image_bytes = normalized_images[normalized_index]
        normalized_index += 1
    if product_image_2 and product_image_2.filename:
        secondary_product_image_bytes = normalized_images[normalized_index]

    if primary_product_image_bytes is None and secondary_product_image_bytes is not None:
        primary_product_image_bytes = secondary_product_image_bytes
        secondary_product_image_bytes = None

    if primary_product_image_bytes is None and not normalized_product_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Product image not provided")

    requested_variants = variants if variants is not None else settings.variants
    variant_count = max(1, min(requested_variants, 3))
    back_reference_available = secondary_product_image_bytes is not None

    charged_tokens = 0
    if user_id and not settings.dev_mode and not is_demo_user_id(user_id):
        charged_tokens = variant_count * settings.token_cost_per_stylization
        updated_tokens = await deduct_tokens_if_possible(user_id, charged_tokens)
        if updated_tokens is None:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=f"Insufficient tokens. Required: {charged_tokens}",
            )

    payload = {
        "product_url": normalized_product_url,
        "selfie_bytes": selfie_bytes,
        "product_image_1_bytes": primary_product_image_bytes,
        "product_image_2_bytes": secondary_product_image_bytes,
        "category": category_prompt_label,
        "fit_style": fit_style,
        "height_cm": height_cm,
        "chest_cm": chest_cm,
        "waist_cm": waist_cm,
        "hips_cm": hips_cm,
        "variant_count": variant_count,
        "model_choice": model_choice,
        "user_id": user_id,
        "charged_tokens": charged_tokens,
        "product_name": product_name,
        "product_details": product_details,
        "garment_size": garment_size,
        **size_ranges,
        "back_reference_available": back_reference_available,
        "fresh": fresh_requested,
    }

    request_id = getattr(request.state, "request_id", "unknown")
    base_url = str(request.base_url)

    if mode == "async":
        job_id = await _start_async_generation(payload, base_url, variant_count, telemetry)
        if job_id is not None:
            response.status_code = status.HTTP_202_ACCEPTED
            return {"job_id": job_id, "status": "pending", "variant_count": variant_count}
        logger.warning("Async generation unavailable (no Redis); falling back to synchronous request_id=%s", request_id)

    try:
        result = await generate_from_payload(
            payload,
            operation_id=request_id,
            telemetry=telemetry,
        )
    except Exception as exc:
        track_generate_request("failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Generation failed.",
        ) from exc

    redis_started = perf_counter()
    await asyncio.gather(*[_attach_image_url(variant, base_url, user_id) for variant in result.get("variants", [])])
    telemetry["redis_ms"] += (perf_counter() - redis_started) * 1000.0

    track_generate_request(result.get("status", "completed"))
    telemetry["total_ms"] = (perf_counter() - total_started) * 1000.0
    result["telemetry"] = telemetry
    encode_started = perf_counter()
    json.dumps(result, separators=(",", ":"))
    telemetry["response_encode_ms"] = (perf_counter() - encode_started) * 1000.0
    telemetry["total_ms"] = (perf_counter() - total_started) * 1000.0
    result["telemetry"] = {
        key: round(value, 2) if isinstance(value, float) else value
        for key, value in telemetry.items()
    }
    logger.info(
        "generate_tryon completed request_id=%s user=%s variants=%d telemetry=%s",
        request_id,
        user_id,
        variant_count,
        json.dumps(result["telemetry"], separators=(",", ":")),
    )
    return result
