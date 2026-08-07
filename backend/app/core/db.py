from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.core.config import get_settings

_engine: AsyncEngine | None = None


def _to_async_url(url: str) -> str:
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    return url


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        settings = get_settings()
        db_url = _to_async_url(settings.database_url)
        is_local = any(h in db_url for h in ("localhost", "127.0.0.1", "::1"))
        if not is_local and "sslmode=" not in db_url:
            separator = "&" if "?" in db_url else "?"
            db_url = f"{db_url}{separator}sslmode=require"
        _engine = create_async_engine(
            db_url,
            pool_pre_ping=True,
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_recycle=settings.db_pool_recycle,
            pool_timeout=settings.db_pool_timeout,
            future=True,
        )
    return _engine


async def close_engine() -> None:
    global _engine
    if _engine is not None:
        await _engine.dispose()
        _engine = None


async def get_profile_by_user_id(user_id: str) -> dict | None:
    engine = get_engine()
    async with engine.connect() as conn:
        row = (await conn.execute(
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
        )).mappings().first()
    return dict(row) if row else None


async def upsert_profile(
    user_id: str,
    height: str,
    chest: str,
    waist: str,
    hips: str,
    fit_style: str | None,
    consent_given: bool,
    category: str | None = None,
    product_url: str | None = None,
    selfie_url: str | None = None,
) -> dict:
    engine = get_engine()
    async with engine.begin() as conn:
        saved = (await conn.execute(
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
                RETURNING
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
        )).mappings().first()

    if not saved:
        raise RuntimeError("Failed to upsert profile")
    return dict(saved)


async def get_user_with_credentials_by_email(email: str) -> dict | None:
    engine = get_engine()
    async with engine.connect() as conn:
        row = (await conn.execute(
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
        )).mappings().first()
    return dict(row) if row else None


async def get_user_by_id(user_id: str) -> dict | None:
    engine = get_engine()
    async with engine.connect() as conn:
        row = (await conn.execute(
            text(
                """
                SELECT id, email, tokens
                FROM "User"
                WHERE id = :user_id
                LIMIT 1
                """
            ),
            {"user_id": user_id},
        )).mappings().first()
    return dict(row) if row else None


async def get_user_by_email(email: str) -> dict | None:
    engine = get_engine()
    async with engine.connect() as conn:
        row = (await conn.execute(
            text(
                """
                SELECT id, email, tokens
                FROM "User"
                WHERE LOWER(email) = LOWER(:email)
                LIMIT 1
                """
            ),
            {"email": email},
        )).mappings().first()
    return dict(row) if row else None


async def get_or_create_user_by_email(email: str, initial_tokens: int) -> dict:
    # Single atomic statement: DO UPDATE guarantees RETURNING yields the row on
    # both insert and conflict, eliminating the read-before-write race.
    engine = get_engine()
    async with engine.begin() as conn:
        user = (await conn.execute(
            text(
                """
                INSERT INTO "User" (id, email, tokens, "createdAt", "updatedAt")
                VALUES (:id, :email, :tokens, NOW(), NOW())
                ON CONFLICT (email) DO UPDATE SET "updatedAt" = NOW()
                RETURNING id, email, tokens
                """
            ),
            {"id": uuid4().hex, "email": email, "tokens": initial_tokens},
        )).mappings().first()

    if not user:
        raise RuntimeError("Failed to create user")
    return dict(user)


async def create_user_with_credentials(email: str, password_hash: str, initial_tokens: int) -> dict:
    engine = get_engine()

    try:
        async with engine.begin() as conn:
            user = (await conn.execute(
                text(
                    """
                    INSERT INTO "User" (id, email, tokens, "createdAt", "updatedAt")
                    VALUES (:id, :email, :tokens, NOW(), NOW())
                    ON CONFLICT (email) DO UPDATE SET "updatedAt" = NOW()
                    RETURNING id, email, tokens
                    """
                ),
                {"id": uuid4().hex, "email": email, "tokens": initial_tokens},
            )).mappings().first()

            # Fails with IntegrityError if credentials already exist for this
            # user/email (i.e. the account is already registered).
            await conn.execute(
                text(
                    """
                    INSERT INTO auth_user_credentials (user_id, email, password_hash)
                    VALUES (:user_id, :email, :password_hash)
                    """
                ),
                {"user_id": user["id"], "email": email, "password_hash": password_hash},
            )

        if not user:
            raise RuntimeError("Failed to create user")

        return dict(user)
    except IntegrityError as exc:
        raise ValueError("User already exists") from exc


async def add_tokens(user_id: str, amount: int) -> int:
    engine = get_engine()
    async with engine.begin() as conn:
        row = (await conn.execute(
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
        )).mappings().first()
    if not row:
        raise ValueError("User not found")
    return int(row["tokens"])


async def deduct_tokens_if_possible(user_id: str, amount: int) -> int | None:
    engine = get_engine()
    async with engine.begin() as conn:
        row = (await conn.execute(
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
        )).mappings().first()

    if not row:
        return None
    return int(row["tokens"])


async def credit_tokens_for_payment(event_id: str, user_id: str, amount_tokens: int) -> bool:
    engine = get_engine()
    async with engine.begin() as conn:
        inserted = (await conn.execute(
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
        )).mappings().first()

        if not inserted:
            return False

        row = (await conn.execute(
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
        )).mappings().first()

        if not row:
            raise ValueError("User not found")

    return True
