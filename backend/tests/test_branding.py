import io

from PIL import Image

from app.ai.branding import apply_brand_mark


def _png(width: int, height: int, color=(210, 210, 210)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, format="PNG")
    return buffer.getvalue()


def test_brand_mark_is_stamped_in_bottom_right_corner_only():
    branded, mime_type = apply_brand_mark(_png(600, 800))

    assert mime_type == "image/webp"
    with Image.open(io.BytesIO(branded)) as image:
        rgb = image.convert("RGB")
        assert image.size == (600, 800)
        # Badge centre: violet logo pixels differ clearly from the gray backdrop.
        badge_side = round(600 * 0.11)
        margin = round(600 * 0.03)
        centre = (600 - margin - badge_side // 2, 800 - margin - badge_side // 2)
        r, g, b = rgb.getpixel(centre)
        assert b > g + 40
        # Opposite corner stays untouched backdrop.
        r, g, b = rgb.getpixel((10, 10))
        assert abs(r - 210) < 8 and abs(g - 210) < 8 and abs(b - 210) < 8
