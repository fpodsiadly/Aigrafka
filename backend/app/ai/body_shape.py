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


def _describe_feminine_shape(chest: float, waist: float, hips: float) -> str:
    if waist > chest * 1.05 and waist > hips * 1.05:
        return "diamond body shape: the waist is the fullest area, with a narrower chest and hips"
    if waist >= max(chest, hips) * 0.9 and chest >= hips * 0.95:
        return "round/apple body shape: a fuller midsection with comparatively less waist definition"
    if abs(chest - hips) <= max(chest, hips) * 0.05 and waist <= min(chest, hips) * 0.75:
        return "hourglass body shape: balanced chest and hips with a clearly defined waist"
    if hips >= chest * 1.05:
        return "pear/triangle body shape: hips are broader than the chest, with a comparatively narrower upper body"
    if chest >= hips * 1.05:
        return "inverted-triangle body shape: the upper body is broader than the hips"
    return "rectangle body shape: chest and hips are balanced with gentle waist definition"


def _describe_masculine_shape(chest: float, waist: float, hips: float) -> str:
    if waist >= max(chest, hips) * 0.95:
        return "oval body shape: a fuller midsection with comparatively narrower upper and lower proportions"
    if hips >= chest * 1.05:
        return "triangle body shape: the lower body is broader than the chest"
    if chest >= hips * 1.1 and waist <= chest * 0.85:
        return "inverted-triangle body shape: a broad chest tapering clearly toward the waist and hips"
    if chest >= hips * 1.05 and waist < chest * 0.95:
        return "trapezoid body shape: the chest is moderately broader than the waist and hips"
    return "rectangle body shape: chest, waist, and hips have relatively balanced proportions"


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
