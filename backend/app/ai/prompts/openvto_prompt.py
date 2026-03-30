from urllib.parse import urlparse
from typing import Optional


def build_openvto_prompt(
    product_ref: str,
    is_upload: bool = False,
    category: Optional[str] = None,
    fit_style: Optional[str] = None,
    height_cm: Optional[str] = None,
    chest_cm: Optional[str] = None,
    waist_cm: Optional[str] = None,
    hips_cm: Optional[str] = None,
    variants: int = 1,
    variant_index: Optional[int] = None,
    back_reference_available: bool = False,
) -> str:
    domain = urlparse(product_ref).netloc if not is_upload else ""
    source_text = (
        "Product provided via user-uploaded image(s)."
        if is_upload
        else f"Product source domain: {domain or 'unknown'}. Product URL: {product_ref}."
    )

    category_text = f"Garment category: {category}." if category else "Garment category: not provided."

    _SWIMWEAR_KEYWORDS = {
        "bikini", "swimsuit", "swimwear", "bathing suit", "one-piece", "monokini",
        "strój kąpielowy", "kostium kąpielowy", "góra od bikini", "dół od bikini",
        "bikini top", "bikini bottom",
    }
    is_swimwear = bool(category and any(kw in category.lower() for kw in _SWIMWEAR_KEYWORDS))

    swimwear_text = (
        "Swimwear-specific rules: pose must be neutral and upright — no beach, ocean, pool, sand, or water elements. "
        "Use only the clean studio backdrop defined in the branding requirement. "
        "Render the swimwear faithfully to the product reference (cut, colour, pattern, coverage level). "
        "Do not add cover-ups, sarongs, or extra garments unless they are part of the product."
    ) if is_swimwear else ""

    fit_style_text = ""
    if fit_style == "masculine":
        fit_style_text = "Use masculine tailoring; do not generate dresses or skirts."
    elif fit_style == "feminine":
        fit_style_text = "Use feminine tailoring."
    elif fit_style == "unisex":
        fit_style_text = "Use unisex/neutral tailoring."

    measurements = []
    if height_cm:
        measurements.append(f"height {height_cm} cm")
    if chest_cm:
        measurements.append(f"chest {chest_cm} cm")
    if waist_cm:
        measurements.append(f"waist {waist_cm} cm")
    if hips_cm:
        measurements.append(f"hips {hips_cm} cm")
    measurements_text = f"User measurements: {', '.join(measurements)}." if measurements else "User measurements: not provided."

    variants = max(1, min(variants, 3))
    variant_index = max(1, min(variant_index or 1, variants))

    if variants == 1:
        variant_text = "Generate ONE photorealistic full-body portrait of the user wearing the product."
        variant_pose_text = (
            "Use a single natural pose with slight body angle (about 10-20 degrees) while keeping full body visible."
        )
    elif variants == 2:
        variant_text = (
            "Generate 2 DISTINCT photorealistic full-body portraits of the user wearing the product. "
            "Return exactly 2 separate images, one pose per image."
        )
        variant_pose_text = (
            "Pose plan: image 1 front-facing or very subtle 3/4; image 2 slight 3/4 turn so garment side seam and part of back panel are visible."
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
                "(1) front-facing full body, "
                "(2) slight 3/4 left turn, "
                "(3) full back-facing stance (user standing with back toward camera) so the garment back is clearly visible."
            )
        else:
            variant_pose_text = (
                "Pose plan for 3 variants without a dedicated back reference: "
                "(1) front-facing full body, "
                "(2) slight 3/4 left turn, "
                "(3) stronger 3/4 right turn (about 35-55 degrees) to reveal part of the back panel."
            )

    if variants == 3:
        if variant_index == 1:
            shot_instruction = "Current requested shot = VARIANT 1 OF 3: front-facing full body."
        elif variant_index == 2:
            shot_instruction = "Current requested shot = VARIANT 2 OF 3: slight 3/4 LEFT turn."
        else:
            if back_reference_available:
                shot_instruction = (
                    "Current requested shot = VARIANT 3 OF 3: full BACK view with the user's back toward camera. "
                    "Make the garment back panel clearly visible and centered."
                )
            else:
                shot_instruction = (
                    "Current requested shot = VARIANT 3 OF 3: stronger 3/4 RIGHT turn to reveal part of garment back. "
                    "Do not invent unseen back details beyond what can be inferred from the provided reference."
                )
    elif variants == 2:
        shot_instruction = (
            "Current requested shot: keep pose distinct from the other variant while preserving identity and garment fidelity."
        )
    else:
        shot_instruction = "Current requested shot: single final variant."

    back_requirement_text = (
        "Back-view policy: when a second product image reference is available, use it as authority for back-side garment details "
        "(print placement, stitching lines, seam structure, yoke/pocket details, logo position). "
        "When no second back reference exists, keep back details conservative and avoid speculative patterns/text."
    )

    branding_background_text = (
        "Background branding requirement (AIgrafka): remove any existing marketplace/store watermark, logo, or text from source visuals. "
        "ALWAYS use a clean studio backdrop regardless of any outdoor, beach, lifestyle, or environmental setting shown in the product reference image — "
        "the product reference is used only for garment details, never for background/scene context. "
        "Create a clean studio-like light gray (#d2d2d2) backdrop with a subtle repeating brand pattern. "
        "The pattern consists of two alternating elements tiled evenly across the backdrop: "
        "(1) a filled violet/purple circle (colour ~#9955ff) containing a white lowercase letter 'a' in the centre — this is the AIgrafka logo mark; "
        "(2) the lowercase text 'aigrafka.pl' in a matching purple/violet tone. "
        "Both elements are small, semi-transparent, and arranged in a regular staggered grid with even spacing. "
        "Keep branding low-contrast and secondary — never covering the face, garment edges, or key product details. "
        "The final composition should look like a premium e-commerce catalog photo with consistent AIgrafka visual identity."
    )

    return (
        "You are an AI virtual try-on system following OpenVTO principles. "
        "Inputs: (1) user selfie image; (2) product garment image from the e-commerce page or upload. "
        f"{variant_text} "
        f"{variant_pose_text} "
        f"{shot_instruction} "
        "Composition constraint: each output image must contain exactly one person in one continuous camera frame. "
        "Do not create collages, split screens, diptychs/triptychs, before-vs-after layouts, or multiple mini-photos inside one image. "
        "Pose: user standing upright, relaxed neutral stance, body and face oriented straight toward the camera. "
        "Camera/framing: full body visible (head to feet) with slight headroom; straight-on preferred or very subtle 3/4 view; no profile. "
        "Aspect ratio approximately 3:4 (allow up to 2:3 if needed to keep feet visible). "
        f"{category_text} Replace only the specified garment category with the provided product; keep all other clothing minimal, neutral, and consistent. "
        f"{fit_style_text} "
        f"{swimwear_text} "
        "Do not add accessories or extra garments. "
        "CRITICAL: Strictly preserve the user's face identity, facial features, facial structure, expression, hairstyle, and skin tone exactly as in the selfie. "
        "Do NOT modify, beautify, or alter the face in any way. User identity preservation has absolute priority over garment transformation. "
        "Maintain original body proportions and posture; no slimming, enlarging, or reshaping. "
        "Fit the garment naturally and realistically: correct scale, accurate seams, proper collar/neck alignment, "
        "realistic draping, folds, and fabric physics consistent with the material. "
        f"{back_requirement_text} "
        f"{branding_background_text} "
        "Show garment coverage clearly: reflect true length on the user's reported height (e.g., dress/skirt hem position, sleeve length, neckline depth/shape). "
        "Depict sleeves and neckline faithfully to the product reference; do not invent alternative cuts. "
        "Avoid hiding garment edges—ensure hems, cuffs, and neckline are visible and true to length. "
        "Merge lighting and color so the garment matches the selfie lighting conditions; "
        "avoid mismatched shadows, highlights, or color casts. "
        f"{measurements_text} "
        "Background: keep clean and controlled with the branded catalog look; avoid busy or cinematic scenes. "
        "No cinematic grading, no fashion editorial stylization. "
        "Return only the final rendered image. "
        f"{source_text}"
    )
