import pytest

from app.core.worker import generate_from_payload


def _payload() -> dict:
    return {
        "selfie_bytes": b"selfie",
        "product_image_1_bytes": b"product",
        "variant_count": 1,
        "user_id": "user-1",
        "charged_tokens": 1,
        "product_ref": "uploaded product image",
        "used_upload": True,
    }


@pytest.mark.asyncio
async def test_generate_from_payload_returns_result_without_job_storage(monkeypatch):
    import app.core.worker as worker

    async def generated(*_args, **_kwargs):
        return {"status": "generated", "image_base64": "image", "model": "model"}

    monkeypatch.setattr(worker, "_run_variant_with_retry", generated)

    result = await generate_from_payload(_payload(), operation_id="request-1")

    assert result["status"] == "generated"
    assert result["variants"][0]["image_base64"] == "image"


@pytest.mark.asyncio
async def test_generate_from_payload_refunds_unusable_result(monkeypatch):
    import app.core.worker as worker

    refunds = []

    async def fallback(*_args, **_kwargs):
        return {"status": "fallback", "error": "failed", "model": "model"}

    async def add_tokens(user_id, amount):
        refunds.append((user_id, amount))

    monkeypatch.setattr(worker, "_run_variant_with_retry", fallback)
    monkeypatch.setattr(worker, "add_tokens", add_tokens)

    result = await generate_from_payload(_payload(), operation_id="request-1")

    assert result["status"] == "fallback"
    assert refunds == [("user-1", 1)]


@pytest.mark.asyncio
async def test_generate_from_payload_refunds_cancelled_generation(monkeypatch):
    import asyncio

    import app.core.worker as worker

    refunds = []
    started = asyncio.Event()
    release = asyncio.Event()

    async def blocked(*_args, **_kwargs):
        started.set()
        await release.wait()

    async def add_tokens(user_id, amount):
        refunds.append((user_id, amount))

    monkeypatch.setattr(worker, "_run_variant_with_retry", blocked)
    monkeypatch.setattr(worker, "add_tokens", add_tokens)

    task = asyncio.create_task(generate_from_payload(_payload(), operation_id="request-1"))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert refunds == [("user-1", 1)]
