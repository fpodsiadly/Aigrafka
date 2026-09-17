from app.core.config import Settings


def test_default_gemini_models_use_stable_flash_image():
    assert Settings.model_fields["gemini_model"].default == "gemini-3.1-flash-image"
    assert (
        Settings.model_fields["gemini_fallback_models"].default
        == "gemini-3.1-flash-image,gemini-2.5-flash-image"
    )
    assert Settings.model_fields["gemini_image_size"].default == "1K"
    assert Settings.model_fields["result_image_ttl_seconds"].default == 3600
