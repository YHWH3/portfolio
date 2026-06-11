"""Add delivery provider fields to sending_accounts.

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-10

"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE sending_accounts
          ADD COLUMN provider VARCHAR(50) DEFAULT 'manual',
          ADD COLUMN provider_account_id VARCHAR(255)
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE sending_accounts
          DROP COLUMN IF EXISTS provider,
          DROP COLUMN IF EXISTS provider_account_id
        """
    )
