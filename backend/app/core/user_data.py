import asyncio
import logging

from app.core.redis_client import get_redis_client, invalidate_redis_client

logger = logging.getLogger(__name__)


def _index_key(user_id: str) -> str:
    return f"user_data:{user_id}"


def _track_sync(user_id: str, key: str, ttl_seconds: int) -> None:
    client = get_redis_client()
    if client is None:
        return
    try:
        index_key = _index_key(user_id)
        client.sadd(index_key, key)
        # The index only needs to outlive the longest-lived entry it points to.
        current_ttl = client.ttl(index_key)
        if current_ttl is None or current_ttl < ttl_seconds:
            client.expire(index_key, ttl_seconds)
    except Exception:
        logger.exception("Failed to index user data key")
        invalidate_redis_client()


async def track_user_data_key(user_id: str | None, key: str, ttl_seconds: int) -> None:
    """Remember that a Redis key holds this user's personal data (images with their face)."""
    if not user_id:
        return
    await asyncio.to_thread(_track_sync, user_id, key, ttl_seconds)


def _delete_sync(user_id: str) -> int:
    client = get_redis_client()
    if client is None:
        return 0
    index_key = _index_key(user_id)
    try:
        members = client.smembers(index_key) or set()
        keys = [member.decode() if isinstance(member, bytes) else member for member in members]
        deleted = client.delete(*keys) if keys else 0
        client.delete(index_key)
        return int(deleted or 0)
    except Exception:
        invalidate_redis_client()
        raise


async def delete_user_data_keys(user_id: str) -> int:
    """Delete every indexed Redis entry holding this user's data; returns how many were removed."""
    return await asyncio.to_thread(_delete_sync, user_id)
