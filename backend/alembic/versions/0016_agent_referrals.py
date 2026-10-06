"""Agent programme: personal referral codes, bookings linked to agents, agent payouts

Revision ID: 0016
Revises: 0015
"""
import secrets

import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # no 0/O/1/I: codes get read out loud


def _code() -> str:
    return "AV" + "".join(secrets.choice(ALPHABET) for _ in range(6))


def upgrade() -> None:
    op.add_column("agents", sa.Column("ref_code", sa.String(12), nullable=True))
    conn = op.get_bind()
    for (agent_id,) in conn.execute(sa.text("SELECT id FROM agents")).fetchall():
        conn.execute(sa.text("UPDATE agents SET ref_code = :c WHERE id = :i"), {"c": _code(), "i": agent_id})
    op.alter_column("agents", "ref_code", nullable=False)
    op.create_unique_constraint("uq_agents_ref_code", "agents", ["ref_code"])

    op.add_column("bookings", sa.Column("agent_id", sa.UUID(as_uuid=False), sa.ForeignKey("agents.id"), nullable=True))

    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE payment_type ADD VALUE IF NOT EXISTS 'agent_commission'")


def downgrade() -> None:
    # Postgres can't drop an enum value; it stays harmlessly unused.
    op.drop_column("bookings", "agent_id")
    op.drop_constraint("uq_agents_ref_code", "agents", type_="unique")
    op.drop_column("agents", "ref_code")
