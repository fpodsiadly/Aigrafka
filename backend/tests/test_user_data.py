import pytest

import app.core.user_data as user_data


class FakeRedis:
    def __init__(self):
        self.values: dict[str, object] = {}
        self.ttls: dict[str, int] = {}

    def sadd(self, key, *members):
        self.values.setdefault(key, set()).update(members)

    def smembers(self, key):
        return set(self.values.get(key, set()))

    def ttl(self, key):
        return self.ttls.get(key, -1)

    def expire(self, key, seconds):
        self.ttls[key] = seconds

    def delete(self, *keys):
        removed = 0
        for key in keys:
            if self.values.pop(key, None) is not None:
                removed += 1
        return removed


@pytest.fixture
def fake_redis(monkeypatch):
    client = FakeRedis()
    monkeypatch.setattr(user_data, "get_redis_client", lambda: client)
    return client


@pytest.mark.asyncio
async def test_tracked_keys_are_deleted_with_the_index(fake_redis):
    fake_redis.values["result_image:a"] = "img"
    fake_redis.values["gen_cache:b"] = "cached"
    fake_redis.values["result_image:other-user"] = "img"

    await user_data.track_user_data_key("user-1", "result_image:a", 3600)
    await user_data.track_user_data_key("user-1", "gen_cache:b", 86400)

    assert fake_redis.ttls["user_data:user-1"] == 86400
    assert await user_data.delete_user_data_keys("user-1") == 2
    assert "user_data:user-1" not in fake_redis.values
    assert set(fake_redis.values) == {"result_image:other-user"}


@pytest.mark.asyncio
async def test_anonymous_data_is_not_tracked(fake_redis):
    await user_data.track_user_data_key(None, "result_image:a", 3600)

    assert fake_redis.values == {}


@pytest.mark.asyncio
async def test_delete_my_data_removes_images_and_profile(monkeypatch):
    import app.api.profile as profile

    deleted_profiles = []

    async def delete_keys(user_id):
        return 3

    async def delete_profile(user_id):
        deleted_profiles.append(user_id)

    monkeypatch.setattr(profile, "delete_user_data_keys", delete_keys)
    monkeypatch.setattr(profile, "delete_profile", delete_profile)

    result = await profile.delete_my_data(current_user_id="user-1")

    assert result.deleted is True
    assert result.removedImages == 3
    assert deleted_profiles == ["user-1"]


@pytest.mark.asyncio
async def test_delete_my_data_keeps_profile_when_image_deletion_fails(monkeypatch):
    from fastapi import HTTPException

    import app.api.profile as profile

    async def delete_keys(user_id):
        raise RuntimeError("redis down")

    async def delete_profile(user_id):
        raise AssertionError("profile must not be deleted before images")

    monkeypatch.setattr(profile, "delete_user_data_keys", delete_keys)
    monkeypatch.setattr(profile, "delete_profile", delete_profile)

    with pytest.raises(HTTPException) as exc_info:
        await profile.delete_my_data(current_user_id="user-1")

    assert exc_info.value.status_code == 503
