import asyncio
import logging
import threading
import time
import uuid

from fastapi import HTTPException, Request, status

from app.core.config import get_settings
from app.core.network import client_ip
from app.core.redis_client import get_redis_client, invalidate_redis_client, is_upstash_client

logger = logging.getLogger(__name__)

# Process-local fallback used when Redis is unavailable, so limits are still
# enforced (fail-closed against unlimited traffic) instead of silently skipped.
_local_hits: dict[str, list[int]] = {}
_local_lock = threading.Lock()
_last_purge_ms = 0

BURST_WINDOW_MS = 10 * 1000
MAX_WINDOW_MS = 60 * 60 * 1000
PURGE_INTERVAL_MS = 5 * 60 * 1000


def _maybe_purge_local(now_ms: int) -> None:
    """Drop stale keys from the fallback store so it does not grow unbounded."""
    global _last_purge_ms
    with _local_lock:
        if now_ms - _last_purge_ms < PURGE_INTERVAL_MS:
            return
        _last_purge_ms = now_ms
        cutoff = now_ms - MAX_WINDOW_MS
        stale = [k for k, hits in _local_hits.items() if not hits or max(hits) <= cutoff]
        for k in stale:
            del _local_hits[k]


def _too_many(retry_after: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many generation requests. Please wait a moment.",
        headers={"Retry-After": str(retry_after)},
    )


def _check_local_window(key: str, window_ms: int, max_count: int, now_ms: int) -> bool:
    """Sliding-window check against process-local store. Returns True if allowed."""
    with _local_lock:
        hits = [t for t in _local_hits.get(key, []) if t > now_ms - window_ms]
        if len(hits) >= max_count:
            _local_hits[key] = hits
            return False
        hits.append(now_ms)
        _local_hits[key] = hits
        return True


def _check_redis_window(client, key: str, window_ms: int, max_count: int, now_ms: int) -> bool:
    """Sliding-window check against Redis sorted set. Returns True if allowed."""
    client.zremrangebyscore(key, 0, now_ms - window_ms)
    count = client.zcard(key)
    if count >= max_count:
        return False
    client.zadd(key, {f"{now_ms}:{count}": now_ms})
    client.expire(key, int(window_ms / 1000) + 1)
    return True


_GENERATE_RATE_LIMIT_SCRIPT = """
local now = tonumber(ARGV[1])
local member = ARGV[2]
for index, key in ipairs(KEYS) do
    local offset = 2 + (index - 1) * 3
    local window = tonumber(ARGV[offset + 1])
    local maximum = tonumber(ARGV[offset + 2])
    redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
    if redis.call('ZCARD', key) >= maximum then
        return index
    end
end
for index, key in ipairs(KEYS) do
    local offset = 2 + (index - 1) * 3
    local window = tonumber(ARGV[offset + 1])
    local expiry = tonumber(ARGV[offset + 3])
    redis.call('ZADD', key, now, member .. ':' .. index)
    redis.call('EXPIRE', key, expiry)
end
return 0
"""


def _check_redis_windows(client, checks: list[tuple[str, int, int, int]], now_ms: int) -> int:
    keys = [key for key, _, _, _ in checks]
    args = [str(now_ms), f"{now_ms}:{uuid.uuid4().hex}"]
    for _, window_ms, max_count, _ in checks:
        args.extend((str(window_ms), str(max_count), str(int(window_ms / 1000) + 1)))

    if is_upstash_client(client):
        result = client.eval(_GENERATE_RATE_LIMIT_SCRIPT, keys=keys, args=args)
    else:
        result = client.eval(_GENERATE_RATE_LIMIT_SCRIPT, len(keys), *keys, *args)
    return int(result)


def enforce_auth_rate_limit(bucket_key: str, max_requests: int, window_seconds: int, retry_after: int | None = None) -> None:
    """Shared sliding-window limiter for auth endpoints.

    Uses Redis so limits hold across worker processes; falls back to the
    process-local store (fail-closed) when Redis is unavailable.
    """
    now_ms = int(time.time() * 1000)
    window_ms = window_seconds * 1000
    key = f"rate_limit:auth:{bucket_key}"
    client = get_redis_client()
    if client:
        try:
            allowed = _check_redis_window(client, key, window_ms, max_requests, now_ms)
        except Exception as exc:
            logger.error("Auth rate limit Redis error for %s; using local fallback: %s", key, exc)
            invalidate_redis_client()
            allowed = _check_local_window(key, window_ms, max_requests, now_ms)
    else:
        allowed = _check_local_window(key, window_ms, max_requests, now_ms)

    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many attempts. Retry in {retry_after or window_seconds}s",
            headers={"Retry-After": str(retry_after or window_seconds)},
        )


async def enforce_generate_rate_limit(request: Request, user_id: str | None) -> None:
    settings = get_settings()
    client = get_redis_client()
    ip = client_ip(request)

    now_ms = int(time.time() * 1000)
    minute_ms = 60 * 1000
    hour_ms = 60 * 60 * 1000

    _maybe_purge_local(now_ms)

    scopes = [("ip", ip)]
    if user_id:
        scopes.append(("user", user_id))

    # (suffix, window_ms, max_count, retry_after_seconds)
    windows = [
        ("burst", BURST_WINDOW_MS, settings.generate_rate_limit_burst, 10),
        ("minute", minute_ms, settings.generate_rate_limit_per_minute, 60 - int(time.time() % 60)),
        ("hour", hour_ms, settings.generate_rate_limit_per_hour, 3600),
    ]

    checks = [
        (f"rate_limit:generate:{scope}:{ident}:{suffix}", window_ms, max_count, retry_after)
        for scope, ident in scopes
        for suffix, window_ms, max_count, retry_after in windows
    ]

    if client:
        try:
            blocked_index = await asyncio.to_thread(_check_redis_windows, client, checks, now_ms)
            if blocked_index:
                key, _, _, retry_after = checks[blocked_index - 1]
                logger.warning("Rate limit hit: %s", key)
                raise _too_many(retry_after)
            return
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("Rate limit Redis error; using local fallback: %s", exc)
            invalidate_redis_client()

    for key, window_ms, max_count, retry_after in checks:
        if not _check_local_window(key, window_ms, max_count, now_ms):
            logger.warning("Rate limit hit: %s", key)
            raise _too_many(retry_after)
