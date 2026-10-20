"""Prompt used before the narrative rewrite (commit 1988d8a), kept only for A/B comparison."""

from urllib.parse import urlparse

from app.ai.body_shape import (
    MAX_BODY_CIRCUMFERENCE_CM,
    MAX_HEIGHT_CM,
    MIN_BODY_CIRCUMFERENCE_CM,
    MIN_HEIGHT_CM,
    describe_body_shape,
    parse_measurement,
)


def build_openvto_prompt(
    product_ref: str,
    is_upload: bool = False,
    category: str | None = None,
    fit_style: str | None = None,
    height_cm: str | None = None,
    chest_cm: str | None = None,
    waist_cm: str | None = None,
    hips_cm: str | None = None,
    variants: int = 1,
    variant_index: int | None = None,
    back_reference_available: bool = False,
) -> str:
    domain = urlparse(product_ref).netloc if not is_upload else ""
    source_text = (
        "Product provided via user-uploaded image(s)."
        if is_upload
        else f"Product source domain: {domain or 'unknown'}."
    )

    category_text = f"Garment category: {category}." if category else "Garment category: not provided."

    fit_style_text = ""
    user_presentation_text = ""
    if fit_style == "masculine":
        fit_style_text = (
            "Use masculine tailoring only. Never dress the user in feminine clothing, underwear, lingerie, "
            "swimwear, or any intimate or revealing garment."
        )
        user_presentation_text = "The user presents as male. Fit the garment to a male body shape."
    elif fit_style == "feminine":
        fit_style_text = "Use feminine tailoring."
        user_presentation_text = "The user presents as female. Fit the garment to a female body shape."
    elif fit_style == "unisex":
        fit_style_text = "Use unisex/neutral tailoring."
        user_presentation_text = "The user prefers a unisex/neutral presentation."

    measurements = []
    normalized_height = parse_measurement(height_cm, MIN_HEIGHT_CM, MAX_HEIGHT_CM)
    normalized_chest = parse_measurement(chest_cm, MIN_BODY_CIRCUMFERENCE_CM, MAX_BODY_CIRCUMFERENCE_CM)
    normalized_waist = parse_measurement(waist_cm, MIN_BODY_CIRCUMFERENCE_CM, MAX_BODY_CIRCUMFERENCE_CM)
    normalized_hips = parse_measurement(hips_cm, MIN_BODY_CIRCUMFERENCE_CM, MAX_BODY_CIRCUMFERENCE_CM)
    if normalized_height is not None:
        measurements.append(f"height {normalized_height:g} cm")
    if normalized_chest is not None:
        measurements.append(f"chest {normalized_chest:g} cm")
    if normalized_waist is not None:
        measurements.append(f"waist {normalized_waist:g} cm")
    if normalized_hips is not None:
        measurements.append(f"hips {normalized_hips:g} cm")
    measurements_text = f"User measurements: {', '.join(measurements)}." if measurements else "User measurements: not provided."
    body_shape = describe_body_shape(fit_style, chest_cm, waist_cm, hips_cm)
    body_shape_text = (
        f"Inferred body proportions: {body_shape}. Treat this as an approximate fit guide only; "
        "preserve the user's actual body visible in the selfie."
        if body_shape
        else ""
    )

    variants = max(1, min(variants, 3))
    variant_index = max(1, min(variant_index or 1, variants))

    # Every call renders exactly one image; additional variants are produced as
    # follow-up turns (see build_variant_follow_up_prompt) or, as a fallback,
    # as standalone calls for the requested shot.
    variant_text = "Generate ONE photorealistic full-body portrait of the user wearing the product."
    if variants == 1:
        shot_instruction = (
            "Use a soft one-quarter view: turn the body 10 to 15 degrees, define the jawline, and keep the full body visible."
        )
    else:
        shot_instruction = f"Requested shot: {_shot_description(variant_index, variants, back_reference_available)}"

    back_requirement_text = (
        "Back-view policy: when a back reference of the garment is available, use it as authority for back-side garment details "
        "(print placement, stitching lines, seam structure, yoke/pocket details, logo position). "
        "When no back reference exists, keep back details conservative and avoid speculative patterns/text."
    )

    background_text = (
        "Remove any existing marketplace/store watermark, logo, or text from source visuals. "
        "ALWAYS use a clean studio backdrop regardless of any outdoor, beach, lifestyle, or environmental setting shown in the product reference image — "
        "the product reference is used only for garment details, never for background/scene context. "
        "Use a seamless, evenly lit light gray (#d2d2d2) studio backdrop with no logos, patterns, text, or watermarks. "
        "The final composition should look like a premium e-commerce catalog photo."
    )

    # Build final prompt; filter out empty segments to avoid double spaces
    segments = [
        "You are an AI virtual try-on system following OpenVTO principles.",
        "Inputs: (1) user selfie image; (2) product garment image.",
        source_text,
        variant_text,
        shot_instruction,
        "Composition constraint: each output image must contain exactly one person in one continuous camera frame. "
        "Do not create collages, split screens, diptychs/triptychs, before-vs-after layouts, or multiple mini-photos inside one image.",
        "Camera/framing: full body visible (head to feet) with slight headroom. Never use an en face pose or direct eye contact. "
        "Whenever the face is visible, keep the body at a soft 10 to 15-degree one-quarter angle, with a defined jawline, "
        "and make the user look away from the camera with a candid, thoughtful expression. No profile shots.",
        "Aspect ratio approximately 3:4 (allow up to 2:3 if needed to keep feet visible).",
        f"{category_text} Replace only the specified garment category with the provided product; keep all other clothing minimal, neutral, and consistent.",
        user_presentation_text,
        fit_style_text,
        "Do not add accessories or extra garments.",
        "CRITICAL: Strictly preserve the user's face identity, facial features, facial structure, expression, hairstyle, and skin tone exactly as in the selfie. "
        "Do NOT modify, beautify, or alter the face in any way. User identity preservation has absolute priority over garment transformation.",
        "Maintain original body proportions and posture; no slimming, enlarging, or reshaping.",
        measurements_text,
        body_shape_text,
        "Fit the garment naturally and realistically: correct scale, accurate seams, proper collar/neck alignment, "
        "realistic draping, folds, and fabric physics consistent with the material.",
        back_requirement_text,
        "Show garment coverage clearly: reflect true length on the user's reported height (e.g., dress/skirt hem position, sleeve length, neckline depth/shape).",
        "Depict sleeves and neckline faithfully to the product reference; do not invent alternative cuts.",
        "Avoid hiding garment edges — ensure hems, cuffs, and neckline are visible and true to length.",
        "Merge lighting and color so the garment matches the selfie lighting conditions; "
        "avoid mismatched shadows, highlights, or color casts.",
        background_text,
        "Return only the final rendered image.",
    ]

    return " ".join(s for s in segments if s)


