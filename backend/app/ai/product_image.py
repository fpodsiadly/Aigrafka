import re
import time
from io import BytesIO
from typing import Optional
from urllib.parse import urlparse, urlunparse

import httpx
from PIL import Image

from app.core.config import get_settings

settings = get_settings()

ALLOWED_HOST = "reserved.com"
DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
}
MAX_IMAGE_BYTES = settings.max_product_image_mb * 1024 * 1024
MAX_SIDE_PX = settings.max_side_px
CACHE_TTL = 300  # seconds
_CACHE: dict[str, tuple[float, bytes]] = {}


def _is_allowed(url: str) -> bool:
    return urlparse(url).netloc.endswith(ALLOWED_HOST)


def _verify_image(content: bytes) -> bytes:
    import io

    image = Image.open(io.BytesIO(content))
    image.verify()
    return content


def _normalize_image(content: bytes) -> bytes:
    image = Image.open(BytesIO(content)).convert("RGB")
    w, h = image.size
    longer = max(w, h)
    if longer > MAX_SIDE_PX:
        scale = MAX_SIDE_PX / longer
        image = image.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=90)
    return buffer.getvalue()


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
        try:
            resp = await client.get(url)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise ValueError("Failed to fetch product page") from exc
        content_type = resp.headers.get("Content-Type", "")

        if content_type.startswith("image/"):
            if len(resp.content) > MAX_IMAGE_BYTES:
                raise ValueError("Product image too large")
            data = _verify_image(resp.content)
            data = _normalize_image(data)
            _set_cache(url, data)
            return data

        # If it's HTML page, try to extract og:image
        html = resp.text
        match = re.search(r'<meta[^>]+property=["\"]og:image["\"][^>]+content=["\"]([^"\"]+)["\"]', html, re.IGNORECASE)
        if not match:
            raise ValueError("Product page does not expose an image")

        image_url = _sanitize_image_url(match.group(1))

        try:
            img_resp = await client.get(image_url)
            img_resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise ValueError("Failed to fetch product image") from exc
        if not img_resp.headers.get("Content-Type", "").startswith("image/"):
            raise ValueError("Resolved product image is not an image")
        if len(img_resp.content) > MAX_IMAGE_BYTES:
            raise ValueError("Product image too large")

        data = _verify_image(img_resp.content)
        data = _normalize_image(data)
        _set_cache(url, data)
        return data
