
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.core.queue import get_job
from app.core.security import get_optional_user_id

router = APIRouter(prefix="/jobs", tags=["jobs"])


class JobStatusResponse(BaseModel):
    id: str
    status: str
    result: dict | None = None
    error: str | None = None


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

    return JobStatusResponse(
        id=job.get("id", job_id),
        status=job.get("status", "unknown"),
        result=job.get("result"),
        error=job.get("error") or None,
    )
