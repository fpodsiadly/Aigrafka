import asyncio
import base64
import io
import logging
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from google import genai
from google.genai import types

from app.core.config import get_settings

logger = logging.getLogger(__name__)
# Key under which a generated result carries the raw model turn, so a follow-up
# variant can continue the same conversation. Never serialised or cached.
MODEL_CONTENT_KEY = "_model_content"


@dataclass(frozen=True)
class VariantFollowUp:
    """Continue a previous generation as a new conversation turn.

    `previous_content` is the model turn returned for the first variant; it is
    sent back unchanged so thought signatures are preserved.
    """

    previous_content: types.Content
    prompt: str
    extra_image_bytes: bytes | None = None


@lru_cache(maxsize=4)
def _get_genai_client(api_key: str) -> genai.Client:
    return genai.Client(api_key=api_key)


def _build_request_parts(
    prompt: str,
    selfie_bytes: bytes,
    product_image_bytes: bytes,
) -> list[types.Part]:
    return [
        types.Part(text=prompt),
        types.Part(text="REFERENCE IMAGE 1: user selfie and identity source."),
        types.Part(inline_data=types.Blob(mime_type="image/jpeg", data=selfie_bytes)),
        types.Part(text="REFERENCE IMAGE 2: garment source. Copy garment construction, colour, and pattern."),
        types.Part(inline_data=types.Blob(mime_type="image/jpeg", data=product_image_bytes)),
    ]


def _build_contents(
    prompt: str,
    selfie_bytes: bytes,
    product_image_bytes: bytes,
    follow_up: VariantFollowUp | None,
) -> list[types.Content]:
    contents = [types.Content(role="user", parts=_build_request_parts(prompt, selfie_bytes, product_image_bytes))]
    if follow_up is None:
        return contents

    follow_up_parts = [types.Part(text=follow_up.prompt)]
    if follow_up.extra_image_bytes is not None:
        follow_up_parts.append(types.Part(text="REFERENCE IMAGE 3: back side of the same garment."))
        follow_up_parts.append(types.Part(inline_data=types.Blob(mime_type="image/jpeg", data=follow_up.extra_image_bytes)))
    contents.append(follow_up.previous_content)
    contents.append(types.Content(role="user", parts=follow_up_parts))
    return contents


class GeminiClient:
    FALLBACK_IMAGE_BASE64 = (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Yg3FdQAAAAASUVORK5CYII="
    )

    def __init__(self, api_key: str | None = None, timeout: float | None = None, model: str | None = None) -> None:
        settings = get_settings()
        self.api_key = api_key or settings.gemini_api_key or ""
        # Primary model: Nano Banana 2.1 image generation (generateContent)
        self.model = model or settings.gemini_model or "gemini-nano-banana-2.1"
        self.image_size = settings.gemini_image_size
        self.timeout = timeout or settings.http_timeout
        # Reuse a single genai client; mirrors OpenVTO reference behavior
        self._client = _get_genai_client(self.api_key) if self.api_key else None

    async def generate_image(
        self,
        prompt: str,
        selfie_bytes: bytes,
        product_image_bytes: bytes,
        follow_up: VariantFollowUp | None = None,
    ) -> dict[str, Any]:
        if self._client is None:
            return {
                "image_base64": self.FALLBACK_IMAGE_BASE64,
                "mime_type": "image/png",
                "status": "fallback",
                "model": self.model,
                "error": "GEMINI_API_KEY is not configured",
            }

        contents = _build_contents(prompt, selfie_bytes, product_image_bytes, follow_up)

        # Model-specific image config
        MODELS_WITHOUT_SIZE = {"gemini-2.5-flash-image"}  # gemini-3.1-flash-image supports image_size
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
                contents=contents,
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
        def extract_inline_data(resp: Any) -> tuple[bytes | None, str | None]:
            try:
                candidates = getattr(resp, "candidates", []) or []
                if not candidates:
                    return None, None
                parts_resp = getattr(candidates[0], "content", None)
                parts_list = getattr(parts_resp, "parts", []) if parts_resp else []
                result_bytes: bytes | None = None
                result_mime: str | None = None
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

        candidates = getattr(response, "candidates", None) or []
        return {
            "image_base64": image_b64,
            "mime_type": mime or "image/jpeg",
            "status": "generated",
            "model": self.model,
            MODEL_CONTENT_KEY: getattr(candidates[0], "content", None) if candidates else None,
        }
