import asyncio
import json
import logging
import time
import uuid

from app.core.config import get_settings
from app.core.redis_client import get_redis_client, invalidate_redis_client

logger = logging.getLogger(__name__)

QUEUE_KEY = "jobs:queue"


def _job_key(job_id: str) -> str:
    return f"job:{job_id}"


def _enqueue_job_sync(payload: dict) -> str:
    client = get_redis_client()
    if not client:
        raise RuntimeError("Redis is not configured; cannot enqueue job")

    job_id = uuid.uuid4().hex
    settings = get_settings()
    job_data = {
        "id": job_id,
        "status": "pending",
        "payload": json.dumps(payload),
        "result": "",
        "error": "",
        "owner_id": payload.get("user_id") or "",
    }
    try:
        try:
            client.hset(_job_key(job_id), mapping=job_data)
        except TypeError:
            # Upstash Redis SDK uses values= instead of mapping=
            client.hset(_job_key(job_id), values=job_data)
        client.expire(_job_key(job_id), settings.job_result_ttl_seconds)
        client.rpush(QUEUE_KEY, job_id)
    except Exception:
        invalidate_redis_client()
        raise
    logger.info("Enqueued job %s", job_id)
    return job_id


async def enqueue_job(payload: dict) -> str:
    return await asyncio.to_thread(_enqueue_job_sync, payload)


def _get_job_sync(job_id: str) -> dict | None:
    client = get_redis_client()
    if not client:
        return None

    try:
        data = client.hgetall(_job_key(job_id))
    except Exception:
        invalidate_redis_client()
        raise
    if not data:
        return None

    result = {}
    for k, v in data.items():
        key = k.decode() if isinstance(k, bytes) else k
        val = v.decode() if isinstance(v, bytes) else v
        if val == "":
            val = None
        if key in ("payload", "result") and val:
            try:
                result[key] = json.loads(val)
            except json.JSONDecodeError:
                result[key] = val
        else:
            result[key] = val
    return result


async def get_job(job_id: str) -> dict | None:
    return await asyncio.to_thread(_get_job_sync, job_id)


def _update_job_status_sync(job_id: str, status: str, result: dict | None = None, error: str | None = None) -> None:
    client = get_redis_client()
    if not client:
        return

    settings = get_settings()
    mapping = {"status": status}
    if result is not None:
        mapping["result"] = json.dumps(result)
    if error is not None:
        mapping["error"] = error

    try:
        try:
            client.hset(_job_key(job_id), mapping=mapping)
        except TypeError:
            client.hset(_job_key(job_id), values=mapping)
        client.expire(_job_key(job_id), settings.job_result_ttl_seconds)
    except Exception:
        invalidate_redis_client()
        raise


async def update_job_status(
    job_id: str, status: str, result: dict | None = None, error: str | None = None
) -> None:
    await asyncio.to_thread(_update_job_status_sync, job_id, status, result, error)


def dequeue_job(timeout: int = 5) -> str | None:
    client = get_redis_client()
    if not client:
        return None

    # Native redis supports blocking pop (no busy-wait); Upstash REST does not.
    is_upstash = client.__class__.__module__.startswith("upstash_redis")
    if not is_upstash:
        try:
            popped = client.blpop(QUEUE_KEY, timeout=timeout)
            if not popped:
                return None
            item = popped[1]
            return item.decode() if isinstance(item, bytes) else item
        except Exception as exc:
            logger.error("blpop failed, falling back to polling: %s", exc)

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        item = client.lpop(QUEUE_KEY)
        if item:
            if isinstance(item, bytes):
                return item.decode()
            return item
        time.sleep(0.5)
    return None
