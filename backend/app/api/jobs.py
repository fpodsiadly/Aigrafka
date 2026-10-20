import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.db import add_tokens
from app.core.metrics import track_token_refund
from app.core.queue import claim_orphaned_job, get_job
from app.core.security import get_optional_user_id

router = APIRouter(prefix="/jobs", tags=["jobs"])
logger = logging.getLogger(__name__)


class JobStatusResponse(BaseModel):
    id: str
    status: str
    result: dict | None = None
    error: str | None = None


async def _fail_if_orphaned(job_id: str) -> None:
    """Fail and refund a job whose generation died with a restarted API process."""
    if not await claim_orphaned_job(job_id, get_settings().job_orphan_timeout_seconds):
        return
    job = await get_job(job_id, include_payload=True) or {}
    payload = job.get("payload") or {}
    user_id = payload.get("user_id")
    charged_tokens = int(payload.get("charged_tokens") or 0)
    logger.warning("Job %s was interrupted; refunding %d tokens", job_id, charged_tokens)
    if user_id and charged_tokens > 0:
        await add_tokens(user_id, charged_tokens)
        track_token_refund()


@router.get("/{job_id}", response_model=JobStatusResponse)
async def get_job_status(
    job_id: str,
    user_id: str | None = Depends(get_optional_user_id),
) -> JobStatusResponse:
    job = await get_job(job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    # Ownership check: jobs created by an authenticated user are only
    # readable by that user. Guest jobs (no owner) rely on the unguessable
    # job_id as a capability token. 404 avoids leaking job existence.
    owner_id = job.get("owner_id")
    if owner_id and owner_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    if job.get("status") in {"pending", "running"}:
        await _fail_if_orphaned(job_id)
        job = await get_job(job_id) or job

    return JobStatusResponse(
        id=job.get("id", job_id),
        status=job.get("status", "unknown"),
        result=job.get("result"),
        error=job.get("error") or None,
    )
