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
        # primary from env; default to pro image preview; secondary fallback without pro suffix
        self.model = settings.gemini_model or "gemini-3-pro-image-preview"
        self.fallback_models = [self.model, "gemini-2.5-flash-image"]
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

            for model_name in self.fallback_models:
                for attempt in range(3):
                    try:
                        response = await client.post(
                            f"{self._base_url}/{model_name}:generateImage",
                            headers=headers,
                            params=params,
                            json=payload,
                        )
                        response.raise_for_status()
                        data = response.json()
                        self.model = model_name
                        break
                    except httpx.HTTPError as exc:
                        last_exc = exc
                        if attempt == 2:
                            await asyncio.sleep(0.5 * (attempt + 1))
                        else:
                            await asyncio.sleep(0.5 * (attempt + 1))
                if data:
                    break

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
        return {
            "image_base64": image_b64,
            "mime_type": "image/jpeg",
            "status": "generated",
            "model": self.model,
        }
