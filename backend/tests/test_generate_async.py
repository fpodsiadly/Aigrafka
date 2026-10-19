import pytest

import app.api.generate as generate


@pytest.fixture
def job_updates(monkeypatch):
    updates = []

    async def update_job_status(job_id, status, result=None, error=None):
        # Snapshot: the partial list is mutated after each update.
        variants = [dict(v) if v else None for v in (result or {}).get("variants", [])]
        updates.append((job_id, status, variants, error))

    async def store_result_image(image_base64, mime_type, owner_id=None):
        return f"token-{image_base64}"

    monkeypatch.setattr(generate, "update_job_status", update_job_status)
    monkeypatch.setattr(generate, "store_result_image", store_result_image)
    monkeypatch.setattr(generate, "track_generate_request", lambda _status: None)
    return updates


@pytest.mark.asyncio
async def test_async_generation_publishes_partial_variants_then_completes(monkeypatch, job_updates):
    async def generate_from_payload(payload, *, operation_id, telemetry, on_variant):
        first = {"status": "generated", "image_base64": "a", "mime_type": "image/webp"}
        await on_variant(0, dict(first))
        second = {"status": "generated", "image_base64": "b", "mime_type": "image/webp"}
        await on_variant(1, dict(second))
        return {"status": "generated", "variants": [first, second]}

    monkeypatch.setattr(generate, "generate_from_payload", generate_from_payload)

    await generate._run_async_generation("job-1", {}, "https://api.test/", 2, {})

    statuses = [update[1] for update in job_updates]
    assert statuses == ["running", "running", "running", "completed"]
    # First partial snapshot exposes variant 1 by URL before variant 2 exists.
    assert job_updates[1][2][0]["image_url"] == "https://api.test/images/token-a"
    assert job_updates[1][2][1] is None
    final_variants = job_updates[-1][2]
    assert [variant["image_url"] for variant in final_variants] == [
        "https://api.test/images/token-a",
        "https://api.test/images/token-b",
    ]
    assert all("image_base64" not in variant for variant in final_variants)


@pytest.mark.asyncio
async def test_async_generation_marks_job_failed_on_error(monkeypatch, job_updates):
    async def generate_from_payload(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(generate, "generate_from_payload", generate_from_payload)

    await generate._run_async_generation("job-1", {}, "https://api.test/", 1, {})

    assert job_updates[-1][1] == "failed"
    assert job_updates[-1][3] == "Generation failed."


@pytest.mark.asyncio
async def test_start_async_generation_returns_none_without_redis(monkeypatch):
    async def create_job(_payload):
        raise RuntimeError("Redis is not configured")

    monkeypatch.setattr(generate, "create_job", create_job)

    assert await generate._start_async_generation({"user_id": "u"}, "https://api.test/", 1, {}) is None
