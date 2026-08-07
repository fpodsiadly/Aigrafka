
from app.core.config import Settings
from app.core.security import create_access_token, decode_access_token, hash_password, verify_password


def test_password_hash_roundtrip():
    password = "secret123"
    hashed = hash_password(password)
    assert verify_password(password, hashed)
    assert not verify_password("wrong", hashed)


def test_jwt_roundtrip(monkeypatch):
    monkeypatch.setattr(
        "app.core.security.get_settings",
        lambda: Settings(JWT_SECRET="a" * 32, JWT_EXP_MINUTES=60),
    )
    token = create_access_token("user1", "test@example.com")
    payload = decode_access_token(token)
    assert payload["sub"] == "user1"
    assert payload["email"] == "test@example.com"