def _shot_description(variant_index: int, variants: int, back_reference_available: bool) -> str:
    if variant_index == 1:
        return "soft 10-degree one-quarter LEFT view."
    if variant_index == 2:
        return "soft 15-degree one-quarter RIGHT view."
    if variants == 3 and back_reference_available:
        return (
            "full BACK view with the user's back toward camera. "
            "Make the garment back panel clearly visible and centered."
        )
    return (
        "soft 12-degree one-quarter LEFT view with a natural weight shift. "
        "Do not invent unseen back details beyond what can be inferred from the provided reference."
    )


def build_variant_follow_up_prompt(variant_index: int, variants: int, back_reference_available: bool) -> str:
    """Prompt for a follow-up turn that re-poses the first rendered variant.

    Continuing the same conversation keeps the person and garment consistent
    across variants instead of rendering independent, drifting interpretations.
    """
    variants = max(1, min(variants, 3))
    variant_index = max(1, min(variant_index, variants))
    back_reference_text = (
        "REFERENCE IMAGE 3 shows the back of the garment; use it as authority for back-side details."
        if variants == 3 and variant_index == 3 and back_reference_available
        else ""
    )
    segments = [
        "Render a new photo of the SAME person wearing the SAME garment as in your previous image.",
        f"Change only the pose and camera angle: {_shot_description(variant_index, variants, back_reference_available)}",
        back_reference_text,
        "Keep the face identity, hairstyle, skin tone, body proportions, garment colour, pattern, fit, length, "
        "lighting, and the plain light gray studio backdrop identical to the previous image.",
        "Whenever the face is visible, the user looks away from the camera with a candid, thoughtful expression.",
        "Full body visible (head to feet), exactly one person, one continuous camera frame, no collage, "
        "no logos, text, or watermarks.",
        "Return only the final rendered image.",
    ]
    return " ".join(s for s in segments if s)
