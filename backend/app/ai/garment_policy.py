import re
import unicodedata
from dataclasses import dataclass

from fastapi import HTTPException, status


@dataclass(frozen=True)
class GarmentCategory:
    prompt_label: str
    feminine_only: bool = False
    intimate: bool = False


# Fixed category keys sent by extension versions that used a dropdown. Still
# accepted so older installs keep working; new versions send free text.
GARMENT_CATEGORIES = {
    "tshirt": GarmentCategory("T-shirt"),
    "shirt": GarmentCategory("shirt"),
    "hoodie": GarmentCategory("hoodie"),
    "sweater": GarmentCategory("sweater"),
    "jacket": GarmentCategory("jacket"),
    "coat": GarmentCategory("coat"),
    "trousers": GarmentCategory("trousers"),
    "jeans": GarmentCategory("jeans"),
    "shorts": GarmentCategory("shorts"),
    "suit": GarmentCategory("suit"),
    "womens_blouse": GarmentCategory("women's blouse", feminine_only=True),
    "dress": GarmentCategory("dress", feminine_only=True),
    "skirt": GarmentCategory("skirt", feminine_only=True),
    "womens_leggings": GarmentCategory("women's leggings", feminine_only=True),
    "underwear": GarmentCategory("underwear", intimate=True),
    "lingerie": GarmentCategory("lingerie", feminine_only=True, intimate=True),
    "bra": GarmentCategory("bra", feminine_only=True, intimate=True),
    "swimwear": GarmentCategory("swimwear", intimate=True),
    "bikini": GarmentCategory("bikini", feminine_only=True, intimate=True),
}

# The free-text category is interpolated into the model prompt: keep it short
# and limited to characters a garment description needs.
MAX_CATEGORY_LENGTH = 60
_DISALLOWED_CATEGORY_CHARS = re.compile(r"[^\w\s\-'/&,.]")

# Keyword stems matched against the lower-cased, diacritic-free category, in
# Polish and English. Short English words are matched as whole words only.
_INTIMATE_STEMS = (
    "bieliz", "majt", "stanik", "biustonosz", "stringi", "figi", "bokserk", "slipy",
    "kapiel", "bikini", "lingerie", "underwear", "swim", "panties", "thong",
)
_INTIMATE_WORDS = ("bra", "bras", "boxers", "briefs")
_FEMININE_STEMS = ("sukien", "sukni", "spodnic", "damsk", "legginsy", "women")
_FEMININE_WORDS = ("dress", "dresses", "skirt", "skirts", "blouse", "blouses", "leggings")


@dataclass(frozen=True)
class _CategoryFlags:
    feminine_only: bool
    intimate: bool


def _fold(text: str) -> str:
    """Lower-case and strip diacritics so 'Strój kąpielowy' matches 'kapiel'."""
    decomposed = unicodedata.normalize("NFKD", text.lower().replace("ł", "l"))
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def _flags_for_free_text(category: str) -> _CategoryFlags:
    folded = _fold(category)
    words = set(re.findall(r"[a-z]+", folded))
    intimate = any(stem in folded for stem in _INTIMATE_STEMS) or bool(words.intersection(_INTIMATE_WORDS))
    feminine_only = any(stem in folded for stem in _FEMININE_STEMS) or bool(words.intersection(_FEMININE_WORDS))
    return _CategoryFlags(feminine_only=feminine_only, intimate=intimate)


def normalize_category(category: str) -> str:
    cleaned = _DISALLOWED_CATEGORY_CHARS.sub(" ", category)
    return " ".join(cleaned.split())[:MAX_CATEGORY_LENGTH].strip()


def validate_garment_category(category: str | None, fit_style: str | None) -> str:
    if not category or not category.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="category_required",
        )

    legacy_category = GARMENT_CATEGORIES.get(category)
    if legacy_category is not None:
        prompt_label = legacy_category.prompt_label
        flags = _CategoryFlags(legacy_category.feminine_only, legacy_category.intimate)
    else:
        prompt_label = normalize_category(category)
        if not prompt_label:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="invalid_category",
            )
        flags = _flags_for_free_text(prompt_label)

    if fit_style == "masculine" and flags.intimate:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="incompatible_category:masculine_intimate",
        )

    if fit_style == "masculine" and flags.feminine_only:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="incompatible_category:masculine_feminine",
        )

    return prompt_label
