from io import BytesIO
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.api.generate import _normalize_product_url, _validate_and_normalize_image


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
