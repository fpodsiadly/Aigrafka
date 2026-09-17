import pytest

from app.ai.prompts.openvto_prompt import build_openvto_prompt


@pytest.mark.parametrize("variants", [1, 2, 3])
def test_prompt_requires_soft_angle_and_gaze_away(variants):
    prompt = build_openvto_prompt(
        "uploaded product image",
        is_upload=True,
        category="T-shirt",
        fit_style="feminine",
        variants=variants,
    )

    assert "Never use an en face pose or direct eye contact." in prompt
    assert "soft 10 to 15-degree one-quarter angle" in prompt
    assert "look away from the camera" in prompt
    assert "front-facing" not in prompt


def test_masculine_prompt_forbids_feminine_and_intimate_clothing():
    prompt = build_openvto_prompt(
        "uploaded product image",
        is_upload=True,
        category="shirt",
        fit_style="masculine",
    )

    assert "Never dress the user in feminine clothing" in prompt
    assert "underwear, lingerie, swimwear" in prompt


def test_prompt_contains_inferred_body_shape():
    prompt = build_openvto_prompt(
        "uploaded product image",
        is_upload=True,
        category="dress",
        fit_style="feminine",
        chest_cm="90",
        waist_cm="66",
        hips_cm="92",
    )

    assert "Inferred body proportions: hourglass body shape" in prompt
    assert "Treat this as an approximate fit guide only" in prompt


def test_prompt_ignores_invalid_measurements():
    prompt = build_openvto_prompt(
        "uploaded product image",
        is_upload=True,
        category="shirt",
        fit_style="unisex",
        height_cm="invalid",
        chest_cm="100",
        waist_cm="20",
        hips_cm="95",
    )

    assert "User measurements: chest 100 cm, hips 95 cm." in prompt
    assert "height invalid" not in prompt
    assert "waist 20" not in prompt
    assert "estimated balanced upper- and lower-body proportions" in prompt


def test_prompt_uses_supplied_brand_mark_instead_of_inventing_logo():
    prompt = build_openvto_prompt(
        "uploaded product image",
        is_upload=True,
        category="shirt",
        fit_style="unisex",
    )

    assert "REFERENCE IMAGE 3 contains the exact AIgrafka brand mark" in prompt
    assert "Tile only the supplied AIgrafka brand mark" in prompt
    assert "Do not redesign, reinterpret, blur, distort" in prompt
    assert "aigrafka.pl" not in prompt
