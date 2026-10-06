"""Payment integrity: unique availability per night, provider request IDs

- payments.provider_request_id (CheckoutRequestID / ConversationID), unique —
  callbacks are matched on this instead of a guessable booking-id prefix.
- availability(property_id, date) unique index already exists from 0001 but
  was missing from the model; re-assert it for databases built via create_all.

Data repair (must run before the constraint can be created):
  * create_booking used to write availability rows with booking_id = NULL
    (the booking id did not exist before flush), so cancelling never freed
    the dates. Relink those rows to their live booking, delete the rest.
  * on databases without the index, the M-Pesa callback inserted a second
    copy of every booked night — dedupe. (With the index, that second insert
    failed instead, so paid bookings never confirmed.)

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # B2C rows move pending -> processing before the request is sent, so a
    # retried task can tell "never sent" from "maybe sent".
    op.execute("ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'processing'")
    op.add_column("payments", sa.Column("provider_request_id", sa.String(100), nullable=True))
    op.create_unique_constraint("uq_payments_provider_request_id", "payments", ["provider_request_id"])

    # 1. Relink orphaned booking rows to the live booking covering that night.
    op.execute("""
        UPDATE availability a
           SET booking_id = b.id
          FROM bookings b
         WHERE a.source = 'booking'
           AND a.booking_id IS NULL
           AND b.property_id = a.property_id
           AND a.date >= b.check_in AND a.date < b.check_out
           AND b.status IN ('pending', 'confirmed', 'checked_in', 'completed')
    """)
    # 2. Orphans left over belong to cancelled bookings — free those nights.
    op.execute("DELETE FROM availability WHERE source = 'booking' AND booking_id IS NULL")
    op.execute("""
        DELETE FROM availability a
         USING bookings b
         WHERE a.booking_id = b.id AND b.status = 'cancelled'
    """)
    # 3. Keep one row per property-night, preferring blocked rows tied to a booking.
    op.execute("""
        DELETE FROM availability
         WHERE id IN (
            SELECT id FROM (
                SELECT id, row_number() OVER (
                    PARTITION BY property_id, date
                    ORDER BY is_blocked DESC, (booking_id IS NOT NULL) DESC, id
                ) AS rn
                FROM availability
            ) ranked
            WHERE rn > 1
         )
    """)
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_availability_property_date ON availability (property_id, date)"
    )


def downgrade() -> None:
    # 'processing' stays in the payment_status enum (Postgres cannot drop enum values).
    op.drop_constraint("uq_payments_provider_request_id", "payments", type_="unique")
    op.drop_column("payments", "provider_request_id")
