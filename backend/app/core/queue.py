import asyncio
import json
import logging
import time
import uuid

from app.core.config import get_settings
from app.core.crypto import decrypt_payload, encrypt_payload
from app.core.redis_client import get_redis_client, invalidate_redis_client, is_upstash_client

logger = logging.getLogger(__name__)

QUEUE_KEY = "jobs:queue"
PROCESSING_QUEUE_KEY = "jobs:processing"


def _job_key(job_id: str) -> str:
    return f"job:{job_id}"


def _create_job_sync(payload: dict, enqueue: bool) -> str:
    client = get_redis_client()
    if not client:
        raise RuntimeError("Redis is not configured; cannot enqueue job")

    job_id = uuid.uuid4().hex
    settings = get_settings()
    job_data = {
        "id": job_id,
        "status": "pending",
        "payload": encrypt_payload(json.dumps(payload)),
        "result": "",
        "error": "",
        "owner_id": payload.get("user_id") or "",
        "enqueued_at": str(int(time.time())),
    }
    try:
        try:
            client.hset(_job_key(job_id), mapping=job_data)
        except TypeError:
            # Upstash Redis SDK uses values= instead of mapping=
            client.hset(_job_key(job_id), values=job_data)
        client.expire(_job_key(job_id), settings.job_result_ttl_seconds)
        if enqueue:
            client.rpush(QUEUE_KEY, job_id)
    except Exception:
        invalidate_redis_client()
        raise
    logger.info("%s job %s", "Enqueued" if enqueue else "Created", job_id)
    return job_id


async def enqueue_job(payload: dict) -> str:
    return await asyncio.to_thread(_create_job_sync, payload, True)


async def create_job(payload: dict) -> str:
    """Create a persisted job without putting it on the worker queue."""
    return await asyncio.to_thread(_create_job_sync, payload, False)


def _get_job_sync(job_id: str, include_payload: bool) -> dict | None:
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
        if key == "payload" and not include_payload:
            continue
        if key in ("payload", "result") and val:
            if key == "payload":
                val = decrypt_payload(val)
            try:
                result[key] = json.loads(val)
            except json.JSONDecodeError:
                result[key] = val
        else:
            result[key] = val
    return result


async def get_job(job_id: str, include_payload: bool = False) -> dict | None:
    return await asyncio.to_thread(_get_job_sync, job_id, include_payload)


def _update_job_status_sync(job_id: str, status: str, result: dict | None = None, error: str | None = None) -> None:
    client = get_redis_client()
    if not client:
        return

    settings = get_settings()
    mapping = {"status": status}
    if status == "running":
        mapping["started_at"] = str(int(time.time()))
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


def renew_job_lease(job_id: str) -> None:
    """Refresh started_at so a still-running long job is not treated as stale
    and requeued (which would duplicate model cost and writes)."""
    client = get_redis_client()
    if not client:
        return
    try:
        mapping = {"started_at": str(int(time.time()))}
        try:
            client.hset(_job_key(job_id), mapping=mapping)
        except TypeError:
            client.hset(_job_key(job_id), values=mapping)
    except Exception:
        logger.exception("Failed to renew lease for job %s", job_id)
        invalidate_redis_client()


def _claim_orphaned_job_sync(job_id: str, stale_after_seconds: int) -> bool:
    client = get_redis_client()
    if not client:
        return False
    try:
        data = client.hgetall(_job_key(job_id)) or {}
        decoded = {
            (k.decode() if isinstance(k, bytes) else k): (v.decode() if isinstance(v, bytes) else v)
            for k, v in data.items()
        }
        if decoded.get("status") not in {"pending", "running"}:
            return False
        last_alive = decoded.get("started_at") or decoded.get("enqueued_at") or "0"
        try:
            if int(time.time()) - int(last_alive) < stale_after_seconds:
                return False
        except ValueError:
            pass
        # HSETNX makes the claim atomic: concurrent polls refund the job once.
        if not client.hsetnx(_job_key(job_id), "orphan_claimed", "1"):
            return False
        mapping = {"status": "failed", "error": "interrupted"}
        try:
            client.hset(_job_key(job_id), mapping=mapping)
        except TypeError:
            client.hset(_job_key(job_id), values=mapping)
        return True
    except Exception:
        invalidate_redis_client()
        raise


async def claim_orphaned_job(job_id: str, stale_after_seconds: int) -> bool:
    """Mark a pending/running job whose lease went stale as failed.

    In-process generations renew their lease while alive; a stale lease means
    the API process was restarted or crashed mid-generation. Returns True only
    for the single caller that claimed the job (and must refund it).
    """
    return await asyncio.to_thread(_claim_orphaned_job_sync, job_id, stale_after_seconds)


def dequeue_job(timeout: int = 5) -> str | None:
    client = get_redis_client()
    if not client:
        return None

    # Move jobs to a processing list before returning them. A restart can then
    # requeue abandoned jobs instead of silently losing a destructive pop.
    is_upstash = is_upstash_client(client)
    if not is_upstash:
        try:
            item = client.blmove(QUEUE_KEY, PROCESSING_QUEUE_KEY, timeout, "LEFT", "RIGHT")
            if item is None:
                return None
            return item.decode() if isinstance(item, bytes) else item
        except Exception as exc:
            logger.error("blmove failed, falling back to polling: %s", exc)

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            item = client.lmove(QUEUE_KEY, PROCESSING_QUEUE_KEY, "LEFT", "RIGHT")
        except Exception:
            item = None
        if item:
            if isinstance(item, bytes):
                return item.decode()
            return item
        time.sleep(0.5)
    return None


def acknowledge_job(job_id: str) -> None:
    """Remove a completed or failed job from the processing list."""
    client = get_redis_client()
    if not client:
        return
    try:
        client.lrem(PROCESSING_QUEUE_KEY, 1, job_id)
    except Exception:
        logger.exception("Failed to acknowledge job %s", job_id)
        invalidate_redis_client()


def recover_stale_jobs() -> int:
    """Return jobs abandoned by a crashed worker to the pending queue."""
    client = get_redis_client()
    if not client:
        return 0

    settings = get_settings()
    now = int(time.time())
    recovered = 0
    try:
        job_ids = client.lrange(PROCESSING_QUEUE_KEY, 0, -1)
        for raw_id in job_ids:
            job_id = raw_id.decode() if isinstance(raw_id, bytes) else raw_id
            data = client.hgetall(_job_key(job_id))
            started_at = data.get("started_at") if data else None
            if isinstance(started_at, bytes):
                started_at = started_at.decode()
            try:
                is_stale = not started_at or now - int(started_at) >= settings.job_visibility_timeout_seconds
            except (TypeError, ValueError):
                is_stale = True
            if not is_stale:
                continue
            if client.lrem(PROCESSING_QUEUE_KEY, 1, job_id):
                client.lpush(QUEUE_KEY, job_id)
                try:
                    client.hset(_job_key(job_id), mapping={"status": "pending", "started_at": ""})
                except TypeError:
                    client.hset(_job_key(job_id), values={"status": "pending", "started_at": ""})
                recovered += 1
    except Exception:
        logger.exception("Failed to recover stale jobs")
        invalidate_redis_client()
        return recovered

    if recovered:
        logger.warning("Requeued %d stale jobs", recovered)
    return recovered
