"""Card payments (Paystack): payment method, card surcharge, refund link

Revision ID: 0015
Revises: 0014
"""
import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("payments", sa.Column("method", sa.String(10), nullable=False, server_default="mpesa"))
    op.add_column("payments", sa.Column("fee_amount", sa.BigInteger(), nullable=False, server_default="0"))
    op.add_column("payments", sa.Column("refund_of", sa.UUID(as_uuid=False), sa.ForeignKey("payments.id"), nullable=True))


def downgrade() -> None:
    op.drop_column("payments", "refund_of")
    op.drop_column("payments", "fee_amount")
    op.drop_column("payments", "method")
