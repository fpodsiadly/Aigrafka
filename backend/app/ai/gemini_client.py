import asyncio
import base64
import io
from typing import Any, Optional

from google import genai
from google.genai import types

from app.core.config import get_settings


class GeminiClient:
    FALLBACK_IMAGE_BASE64 = (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Yg3FdQAAAAASUVORK5CYII="
    )

    def __init__(self, api_key: Optional[str] = None, timeout: Optional[float] = None, model: Optional[str] = None) -> None:
        settings = get_settings()
        self.api_key = api_key or settings.gemini_api_key
        # Primary model: Gemini 3 image generation (generateContent)
        self.model = model or settings.gemini_model or "gemini-3-pro-image-preview"
        self.timeout = timeout or settings.http_timeout
        # Reuse a single genai client; mirrors OpenVTO reference behavior
        self._client = genai.Client(api_key=self.api_key)

    async def generate_image(self, prompt: str, selfie_bytes: bytes, product_image_bytes: bytes) -> dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        params = {"key": self.api_key}

        # Build parts: selfie (reference/body), product (clothing), prompt last
        parts = [
            types.Part(
                inline_data=types.Blob(
                    mime_type="image/jpeg",
                    data=selfie_bytes,
                )
            ),
            types.Part(
                inline_data=types.Blob(
                    mime_type="image/jpeg",
                    data=product_image_bytes,
                )
            ),
            types.Part(text=prompt),
        ]

        # Model-specific image config: 2.5-flash cannot take image_size
        if self.model == "gemini-2.5-flash-image":
            image_config = types.ImageConfig(aspect_ratio="3:4")
        else:
            image_config = types.ImageConfig(aspect_ratio="3:4", image_size="1K")

        config = types.GenerateContentConfig(
            temperature=1.0,
            top_p=0.95,
            response_modalities=["IMAGE"],
            image_config=image_config,
        )

        # Run the sync SDK call off the event loop to respect async interface
        def _do_generate() -> Any:
            return self._client.models.generate_content(
                model=self.model,
                contents=[types.Content(role="user", parts=parts)],
                config=config,
            )

        try:
            response = await asyncio.wait_for(asyncio.to_thread(_do_generate), timeout=self.timeout)
        except Exception as exc:
            return {
                "image_base64": self.FALLBACK_IMAGE_BASE64,
                "mime_type": "image/png",
                "status": "fallback",
                "model": self.model,
                "error": str(exc),
            }

        # Extract first inline_data bytes from candidates
        def extract_inline_data(resp: Any) -> tuple[Optional[bytes], Optional[str]]:
            try:
                candidates = getattr(resp, "candidates", []) or []
                if not candidates:
                    return None, None
                parts_resp = getattr(candidates[0], "content", None)
                parts_list = getattr(parts_resp, "parts", []) if parts_resp else []
                for part in parts_list:
                    inline = getattr(part, "inline_data", None)
                    if inline and getattr(inline, "data", None):
                        return inline.data, getattr(inline, "mime_type", "image/png")
                return None, None
            except Exception:
                return None, None

        image_bytes, mime = extract_inline_data(response)

        # If response does not contain a usable base64 string, mark fallback
        if not image_bytes:
            return {
                "image_base64": self.FALLBACK_IMAGE_BASE64,
                "mime_type": "image/png",
                "status": "fallback",
                "model": self.model,
                "error": "Missing image data in Gemini response",
            }

        image_b64 = base64.b64encode(image_bytes).decode()

        # Decode to inspect dimensions; if tiny (1x1), treat as failure
        try:
            from PIL import Image

            with Image.open(io.BytesIO(image_bytes)) as img:
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
            "mime_type": mime or "image/jpeg",
            "status": "generated",
            "model": self.model,
        }

    async def generate_fit_note(self, prompt: str) -> Optional[str]:
        """Generate a short Polish fit note based on the styling prompt."""

        instruction = (
            "Na podstawie opisu stylizacji oceń, czy produkt pasuje do sylwetki i rozmiaru. "
            "Napisz jedno zwięzłe zdanie po polsku, maks 200 znaków, bez emoji, bez wtrętów technicznych. "
            f"Opis: {prompt}"
        )

        config = types.GenerateContentConfig(
            temperature=0.4,
            top_p=0.9,
            response_modalities=["TEXT"],
        )

        def _do_generate() -> Any:
            return self._client.models.generate_content(
                model=self.model,
                contents=[types.Content(role="user", parts=[types.Part(text=instruction)])],
                config=config,
            )

        try:
            response = await asyncio.wait_for(asyncio.to_thread(_do_generate), timeout=self.timeout)
            candidates = getattr(response, "candidates", []) or []
            if not candidates:
                return None
            content = getattr(candidates[0], "content", None)
            parts_list = getattr(content, "parts", []) if content else []
            for part in parts_list:
                if getattr(part, "text", None):
                    return part.text.strip()
        except Exception:
            return None

        return None
