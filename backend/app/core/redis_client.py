import logging
import time

import redis
from upstash_redis import Redis as UpstashRedis

from app.core.config import get_settings

logger = logging.getLogger(__name__)
_redis_client: redis.Redis | UpstashRedis | None = None
_next_retry_at: float = 0.0
_RETRY_COOLDOWN_SEC = 15.0


def get_redis_client() -> redis.Redis | UpstashRedis | None:
    global _redis_client, _next_retry_at
    if _redis_client is not None:
        return _redis_client

    # Avoid hammering a full reconnect (with 5s timeouts) on every call when
    # Redis is down; back off between attempts.
    now = time.monotonic()
    if now < _next_retry_at:
        return None
    _next_retry_at = now + _RETRY_COOLDOWN_SEC

    settings = get_settings()
    url = settings.redis_url or settings.upstash_redis_rest_url
    token = settings.redis_token or settings.upstash_redis_rest_token

    if not url:
        logger.warning("REDIS_URL / UPSTASH_REDIS_REST_URL not set; Redis features disabled")
        return None

    try:
        if url.startswith("https://"):
            if not token:
                logger.error("Redis REST URL requires REDIS_TOKEN or UPSTASH_REDIS_REST_TOKEN")
                return None
            _redis_client = UpstashRedis(url=url, token=token)
            _redis_client.ping()
        else:
            _redis_client = redis.from_url(url, decode_responses=True, socket_connect_timeout=5, socket_timeout=5)
            _redis_client.ping()
        logger.info("Redis connected")
    except Exception as exc:
        logger.error("Redis connection failed: %s", exc)
        _redis_client = None

    return _redis_client


def get_redis_client_required() -> redis.Redis | UpstashRedis:
    client = get_redis_client()
    if client is None:
        raise RuntimeError("Redis is not configured or unreachable")
    return client


def invalidate_redis_client() -> None:
    """Drop the cached client after a failed operation so the next call can
    rebuild a fresh connection instead of reusing a dead one until restart."""
    global _redis_client
    _redis_client = None
