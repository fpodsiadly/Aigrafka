import pytest

from app.ai.size_fit import clean_garment_size, describe_size_fit, parse_size_range


@pytest.mark.parametrize(
    ("value", "expected"),
    [("96-100", (96.0, 100.0)), ("96 – 100", (96.0, 100.0)), ("100/96", (96.0, 100.0)), ("98", (98.0, 98.0)),
     ("96,5-100", (96.5, 100.0)), ("M", None), ("5-10", None), ("", None), (None, None)],
)
def test_parse_size_range(value, expected):
    assert parse_size_range(value) == expected


def test_clean_garment_size():
    assert clean_garment_size(" m ") == "M"
    assert clean_garment_size("<script>XL") == "SCRIPT XL"
    assert clean_garment_size("38/40") == "38/40"
    assert len(clean_garment_size("x" * 50)) == 12


def test_describes_fit_per_measurement():
    text = describe_size_fit(
        "m",
        {"chest": "96-100", "waist": "80-84", "hips": "96-100"},
        {"chest": "106", "waist": "82", "hips": "95"},
    )

    assert text.startswith("The garment is size M, cut for a body with chest 96-100 cm, waist 80-84 cm, hips 96-100 cm.")
    assert "clearly tight at the chest (106 cm)" in text
    assert "true to size at the waist (82 cm)" in text
    assert "slightly roomy at the hips (95 cm)" in text
    assert "Show exactly this fit" in text


def test_size_without_chart_or_measurements():
    assert describe_size_fit("L", {}, {}) == "The garment is size L."
    assert describe_size_fit("L", {"chest": "100-104"}, {"chest": None}) == (
        "The garment is size L, cut for a body with chest 100-104 cm."
    )


def test_no_size_means_no_sentence():
    assert describe_size_fit(None, {"chest": "96-100"}, {"chest": "100"}) == ""
