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
) -> str:
    domain = urlparse(product_ref).netloc if not is_upload else ""
    source_text = (
        "Product provided via user-uploaded image(s)."
        if is_upload
        else f"Product source domain: {domain or 'unknown'}. Product URL: {product_ref}."
    )

    category_text = f"Garment category: {category}." if category else "Garment category: not provided."

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
    if variants == 1:
        variant_text = "Generate ONE photorealistic full-body portrait of the user wearing the product."
    else:
        variant_text = (
            f"Generate {variants} DISTINCT photorealistic full-body portraits of the user wearing the product. "
            f"Each variant must show the same user and garment but differ in pose angle (e.g., straight-on vs subtle 3/4 view), "
            f"lighting mood, or background tone to give the user meaningful variety. "
            f"Return exactly {variants} separate images."
        )

    return (
        "You are an AI virtual try-on system following OpenVTO principles. "
        "Inputs: (1) user selfie image; (2) product garment image from the e-commerce page or upload. "
        f"{variant_text} "
        "Pose: user standing upright, relaxed neutral stance, body and face oriented straight toward the camera. "
        "Camera/framing: full body visible (head to feet) with slight headroom; straight-on preferred or very subtle 3/4 view; no profile. "
        "Aspect ratio approximately 3:4 (allow up to 2:3 if needed to keep feet visible). "
        f"{category_text} Replace only the specified garment category with the provided product; keep all other clothing minimal, neutral, and consistent. "
        f"{fit_style_text} "
        "Do not add accessories or extra garments. "
        "CRITICAL: Strictly preserve the user's face identity, facial features, facial structure, expression, hairstyle, and skin tone exactly as in the selfie. "
        "Do NOT modify, beautify, or alter the face in any way. User identity preservation has absolute priority over garment transformation. "
        "Maintain original body proportions and posture; no slimming, enlarging, or reshaping. "
        "Fit the garment naturally and realistically: correct scale, accurate seams, proper collar/neck alignment, "
        "realistic draping, folds, and fabric physics consistent with the material. "
        "Show garment coverage clearly: reflect true length on the user's reported height (e.g., dress/skirt hem position, sleeve length, neckline depth/shape). "
        "Depict sleeves and neckline faithfully to the product reference; do not invent alternative cuts. "
        "Avoid hiding garment edges—ensure hems, cuffs, and neckline are visible and true to length. "
        "Merge lighting and color so the garment matches the selfie lighting conditions; "
        "avoid mismatched shadows, highlights, or color casts. "
        f"{measurements_text} "
        "Background: keep simple, clean, and consistent with the selfie; do not invent busy or stylized scenes. "
        "No cinematic grading, no fashion editorial stylization. "
        "Return only the final rendered image. "
        f"{source_text}"
    )
