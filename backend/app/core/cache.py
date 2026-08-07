import asyncio
import base64
import hashlib
import json
import logging

from app.core.config import get_settings
from app.core.redis_client import get_redis_client, invalidate_redis_client

logger = logging.getLogger(__name__)


def _build_generation_cache_key(
    selfie_bytes: bytes,
    product_bytes: bytes,
    category: str | None,
    fit_style: str | None,
    height_cm: str | None,
    chest_cm: str | None,
    waist_cm: str | None,
    hips_cm: str | None,
    variant_index: int,
    model: str,
) -> str:
    """Stable cache key based on image content + parameters."""
    data = {
        "selfie_hash": hashlib.sha256(selfie_bytes).hexdigest(),
        "product_hash": hashlib.sha256(product_bytes).hexdigest(),
        "category": category or "",
        "fit_style": fit_style or "",
        "height_cm": height_cm or "",
        "chest_cm": chest_cm or "",
        "waist_cm": waist_cm or "",
        "hips_cm": hips_cm or "",
        "variant_index": variant_index,
        "model": model,
    }
    raw = json.dumps(data, sort_keys=True, separators=(",", ":"))
    return f"gen_cache:{hashlib.sha256(raw.encode()).hexdigest()}"


async def get_cached_generation(
    selfie_bytes: bytes,
    product_bytes: bytes,
    category: str | None,
    fit_style: str | None,
    height_cm: str | None,
    chest_cm: str | None,
    waist_cm: str | None,
    hips_cm: str | None,
    variant_index: int,
    model: str,
) -> dict | None:
    client = get_redis_client()
    if not client:
        return None

    key = _build_generation_cache_key(
        selfie_bytes, product_bytes, category, fit_style, height_cm, chest_cm, waist_cm, hips_cm, variant_index, model
    )
    try:
        cached = await asyncio.to_thread(client.get, key)
        if cached:
            logger.info("Generation cache hit: %s", key)
            return json.loads(cached)
    except Exception as exc:
        logger.error("Generation cache read failed: %s", exc)
        invalidate_redis_client()
    return None


async def set_cached_generation(
    selfie_bytes: bytes,
    product_bytes: bytes,
    category: str | None,
    fit_style: str | None,
    height_cm: str | None,
    chest_cm: str | None,
    waist_cm: str | None,
    hips_cm: str | None,
    variant_index: int,
    model: str,
    result: dict,
) -> None:
    client = get_redis_client()
    if not client:
        return

    settings = get_settings()
    key = _build_generation_cache_key(
        selfie_bytes, product_bytes, category, fit_style, height_cm, chest_cm, waist_cm, hips_cm, variant_index, model
    )
    try:
        await asyncio.to_thread(client.setex, key, settings.generation_cache_ttl_seconds, json.dumps(result))
        logger.info("Generation cache stored: %s", key)
    except Exception as exc:
        logger.error("Generation cache write failed: %s", exc)
        invalidate_redis_client()


def _product_image_key(url: str) -> str:
    return f"product_img:{hashlib.sha256(url.encode()).hexdigest()}"


async def get_cached_product_image(url: str) -> bytes | None:
    client = get_redis_client()
    if not client:
        return None
    try:
        cached = await asyncio.to_thread(client.get, _product_image_key(url))
        if cached is not None:
            return base64.b64decode(cached) if isinstance(cached, str) else cached
    except Exception as exc:
        logger.error("Product image cache read failed: %s", exc)
        invalidate_redis_client()
    return None


async def set_cached_product_image(url: str, data: bytes) -> None:
    client = get_redis_client()
    if not client:
        return
    try:
        settings = get_settings()
        encoded = base64.b64encode(data).decode("ascii")
        await asyncio.to_thread(
            client.setex, _product_image_key(url), settings.product_image_cache_ttl_seconds, encoded
        )
    except Exception as exc:
        logger.error("Product image cache write failed: %s", exc)
        invalidate_redis_client()
