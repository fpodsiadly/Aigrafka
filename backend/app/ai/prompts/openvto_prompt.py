from urllib.parse import urlparse


def build_openvto_prompt(product_url: str) -> str:
    domain = urlparse(product_url).netloc
    return (
        "You are an AI virtual try-on system following OpenVTO principles. "
        "Inputs: (1) user selfie image; (2) product garment image from the e-commerce page. "
        "Generate ONE photorealistic portrait of the user wearing the product. "
        "Strictly preserve the user's face identity and hair; keep skin tone consistent; avoid body morphing. "
        "Fit the garment naturally (draping, folds, collar/neck alignment), respect fabric physics and scale. "
        "Lighting should stay natural and coherent with the selfie; avoid artifacts, text, or watermarks. "
        "Return only the final rendered image. "
        f"Product source domain: {domain}. Product URL: {product_url}."
    )
