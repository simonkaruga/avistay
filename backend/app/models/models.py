import uuid
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import (
    JSON, BigInteger, Boolean, Date, DateTime, Enum, ForeignKey,
    Index, Integer, SmallInteger, String, Text,
)
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_uuid() -> str:
    return str(uuid.uuid4())



REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # no 0/O/1/I: codes get read out loud


def new_ref_code() -> str:
    import secrets
    return "AV" + "".join(secrets.choice(REF_ALPHABET) for _ in range(6))

class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    name: Mapped[Optional[str]] = mapped_column(String(120))
    phone: Mapped[Optional[str]] = mapped_column(String(20), unique=True, nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), unique=True, nullable=True)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255))
    google_id: Mapped[Optional[str]] = mapped_column(String(100), unique=True, nullable=True)
    role: Mapped[str] = mapped_column(Enum("guest", "owner", "admin", "banned", name="user_role"), default="guest")
    national_id_url: Mapped[Optional[str]] = mapped_column(String(500))
    passport_number: Mapped[Optional[str]] = mapped_column(String(50))
    fcm_token: Mapped[Optional[str]] = mapped_column(String(500))
    sms_opt_in: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    # Owner commission on the room price. 10% standard, 7% founding partners (set by admin).
    commission_pct: Mapped[int] = mapped_column(SmallInteger, default=10, server_default="10")
    # Super admins (role "admin" + this flag) can also change platform settings,
    # staff roles and money records. Grant with: python -m app.cli make-superadmin
    is_superadmin: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Set when the user deletes their account; personal data is wiped, booking
    # records stay (anonymised) for the 7-year tax retention requirement.
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    # "Sign out everywhere": any login token issued before this is refused
    # (password reset, ban, account deletion). Works with or without Redis.
    sessions_revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    kra_pin: Mapped[Optional[str]] = mapped_column(String(11))   # hosts: for withholding tax on payouts
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    properties: Mapped[list["Property"]] = relationship(back_populates="owner")
    bookings: Mapped[list["Booking"]] = relationship(back_populates="guest")


class Property(Base):
    __tablename__ = "properties"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[str] = mapped_column(String(50))
    price_per_night: Mapped[int] = mapped_column(BigInteger, nullable=False)  # KES integer
    lat: Mapped[Optional[float]]
    lng: Mapped[Optional[float]]
    what3words: Mapped[Optional[str]] = mapped_column(String(100))
    landmark_instructions: Mapped[Optional[str]] = mapped_column(Text)
    description: Mapped[Optional[str]] = mapped_column(Text)
    verified_tier: Mapped[int] = mapped_column(SmallInteger, default=0)
    min_nights: Mapped[int] = mapped_column(SmallInteger, default=1)
    no_checkout_days: Mapped[Optional[str]] = mapped_column(String(20))  # e.g. "0,6" (Sun,Sat)
    response_time_hours: Mapped[Optional[int]] = mapped_column(SmallInteger)
    cancellation_policy: Mapped[str] = mapped_column(String(30), default="moderate")
    area: Mapped[Optional[str]] = mapped_column(String(30), index=True)   # one of NAIVASHA_AREAS
    # Tourism Regulatory Authority licence/registration number (required to go live).
    tra_licence_no: Mapped[Optional[str]] = mapped_column(String(40))
    # House rules & policies — the owner's choice (cancellation + min stay above too).
    deposit_amount: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")  # KES, 0 = no deposit
    max_guests: Mapped[Optional[int]] = mapped_column(SmallInteger)
    check_in_from: Mapped[str] = mapped_column(String(5), default="14:00", server_default="14:00")
    check_in_until: Mapped[Optional[str]] = mapped_column(String(5))
    check_out_until: Mapped[str] = mapped_column(String(5), default="10:00", server_default="10:00")
    children_allowed: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    pets_allowed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    smoking_allowed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    parties_allowed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    quiet_hours: Mapped[Optional[str]] = mapped_column(String(11))           # "22:00-07:00"
    house_rules: Mapped[Optional[str]] = mapped_column(Text)                 # anything else, in the owner's words
    # Home-page curation by the NaivaStay team ("Stay at our top unique properties").
    featured_rank: Mapped[Optional[int]] = mapped_column(SmallInteger)        # set = featured; lower shows first
    featured_tagline: Mapped[Optional[str]] = mapped_column(String(80))       # e.g. "Private jetty on the lake"
    ical_import_url: Mapped[Optional[str]] = mapped_column(String(500))
    active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    owner: Mapped["User"] = relationship(back_populates="properties")
    images: Mapped[list["PropertyImage"]] = relationship(back_populates="property")
    bookings: Mapped[list["Booking"]] = relationship(back_populates="property")


