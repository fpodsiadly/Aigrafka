import time

import pytest

import app.core.queue as queue


class FakeRedis:
    def __init__(self, job: dict):
        self.hashes = {"job:j1": dict(job)}

    def hgetall(self, key):
        return dict(self.hashes.get(key, {}))

    def hsetnx(self, key, field, value):
        if field in self.hashes[key]:
            return 0
        self.hashes[key][field] = value
        return 1

    def hset(self, key, mapping):
        self.hashes[key].update(mapping)


def _use(monkeypatch, job: dict) -> FakeRedis:
    client = FakeRedis(job)
    monkeypatch.setattr(queue, "get_redis_client", lambda: client)
    return client


@pytest.mark.asyncio
async def test_stale_running_job_is_claimed_once(monkeypatch):
    client = _use(monkeypatch, {"status": "running", "started_at": str(int(time.time()) - 600)})

    assert await queue.claim_orphaned_job("j1", 120) is True
    assert await queue.claim_orphaned_job("j1", 120) is False
    assert client.hashes["job:j1"]["status"] == "failed"
    assert client.hashes["job:j1"]["error"] == "interrupted"


@pytest.mark.asyncio
async def test_job_with_fresh_lease_is_left_alone(monkeypatch):
    client = _use(monkeypatch, {"status": "running", "started_at": str(int(time.time()) - 10)})

    assert await queue.claim_orphaned_job("j1", 120) is False
    assert client.hashes["job:j1"]["status"] == "running"


@pytest.mark.asyncio
async def test_finished_job_is_never_claimed(monkeypatch):
    _use(monkeypatch, {"status": "completed", "started_at": "0"})

    assert await queue.claim_orphaned_job("j1", 120) is False


@pytest.mark.asyncio
async def test_polling_an_orphaned_job_refunds_and_reports_interruption(monkeypatch):
    import app.api.jobs as jobs

    state = {"status": "running"}
    refunds = []

    async def get_job(job_id, include_payload=False):
        job = {"id": job_id, "status": state["status"], "owner_id": "u1", "error": state.get("error")}
        if include_payload:
            job["payload"] = {"user_id": "u1", "charged_tokens": 2}
        return job

    async def claim(job_id, stale_after_seconds):
        state.update(status="failed", error="interrupted")
        return True

    async def add_tokens(user_id, amount):
        refunds.append((user_id, amount))

    monkeypatch.setattr(jobs, "get_job", get_job)
    monkeypatch.setattr(jobs, "claim_orphaned_job", claim)
    monkeypatch.setattr(jobs, "add_tokens", add_tokens)

    response = await jobs.get_job_status("j1", user_id="u1")

    assert response.status == "failed"
    assert response.error == "interrupted"
    assert refunds == [("u1", 2)]
