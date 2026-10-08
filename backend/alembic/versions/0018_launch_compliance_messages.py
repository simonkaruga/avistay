"""Launch essentials: host KRA PIN, TRA licence per listing, withholding tax on
payouts, and guest-host messages per booking

Revision ID: 0018
Revises: 0017
"""
import sqlalchemy as sa
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("kra_pin", sa.String(11), nullable=True))
    op.add_column("properties", sa.Column("tra_licence_no", sa.String(40), nullable=True))
    op.add_column("payments", sa.Column("tax_withheld", sa.BigInteger(), nullable=False, server_default="0"))
    op.create_table(
        "messages",
        sa.Column("id", sa.UUID(as_uuid=False), primary_key=True),
        sa.Column("booking_id", sa.UUID(as_uuid=False), sa.ForeignKey("bookings.id"), nullable=False),
        sa.Column("sender_id", sa.UUID(as_uuid=False), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_messages_booking_created", "messages", ["booking_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_messages_booking_created", table_name="messages")
    op.drop_table("messages")
    op.drop_column("payments", "tax_withheld")
    op.drop_column("properties", "tra_licence_no")
    op.drop_column("users", "kra_pin")
