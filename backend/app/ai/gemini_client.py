import asyncio
import base64
import io
import logging
from typing import Any, Optional

from google import genai
from google.genai import types

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class GeminiClient:
    FALLBACK_IMAGE_BASE64 = (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Yg3FdQAAAAASUVORK5CYII="
    )

    def __init__(self, api_key: Optional[str] = None, timeout: Optional[float] = None, model: Optional[str] = None) -> None:
        settings = get_settings()
        self.api_key = api_key or settings.gemini_api_key or ""
        # Primary model: Gemini 3 image generation (generateContent)
        self.model = model or settings.gemini_model or "gemini-3.1-flash-image-preview"
        self.image_size = settings.gemini_image_size
        self.timeout = timeout or settings.http_timeout
        # Reuse a single genai client; mirrors OpenVTO reference behavior
        self._client = genai.Client(api_key=self.api_key) if self.api_key else None

    async def generate_image(self, prompt: str, selfie_bytes: bytes, product_image_bytes: bytes) -> dict[str, Any]:
        if self._client is None:
            return {
                "image_base64": self.FALLBACK_IMAGE_BASE64,
                "mime_type": "image/png",
                "status": "fallback",
                "model": self.model,
                "error": "GEMINI_API_KEY is not configured",
            }

        # Build parts: prompt first (docs best practice for reference images), then selfie, then product
        parts = [
            types.Part(text=prompt),
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
        ]

        # Model-specific image config
        MODELS_WITHOUT_SIZE = {"gemini-2.5-flash-image"}  # gemini-3.1-flash-image-preview supports image_size
        use_image_size = self.model not in MODELS_WITHOUT_SIZE
        # Validate image_size — only "1K", "2K", "4K" are accepted by the API.
        # Env vars could contain legacy values like "768" which cause 400.
        VALID_IMAGE_SIZES = {"512", "1K", "2K", "4K"}
        safe_image_size = self.image_size if self.image_size in VALID_IMAGE_SIZES else "1K"
        try:
            if use_image_size:
                image_config = types.ImageConfig(aspect_ratio="3:4", image_size=safe_image_size)
            else:
                image_config = types.ImageConfig(aspect_ratio="3:4")
        except Exception:
            try:
                image_config = types.ImageConfig(aspect_ratio="3:4")
            except Exception:
                image_config = types.ImageConfig()

        config = types.GenerateContentConfig(
            response_modalities=["TEXT", "IMAGE"],  # TEXT required by gemini-3.x preview models
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
            logger.error("GeminiClient.generate_image exception model=%s error=%s", self.model, exc, exc_info=True)
            return {
                "image_base64": self.FALLBACK_IMAGE_BASE64,
                "mime_type": "image/png",
                "status": "fallback",
                "model": self.model,
                "error": str(exc),
            }

        # Extract final inline_data bytes from candidates.
        # With thinking enabled, draft/thought images precede the final image —
        # take the LAST non-thought inline_data part (which is the final render).
        def extract_inline_data(resp: Any) -> tuple[Optional[bytes], Optional[str]]:
            try:
                candidates = getattr(resp, "candidates", []) or []
                if not candidates:
                    return None, None
                parts_resp = getattr(candidates[0], "content", None)
                parts_list = getattr(parts_resp, "parts", []) if parts_resp else []
                result_bytes: Optional[bytes] = None
                result_mime: Optional[str] = None
                for part in parts_list:
                    # Skip thought/draft parts (present when include_thoughts=True)
                    if getattr(part, "thought", False):
                        continue
                    inline = getattr(part, "inline_data", None)
                    if inline and getattr(inline, "data", None):
                        # Keep overwriting — last image wins (final render)
                        result_bytes = inline.data
                        result_mime = getattr(inline, "mime_type", "image/png")
                return result_bytes, result_mime
            except Exception:
                return None, None

        image_bytes, mime = extract_inline_data(response)

        # If response does not contain a usable image, determine why
        if not image_bytes:
            # Check finish_reason / block_reason for content policy refusal
            _SAFETY_REASONS = {"SAFETY", "IMAGE_SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"}
            is_refused = False
            try:
                candidates = getattr(response, "candidates", []) or []
                if candidates:
                    finish_reason = getattr(candidates[0], "finish_reason", None)
                    if finish_reason is not None:
                        reason_str = str(finish_reason).upper()
                        is_refused = any(s in reason_str for s in _SAFETY_REASONS)
                if not is_refused:
                    feedback = getattr(response, "prompt_feedback", None)
                    if feedback:
                        block_reason = str(getattr(feedback, "block_reason", "") or "").upper()
                        is_refused = bool(block_reason) and block_reason not in {"", "NONE", "BLOCK_REASON_UNSPECIFIED", "0"}
            except Exception:
                pass

            if is_refused:
                logger.warning("GeminiClient content policy refusal model=%s", self.model)
                return {
                    "image_base64": self.FALLBACK_IMAGE_BASE64,
                    "mime_type": "image/png",
                    "status": "refused",
                    "model": self.model,
                    "error": "content_policy",
                }
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

        if self._client is None:
            return None

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
