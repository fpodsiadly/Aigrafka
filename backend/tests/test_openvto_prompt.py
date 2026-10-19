import pytest

from app.ai.prompts.openvto_prompt import build_openvto_prompt, build_variant_follow_up_prompt


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


def test_prompt_asks_for_plain_backdrop_without_brand_mark():
    prompt = build_openvto_prompt(
        "uploaded product image",
        is_upload=True,
        category="shirt",
        fit_style="unisex",
    )

    assert "no logos, patterns, text, or watermarks" in prompt
    assert "REFERENCE IMAGE 3" not in prompt
    assert "brand mark" not in prompt


@pytest.mark.parametrize("variants", [1, 2, 3])
def test_prompt_requests_exactly_one_image_per_call(variants):
    prompt = build_openvto_prompt("uploaded product image", is_upload=True, variants=variants, variant_index=variants)

    assert "Generate ONE photorealistic full-body portrait" in prompt
    assert "separate images" not in prompt


def test_prompt_targets_requested_shot():
    prompt = build_openvto_prompt("uploaded product image", is_upload=True, variants=3, variant_index=2)

    assert "Requested shot: soft 15-degree one-quarter RIGHT view." in prompt


def test_follow_up_prompt_keeps_identity_and_changes_pose_only():
    prompt = build_variant_follow_up_prompt(2, 3, back_reference_available=False)

    assert "SAME person wearing the SAME garment" in prompt
    assert "Change only the pose and camera angle: soft 15-degree one-quarter RIGHT view." in prompt
    assert "REFERENCE IMAGE 3" not in prompt


def test_follow_up_prompt_uses_back_reference_for_third_variant():
    prompt = build_variant_follow_up_prompt(3, 3, back_reference_available=True)

    assert "full BACK view" in prompt
    assert "REFERENCE IMAGE 3 shows the back of the garment" in prompt
