from app.ai.product_image import _extract_image_candidate


def test_json_ld_product_image_wins_over_og_image():
    html = """
    <meta property="og:image" content="https://shop.test/banner.jpg">
    <script type="application/ld+json">
      {"@context": "https://schema.org", "@type": "Product", "name": "Shirt",
       "image": ["https://shop.test/packshot-1.jpg", "https://shop.test/packshot-2.jpg"]}
    </script>
    """

    assert _extract_image_candidate(html) == "https://shop.test/packshot-1.jpg"


def test_json_ld_product_inside_graph_with_image_object():
    html = """
    <script type="application/ld+json">
      {"@graph": [{"@type": "WebPage"},
                  {"@type": ["Product"], "image": {"@type": "ImageObject", "contentUrl": "/img/dress.webp"}}]}
    </script>
    """

    assert _extract_image_candidate(html) == "/img/dress.webp"


def test_invalid_json_ld_falls_back_to_og_image():
    html = """
    <script type="application/ld+json">{not json</script>
    <meta property="og:image" content="https://shop.test/og.jpg">
    """

    assert _extract_image_candidate(html) == "https://shop.test/og.jpg"


def test_json_ld_without_product_falls_back_to_og_image():
    html = """
    <script type="application/ld+json">{"@type": "Organization", "image": "https://shop.test/logo.png"}</script>
    <meta property="og:image" content="https://shop.test/og.jpg">
    """

    assert _extract_image_candidate(html) == "https://shop.test/og.jpg"
