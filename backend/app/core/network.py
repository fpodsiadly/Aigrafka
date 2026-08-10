from fastapi import Request

from app.core.config import get_settings


def client_ip(request: Request) -> str:
    """Resolve client IP.

    `x-forwarded-for` is only trusted when TRUST_PROXY_HEADERS is enabled
    (i.e. the app runs behind a known reverse proxy). Otherwise the header is
    spoofable and the direct socket peer is used instead.
    """
    settings = get_settings()
    if settings.trust_proxy_headers:
        forwarded_for = request.headers.get("x-forwarded-for", "")
        if forwarded_for:
            # Only enable TRUST_PROXY_HEADERS behind a proxy that OVERWRITES
            # inbound X-Forwarded-For (e.g. Render). The leftmost entry is then
            # the real origin client, which is what per-client rate limits must
            # key on; using the socket peer would collapse all users onto the
            # proxy IP (one shared bucket).
            first = forwarded_for.split(",")[0].strip()
            if first:
                return first
    if request.client and request.client.host:
        return request.client.host
    return "unknown"
