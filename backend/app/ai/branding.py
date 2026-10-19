import io
from functools import lru_cache
from pathlib import Path

from PIL import Image

BRAND_LOGO_PATH = Path(__file__).parent / "assets" / "aigrafka_logo_reference.png"
# Badge size relative to the shorter image side, and its distance from the edges.
BADGE_SCALE = 0.11
MARGIN_SCALE = 0.03
BADGE_OPACITY = 0.9
OUTPUT_MIME = "image/webp"
OUTPUT_QUALITY = 90


@lru_cache(maxsize=1)
def _load_brand_logo() -> Image.Image:
    with Image.open(BRAND_LOGO_PATH) as logo:
        return logo.convert("RGBA")


def apply_brand_mark(image_bytes: bytes) -> tuple[bytes, str]:
    """Stamp the AIgrafka badge in the bottom-right corner of a generated image.

    Branding is applied deterministically here instead of asking the model to
    render it, so the model's attention stays on identity and garment fidelity
    and the mark is never distorted or placed on the clothing.
    """
    with Image.open(io.BytesIO(image_bytes)) as source:
        canvas = source.convert("RGBA")

    width, height = canvas.size
    badge_side = max(16, round(min(width, height) * BADGE_SCALE))
    margin = round(min(width, height) * MARGIN_SCALE)

    badge = _load_brand_logo().resize((badge_side, badge_side), Image.LANCZOS)
    alpha = badge.getchannel("A").point(lambda value: round(value * BADGE_OPACITY))
    badge.putalpha(alpha)
    canvas.alpha_composite(badge, (width - badge_side - margin, height - badge_side - margin))

    buffer = io.BytesIO()
    canvas.convert("RGB").save(buffer, format="WEBP", quality=OUTPUT_QUALITY, method=6)
    return buffer.getvalue(), OUTPUT_MIME
