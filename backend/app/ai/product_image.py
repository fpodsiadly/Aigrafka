import asyncio
import re
import time
from io import BytesIO
from typing import Optional
from urllib.parse import urljoin, urlparse, urlunparse

import httpx
from PIL import Image

from app.core.config import get_settings

settings = get_settings()

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


def _extract_image_candidate(html: str) -> Optional[str]:
    patterns = [
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
        r'<meta[^>]+name=["\']twitter:image(?::src)?["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']twitter:image(?::src)?["\']',
        r'<meta[^>]+itemprop=["\']image["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+itemprop=["\']image["\']',
    ]
    for pattern in patterns:
        match = re.search(pattern, html, re.IGNORECASE)
        if match:
            return match.group(1)

    img_match = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', html, re.IGNORECASE)
    if img_match:
        return img_match.group(1)
    return None


async def _get_with_retry(client: httpx.AsyncClient, url: str) -> httpx.Response:
    last_exc: Optional[Exception] = None
    for _ in range(2):
        try:
            response = await client.get(url)
            response.raise_for_status()
            return response
        except (httpx.TimeoutException, httpx.TransportError, httpx.HTTPStatusError) as exc:
            last_exc = exc
            await asyncio.sleep(0.2)

    if isinstance(last_exc, httpx.HTTPStatusError):
        code = last_exc.response.status_code if last_exc.response is not None else "unknown"
        raise ValueError(f"Failed to fetch product page (HTTP {code})") from last_exc
    if isinstance(last_exc, httpx.TimeoutException):
        raise ValueError("Failed to fetch product page (timeout)") from last_exc
    raise ValueError("Failed to fetch product page") from last_exc

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
    image.save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()


def _sanitize_image_url(image_url: str, source_page_url: str) -> str:
    resolved = urljoin(source_page_url, image_url)
    parsed = urlparse(resolved)
    if parsed.scheme not in {"https", "http"}:
        raise ValueError("Invalid image url scheme")
    if parsed.scheme == "http":  # force https
        parsed = parsed._replace(scheme="https")
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
    parsed_url = urlparse(url)
    if parsed_url.scheme not in {"https", "http"} or not parsed_url.netloc:
        raise ValueError("Invalid product URL")

    timeout = timeout or settings.product_image_timeout

    cached = _get_cached(url)
    if cached:
        return cached

    async with httpx.AsyncClient(timeout=timeout, headers=DEFAULT_HEADERS, follow_redirects=True) as client:
        resp = await _get_with_retry(client, url)
        content_type = resp.headers.get("Content-Type", "")

        if content_type.startswith("image/"):
            if len(resp.content) > MAX_IMAGE_BYTES:
                raise ValueError("Product image too large")
            data = _verify_image(resp.content)
            data = _normalize_image(data)
            _set_cache(url, data)
            return data

        # If it's HTML page, try to extract a likely product image
        html = resp.text
        image_candidate = _extract_image_candidate(html)
        if not image_candidate:
            raise ValueError("Product page does not expose an image")

        image_url = _sanitize_image_url(image_candidate, url)

        try:
            img_resp = await client.get(image_url)
            img_resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise ValueError(f"Failed to fetch product image (HTTP {exc.response.status_code})") from exc
        except httpx.TimeoutException as exc:
            raise ValueError("Failed to fetch product image (timeout)") from exc
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
