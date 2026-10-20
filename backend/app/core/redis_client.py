import asyncio
import logging
import time

import redis
from upstash_redis import Redis as UpstashRedis

from app.core.config import get_settings

logger = logging.getLogger(__name__)
_redis_client: redis.Redis | UpstashRedis | None = None
_next_retry_at: float = 0.0
_RETRY_COOLDOWN_SEC = 15.0
# Consecutive failed connection attempts, reported once a connection succeeds.
_failed_attempts: int = 0
# Startup retries absorb transient DNS failures of a freshly deployed instance.
STARTUP_CONNECT_ATTEMPTS = 3
STARTUP_RETRY_DELAY_SEC = 2.0


def is_redis_configured() -> bool:
    settings = get_settings()
    return bool(settings.redis_url or settings.upstash_redis_rest_url)


def get_redis_client() -> redis.Redis | UpstashRedis | None:
    global _redis_client, _next_retry_at, _failed_attempts
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
        if _failed_attempts:
            logger.info("Redis connected after %d failed attempt(s)", _failed_attempts)
        else:
            logger.info("Redis connected")
        _failed_attempts = 0
    except Exception as exc:
        _failed_attempts += 1
        logger.error("Redis connection failed (attempt %d): %s", _failed_attempts, exc)
        _redis_client = None

    return _redis_client


async def connect_redis_at_startup(
    attempts: int = STARTUP_CONNECT_ATTEMPTS, delay_seconds: float = STARTUP_RETRY_DELAY_SEC
) -> bool:
    """Connect during startup, retrying a few times without the usual cooldown.

    A new Render instance can fail DNS resolution for a moment right after
    boot; one failed attempt should not leave the API without Redis until
    the first request retries it.
    """
    global _next_retry_at
    if not is_redis_configured():
        return False
    for attempt in range(attempts):
        _next_retry_at = 0.0
        if await asyncio.to_thread(get_redis_client) is not None:
            return True
        if attempt < attempts - 1:
            await asyncio.sleep(delay_seconds)
    return False


def get_redis_client_required() -> redis.Redis | UpstashRedis:
    client = get_redis_client()
    if client is None:
        raise RuntimeError("Redis is not configured or unreachable")
    return client


def is_upstash_client(client: object) -> bool:
    return client.__class__.__module__.startswith("upstash_redis")


def invalidate_redis_client() -> None:
    """Drop the cached client after a failed operation so the next call can
    rebuild a fresh connection instead of reusing a dead one until restart."""
    global _redis_client
    _redis_client = None
