from app.core.cache import _build_generation_cache_key


def _cache_key(image_size: str) -> str:
    return _build_generation_cache_key(
        b"selfie",
        b"product",
        "jacket",
        "regular",
        "180",
        "100",
        "85",
        "95",
        0,
        1,
        "gemini-3.1-flash-image",
        image_size,
    )


def test_generation_cache_key_separates_image_sizes():
    assert _cache_key("512") != _cache_key("1K")
