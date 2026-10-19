import asyncio
import base64
import hashlib
import hmac
import json
import logging
from urllib.parse import quote

from app.core.config import get_settings
from app.core.redis_client import get_redis_client
from app.core.user_data import track_user_data_key

RESULT_IMAGE_KEY_PREFIX = "result_image:"
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
logger = logging.getLogger(__name__)


def _signature(image_id: str) -> str:
    secret = get_settings().jwt_secret.encode()
    return hmac.new(secret, image_id.encode(), hashlib.sha256).hexdigest()


def _build_token(image_id: str) -> str:
    return f"{image_id}.{_signature(image_id)}"


def _parse_token(token: str) -> str | None:
    image_id, separator, signature = token.partition(".")
    if not separator or not image_id or not signature:
        return None
    return image_id if hmac.compare_digest(signature, _signature(image_id)) else None


def _store_result_image_sync(image_base64: str, mime_type: str) -> tuple[str, str] | None:
    client = get_redis_client()
    if client is None or mime_type not in ALLOWED_IMAGE_TYPES:
        return None

    try:
        image_id = hashlib.sha256(f"{mime_type}:".encode() + image_base64.encode()).hexdigest()
        payload = json.dumps({"data": image_base64, "mime_type": mime_type}, separators=(",", ":"))
        key = f"{RESULT_IMAGE_KEY_PREFIX}{image_id}"
        client.set(key, payload, ex=get_settings().result_image_ttl_seconds)
        return _build_token(image_id), key
    except Exception as exc:
        logger.error("Result image storage failed: %s", exc)
        return None


async def store_result_image(image_base64: str, mime_type: str, owner_id: str | None = None) -> str | None:
    stored = await asyncio.to_thread(_store_result_image_sync, image_base64, mime_type)
    if stored is None:
        return None
    token, key = stored
    await track_user_data_key(owner_id, key, get_settings().result_image_ttl_seconds)
    return token


def _get_result_image_sync(token: str) -> tuple[bytes, str] | None:
    image_id = _parse_token(token)
    if image_id is None:
        return None

    client = get_redis_client()
    if client is None:
        return None
    try:
        raw = client.get(f"{RESULT_IMAGE_KEY_PREFIX}{image_id}")
        if not raw:
            return None
        if isinstance(raw, bytes):
            raw = raw.decode()
        payload = json.loads(raw)
        mime_type = payload.get("mime_type")
        data = payload.get("data")
        if mime_type not in ALLOWED_IMAGE_TYPES or not isinstance(data, str):
            return None
        return base64.b64decode(data, validate=True), mime_type
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return None


async def get_result_image(token: str) -> tuple[bytes, str] | None:
    return await asyncio.to_thread(_get_result_image_sync, token)


def build_result_image_url(base_url: str, token: str) -> str:
    return f"{base_url.rstrip('/')}/images/{quote(token, safe='')}"
