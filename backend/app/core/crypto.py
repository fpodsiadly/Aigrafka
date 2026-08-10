"""Optional at-rest encryption for job payloads stored in Redis.

When PAYLOAD_ENCRYPTION_KEY (a urlsafe base64 Fernet key) is configured, the
sensitive job payload (base64 selfie / product images) is encrypted before it
touches Redis and decrypted only inside the worker. Without a key the payload
is stored as-is, preserving previous behavior.
"""

from functools import lru_cache

from app.core.config import get_settings

_ENC_PREFIX = "enc:"


@lru_cache(maxsize=1)
def _fernet():
    key = get_settings().payload_encryption_key
    if not key:
        return None
    from cryptography.fernet import Fernet

    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_payload(plaintext: str) -> str:
    fernet = _fernet()
    if not fernet:
        return plaintext
    return _ENC_PREFIX + fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_payload(stored: str) -> str:
    if not stored.startswith(_ENC_PREFIX):
        return stored
    fernet = _fernet()
    if not fernet:
        raise RuntimeError("Encrypted payload found but PAYLOAD_ENCRYPTION_KEY is not configured")
    return fernet.decrypt(stored[len(_ENC_PREFIX):].encode("ascii")).decode("utf-8")
