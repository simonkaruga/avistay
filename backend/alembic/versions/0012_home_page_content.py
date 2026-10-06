"""Home page content: offers, destinations, featured properties

Destinations are seeded with Naivasha's main draws so "Trending destinations"
works on day one — edit or replace them in the admin panel. No offers are
seeded: only real promotions should ever appear.

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-05
"""
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)

SEED_DESTINATIONS = [
    ("Hell's Gate National Park", "Cycle among zebra and giraffe, then hike the gorge", "hells-gate"),
    ("Crescent Island", "Walk with giraffe, wildebeest and waterbuck on the lake", "south-lake"),
    ("Mount Longonot", "Sunrise hike to the crater rim (2,776 m)", "longonot"),
    ("Lake Naivasha boat rides", "Hippos, fish eagles and golden-hour cruises", "south-lake"),
    ("Lake Oloiden", "Quiet flamingo-and-pelican lake next door", "south-lake"),
]


def upgrade() -> None:
    op.add_column("properties", sa.Column("featured_rank", sa.SmallInteger()))
    op.add_column("properties", sa.Column("featured_tagline", sa.String(80)))

    op.create_table(
        "offers",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("title", sa.String(80), nullable=False),
        sa.Column("subtitle", sa.String(120)),
        sa.Column("body", sa.String(300)),
        sa.Column("image_url", sa.String(500)),
        sa.Column("cta_label", sa.String(30), nullable=False, server_default="See stays"),
        sa.Column("link", sa.String(300), nullable=False, server_default="/search"),
        sa.Column("promo_code", sa.String(30)),
        sa.Column("starts_at", sa.DateTime(timezone=True)),
        sa.Column("ends_at", sa.DateTime(timezone=True)),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sort_order", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    destinations = op.create_table(
        "destinations",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("tagline", sa.String(120)),
        sa.Column("image_url", sa.String(500)),
        sa.Column("area", sa.String(30)),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sort_order", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.bulk_insert(destinations, [
        {"id": str(uuid.uuid4()), "name": n, "tagline": t, "area": a, "active": True, "sort_order": i}
        for i, (n, t, a) in enumerate(SEED_DESTINATIONS)
    ])


def downgrade() -> None:
    op.drop_table("destinations")
    op.drop_table("offers")
    op.drop_column("properties", "featured_tagline")
    op.drop_column("properties", "featured_rank")
