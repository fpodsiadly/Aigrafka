from types import SimpleNamespace

import app.core.db as db


def test_get_engine_translates_sslmode_for_asyncpg(monkeypatch):
    captured = {}

    def fake_create_async_engine(url, **kwargs):
        captured["url"] = url
        captured["kwargs"] = kwargs
        return object()

    monkeypatch.setattr(
        db,
        "get_settings",
        lambda: SimpleNamespace(
            database_url="postgresql://user:pass@db.example.com/app?sslmode=require",
            db_pool_size=2,
            db_max_overflow=1,
            db_pool_recycle=300,
            db_pool_timeout=10,
        ),
    )
    monkeypatch.setattr(db, "create_async_engine", fake_create_async_engine)
    db._engine = None

    db.get_engine()

    assert captured["url"].drivername == "postgresql+asyncpg"
    assert "sslmode" not in captured["url"].query
    assert captured["kwargs"]["connect_args"] == {"ssl": "require"}
    db._engine = None
