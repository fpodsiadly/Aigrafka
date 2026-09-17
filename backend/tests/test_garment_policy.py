import pytest
from fastapi import HTTPException

from app.ai.garment_policy import validate_garment_category


@pytest.mark.parametrize("category", ["dress", "skirt", "womens_blouse", "womens_leggings"])
def test_masculine_fit_rejects_feminine_categories(category):
    with pytest.raises(HTTPException) as exc:
        validate_garment_category(category, "masculine")

    assert exc.value.status_code == 422
    assert exc.value.detail == "incompatible_category:masculine_feminine"


@pytest.mark.parametrize("category", ["underwear", "lingerie", "bra", "swimwear", "bikini"])
def test_masculine_fit_rejects_intimate_categories(category):
    with pytest.raises(HTTPException) as exc:
        validate_garment_category(category, "masculine")

    assert exc.value.status_code == 422
    assert exc.value.detail == "incompatible_category:masculine_intimate"


def test_feminine_fit_accepts_feminine_category():
    assert validate_garment_category("dress", "feminine") == "dress"


def test_category_is_required_and_must_be_supported():
    with pytest.raises(HTTPException) as missing:
        validate_garment_category(None, "feminine")
    with pytest.raises(HTTPException) as invalid:
        validate_garment_category("custom category", "feminine")

    assert missing.value.detail == "category_required"
    assert invalid.value.detail == "invalid_category"
