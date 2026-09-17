from io import BytesIO
from time import perf_counter
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from PIL import Image
from starlette.datastructures import Headers, UploadFile
from starlette.requests import Request

from app.api.generate import _normalize_product_url, _validate_and_normalize_image, generate_tryon


def test_normalize_product_url_rejects_private():
    with pytest.raises(HTTPException):
        _normalize_product_url("http://localhost:8000/product")

    with pytest.raises(HTTPException):
        _normalize_product_url("http://192.168.1.1/product")

    assert _normalize_product_url("https://example.com/product") == "https://example.com/product"


def test_validate_and_normalize_image_rejects_non_image():
    upload = MagicMock()
    upload.content_type = "text/plain"
    upload.file = BytesIO(b"not an image")
    with pytest.raises(HTTPException):
        _validate_and_normalize_image(upload, 8 * 1024 * 1024, "Selfie")


def test_validate_and_normalize_image_rejects_too_large():
    upload = MagicMock()
    upload.content_type = "image/jpeg"
    upload.file = BytesIO(b"x" * (2 * 1024 * 1024))
    with pytest.raises(HTTPException) as exc:
        _validate_and_normalize_image(upload, 1 * 1024 * 1024, "Selfie")
    assert "too large" in str(exc.value.detail)


def _jpeg_upload(filename: str) -> UploadFile:
    data = BytesIO()
    Image.new("RGB", (20, 20), "white").save(data, format="JPEG")
    data.seek(0)
    return UploadFile(file=data, filename=filename, headers=Headers({"content-type": "image/jpeg"}))


@pytest.mark.asyncio
async def test_generate_returns_signed_image_url_and_telemetry_without_job_round_trip(monkeypatch):
    import app.api.generate as generate

    async def allow(*_args):
        return None

    async def generated(*_args, **_kwargs):
        return {
            "status": "generated",
            "model": "model",
            "variants": [{"status": "generated", "image_base64": "aW1hZ2U=", "mime_type": "image/png"}],
        }

    async def store(*_args):
        return "image.token"

    monkeypatch.setattr(generate, "enforce_generate_rate_limit", allow)
    monkeypatch.setattr(generate, "generate_from_payload", generated)
    monkeypatch.setattr(generate, "store_result_image", store)

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "scheme": "https",
            "server": ("api.example.com", 443),
            "path": "/generate",
            "headers": [],
        }
    )
    request.state.request_started_perf = perf_counter()
    request.state.request_id = "request-1"

    result = await generate_tryon(
        request=request,
        product_url=None,
        selfie=_jpeg_upload("selfie.jpg"),
        category="hoodie",
        fit_style="unisex",
        height_cm=None,
        chest_cm=None,
        waist_cm=None,
        hips_cm=None,
        model_choice=None,
        variants=1,
        product_image_1=_jpeg_upload("product.jpg"),
        product_image_2=None,
        user_id=None,
    )

    assert result["variants"][0]["image_url"].startswith("https://api.example.com/images/")
    assert "image_base64" not in result["variants"][0]
    assert result["telemetry"]["cache_hit"] is False
