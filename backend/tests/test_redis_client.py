import logging

import pytest

import app.core.redis_client as redis_client


class FakeSettings:
    def __init__(self, redis_url=None, upstash_url=None):
        self.redis_url = redis_url
        self.redis_token = None
        self.upstash_redis_rest_url = upstash_url
        self.upstash_redis_rest_token = None


class FakeRedis:
    def ping(self):
        return True


@pytest.fixture(autouse=True)
def reset_client_state(monkeypatch):
    monkeypatch.setattr(redis_client, "_redis_client", None)
    monkeypatch.setattr(redis_client, "_next_retry_at", 0.0)
    monkeypatch.setattr(redis_client, "_failed_attempts", 0)


def _flaky_from_url(failures: int):
    calls = {"count": 0}

    def from_url(*_args, **_kwargs):
        calls["count"] += 1
        if calls["count"] <= failures:
            raise OSError("[Errno -2] Name or service not known")
        return FakeRedis()

    return from_url, calls


@pytest.mark.asyncio
async def test_startup_retries_through_a_transient_dns_failure(monkeypatch, caplog):
    from_url, calls = _flaky_from_url(failures=1)
    monkeypatch.setattr(redis_client, "get_settings", lambda: FakeSettings(redis_url="redis://cache:6379"))
    monkeypatch.setattr(redis_client.redis, "from_url", from_url)

    with caplog.at_level(logging.INFO, logger="app.core.redis_client"):
        assert await redis_client.connect_redis_at_startup(delay_seconds=0) is True

    assert calls["count"] == 2
    assert "Redis connected after 1 failed attempt(s)" in caplog.text


@pytest.mark.asyncio
async def test_startup_gives_up_after_configured_attempts(monkeypatch):
    from_url, calls = _flaky_from_url(failures=10)
    monkeypatch.setattr(redis_client, "get_settings", lambda: FakeSettings(redis_url="redis://cache:6379"))
    monkeypatch.setattr(redis_client.redis, "from_url", from_url)

    assert await redis_client.connect_redis_at_startup(attempts=3, delay_seconds=0) is False
    assert calls["count"] == 3


@pytest.mark.asyncio
async def test_unconfigured_redis_is_not_retried(monkeypatch):
    monkeypatch.setattr(redis_client, "get_settings", lambda: FakeSettings())

    assert redis_client.is_redis_configured() is False
    assert await redis_client.connect_redis_at_startup(delay_seconds=0) is False
