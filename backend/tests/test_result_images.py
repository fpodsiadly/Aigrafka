import base64
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.images import get_generated_image
from app.core.result_images import get_result_image, store_result_image


class FakeRedis:
    def __init__(self):
        self.data = {}

    def set(self, key, value, ex=None):
        self.data[key] = value
        self.ttl = ex

    def get(self, key):
        return self.data.get(key)


@pytest.mark.asyncio
async def test_result_image_round_trip(monkeypatch):
    import app.core.result_images as result_images

    fake = FakeRedis()
    monkeypatch.setattr(result_images, "get_redis_client", lambda: fake)
    monkeypatch.setattr(
        result_images,
        "get_settings",
        lambda: SimpleNamespace(jwt_secret="secret", result_image_ttl_seconds=3600),
    )

    token = await store_result_image(base64.b64encode(b"image").decode(), "image/png")

    assert token is not None
    assert fake.ttl == 3600
    assert await get_result_image(token) == (b"image", "image/png")
    assert await get_result_image(f"{token}invalid") is None
    assert await store_result_image(base64.b64encode(b"image").decode(), "image/png") == token


@pytest.mark.asyncio
async def test_result_image_rejects_invalid_mime_type(monkeypatch):
    import app.core.result_images as result_images

    monkeypatch.setattr(result_images, "get_redis_client", lambda: FakeRedis())
    assert await store_result_image("data", "text/html") is None


@pytest.mark.asyncio
async def test_result_image_endpoint_returns_private_binary_response(monkeypatch):
    import app.api.images as images

    monkeypatch.setattr(images, "get_result_image", lambda _token: _async_result((b"image", "image/png")))
    monkeypatch.setattr(images, "get_settings", lambda: SimpleNamespace(result_image_ttl_seconds=3600))

    response = await get_generated_image("token")

    assert response.body == b"image"
    assert response.media_type == "image/png"
    assert response.headers["cache-control"] == "private, max-age=3600"
    assert response.headers["x-content-type-options"] == "nosniff"


@pytest.mark.asyncio
async def test_result_image_endpoint_returns_not_found(monkeypatch):
    import app.api.images as images

    monkeypatch.setattr(images, "get_result_image", lambda _token: _async_result(None))

    with pytest.raises(HTTPException) as exc:
        await get_generated_image("invalid")
    assert exc.value.status_code == 404


async def _async_result(value):
    return value