class PropertyImage(Base):
    __tablename__ = "property_images"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    property_id: Mapped[str] = mapped_column(ForeignKey("properties.id"), nullable=False)
    cloudinary_url: Mapped[str] = mapped_column(String(500), nullable=False)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    display_order: Mapped[int] = mapped_column(SmallInteger, default=0)

    property: Mapped["Property"] = relationship(back_populates="images")


class ExternalCalendar(Base):
    """One row per external platform the owner listed on (Airbnb, Booking.com, VRBO…)."""
    __tablename__ = "external_calendars"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    property_id: Mapped[str] = mapped_column(ForeignKey("properties.id"), nullable=False)
    platform: Mapped[str] = mapped_column(String(50), nullable=False)   # "airbnb" | "booking" | "vrbo" | "other"
    ical_url: Mapped[str] = mapped_column(String(1000), nullable=False)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    property: Mapped["Property"] = relationship()


class Availability(Base):
    __tablename__ = "availability"
    # One row per property-night. This constraint is what actually prevents
    # double bookings — two concurrent bookings for overlapping dates cannot
    # both insert their rows.
    # (Created by migration 0001; declared here so tests run with it too.)
    __table_args__ = (Index("ix_availability_property_date", "property_id", "date", unique=True),)

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    property_id: Mapped[str] = mapped_column(ForeignKey("properties.id"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=True)
    source: Mapped[str] = mapped_column(Enum("manual", "ical", "booking", name="avail_source"), default="manual")
    booking_id: Mapped[Optional[str]] = mapped_column(ForeignKey("bookings.id"))


class Booking(Base):
    __tablename__ = "bookings"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    guest_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    property_id: Mapped[str] = mapped_column(ForeignKey("properties.id"), nullable=False)
    check_in: Mapped[date] = mapped_column(Date, nullable=False)
    check_out: Mapped[date] = mapped_column(Date, nullable=False)
    # Price snapshot at booking time — all KES integers.
    # total_amount = room_amount + levy_amount + platform_fee + deposit_amount - discount
    total_amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    platform_fee: Mapped[int] = mapped_column(BigInteger, nullable=False)
    deposit_amount: Mapped[int] = mapped_column(BigInteger, default=0)   # refundable damage deposit
    room_amount: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")   # nights x price
    levy_amount: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")   # 2% tourism levy (TRA)
    commission_kes: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")  # owner's commission, locked at booking
    cancellation_policy: Mapped[str] = mapped_column(String(30), default="moderate", server_default="moderate")
    deposit_status: Mapped[str] = mapped_column(
        Enum("none", "held", "refunded", "claimed", name="deposit_status"), default="none", server_default="none"
    )
    promo_code_id: Mapped[Optional[str]] = mapped_column(ForeignKey("promo_codes.id"))
    agent_id: Mapped[Optional[str]] = mapped_column(ForeignKey("agents.id"))   # who referred this guest
    status: Mapped[str] = mapped_column(
        Enum("pending", "confirmed", "checked_in", "completed", "cancelled", name="booking_status"),
        default="pending",
    )
    guests: Mapped[int] = mapped_column(SmallInteger, default=1)
    group_name: Mapped[Optional[str]] = mapped_column(String(150))
    is_corporate: Mapped[bool] = mapped_column(Boolean, default=False)
    company_name: Mapped[Optional[str]] = mapped_column(String(200))
    kra_pin: Mapped[Optional[str]] = mapped_column(String(20))
    checkin_code: Mapped[Optional[str]] = mapped_column(String(4))
    mpesa_ref: Mapped[Optional[str]] = mapped_column(String(50))
    terms_accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    checked_in_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    cancelled_by: Mapped[Optional[str]] = mapped_column(
        Enum("guest", "owner", "admin", "system", name="cancelled_by")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    guest: Mapped["User"] = relationship(back_populates="bookings")
    property: Mapped["Property"] = relationship(back_populates="bookings")
    review: Mapped[Optional["Review"]] = relationship(back_populates="booking", uselist=False)


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    booking_id: Mapped[str] = mapped_column(ForeignKey("bookings.id"), nullable=False)
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)
    type: Mapped[str] = mapped_column(Enum("charge", "refund", "payout", "deposit_refund", "claim_payout", "agent_commission", name="payment_type"))
    mpesa_ref: Mapped[Optional[str]] = mapped_column(String(50))  # M-Pesa receipt / TransactionID
    # CheckoutRequestID (STK charge) or ConversationID (B2C payout/refund) —
    # the key Safaricom echoes back in callbacks.
    provider_request_id: Mapped[Optional[str]] = mapped_column(String(100), unique=True)
    status: Mapped[str] = mapped_column(Enum("pending", "processing", "completed", "failed", name="payment_status"), default="pending")
    # "mpesa" or "card" (Paystack). For refunds: where the money goes back to.
    method: Mapped[str] = mapped_column(String(10), default="mpesa", server_default="mpesa")
    # Card surcharge the guest paid on top of `amount` (charges only). Not part
    # of the booking money, so normal refunds don't include it.
    fee_amount: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    # Host payouts: withholding tax deducted and remitted to KRA by NaivaStay.
    tax_withheld: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    # Refunds of one specific charge (e.g. a duplicate/late payment).
    refund_of: Mapped[Optional[str]] = mapped_column(ForeignKey("payments.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    booking_id: Mapped[str] = mapped_column(ForeignKey("bookings.id"), nullable=False, unique=True)
    accuracy_score: Mapped[int] = mapped_column(SmallInteger)
    cleanliness_score: Mapped[int] = mapped_column(SmallInteger)
    location_score: Mapped[int] = mapped_column(SmallInteger)
    value_score: Mapped[int] = mapped_column(SmallInteger)
    comment: Mapped[Optional[str]] = mapped_column(Text)
    owner_response: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    booking: Mapped["Booking"] = relationship(back_populates="review")


class PromoCode(Base):
    __tablename__ = "promo_codes"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    discount_kes: Mapped[int] = mapped_column(Integer, nullable=False)
    max_uses: Mapped[int] = mapped_column(Integer, default=1)
    used_count: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(100), nullable=False)
    actor_id: Mapped[Optional[str]] = mapped_column(String(100))
    metadata_json: Mapped[Optional[dict]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class OwnerApplication(Base):
    __tablename__ = "owner_applications"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id"), nullable=True)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(255))
    national_id: Mapped[str] = mapped_column(String(50), nullable=False)
    property_type: Mapped[str] = mapped_column(String(50), nullable=False)
    property_location: Mapped[str] = mapped_column(String(200), nullable=False)
    property_description: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        Enum("pending", "approved", "rejected", name="application_status"), default="pending"
    )
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text)
    reviewed_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Agent(Base):
    """Travel agents / brokers who refer bookings and earn M-Pesa commission."""
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, unique=True)
    agency_name: Mapped[Optional[str]] = mapped_column(String(200))
    # Personal code on the agent's share links: naivastay.com/property/…?ref=AV7K2Q9X
    ref_code: Mapped[str] = mapped_column(String(12), unique=True, nullable=False, default=lambda: new_ref_code())
    commission_pct: Mapped[int] = mapped_column(SmallInteger, default=5)  # percentage
    status: Mapped[str] = mapped_column(
        Enum("pending", "active", "suspended", name="agent_status"), default="pending"
    )
    total_earned: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped["User"] = relationship()
    referrals: Mapped[list["AgentReferral"]] = relationship(back_populates="agent")


