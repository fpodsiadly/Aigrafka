from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.auth import me, start_demo_access
from app.api.payments import CheckoutRequest, create_checkout
from app.core.security import DEMO_EMAIL, DEMO_USER_ID, is_demo_user_id


@pytest.mark.asyncio
async def test_demo_access_issues_non_payment_identity(monkeypatch):
    import app.api.auth as auth

    monkeypatch.setattr(auth, "get_settings", lambda: SimpleNamespace(demo_access_enabled=True))
    response = await start_demo_access()

    assert response.user_id == DEMO_USER_ID
    assert response.email == DEMO_EMAIL
    assert response.tokens == 999
    assert is_demo_user_id(response.user_id)


@pytest.mark.asyncio
async def test_demo_access_can_be_disabled(monkeypatch):
    import app.api.auth as auth

    monkeypatch.setattr(auth, "get_settings", lambda: SimpleNamespace(demo_access_enabled=False))
    with pytest.raises(HTTPException) as exc:
        await start_demo_access()
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_demo_identity_bypasses_database_lookup_and_checkout():
    response = await me(DEMO_USER_ID)
    assert response.email == DEMO_EMAIL

    with pytest.raises(HTTPException) as exc:
        await create_checkout(CheckoutRequest(), DEMO_USER_ID)
    assert exc.value.status_code == 403
