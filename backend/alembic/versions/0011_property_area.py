"""properties.area — browse Naivasha by area on the home page

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("properties", sa.Column("area", sa.String(30), nullable=True))
    op.create_index("ix_properties_area", "properties", ["area"])


def downgrade() -> None:
    op.drop_index("ix_properties_area", table_name="properties")
    op.drop_column("properties", "area")
