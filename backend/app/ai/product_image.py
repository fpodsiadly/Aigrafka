import re
import time
from typing import Optional
from urllib.parse import urlparse, urlunparse

import httpx
from PIL import Image

from app.core.config import get_settings

settings = get_settings()

ALLOWED_HOST = "reserved.com"
DEFAULT_HEADERS = {
    "User-Agent": "Aigrafka-Demo/1.0 (+https://aigrafka.example)",
}
MAX_IMAGE_BYTES = settings.max_product_image_mb * 1024 * 1024
CACHE_TTL = 300  # seconds
_CACHE: dict[str, tuple[float, bytes]] = {}


def _is_allowed(url: str) -> bool:
    return urlparse(url).netloc.endswith(ALLOWED_HOST)


def _verify_image(content: bytes) -> bytes:
    import io

    image = Image.open(io.BytesIO(content))
    image.verify()
    return content


def _sanitize_image_url(image_url: str) -> str:
    parsed = urlparse(image_url)
    if parsed.scheme in {"", "//"}:
        parsed = parsed._replace(scheme="https")
    if parsed.scheme not in {"https", "http"}:
        raise ValueError("Invalid image url scheme")
    if parsed.scheme == "http":  # force https
        parsed = parsed._replace(scheme="https")
    if parsed.netloc and not parsed.netloc.endswith(ALLOWED_HOST):
        raise ValueError("Image host not allowed")
    return urlunparse(parsed)


def _get_cached(url: str) -> Optional[bytes]:
    entry = _CACHE.get(url)
    if not entry:
        return None
    ts, data = entry
    if time.time() - ts > CACHE_TTL:
        _CACHE.pop(url, None)
        return None
    return data


def _set_cache(url: str, data: bytes) -> None:
    _CACHE[url] = (time.time(), data)


async def fetch_product_image(url: str, timeout: Optional[float] = None) -> bytes:
    if not _is_allowed(url):
        raise ValueError("Only reserved.com URLs are allowed in demo")

    timeout = timeout or settings.product_image_timeout

    cached = _get_cached(url)
    if cached:
        return cached

    async with httpx.AsyncClient(timeout=timeout, headers=DEFAULT_HEADERS, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        content_type = resp.headers.get("Content-Type", "")

        if content_type.startswith("image/"):
            if len(resp.content) > MAX_IMAGE_BYTES:
                raise ValueError("Product image too large")
            data = _verify_image(resp.content)
            _set_cache(url, data)
            return data

        # If it's HTML page, try to extract og:image
        html = resp.text
        match = re.search(r'<meta[^>]+property=["\"]og:image["\"][^>]+content=["\"]([^"\"]+)["\"]', html, re.IGNORECASE)
        if not match:
            raise ValueError("Product page does not expose an image")

        image_url = _sanitize_image_url(match.group(1))

        img_resp = await client.get(image_url)
        img_resp.raise_for_status()
        if not img_resp.headers.get("Content-Type", "").startswith("image/"):
            raise ValueError("Resolved product image is not an image")
        if len(img_resp.content) > MAX_IMAGE_BYTES:
            raise ValueError("Product image too large")

        data = _verify_image(img_resp.content)
        _set_cache(url, data)
        return data
