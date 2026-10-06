"""Disputes channel, held deposits, owner commission, owner cancellation

- users.commission_pct (10 default; 7 for founding partners)
- bookings: price snapshot (room/levy/commission), policy snapshot,
  deposit_status, checked_in_at, cancelled_at/by
- payment_type += deposit_refund, claim_payout
- disputes, dispute_messages, owner_adjustments
- damage_claims rows copied into disputes (table kept until a later release)

Existing bookings are grandfathered at 0% commission and deposit 'none'
(their deposit was never charged). Their owner payout becomes the room price;
the 2% levy, previously passed through to the owner, is now kept for TRA.
Migrated damage claims have no held deposit to award from.

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)


def upgrade() -> None:
    op.execute("ALTER TYPE payment_type ADD VALUE IF NOT EXISTS 'deposit_refund'")
    op.execute("ALTER TYPE payment_type ADD VALUE IF NOT EXISTS 'claim_payout'")

    op.add_column("users", sa.Column("commission_pct", sa.SmallInteger(), nullable=False, server_default="10"))

    deposit_status = postgresql.ENUM("none", "held", "refunded", "claimed", name="deposit_status")
    cancelled_by = postgresql.ENUM("guest", "owner", "admin", "system", name="cancelled_by")
    deposit_status.create(op.get_bind(), checkfirst=True)
    cancelled_by.create(op.get_bind(), checkfirst=True)

    op.add_column("bookings", sa.Column("room_amount", sa.BigInteger(), nullable=False, server_default="0"))
    op.add_column("bookings", sa.Column("levy_amount", sa.BigInteger(), nullable=False, server_default="0"))
    op.add_column("bookings", sa.Column("commission_kes", sa.BigInteger(), nullable=False, server_default="0"))
    op.add_column("bookings", sa.Column("cancellation_policy", sa.String(30), nullable=False, server_default="moderate"))
    op.add_column("bookings", sa.Column(
        "deposit_status", postgresql.ENUM(name="deposit_status", create_type=False),
        nullable=False, server_default="none"))
    op.add_column("bookings", sa.Column("checked_in_at", sa.DateTime(timezone=True)))
    op.add_column("bookings", sa.Column("cancelled_at", sa.DateTime(timezone=True)))
    op.add_column("bookings", sa.Column(
        "cancelled_by", postgresql.ENUM(name="cancelled_by", create_type=False)))

    # Backfill the price snapshot so refunds/payouts of existing bookings are computable.
    op.execute("""
        UPDATE bookings b
           SET room_amount = p.price_per_night * (b.check_out - b.check_in),
               levy_amount = floor(p.price_per_night * (b.check_out - b.check_in) * 0.02),
               cancellation_policy = p.cancellation_policy
          FROM properties p
         WHERE p.id = b.property_id
    """)

    op.create_table(
        "disputes",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("booking_id", UUID, sa.ForeignKey("bookings.id"), nullable=False),
        sa.Column("opened_by", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("opener_role", sa.Enum("guest", "owner", name="dispute_party"), nullable=False),
        sa.Column("reason", sa.String(30), nullable=False),
        sa.Column("claimed_amount", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("status", sa.Enum("open", "resolved", "withdrawn", name="dispute_status"),
                  nullable=False, server_default="open"),
        sa.Column("guest_refund_kes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("owner_award_kes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("ruling", sa.Text()),
        sa.Column("resolved_by", UUID, sa.ForeignKey("users.id")),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_disputes_booking_id", "disputes", ["booking_id"])
    op.create_index("ix_disputes_status", "disputes", ["status"])
    # At most one OPEN dispute per booking per side — keeps the money rules simple.
    op.create_index("uq_disputes_open_per_side", "disputes", ["booking_id", "opener_role"],
                    unique=True, postgresql_where=sa.text("status = 'open'"))

    op.create_table(
        "dispute_messages",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("dispute_id", UUID, sa.ForeignKey("disputes.id"), nullable=False),
        sa.Column("author_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("author_role", sa.Enum("guest", "owner", "admin", name="message_author"), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("attachments", sa.JSON()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_dispute_messages_dispute_id", "dispute_messages", ["dispute_id"])

    op.create_table(
        "owner_adjustments",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("owner_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("booking_id", UUID, sa.ForeignKey("bookings.id")),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("reason", sa.String(50), nullable=False),
        sa.Column("applied_payment_id", UUID, sa.ForeignKey("payments.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_owner_adjustments_owner_id", "owner_adjustments", ["owner_id"])

    # Carry old damage claims into the new channel.
    op.execute("""
        INSERT INTO disputes (id, booking_id, opened_by, opener_role, reason, claimed_amount,
                              status, owner_award_kes, ruling, created_at)
        SELECT c.id, c.booking_id, p.owner_id, 'owner', 'damage', c.claimed_amount,
               CASE WHEN c.status = 'pending' THEN 'open' ELSE 'resolved' END::dispute_status,
               CASE WHEN c.status = 'approved' THEN c.claimed_amount ELSE 0 END,
               c.ruling, c.created_at
          FROM damage_claims c
          JOIN bookings b ON b.id = c.booking_id
          JOIN properties p ON p.id = b.property_id
    """)


def downgrade() -> None:
    op.drop_table("owner_adjustments")
    op.drop_table("dispute_messages")
    op.drop_table("disputes")
    for name in ("message_author", "dispute_status", "dispute_party"):
        op.execute(f"DROP TYPE IF EXISTS {name}")
    for col in ("cancelled_by", "cancelled_at", "checked_in_at", "deposit_status", "cancellation_policy",
                "commission_kes", "levy_amount", "room_amount"):
        op.drop_column("bookings", col)
    op.execute("DROP TYPE IF EXISTS cancelled_by")
    op.execute("DROP TYPE IF EXISTS deposit_status")
    op.drop_column("users", "commission_pct")
    # payment_type keeps 'deposit_refund' / 'claim_payout' (Postgres cannot drop enum values).
