
from app.api.payments import P24Config, P24WebhookPayload, _build_register_sign, _is_notification_sign_valid


def test_build_register_sign_stable():
    config = P24Config(
        merchant_id=1,
        pos_id=1,
        crc="crc_secret",
        api_user="user",
        api_secret="secret",
        api_base="https://sandbox.przelewy24.pl/api/v1",
        panel_base="https://sandbox.przelewy24.pl",
        currency="PLN",
    )
    sign = _build_register_sign("session-123", 1000, "PLN", config)
    assert sign == _build_register_sign("session-123", 1000, "PLN", config)
    assert sign != _build_register_sign("session-123", 2000, "PLN", config)


def test_notification_sign_valid():
    config = P24Config(
        merchant_id=1,
        pos_id=1,
        crc="crc_secret",
        api_user="user",
        api_secret="secret",
        api_base="https://sandbox.przelewy24.pl/api/v1",
        panel_base="https://sandbox.przelewy24.pl",
        currency="PLN",
    )
    payload = P24WebhookPayload(
        merchantId=1,
        posId=1,
        sessionId="session-123",
        amount=1000,
        originAmount=1000,
        currency="PLN",
        orderId=123,
        methodId=1,
        statement="",
        sign="wrong",
    )
    assert not _is_notification_sign_valid(payload, config)
