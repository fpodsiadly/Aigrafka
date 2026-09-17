from dataclasses import dataclass

from fastapi import HTTPException, status


@dataclass(frozen=True)
class GarmentCategory:
    prompt_label: str
    feminine_only: bool = False
    intimate: bool = False


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


def validate_garment_category(category: str | None, fit_style: str | None) -> str:
    if not category:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="category_required",
        )

    garment_category = GARMENT_CATEGORIES.get(category)
    if garment_category is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="invalid_category",
        )

    if fit_style == "masculine" and garment_category.intimate:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="incompatible_category:masculine_intimate",
        )

    if fit_style == "masculine" and garment_category.feminine_only:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="incompatible_category:masculine_feminine",
        )

    return garment_category.prompt_label