class AgentReferral(Base):
    """Tracks each booking that came through an agent."""
    __tablename__ = "agent_referrals"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"), nullable=False)
    booking_id: Mapped[str] = mapped_column(ForeignKey("bookings.id"), nullable=False, unique=True)
    commission_kes: Mapped[int] = mapped_column(BigInteger, default=0)
    status: Mapped[str] = mapped_column(
        Enum("pending", "paid", "cancelled", name="referral_status"), default="pending"
    )
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    agent: Mapped["Agent"] = relationship(back_populates="referrals")


class DamageClaim(Base):
    __tablename__ = "damage_claims"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    booking_id: Mapped[str] = mapped_column(ForeignKey("bookings.id"), nullable=False)
    before_photos: Mapped[Optional[list]] = mapped_column(JSON)
    after_photos: Mapped[Optional[list]] = mapped_column(JSON)
    claimed_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    status: Mapped[str] = mapped_column(
        Enum("pending", "approved", "rejected", name="claim_status"), default="pending"
    )
    ruling: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ── Areas of Naivasha ─────────────────────────────────────────────────────────
# Guests choose stays by area. Owners pick one when listing. Keep slugs stable
# (they're in URLs); labels can change.
NAIVASHA_AREAS: dict[str, str] = {
    "south-lake": "South Lake Road",
    "north-lake": "North Lake & Kongoni",
    "hells-gate": "Hell's Gate & Olkaria",
    "town": "Naivasha Town",
    "longonot": "Longonot & Mai Mahiu",
}


