"""Add index on fastapi_payment_events.user_id.

Queries that look up payment events by user_id would otherwise full-scan.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "002_payment_events_user_id_index"
down_revision = "001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_fastapi_payment_events_user_id "
        "ON fastapi_payment_events (user_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_fastapi_payment_events_user_id")
