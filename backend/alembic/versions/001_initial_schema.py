"""Initial schema for AIgrafka backend.

Creates the User table, auth credentials, profile, and payment events tables.
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS "User" (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            tokens INTEGER NOT NULL DEFAULT 0,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS auth_user_credentials (
            user_id TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
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
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS fastapi_payment_events (
            event_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            amount_tokens INTEGER NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS fastapi_payment_events')
    op.execute('DROP TABLE IF EXISTS "Profile"')
    op.execute('DROP TABLE IF EXISTS auth_user_credentials')
    op.execute('DROP TABLE IF EXISTS "User"')
