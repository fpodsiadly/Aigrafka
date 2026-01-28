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
        "Generate ONE photorealistic portrait of the user wearing the product. "
        "Keep camera similar to the selfie: upper-body portrait, straight-on or slight 3/4, aspect ratio about 3:4. "
        "Strictly preserve the user's face identity, hairstyle, and skin tone; no body morphing, no slimming or enlarging. "
        "Fit the garment naturally: correct scale, seams, collar/neck alignment, realistic draping and fabric physics. "
        "Merge lighting and color so the garment matches the selfie lighting; avoid mismatched shadows or highlights. "
        "Do not add logos, text, watermarks, borders, extra garments, accessories, or extra fingers/limbs. "
        "Background: keep simple/clean and consistent with the selfie; do not invent busy scenes. "
        "Return only the final rendered image. "
        f"{source_text}"
    )
