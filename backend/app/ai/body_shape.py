from collections.abc import Mapping

MIN_BODY_CIRCUMFERENCE_CM = 30.0
MAX_BODY_CIRCUMFERENCE_CM = 250.0
MIN_HEIGHT_CM = 80.0
MAX_HEIGHT_CM = 250.0


def parse_measurement(value: str | None, minimum: float, maximum: float) -> float | None:
    if not value:
        return None

    try:
        parsed = float(value.strip().replace(",", "."))
    except ValueError:
        return None

    return parsed if minimum <= parsed <= maximum else None


def describe_body_shape(
    fit_style: str | None,
    chest_cm: str | None,
    waist_cm: str | None,
    hips_cm: str | None,
) -> str | None:
    measurements = {
        "chest": parse_measurement(chest_cm, MIN_BODY_CIRCUMFERENCE_CM, MAX_BODY_CIRCUMFERENCE_CM),
        "waist": parse_measurement(waist_cm, MIN_BODY_CIRCUMFERENCE_CM, MAX_BODY_CIRCUMFERENCE_CM),
        "hips": parse_measurement(hips_cm, MIN_BODY_CIRCUMFERENCE_CM, MAX_BODY_CIRCUMFERENCE_CM),
    }
    available = {name: value for name, value in measurements.items() if value is not None}

    if len(available) < 2:
        return None
    if len(available) < 3:
        return _describe_partial_shape(available)

    chest = available["chest"]
    waist = available["waist"]
    hips = available["hips"]

    if fit_style == "feminine":
        return _describe_feminine_shape(chest, waist, hips)
    if fit_style == "masculine":
        return _describe_masculine_shape(chest, waist, hips)
    return _describe_neutral_shape(chest, waist, hips)


# Thresholds from the body-shape reference table (defined in inches there).
INCH_CM = 2.54
SIMILAR_BUST_HIPS_CM = 3 * INCH_CM  # bust and hips "about equal"
CLEAR_DIFFERENCE_CM = 3 * INCH_CM  # pear / inverted triangle: 3+ inches apart
DEFINED_WAIST_CM = 8 * INCH_CM  # hourglass: waist 8+ inches smaller than bust and hips
APPLE_WAIST_TO_HIP = 0.85
OVAL_WAIST_TO_HIP = 0.95
INVERTED_TRIANGLE_CHEST_TO_WAIST = 1.4
TRAPEZOID_CHEST_TO_WAIST = 1.3
RECTANGLE_MAX_SPREAD = 1.08  # widest / narrowest measurement


def _describe_feminine_shape(chest: float, waist: float, hips: float) -> str:
    if waist > chest * 1.05 and waist > hips * 1.05:
        return "diamond body shape: the waist is the fullest area, with a narrower bust and hips"
    # The table's "waist >= hips/bust": a high waist-to-hip ratio alone would label narrow-hipped
    # inverted triangles as apples, so the waist must be close to the bust as well.
    if waist / hips > APPLE_WAIST_TO_HIP and waist / chest > APPLE_WAIST_TO_HIP:
        return (
            "round/apple body shape: a fuller midsection with the waist close to the bust and hip width "
            "and little waist definition"
        )
    if abs(chest - hips) < SIMILAR_BUST_HIPS_CM and min(chest, hips) - waist >= DEFINED_WAIST_CM:
        return "hourglass body shape: bust and hips of similar width with a clearly narrower, defined waist"
    if hips - chest >= CLEAR_DIFFERENCE_CM:
        return "pear/triangle body shape: hips noticeably wider than the bust, with a defined waist"
    if chest - hips >= CLEAR_DIFFERENCE_CM:
        return "inverted-triangle body shape: bust and shoulders noticeably wider than the hips"
    return "rectangle body shape: bust, waist and hips of similar width, giving a fairly straight silhouette"


def _describe_masculine_shape(chest: float, waist: float, hips: float) -> str:
    if waist >= chest * 0.98 and waist / hips >= OVAL_WAIST_TO_HIP:
        return "oval body shape: a fuller abdomen, with the waist as wide as or wider than the chest and hips"
    if max(hips, waist) > chest:
        return "triangle body shape: hips and waist wider than the chest and shoulders"
    chest_to_waist = chest / waist
    if chest_to_waist > INVERTED_TRIANGLE_CHEST_TO_WAIST:
        return "inverted-triangle body shape: a broad chest and shoulders tapering sharply to a narrow waist and hips"
    if chest_to_waist >= TRAPEZOID_CHEST_TO_WAIST:
        return "trapezoid (V-taper) body shape: chest and shoulders clearly broader than the waist"
    if max(chest, waist, hips) / min(chest, waist, hips) <= RECTANGLE_MAX_SPREAD:
        return "rectangle body shape: chest, waist and hips of nearly equal width"
    # Between the table's rectangle and trapezoid (chest-to-waist below 1.3).
    return "slightly tapered body shape: the chest moderately broader than the waist and hips"


def _describe_neutral_shape(chest: float, waist: float, hips: float) -> str:
    if waist >= max(chest, hips) * 0.92:
        return "fuller-midsection proportions, with the waist close to the chest and hip measurements"
    if chest >= hips * 1.07:
        return "upper-body-dominant proportions, with the chest broader than the hips"
    if hips >= chest * 1.07:
        return "lower-body-dominant proportions, with the hips broader than the chest"
    return "balanced proportions, with the chest and hips similar in size and a defined waist"


def _describe_partial_shape(measurements: Mapping[str, float]) -> str:
    chest = measurements.get("chest")
    waist = measurements.get("waist")
    hips = measurements.get("hips")

    if chest is not None and hips is not None:
        if chest >= hips * 1.07:
            return "estimated upper-body-dominant proportions based on the available chest and hip measurements"
        if hips >= chest * 1.07:
            return "estimated lower-body-dominant proportions based on the available chest and hip measurements"
        return "estimated balanced upper- and lower-body proportions based on the available chest and hip measurements"

    outer_measurement = chest if chest is not None else hips
    outer_name = "chest" if chest is not None else "hips"
    if waist is not None and outer_measurement is not None:
        if waist >= outer_measurement * 0.92:
            return f"estimated fuller-midsection proportions based on the available waist and {outer_name} measurements"
        return f"estimated defined-waist proportions based on the available waist and {outer_name} measurements"

    return ""
