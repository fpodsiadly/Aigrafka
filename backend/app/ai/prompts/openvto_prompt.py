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

    if variants == 1:
        variant_text = "Generate ONE photorealistic full-body portrait of the user wearing the product."
        variant_pose_text = (
            "Use a soft one-quarter view: turn the body 10 to 15 degrees, define the jawline, and keep the full body visible."
        )
    elif variants == 2:
        variant_text = (
            "Generate 2 DISTINCT photorealistic full-body portraits of the user wearing the product. "
            "Return exactly 2 separate images, one pose per image."
        )
        variant_pose_text = (
            "Pose plan: image 1 uses a soft 10-degree one-quarter LEFT turn; "
            "image 2 uses a soft 15-degree one-quarter RIGHT turn."
        )
    else:
        variant_text = (
            f"Generate {variants} DISTINCT photorealistic full-body portraits of the user wearing the product. "
            f"Each variant must show the same user and garment but differ in pose angle, "
            f"lighting mood, or background tone to give the user meaningful variety. "
            f"Return exactly {variants} separate images, with exactly ONE photo per variant."
        )
        if back_reference_available:
            variant_pose_text = (
                "Pose plan for 3 variants: "
                "(1) soft 10-degree one-quarter LEFT turn, "
                "(2) soft 15-degree one-quarter RIGHT turn, "
                "(3) full back-facing stance (user standing with back toward camera) so the garment back is clearly visible."
            )
        else:
            variant_pose_text = (
                "Pose plan for 3 variants without a dedicated back reference: "
                "(1) soft 10-degree one-quarter LEFT turn, "
                "(2) soft 15-degree one-quarter RIGHT turn, "
                "(3) soft 12-degree one-quarter LEFT turn with a natural weight shift."
            )

    if variants == 3:
        if variant_index == 1:
            shot_instruction = "Current requested shot = VARIANT 1 OF 3: soft 10-degree one-quarter LEFT view."
        elif variant_index == 2:
            shot_instruction = "Current requested shot = VARIANT 2 OF 3: soft 15-degree one-quarter RIGHT view."
        else:
            if back_reference_available:
                shot_instruction = (
                    "Current requested shot = VARIANT 3 OF 3: full BACK view with the user's back toward camera. "
                    "Make the garment back panel clearly visible and centered."
                )
            else:
                shot_instruction = (
                    "Current requested shot = VARIANT 3 OF 3: soft 12-degree one-quarter LEFT view with a natural weight shift. "
                    "Do not invent unseen back details beyond what can be inferred from the provided reference."
                )
    elif variants == 2:
        if variant_index == 1:
            shot_instruction = "Current requested shot = VARIANT 1 OF 2: soft 10-degree one-quarter LEFT view."
        else:
            shot_instruction = "Current requested shot = VARIANT 2 OF 2: soft 15-degree one-quarter RIGHT view."
    else:
        shot_instruction = "Current requested shot: single final variant."

    back_requirement_text = (
        "Back-view policy: when a second product image reference is available, use it as authority for back-side garment details "
        "(print placement, stitching lines, seam structure, yoke/pocket details, logo position). "
        "When no second back reference exists, keep back details conservative and avoid speculative patterns/text."
    )

    branding_background_text = (
        "Background branding requirement (AIgrafka): REFERENCE IMAGE 3 contains the exact AIgrafka brand mark. "
        "Use that supplied mark as the only logo source; preserve its shape, white linework, letterforms, and violet colour faithfully. "
        "Do not redesign, reinterpret, blur, distort, or replace it with invented text or symbols. "
        "Remove any existing marketplace/store watermark, logo, or text from source visuals. "
        "ALWAYS use a clean studio backdrop regardless of any outdoor, beach, lifestyle, or environmental setting shown in the product reference image — "
        "the product reference is used only for garment details, never for background/scene context. "
        "Create a clean studio-like light gray (#d2d2d2) backdrop with a subtle repeating brand pattern. "
        "Tile only the supplied AIgrafka brand mark in a regular staggered grid with even spacing. "
        "Keep each repeated mark small, sharp, undistorted, and semi-transparent. "
        "Keep branding low-contrast and secondary — never covering the face, garment edges, or key product details. "
        "The final composition should look like a premium e-commerce catalog photo with consistent AIgrafka visual identity."
    )

    # Build final prompt; filter out empty segments to avoid double spaces
    segments = [
        "You are an AI virtual try-on system following OpenVTO principles.",
        "Inputs: (1) user selfie image; (2) product garment image; (3) exact AIgrafka brand-mark reference image.",
        source_text,
        variant_text,
        variant_pose_text,
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
        branding_background_text,
        "Return only the final rendered image.",
    ]

    return " ".join(s for s in segments if s)
