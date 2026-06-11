"""Track LinkedIn connection acceptance per lead.

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-11

"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE leads
          ADD COLUMN connection_accepted_at TIMESTAMP,
          ADD COLUMN provider_member_id VARCHAR(255)
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE leads
          DROP COLUMN IF EXISTS connection_accepted_at,
          DROP COLUMN IF EXISTS provider_member_id
        """
    )
