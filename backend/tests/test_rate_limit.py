from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException, Request

from app.core.rate_limit import enforce_generate_rate_limit


def _mock_request(ip: str = "1.2.3.4") -> Request:
    req = MagicMock(spec=Request)
    req.headers = {"x-forwarded-for": ip}
    req.client = MagicMock(host=ip)
    return req


def _settings(per_minute=5, per_hour=100, burst=3):
    return MagicMock(
        generate_rate_limit_per_minute=per_minute,
        generate_rate_limit_per_hour=per_hour,
        generate_rate_limit_burst=burst,
    )


@pytest.mark.asyncio
async def test_rate_limit_local_fallback_when_redis_down(monkeypatch):
    import app.core.rate_limit as rl

    rl._local_hits.clear()
    monkeypatch.setattr(rl, "get_settings", lambda: _settings(per_minute=5, per_hour=100, burst=3))
    monkeypatch.setattr(rl, "get_redis_client", lambda: None)

    req = _mock_request()
    # Redis unavailable -> local fallback still enforces (fail-closed), first ones allowed
    await enforce_generate_rate_limit(req, "user1")
    await enforce_generate_rate_limit(req, "user1")


@pytest.mark.asyncio
async def test_rate_limit_local_fallback_blocks_excess(monkeypatch):
    import app.core.rate_limit as rl

    rl._local_hits.clear()
    monkeypatch.setattr(rl, "get_settings", lambda: _settings(per_minute=2, per_hour=100, burst=5))
    monkeypatch.setattr(rl, "get_redis_client", lambda: None)

    req = _mock_request()
    await enforce_generate_rate_limit(req, "user1")
    await enforce_generate_rate_limit(req, "user1")
    with pytest.raises(HTTPException) as exc:
        await enforce_generate_rate_limit(req, "user1")
    assert exc.value.status_code == 429


@pytest.mark.asyncio
async def test_rate_limit_blocks_excess(monkeypatch):
    class FakeRedis:
        def __init__(self):
            self.data = {}

        def zremrangebyscore(self, key, min_score, max_score):
            self.data[key] = [ts for ts in self.data.get(key, []) if ts > max_score]

        def zcard(self, key):
            return len(self.data.get(key, []))

        def zadd(self, key, mapping):
            self.data.setdefault(key, []).extend(mapping.values())

        def expire(self, key, seconds):
            pass

    import app.core.rate_limit as rl

    rl._local_hits.clear()
    fake = FakeRedis()
    monkeypatch.setattr(rl, "get_redis_client", lambda: fake)
    monkeypatch.setattr(rl, "get_settings", lambda: _settings(per_minute=2, per_hour=100, burst=5))

    req = _mock_request()
    await enforce_generate_rate_limit(req, "user1")
    await enforce_generate_rate_limit(req, "user1")
    with pytest.raises(HTTPException) as exc:
        await enforce_generate_rate_limit(req, "user1")
    assert exc.value.status_code == 429
