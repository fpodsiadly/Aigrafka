import asyncio
import base64
from typing import Any, Optional

import httpx

from app.core.config import get_settings


class GeminiClient:
    FALLBACK_IMAGE_BASE64 = (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Yg3FdQAAAAASUVORK5CYII="
    )

    def __init__(self, api_key: Optional[str] = None, timeout: Optional[float] = None) -> None:
        settings = get_settings()
        self.api_key = api_key or settings.gemini_api_key
        # Primary and only model: pro image preview
        self.model = settings.gemini_model or "gemini-3-pro-image-preview"
        self.timeout = timeout or settings.http_timeout
        self._base_url = "https://generativelanguage.googleapis.com/v1beta/models"

    async def generate_image(self, prompt: str, selfie_bytes: bytes, product_image_bytes: bytes) -> dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        params = {"key": self.api_key}

        payload = {
            "prompt": prompt,
            "model": self.model,
            "inputs": [
                {"mime_type": "image/jpeg", "data": base64.b64encode(selfie_bytes).decode()},
                {"mime_type": "image/jpeg", "data": base64.b64encode(product_image_bytes).decode()}
            ],
            "output": {"format": "base64"}
        }

        # NOTE: This is a demo stub; real Gemini image endpoint may differ.
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            last_exc: Optional[Exception] = None
            data = None

            for attempt in range(3):
                try:
                    response = await client.post(
                        f"{self._base_url}/{self.model}:generateImage",
                        headers=headers,
                        params=params,
                        json=payload,
                    )
                    response.raise_for_status()
                    data = response.json()
                    break
                except httpx.HTTPError as exc:
                    last_exc = exc
                    await asyncio.sleep(0.5 * (attempt + 1))

            if data is None:
                return {
                    "image_base64": self.FALLBACK_IMAGE_BASE64,
                    "mime_type": "image/png",
                    "status": "fallback",
                    "model": self.model,
                    "error": str(last_exc) if last_exc else "Gemini request failed",
                }

        # Expecting { "image_base64": "..." } shape for demo purposes
        image_b64 = data.get("image_base64") or data.get("image") or data

        # If response does not contain a usable base64 string, mark fallback
        if not isinstance(image_b64, str):
            return {
                "image_base64": self.FALLBACK_IMAGE_BASE64,
                "mime_type": "image/png",
                "status": "fallback",
                "model": self.model,
                "error": "Missing image_base64 in Gemini response",
            }

        # Decode to inspect dimensions; if tiny (1x1), treat as failure
        try:
            from base64 import b64decode
            from PIL import Image
            import io

            img_bytes = b64decode(image_b64)
            with Image.open(io.BytesIO(img_bytes)) as img:
                w, h = img.size
                if w <= 1 and h <= 1:
                    return {
                        "image_base64": self.FALLBACK_IMAGE_BASE64,
                        "mime_type": "image/png",
                        "status": "fallback",
                        "model": self.model,
                        "error": "Gemini returned 1x1 placeholder",
                    }
        except Exception:
            # If inspection fails, still return what we got
            pass

        return {
            "image_base64": image_b64,
            "mime_type": "image/jpeg",
            "status": "generated",
            "model": self.model,
        }
