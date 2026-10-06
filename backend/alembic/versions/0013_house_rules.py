"""House rules & policies chosen by the owner

Damage deposit becomes the owner's choice. Existing listings keep the deposit
they had (the old price-based tiers) so nothing changes for guests until the
owner edits it.

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-06
"""
from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

COLUMNS = [
    sa.Column("deposit_amount", sa.BigInteger(), nullable=False, server_default="0"),
    sa.Column("max_guests", sa.SmallInteger()),
    sa.Column("check_in_from", sa.String(5), nullable=False, server_default="14:00"),
    sa.Column("check_in_until", sa.String(5)),
    sa.Column("check_out_until", sa.String(5), nullable=False, server_default="10:00"),
    sa.Column("children_allowed", sa.Boolean(), nullable=False, server_default=sa.true()),
    sa.Column("pets_allowed", sa.Boolean(), nullable=False, server_default=sa.false()),
    sa.Column("smoking_allowed", sa.Boolean(), nullable=False, server_default=sa.false()),
    sa.Column("parties_allowed", sa.Boolean(), nullable=False, server_default=sa.false()),
    sa.Column("quiet_hours", sa.String(11)),
    sa.Column("house_rules", sa.Text()),
]


def upgrade() -> None:
    for col in COLUMNS:
        op.add_column("properties", col)
    # Keep each existing listing's deposit as it was under the old tiers.
    op.execute("""
        UPDATE properties SET deposit_amount = CASE
            WHEN price_per_night < 5000 THEN 2000
            WHEN price_per_night < 20000 THEN 5000
            ELSE 15000 END
    """)


def downgrade() -> None:
    for col in reversed(COLUMNS):
        op.drop_column("properties", col.name)
