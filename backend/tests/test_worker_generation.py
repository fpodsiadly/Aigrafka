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


def test_generation_models_prefer_nano_banana_then_flash(monkeypatch):
    import app.core.worker as worker
    from app.core.config import Settings

    settings = Settings(GEMINI_MODEL="gemini-nano-banana-2.1", GEMINI_FALLBACK_MODELS="gemini-3.1-flash-image")
    monkeypatch.setattr(worker, "get_settings", lambda: settings)

    assert worker._generation_models() == ["gemini-nano-banana-2.1", "gemini-3.1-flash-image"]


@pytest.mark.asyncio
async def test_follow_up_variants_continue_first_variant_conversation(monkeypatch):
    import app.core.worker as worker
    from app.ai.gemini_client import MODEL_CONTENT_KEY

    calls = []
    first_turn = object()

    async def run(*args, follow_up=None, follow_up_model=None, **_kwargs):
        variant_index = args[9]
        calls.append((variant_index, follow_up, follow_up_model))
        result = {"status": "generated", "image_base64": f"img{variant_index}", "model": "gemini-nano-banana-2.1"}
        if variant_index == 1:
            result[MODEL_CONTENT_KEY] = first_turn
        return result

    notified = []

    async def on_variant(index, variant):
        notified.append((index, variant))

    monkeypatch.setattr(worker, "_run_variant_with_retry", run)

    result = await generate_from_payload({**_payload(), "variant_count": 3}, on_variant=on_variant)

    assert [call[0] for call in calls][0] == 1
    follow_ups = [call for call in calls if call[0] != 1]
    assert len(follow_ups) == 2
    assert all(call[1].previous_content is first_turn for call in follow_ups)
    assert all(call[2] == "gemini-nano-banana-2.1" for call in follow_ups)
    assert [variant["image_base64"] for variant in result["variants"]] == ["img1", "img2", "img3"]
    assert all(MODEL_CONTENT_KEY not in variant for variant in result["variants"])
    assert sorted(index for index, _ in notified) == [0, 1, 2]
    assert all(MODEL_CONTENT_KEY not in variant for _, variant in notified)


@pytest.mark.asyncio
async def test_failed_follow_up_falls_back_to_standalone_generation(monkeypatch):
    import app.core.worker as worker
    from app.ai.gemini_client import MODEL_CONTENT_KEY

    calls = []

    async def run(*args, follow_up=None, **_kwargs):
        variant_index = args[9]
        calls.append((variant_index, follow_up is not None))
        if variant_index == 1:
            return {"status": "generated", "image_base64": "img1", "model": "m", MODEL_CONTENT_KEY: object()}
        if follow_up is not None:
            return {"status": "fallback", "error": "boom", "model": "m"}
        return {"status": "generated", "image_base64": "standalone", "model": "m"}

    monkeypatch.setattr(worker, "_run_variant_with_retry", run)

    result = await generate_from_payload({**_payload(), "variant_count": 2})

    assert calls == [(1, False), (2, True), (2, False)]
    assert result["variants"][1]["image_base64"] == "standalone"


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
