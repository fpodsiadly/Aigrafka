import pytest
from google.genai import types

from app.ai.gemini_client import VariantFollowUp, _build_contents, _build_request_parts, _get_genai_client


def test_request_parts_label_and_attach_reference_images_without_brand_logo():
    parts = _build_request_parts("prompt", b"selfie", b"product")

    assert len(parts) == 5
    assert parts[0].text == "prompt"
    assert "the person" in parts[1].text
    assert parts[2].inline_data.data == b"selfie"
    assert "garment reference" in parts[3].text
    assert parts[4].inline_data.data == b"product"


def test_contents_without_follow_up_is_single_user_turn():
    contents = _build_contents("prompt", b"selfie", b"product", None)

    assert len(contents) == 1
    assert contents[0].role == "user"


def test_follow_up_contents_replay_previous_model_turn_and_attach_back_reference():
    previous = types.Content(role="model", parts=[types.Part(text="previous render")])
    follow_up = VariantFollowUp(previous_content=previous, prompt="turn right", extra_image_bytes=b"back")

    contents = _build_contents("prompt", b"selfie", b"product", follow_up)

    assert [content.role for content in contents] == ["user", "model", "user"]
    assert contents[1] is previous
    assert contents[2].parts[0].text == "turn right"
    assert "back of the same garment" in contents[2].parts[1].text
    assert contents[2].parts[2].inline_data.data == b"back"


def test_genai_client_is_reused_for_same_api_key(monkeypatch):
    import app.ai.gemini_client as gemini_client

    _get_genai_client.cache_clear()
    clients = []
    monkeypatch.setattr(gemini_client.genai, "Client", lambda api_key: clients.append(api_key) or object())

    assert _get_genai_client("key") is _get_genai_client("key")
    assert clients == ["key"]
    _get_genai_client.cache_clear()


@pytest.mark.asyncio
async def test_timed_out_request_is_cancelled_not_left_running():
    import asyncio
    from types import SimpleNamespace

    from app.ai.gemini_client import GeminiClient

    cancelled = asyncio.Event()

    async def hanging_generate_content(**_kwargs):
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            cancelled.set()
            raise

    client = GeminiClient(api_key="test-key", timeout=0.05, model="gemini-nano-banana-2.1")
    client._client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=hanging_generate_content)))

    result = await client.generate_image("prompt", b"selfie", b"product")

    assert result["status"] == "fallback"
    assert cancelled.is_set()
