from urllib.parse import urlparse


def build_openvto_prompt(product_ref: str, is_upload: bool = False) -> str:
    domain = urlparse(product_ref).netloc if not is_upload else ""
    source_text = (
        "Product provided via user-uploaded image(s)."
        if is_upload
        else f"Product source domain: {domain or 'unknown'}. Product URL: {product_ref}."
    )

    return (
    "You are an AI virtual try-on system following OpenVTO principles. "
    "Inputs: (1) user selfie image; (2) product garment image from the e-commerce page or upload. "
    "Generate ONE photorealistic full-body portrait of the user wearing the product. "
    "Pose: user standing upright, relaxed neutral stance, body and face oriented straight toward the camera. "
    "Camera/framing: full body visible (head to feet) with slight headroom; straight-on preferred or very subtle 3/4 view; no profile. "
    "Aspect ratio approximately 3:4 (allow up to 2:3 if needed to keep feet visible). "
    "Strictly preserve the user's face identity, facial features, hairstyle, and skin tone. "
    "User identity preservation has higher priority than garment transformation. "
    "Maintain original body proportions and posture; no slimming, enlarging, or reshaping. "
    "Fit the garment naturally and realistically: correct scale, accurate seams, proper collar/neck alignment, "
    "realistic draping, folds, and fabric physics consistent with the material. "
    "Merge lighting and color so the garment matches the selfie lighting conditions; "
    "avoid mismatched shadows, highlights, or color casts. "
    "Do not add or remove anything: no logos, text, watermarks, borders, accessories, extra garments, "
    "extra fingers or limbs. "
    "Background: keep simple, clean, and consistent with the selfie; do not invent busy or stylized scenes. "
    "No cinematic grading, no fashion editorial stylization. "
    "Return only the final rendered image. "
    f"{source_text}"
    )