# ── Home page content (managed by admins in the admin panel) ─────────────────

class Offer(Base):
    """A real promotion shown on the home page while it runs."""
    __tablename__ = "offers"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    title: Mapped[str] = mapped_column(String(80), nullable=False)
    subtitle: Mapped[Optional[str]] = mapped_column(String(120))
    body: Mapped[Optional[str]] = mapped_column(String(300))
    image_url: Mapped[Optional[str]] = mapped_column(String(500))
    cta_label: Mapped[str] = mapped_column(String(30), default="See stays")
    link: Mapped[str] = mapped_column(String(300), default="/search")        # internal path only
    promo_code: Mapped[Optional[str]] = mapped_column(String(30))            # shown on the card if set
    starts_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(SmallInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Destination(Base):
    """A place guests come for (Hell's Gate, Crescent Island…), linked to the area to stay in."""
    __tablename__ = "destinations"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    tagline: Mapped[Optional[str]] = mapped_column(String(120))
    image_url: Mapped[Optional[str]] = mapped_column(String(500))
    area: Mapped[Optional[str]] = mapped_column(String(30))                 # NAIVASHA_AREAS slug
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(SmallInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ── Platform settings (edited by super admins; defaults in services/settings.py) ──

class PlatformSetting(Base):
    __tablename__ = "platform_settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, nullable=False)        # {"v": <value>}
    updated_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


# ── Disputes ──────────────────────────────────────────────────────────────────
# One channel for both sides: a guest reports a problem with the stay (freezes
# the owner payout), an owner reports damage (freezes the deposit refund).
# Admin rules; the ruling moves the money.

GUEST_DISPUTE_REASONS = ("no_access", "not_as_described", "safety", "cleanliness", "other")
OWNER_DISPUTE_REASONS = ("damage", "house_rules", "other")


class Dispute(Base):
    __tablename__ = "disputes"
    # At most one OPEN dispute per booking per side.
    __table_args__ = (
        Index("uq_disputes_open_per_side", "booking_id", "opener_role", unique=True,
              postgresql_where=text("status = 'open'"), sqlite_where=text("status = 'open'")),
    )

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    booking_id: Mapped[str] = mapped_column(ForeignKey("bookings.id"), nullable=False, index=True)
    opened_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    opener_role: Mapped[str] = mapped_column(Enum("guest", "owner", name="dispute_party"), nullable=False)
    reason: Mapped[str] = mapped_column(String(30), nullable=False)
    claimed_amount: Mapped[int] = mapped_column(BigInteger, default=0)   # KES the opener asks for
    status: Mapped[str] = mapped_column(
        Enum("open", "resolved", "withdrawn", name="dispute_status"), default="open", index=True
    )
    # Ruling — what the admin decided to move
    guest_refund_kes: Mapped[int] = mapped_column(BigInteger, default=0)
    owner_award_kes: Mapped[int] = mapped_column(BigInteger, default=0)
    ruling: Mapped[Optional[str]] = mapped_column(Text)
    resolved_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id"))
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    messages: Mapped[list["DisputeMessage"]] = relationship(
        back_populates="dispute", order_by="DisputeMessage.created_at"
    )


class Message(Base):
    """Guest ↔ host chat about one booking (the NaivaStay team can read it too)."""
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_booking_created", "booking_id", "created_at"),)

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    booking_id: Mapped[str] = mapped_column(ForeignKey("bookings.id"), nullable=False)
    sender_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DisputeMessage(Base):
    __tablename__ = "dispute_messages"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    dispute_id: Mapped[str] = mapped_column(ForeignKey("disputes.id"), nullable=False, index=True)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    author_role: Mapped[str] = mapped_column(Enum("guest", "owner", "admin", name="message_author"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    attachments: Mapped[Optional[list]] = mapped_column(JSON)   # Cloudinary URLs only
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    dispute: Mapped["Dispute"] = relationship(back_populates="messages")


class OwnerAdjustment(Base):
    """Ledger of amounts deducted from (negative) or added to an owner's future
    payouts — cancellation penalties, dispute refunds already paid out."""
    __tablename__ = "owner_adjustments"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    booking_id: Mapped[Optional[str]] = mapped_column(ForeignKey("bookings.id"))
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False)   # KES, negative = deduction
    reason: Mapped[str] = mapped_column(String(50), nullable=False)
    applied_payment_id: Mapped[Optional[str]] = mapped_column(ForeignKey("payments.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
