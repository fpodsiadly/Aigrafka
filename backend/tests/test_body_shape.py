import pytest

from app.ai.body_shape import describe_body_shape, parse_measurement


@pytest.mark.parametrize(
    ("chest", "waist", "hips", "expected"),
    [
        ("90", "66", "92", "hourglass"),
        ("84", "70", "96", "pear/triangle"),
        ("100", "76", "88", "inverted-triangle"),
        ("90", "76", "92", "rectangle"),
        ("88", "104", "90", "diamond"),
        ("102", "98", "98", "round/apple"),
    ],
)
def test_describes_feminine_body_shapes(chest, waist, hips, expected):
    assert describe_body_shape("feminine", chest, waist, hips).startswith(expected)


@pytest.mark.parametrize(
    ("chest", "waist", "hips", "expected"),
    [
        ("112", "88", "94", "inverted-triangle"),
        ("104", "90", "96", "trapezoid"),
        ("100", "94", "98", "rectangle"),
        ("94", "92", "102", "triangle"),
        ("102", "104", "100", "oval"),
    ],
)
def test_describes_masculine_body_shapes(chest, waist, hips, expected):
    assert describe_body_shape("masculine", chest, waist, hips).startswith(expected)


@pytest.mark.parametrize(
    ("chest", "waist", "hips", "expected"),
    [
        ("105", "82", "90", "upper-body-dominant"),
        ("90", "82", "105", "lower-body-dominant"),
        ("96", "90", "96", "fuller-midsection"),
        ("96", "72", "96", "balanced"),
    ],
)
def test_describes_neutral_proportions(chest, waist, hips, expected):
    assert describe_body_shape("unisex", chest, waist, hips).startswith(expected)


def test_estimates_shape_from_two_available_measurements():
    description = describe_body_shape("feminine", "90", None, "102")

    assert description == "estimated lower-body-dominant proportions based on the available chest and hip measurements"


def test_returns_no_shape_from_one_valid_measurement():
    assert describe_body_shape("masculine", "100", "invalid", None) is None


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("90", 90.0),
        ("90,5", 90.5),
        ("invalid", None),
        ("10", None),
        ("300", None),
    ],
)
def test_parse_measurement(value, expected):
    assert parse_measurement(value, 30, 250) == expected
