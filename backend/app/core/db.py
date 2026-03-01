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


def init_profile_tables() -> None:
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(text(
            """
            CREATE TABLE IF NOT EXISTS "Profile" (
                id TEXT PRIMARY KEY,
                "userId" TEXT UNIQUE NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
                height TEXT NOT NULL,
                chest TEXT NOT NULL,
                waist TEXT NOT NULL,
                hips TEXT NOT NULL,
                "fitStyle" TEXT,
                category TEXT,
                "productUrl" TEXT,
                "selfieUrl" TEXT,
                "consentGiven" BOOLEAN NOT NULL DEFAULT FALSE,
                "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        ))
        conn.execute(text('ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "fitStyle" TEXT'))
        conn.execute(text('ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS category TEXT'))
        conn.execute(text('ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "productUrl" TEXT'))
        conn.execute(text('ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "selfieUrl" TEXT'))
        conn.execute(text('ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "consentGiven" BOOLEAN NOT NULL DEFAULT FALSE'))


def init_payment_tables() -> None:
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(text(
            """
            CREATE TABLE IF NOT EXISTS fastapi_payment_events (
                event_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                amount_tokens INTEGER NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        ))


def get_profile_by_user_id(user_id: str) -> Optional[dict]:
    engine = get_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT
                    "userId" AS "userId",
                    height,
                    chest,
                    waist,
                    hips,
                    "fitStyle" AS "fitStyle",
                    "consentGiven" AS "consentGiven",
                    category,
                    "productUrl" AS "productUrl",
                    "selfieUrl" AS "selfieUrl"
                FROM "Profile"
                WHERE "userId" = :user_id
                LIMIT 1
                """
            ),
            {"user_id": user_id},
        ).mappings().first()
    return dict(row) if row else None


def upsert_profile(
    user_id: str,
    height: str,
    chest: str,
    waist: str,
    hips: str,
    fit_style: Optional[str],
    consent_given: bool,
    category: Optional[str] = None,
    product_url: Optional[str] = None,
    selfie_url: Optional[str] = None,
) -> dict:
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO "Profile" (
                    id,
                    "userId",
                    height,
                    chest,
                    waist,
                    hips,
                    "fitStyle",
                    category,
                    "productUrl",
                    "selfieUrl",
                    "consentGiven",
                    "createdAt",
                    "updatedAt"
                )
                VALUES (
                    :id,
                    :user_id,
                    :height,
                    :chest,
                    :waist,
                    :hips,
                    :fit_style,
                    :category,
                    :product_url,
                    :selfie_url,
                    :consent_given,
                    NOW(),
                    NOW()
                )
                ON CONFLICT ("userId")
                DO UPDATE SET
                    height = EXCLUDED.height,
                    chest = EXCLUDED.chest,
                    waist = EXCLUDED.waist,
                    hips = EXCLUDED.hips,
                    "fitStyle" = EXCLUDED."fitStyle",
                    category = EXCLUDED.category,
                    "productUrl" = EXCLUDED."productUrl",
                    "selfieUrl" = EXCLUDED."selfieUrl",
                    "consentGiven" = EXCLUDED."consentGiven",
                    "updatedAt" = NOW()
                """
            ),
            {
                "id": uuid4().hex,
                "user_id": user_id,
                "height": height,
                "chest": chest,
                "waist": waist,
                "hips": hips,
                "fit_style": fit_style,
                "category": category,
                "product_url": product_url,
                "selfie_url": selfie_url,
                "consent_given": consent_given,
            },
        )

    saved = get_profile_by_user_id(user_id)
    if not saved:
        raise RuntimeError("Failed to upsert profile")
    return saved


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


def get_user_by_email(email: str) -> Optional[dict]:
    engine = get_engine()
    with engine.connect() as conn:
        row = conn.execute(
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
    return dict(row) if row else None


def get_or_create_user_by_email(email: str, initial_tokens: int) -> dict:
    existing = get_user_by_email(email)
    if existing:
        return existing

    engine = get_engine()
    user_id = uuid4().hex

    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO "User" (id, email, tokens, "createdAt", "updatedAt")
                    VALUES (:id, :email, :tokens, NOW(), NOW())
                    """
                ),
                {"id": user_id, "email": email, "tokens": initial_tokens},
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
    except IntegrityError:
        race_user = get_user_by_email(email)
        if race_user:
            return race_user
        raise


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


def credit_tokens_for_payment(event_id: str, user_id: str, amount_tokens: int) -> bool:
    engine = get_engine()
    with engine.begin() as conn:
        inserted = conn.execute(
            text(
                """
                INSERT INTO fastapi_payment_events (event_id, user_id, amount_tokens)
                VALUES (:event_id, :user_id, :amount_tokens)
                ON CONFLICT (event_id) DO NOTHING
                RETURNING event_id
                """
            ),
            {
                "event_id": event_id,
                "user_id": user_id,
                "amount_tokens": amount_tokens,
            },
        ).mappings().first()

        if not inserted:
            return False

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
            {"amount": amount_tokens, "user_id": user_id},
        ).mappings().first()

        if not row:
            raise ValueError("User not found")

    return True
