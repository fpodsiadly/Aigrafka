from typing import Optional
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings

_engine = None


def get_engine():
    global _engine
    if _engine is None:
        settings = get_settings()
        connect_args = {}
        if "render.com" in settings.database_url and "sslmode=" not in settings.database_url:
            connect_args = {"sslmode": "require"}
        _engine = create_engine(settings.database_url, pool_pre_ping=True, future=True, connect_args=connect_args)
    return _engine


def init_auth_tables() -> None:
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(text(
            """
            CREATE TABLE IF NOT EXISTS auth_user_credentials (
                user_id TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        ))


def get_user_with_credentials_by_email(email: str) -> Optional[dict]:
    engine = get_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT u.id, u.email, u.tokens, c.password_hash
                FROM "User" u
                JOIN auth_user_credentials c ON c.user_id = u.id
                WHERE LOWER(u.email) = LOWER(:email)
                LIMIT 1
                """
            ),
            {"email": email},
        ).mappings().first()
    return dict(row) if row else None


def get_user_by_id(user_id: str) -> Optional[dict]:
    engine = get_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT id, email, tokens
                FROM "User"
                WHERE id = :user_id
                LIMIT 1
                """
            ),
            {"user_id": user_id},
        ).mappings().first()
    return dict(row) if row else None


def create_user_with_credentials(email: str, password_hash: str, initial_tokens: int) -> dict:
    engine = get_engine()
    user_id = uuid4().hex

    try:
        with engine.begin() as conn:
            existing_user = conn.execute(
                text(
                    """
                    SELECT id, email, tokens
                    FROM "User"
                    WHERE LOWER(email) = LOWER(:email)
                    LIMIT 1
                    """
                ),
                {"email": email},
            ).mappings().first()

            if existing_user:
                user_id = existing_user["id"]
            else:
                conn.execute(
                    text(
                        """
                        INSERT INTO "User" (id, email, tokens, "createdAt", "updatedAt")
                        VALUES (:id, :email, :tokens, NOW(), NOW())
                        """
                    ),
                    {"id": user_id, "email": email, "tokens": initial_tokens},
                )

            conn.execute(
                text(
                    """
                    INSERT INTO auth_user_credentials (user_id, email, password_hash)
                    VALUES (:user_id, :email, :password_hash)
                    """
                ),
                {"user_id": user_id, "email": email, "password_hash": password_hash},
            )

            user = conn.execute(
                text(
                    """
                    SELECT id, email, tokens
                    FROM "User"
                    WHERE id = :user_id
                    LIMIT 1
                    """
                ),
                {"user_id": user_id},
            ).mappings().first()

        if not user:
            raise RuntimeError("Failed to create user")

        return dict(user)
    except IntegrityError as exc:
        raise ValueError("User already exists") from exc


def add_tokens(user_id: str, amount: int) -> int:
    engine = get_engine()
    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                UPDATE "User"
                SET tokens = tokens + :amount,
                    "updatedAt" = NOW()
                WHERE id = :user_id
                RETURNING tokens
                """
            ),
            {"user_id": user_id, "amount": amount},
        ).mappings().first()
    if not row:
        raise ValueError("User not found")
    return int(row["tokens"])


def deduct_tokens_if_possible(user_id: str, amount: int) -> Optional[int]:
    engine = get_engine()
    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                UPDATE "User"
                SET tokens = tokens - :amount,
                    "updatedAt" = NOW()
                WHERE id = :user_id
                  AND tokens >= :amount
                RETURNING tokens
                """
            ),
            {"user_id": user_id, "amount": amount},
        ).mappings().first()

    if not row:
        return None
    return int(row["tokens"])
