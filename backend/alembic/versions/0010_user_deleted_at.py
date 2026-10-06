"""users.deleted_at for self-service account deletion (App Store / Play requirement)

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "deleted_at")
