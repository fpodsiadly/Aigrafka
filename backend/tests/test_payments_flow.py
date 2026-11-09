from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import app.api.payments as payments
from app.api.payments import CheckoutRequest, _json_for_sign, _sha384

CRC = "crc_secret"


def _settings(**overrides):
    values = {
        "p24_env": "sandbox",
        "p24_merchant_id": 111,
        "p24_pos_id": 111,
        "p24_crc": CRC,
        "p24_api_user": "111",
        "p24_api_secret": "api-key",
        "p24_api_base": None,
        "p24_panel_base": None,
        "p24_currency": "PLN",
        "p24_pack_tokens": 5,
        "p24_pack_price_grosze": 1000,
        "checkout_success_url": "https://aigrafka.pl",
        "checkout_status_url": "https://api.test/payments/webhook",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class FakeP24:
    """Stands in for httpx.AsyncClient talking to Przelewy24."""

    calls: list = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, json, auth):
        FakeP24.calls.append(("register", url, json))
        return SimpleNamespace(status_code=200, json=lambda: {"data": {"token": "TOKEN123"}}, text="")

    async def put(self, url, json, auth):
        FakeP24.calls.append(("verify", url, json))
        return SimpleNamespace(status_code=200, json=lambda: {"data": {"status": "success"}}, text="")


@pytest.fixture
def p24(monkeypatch):
    FakeP24.calls = []
    monkeypatch.setattr(payments, "get_settings", lambda: _settings())
    monkeypatch.setattr(payments.httpx, "AsyncClient", FakeP24)
    return FakeP24


def _notification(session_id: str, amount: int = 1000, order_id: int = 777, sign: str | None = None) -> dict:
    body = {
        "merchantId": 111,
        "posId": 111,
        "sessionId": session_id,
        "amount": amount,
        "originAmount": amount,
        "currency": "PLN",
        "orderId": order_id,
        "methodId": 25,
        "statement": "p24-test",
    }
    body["sign"] = sign or _sha384(_json_for_sign({**body, "crc": CRC}))
    return body


class FakeRequest:
    def __init__(self, body: dict):
        self._body = body

    async def json(self):
        return self._body


def test_pack_exposes_configured_tokens_and_price(monkeypatch):
    monkeypatch.setattr(payments, "get_settings", lambda: _settings(p24_pack_tokens=7, p24_pack_price_grosze=1500))

    pack = payments.get_pack()

    assert (pack.tokens, pack.priceGrosze, pack.currency) == (7, 1500, "PLN")


@pytest.mark.asyncio
async def test_checkout_requires_accepted_terms(p24):
    with pytest.raises(HTTPException) as exc:
        await payments.create_checkout(CheckoutRequest(), "user-1")

    assert exc.value.status_code == 400
    assert exc.value.detail == "terms_not_accepted"
    assert p24.calls == []


@pytest.mark.asyncio
async def test_checkout_registers_pack_price_and_carries_tokens_in_session(p24, monkeypatch):
    async def user(_user_id):
        return {"id": "user-1", "email": "buyer@example.com"}

    monkeypatch.setattr(payments, "get_user_by_id", user)

    response = await payments.create_checkout(CheckoutRequest(acceptedTerms=True), "user-1")

    _, url, body = p24.calls[0]
    assert url == "https://sandbox.przelewy24.pl/api/v1/transaction/register"
    assert body["amount"] == 1000
    assert body["urlStatus"] == "https://api.test/payments/webhook"
    assert body["sessionId"].startswith("aigrafka:user-1:5:")
    assert response.checkoutUrl == "https://sandbox.przelewy24.pl/trnRequest/TOKEN123"


@pytest.mark.asyncio
async def test_valid_notification_is_verified_and_credits_tokens_from_session(p24, monkeypatch):
    credited = []

    async def credit(event_id, user_id, tokens):
        credited.append((event_id, user_id, tokens))
        return True

    monkeypatch.setattr(payments, "credit_tokens_for_payment", credit)
    # Price changed after checkout: tokens still come from the signed sessionId.
    monkeypatch.setattr(payments, "get_settings", lambda: _settings(p24_pack_price_grosze=2000))

    response = await payments.p24_webhook(FakeRequest(_notification("aigrafka:user-1:5:abc")))

    assert p24.calls[0][0] == "verify"
    assert p24.calls[0][2]["orderId"] == 777
    assert credited == [("p24:777", "user-1", 5)]
    assert response.credited is True and response.tokens == 5


@pytest.mark.asyncio
async def test_notification_with_wrong_sign_is_rejected_without_verify(p24):
    with pytest.raises(HTTPException) as exc:
        await payments.p24_webhook(FakeRequest(_notification("aigrafka:user-1:5:abc", sign="forged")))

    assert exc.value.status_code == 400
    assert p24.calls == []


@pytest.mark.asyncio
async def test_repeated_notification_does_not_credit_twice(p24, monkeypatch):
    seen = set()

    async def credit(event_id, user_id, tokens):
        if event_id in seen:
            return False
        seen.add(event_id)
        return True

    monkeypatch.setattr(payments, "credit_tokens_for_payment", credit)
    notification = _notification("aigrafka:user-1:5:abc")

    first = await payments.p24_webhook(FakeRequest(notification))
    second = await payments.p24_webhook(FakeRequest(notification))

    assert first.credited is True
    assert second.credited is False


@pytest.mark.asyncio
async def test_legacy_session_without_token_count_maps_amount_to_tokens(p24, monkeypatch):
    credited = []

    async def credit(event_id, user_id, tokens):
        credited.append(tokens)
        return True

    monkeypatch.setattr(payments, "credit_tokens_for_payment", credit)

    await payments.p24_webhook(FakeRequest(_notification("aigrafka:user-1:starter:abc", amount=2000)))

    assert credited == [10]
