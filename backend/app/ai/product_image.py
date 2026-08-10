import asyncio
import ipaddress
import re
import socket
from dataclasses import dataclass
from io import BytesIO
from urllib.parse import urljoin, urlparse, urlunparse

import httpx
from PIL import Image

from app.core.cache import get_cached_product_image, set_cached_product_image
from app.core.config import get_settings

# Decompression bomb protection — PIL raises DecompressionBombError above this
Image.MAX_IMAGE_PIXELS = 50_000_000

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
MAX_HTML_BYTES = 5 * 1024 * 1024


def _verify_and_normalize(content: bytes) -> bytes:
    return _normalize_image(_verify_image(content))


def _extract_image_candidate(html: str) -> str | None:
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


async def _get_safe(client: httpx.AsyncClient, url: str) -> "FetchedResponse":
    """GET following redirects manually, validating and pinning every hop.

    The hostname is resolved and validated once, then the connection is made to
    that exact IP (with the original Host header and TLS SNI preserved). This
    closes the DNS-rebinding TOCTOU: the address httpx connects to is the same
    one that passed the SSRF check, not a second independent resolution.
    """
    current = url
    for _ in range(settings.product_image_max_redirects + 1):
        parsed = urlparse(current)
        host = (parsed.hostname or "").strip("[]")
        pinned_ip = await _ensure_public_url(current)
        port = parsed.port
        netloc_ip = f"[{pinned_ip}]" if ":" in pinned_ip else pinned_ip
        connect_netloc = f"{netloc_ip}:{port}" if port else netloc_ip
        connect_url = urlunparse(parsed._replace(netloc=connect_netloc))
        host_header = host if port is None or port in (80, 443) else f"{host}:{port}"
        extensions = {"sni_hostname": host} if parsed.scheme == "https" else {}

        request = client.build_request("GET", connect_url, headers={"Host": host_header}, extensions=extensions)
        response = await client.send(request, stream=True)
        try:
            if response.is_redirect:
                location = response.headers.get("location")
                if not location:
                    raise ValueError("Redirect without a location")
                current = urljoin(current, location)
                continue
            response.raise_for_status()
            max_bytes = MAX_IMAGE_BYTES if response.headers.get("content-type", "").startswith("image/") else MAX_HTML_BYTES
            content_length = response.headers.get("content-length")
            if content_length and int(content_length) > max_bytes:
                raise ValueError("Product response too large")
            content = bytearray()
            async for chunk in response.aiter_bytes():
                content.extend(chunk)
                if len(content) > max_bytes:
                    raise ValueError("Product response too large")
            return FetchedResponse(dict(response.headers), bytes(content), current)
        finally:
            await response.aclose()
    raise ValueError("Too many redirects")


@dataclass(frozen=True)
class FetchedResponse:
    headers: dict[str, str]
    content: bytes
    url: str


async def _get_with_retry(client: httpx.AsyncClient, url: str) -> FetchedResponse:
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            return await _get_safe(client, url)
        except (httpx.TimeoutException, httpx.TransportError, httpx.HTTPStatusError) as exc:
            last_exc = exc
            await asyncio.sleep(0.2 * (2 ** attempt))

    if isinstance(last_exc, httpx.HTTPStatusError):
        code = last_exc.response.status_code if last_exc.response is not None else "unknown"
        raise ValueError(f"Failed to fetch product page (HTTP {code})") from last_exc
    if isinstance(last_exc, httpx.TimeoutException):
        raise ValueError("Failed to fetch product page (timeout)") from last_exc
    raise ValueError("Failed to fetch product page") from last_exc

def _verify_image(content: bytes) -> bytes:
    image = Image.open(BytesIO(content))
    image.verify()
    return content


def _normalize_image(content: bytes, fmt: str | None = None, quality: int | None = None) -> bytes:
    format_str = (fmt or settings.image_output_format).lower()
    q = quality or settings.image_output_quality
    image = Image.open(BytesIO(content)).convert("RGB")
    w, h = image.size
    longer = max(w, h)
    if longer > MAX_SIDE_PX:
        scale = MAX_SIDE_PX / longer
        image = image.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buffer = BytesIO()
    if format_str == "webp":
        image.save(buffer, format="WEBP", quality=q, method=6)
    elif format_str == "avif":
        try:
            image.save(buffer, format="AVIF", quality=q)
        except Exception:
            image.save(buffer, format="WEBP", quality=q, method=6)
    else:
        image.save(buffer, format="JPEG", quality=q, optimize=True)
    return buffer.getvalue()


