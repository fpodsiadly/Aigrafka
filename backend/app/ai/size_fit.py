import re

from app.ai.body_shape import MAX_BODY_CIRCUMFERENCE_CM, MIN_BODY_CIRCUMFERENCE_CM, parse_measurement

MAX_GARMENT_SIZE_LENGTH = 12
_DISALLOWED_SIZE_CHARS = re.compile(r"[^\w\s/\-+.,]")
_RANGE_PATTERN = re.compile(r"^\s*(\d+(?:[.,]\d+)?)\s*(?:[-–/]\s*(\d+(?:[.,]\d+)?))?\s*$")

# How far (cm) the body may sit outside a size's range before the fit is
# described as clearly tight or loose rather than "slightly".
_CLEAR_MISMATCH_CM = 4.0


def clean_garment_size(size: str | None) -> str:
    if not size:
        return ""
    cleaned = _DISALLOWED_SIZE_CHARS.sub(" ", size)
    return " ".join(cleaned.split())[:MAX_GARMENT_SIZE_LENGTH].strip().upper()


def parse_size_range(value: str | None) -> tuple[float, float] | None:
    """Parse '96-100', '96–100', '96/100' or '96' (cm) from a shop size chart."""
    if not value:
        return None
    match = _RANGE_PATTERN.match(value)
    if not match:
        return None
    low = float(match.group(1).replace(",", "."))
    high = float((match.group(2) or match.group(1)).replace(",", "."))
    low, high = min(low, high), max(low, high)
    if low < MIN_BODY_CIRCUMFERENCE_CM or high > MAX_BODY_CIRCUMFERENCE_CM:
        return None
    return low, high


def _fit_word(body: float, size_range: tuple[float, float]) -> str:
    low, high = size_range
    if body > high:
        return "clearly tight" if body - high > _CLEAR_MISMATCH_CM else "slightly snug"
    if body < low:
        return "clearly loose" if low - body > _CLEAR_MISMATCH_CM else "slightly roomy"
    return "true to size"


def _format_range(size_range: tuple[float, float]) -> str:
    low, high = size_range
    return f"{low:g} cm" if low == high else f"{low:g}-{high:g} cm"


def describe_size_fit(
    garment_size: str | None,
    size_ranges: dict[str, str | None],
    body: dict[str, str | None],
) -> str:
    """Describe how the chosen size fits the user, from the shop's size chart.

    `size_ranges` and `body` are keyed by 'chest', 'waist' and 'hips'. Returns ''
    when no size was chosen.
    """
    size = clean_garment_size(garment_size)
    if not size:
        return ""

    ranges = {name: parse_size_range(value) for name, value in size_ranges.items()}
    cut_for = [f"{name} {_format_range(r)}" for name, r in ranges.items() if r is not None]
    fits = []
    for name, size_range in ranges.items():
        measurement = parse_measurement(body.get(name), MIN_BODY_CIRCUMFERENCE_CM, MAX_BODY_CIRCUMFERENCE_CM)
        if size_range is not None and measurement is not None:
            fits.append(f"{_fit_word(measurement, size_range)} at the {name} ({measurement:g} cm)")

    sentence = f"The garment is size {size}"
    if cut_for:
        sentence += f", cut for a body with {', '.join(cut_for)}"
    sentence += "."
    if fits:
        sentence += (
            f" On this person it is {'; '.join(fits)}. Show exactly this fit, with the fabric pulling or "
            "hanging the way it naturally would."
        )
    return sentence
