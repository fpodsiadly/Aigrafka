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
            # A trusted proxy appends the peer address. Never trust a
            # client-controlled leftmost value from a forwarded chain.
            last = forwarded_for.split(",")[-1].strip()
            if last:
                return last
    if request.client and request.client.host:
        return request.client.host
    return "unknown"