async def _upload_to_cdn(key: str, data: bytes, content_type: str) -> str | None:
    """Upload processed image to S3-compatible CDN if configured."""
    if not settings.product_image_cdn_enabled:
        return None
    if not all([settings.s3_endpoint_url, settings.s3_bucket, settings.s3_access_key, settings.s3_secret_key]):
        return None
    try:
        import aiobotocore
    except ImportError:
        return None
    session = aiobotocore.get_session()
    async with session.create_client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
    ) as client:
        await client.put_object(
            Bucket=settings.s3_bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            ACL="public-read",
        )
    base = settings.product_image_cdn_base_url or settings.s3_endpoint_url
    return f"{base.rstrip('/')}/{key}"


def _sanitize_image_url(image_url: str, source_page_url: str) -> str:
    resolved = urljoin(source_page_url, image_url)
    parsed = urlparse(resolved)
    if parsed.scheme not in {"https", "http"}:
        raise ValueError("Invalid image url scheme")
    if parsed.scheme == "http":  # force https
        parsed = parsed._replace(scheme="https")
    return urlunparse(parsed)


def _reject_if_private(addr: str) -> None:
    ip = ipaddress.ip_address(addr)
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_unspecified:
        raise ValueError("URL resolves to a private address")


async def _ensure_public_url(url: str) -> str:
    """Validate the URL against SSRF and return the pinned public IP to connect to.

    Raises ValueError if the host resolves to a private/loopback address. The
    returned IP is the exact address the caller must connect to, so the
    security check and the connection use the same resolution (no rebinding).
    """
    parsed = urlparse(url)
    hostname = (parsed.hostname or '').lower().strip('[]')
    if not hostname:
        raise ValueError("URL has no hostname")
    if hostname in ('localhost', '0.0.0.0', '::1', '[::]'):
        raise ValueError("URL hostname not allowed")
    # IP literal: validate and pin directly.
    try:
        ipaddress.ip_address(hostname)
        _reject_if_private(hostname)
        return hostname
    except ValueError as exc:
        if "private address" in str(exc) or "not allowed" in str(exc) or "no hostname" in str(exc):
            raise
    # DNS resolution check (run off the event loop to avoid blocking)
    loop = asyncio.get_running_loop()
    try:
        addr_infos = await loop.run_in_executor(
            None,
            lambda: socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM),
        )
    except OSError as exc:
        raise ValueError("Unable to resolve URL hostname") from exc
    pinned: str | None = None
    for _, _, _, _, sockaddr in addr_infos:
        addr = sockaddr[0]
        _reject_if_private(addr)
        if pinned is None:
            pinned = addr
    if pinned is None:
        raise ValueError("Unable to resolve URL hostname")
    return pinned


async def fetch_product_image(url: str, timeout: float | None = None) -> bytes:
    parsed_url = urlparse(url)
    if parsed_url.scheme not in {"https", "http"} or not parsed_url.netloc:
        raise ValueError("Invalid product URL")

    await _ensure_public_url(url)

    timeout = timeout or settings.product_image_timeout

    cached = await get_cached_product_image(url)
    if cached:
        return cached

    async with httpx.AsyncClient(timeout=timeout, headers=DEFAULT_HEADERS, follow_redirects=False) as client:
        resp = await _get_with_retry(client, url)
        content_type = resp.headers.get("content-type", "")

        if content_type.startswith("image/"):
            data = await asyncio.to_thread(_verify_and_normalize, resp.content)
            await set_cached_product_image(url, data)
            return data

        # If it's an HTML page, try to extract a likely product image
        html = resp.content.decode("utf-8", errors="replace")
        image_candidate = _extract_image_candidate(html)
        if not image_candidate:
            raise ValueError("Product page does not expose an image")

        image_url = _sanitize_image_url(image_candidate, url)
        await _ensure_public_url(image_url)

        try:
            img_resp = await _get_safe(client, image_url)
        except httpx.HTTPStatusError as exc:
            raise ValueError(f"Failed to fetch product image (HTTP {exc.response.status_code})") from exc
        except httpx.TimeoutException as exc:
            raise ValueError("Failed to fetch product image (timeout)") from exc
        except httpx.HTTPError as exc:
            raise ValueError("Failed to fetch product image") from exc
        if not img_resp.headers.get("content-type", "").startswith("image/"):
            raise ValueError("Resolved product image is not an image")

        data = await asyncio.to_thread(_verify_and_normalize, img_resp.content)
        await set_cached_product_image(url, data)
        return data
