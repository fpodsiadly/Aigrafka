from app.ai.gemini_client import _build_request_parts, _get_genai_client, _load_brand_logo


def test_brand_logo_reference_is_packaged():
    logo = _load_brand_logo()

    assert logo.startswith(b"\x89PNG\r\n\x1a\n")
    assert len(logo) > 1_000


def test_request_parts_label_and_attach_all_reference_images():
    logo = b"logo"
    parts = _build_request_parts("prompt", b"selfie", b"product", logo)

    assert len(parts) == 7
    assert parts[0].text == "prompt"
    assert "user selfie" in parts[1].text
    assert parts[2].inline_data.data == b"selfie"
    assert "garment source" in parts[3].text
    assert parts[4].inline_data.data == b"product"
    assert "exact AIgrafka brand mark" in parts[5].text
    assert parts[6].inline_data.mime_type == "image/png"
    assert parts[6].inline_data.data == logo


def test_genai_client_is_reused_for_same_api_key(monkeypatch):
    import app.ai.gemini_client as gemini_client

    _get_genai_client.cache_clear()
    clients = []
    monkeypatch.setattr(gemini_client.genai, "Client", lambda api_key: clients.append(api_key) or object())

    assert _get_genai_client("key") is _get_genai_client("key")
    assert clients == ["key"]
    _get_genai_client.cache_clear()
