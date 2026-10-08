"""
Operator console (Admin → everything). Lets the team run NaivaStay without a
developer: people, listings, bookings, money, promotions, settings, audit.

Admins can operate; super admins can additionally change platform settings,
staff roles and money records. Every change is written to the audit log.
"""
import csv
import io
from datetime import date, datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit_log import log_event
from app.core.database import get_db
from app.core.deps import require_admin, require_superadmin
from app.core.security import revoke_sessions
from app.models.models import (
    Agent, AgentReferral, AuditLog, Booking, Dispute, Payment, PromoCode, Property, User,
)
from app.schemas.schemas import PropertyCreate, PropertyOut
from app.services import paystack
from app.services import settings as platform_settings
from app.services.agents import mark_commission_paid
from app.services.compliance import go_live_error, missing_for_live
from app.services.payments import amount_paid, card_fees_paid, dispatch_b2c, lock_booking, queue_b2c, release_booking_dates

router = APIRouter(tags=["console"])

PAGE = 50
LIVE_BOOKING = ("confirmed", "checked_in", "completed")


def _iso(v):
    return v.isoformat() if isinstance(v, (datetime, date)) else v


# ── Overview ──────────────────────────────────────────────────────────────────

@router.get("/overview")
async def overview(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """The numbers to check every morning."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=30)

    def count(stmt):
        return db.execute(stmt)

    live = Booking.status.in_(LIVE_BOOKING)
    agg = (await db.execute(select(
        func.count(Booking.id),
        func.coalesce(func.sum(Booking.room_amount), 0),
        func.coalesce(func.sum(Booking.platform_fee), 0),
        func.coalesce(func.sum(Booking.commission_kes), 0),
        func.coalesce(func.sum(Booking.levy_amount), 0),
    ).where(live, Booking.created_at >= since))).one()
    pay_counts = {k: v for k, v in (await db.execute(
        select(Payment.status, func.count()).where(Payment.type != "charge").group_by(Payment.status)
    )).all()}
    money_in = {"mpesa": {"count": 0, "amount": 0}, "card": {"count": 0, "amount": 0, "card_fees": 0}}
    for method, n, amount, fees in (await db.execute(
        select(Payment.method, func.count(), func.coalesce(func.sum(Payment.amount), 0),
               func.coalesce(func.sum(Payment.fee_amount), 0))
        .where(Payment.type == "charge", Payment.status == "completed", Payment.created_at >= since)
        .group_by(Payment.method)
    )).all():
        row = money_in.setdefault(method, {"count": 0, "amount": 0})
        row["count"], row["amount"] = n, int(amount)
        if method == "card":
            row["card_fees"] = int(fees)
    return {
        "guest_payments": {"paystack": paystack.mode(), "last_30_days": money_in},
        "last_30_days": {
            "bookings": agg[0], "room_value": int(agg[1]),
            "revenue": int(agg[2]) + int(agg[3]),            # service fees + commission
            "levy_collected": int(agg[4]),
        },
        "today": {
            "check_ins": (await count(select(func.count(Booking.id)).where(live, Booking.check_in == date.today()))).scalar(),
            "new_bookings": (await count(select(func.count(Booking.id)).where(Booking.created_at >= now - timedelta(days=1), live))).scalar(),
        },
        "needs_attention": {
            "listings_awaiting_approval": (await count(select(func.count(Property.id)).where(Property.active == False, Property.verified_tier == 0))).scalar(),
            "open_disputes": (await count(select(func.count(Dispute.id)).where(Dispute.status == "open"))).scalar(),
            "payments_processing": pay_counts.get("processing", 0),
            "payments_failed": pay_counts.get("failed", 0),
            "double_bookings": (await count(select(func.count(func.distinct(AuditLog.entity_id))).where(
                AuditLog.event_type == "double_booking_detected", AuditLog.created_at >= now - timedelta(days=7)))).scalar(),
        },
        "totals": {
            "users": (await count(select(func.count(User.id)).where(User.deleted_at.is_(None)))).scalar(),
            "hosts": (await count(select(func.count(User.id)).where(User.role == "owner"))).scalar(),
            "live_listings": (await count(select(func.count(Property.id)).where(Property.active == True))).scalar(),
        },
    }


# ── Users ─────────────────────────────────────────────────────────────────────

def _user_out(u: User) -> dict:
    return {"id": u.id, "name": u.name, "phone": u.phone, "email": u.email, "role": u.role,
            "is_superadmin": u.is_superadmin, "commission_pct": u.commission_pct,
            "verified_at": _iso(u.verified_at), "created_at": _iso(u.created_at), "deleted": u.deleted_at is not None}


@router.get("/users")
async def list_users(
    q: Optional[str] = None,
    role: Optional[str] = None,
    page: int = Query(1, ge=1),
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    stmt = select(User).where(User.deleted_at.is_(None))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(User.name.ilike(like), User.phone.ilike(like), User.email.ilike(like)))
    if role:
        stmt = stmt.where(User.role == role)
    rows = (await db.execute(stmt.order_by(User.created_at.desc()).offset((page - 1) * PAGE).limit(PAGE))).scalars().all()
    return [_user_out(u) for u in rows]


class UserPatch(BaseModel):
    name: Optional[str] = Field(None, max_length=120)
    role: Optional[Literal["guest", "owner", "admin", "banned"]] = None
    is_superadmin: Optional[bool] = None
    commission_pct: Optional[int] = Field(None, ge=0, le=30)
    verified: Optional[bool] = None
    reason: Optional[str] = Field(None, max_length=300)


@router.patch("/users/{user_id}")
async def update_user(user_id: str, body: UserPatch, admin: User = Depends(require_admin),
                      db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if not user or user.deleted_at:
        raise HTTPException(status_code=404, detail="User not found")
    changes = body.model_dump(exclude_unset=True, exclude={"reason"})

    staff_change = ("role" in changes and (changes["role"] == "admin" or user.role == "admin")) or "is_superadmin" in changes
    if staff_change and not admin.is_superadmin:
        raise HTTPException(status_code=403, detail="Only a super admin can change staff access")
    if user.id == admin.id and ("role" in changes or changes.get("is_superadmin") is False):
        raise HTTPException(status_code=409, detail="You can't change your own access. Ask another super admin")

    if "name" in changes:
        user.name = changes["name"] or None
    if "role" in changes:
        user.role = changes["role"]
        if user.role != "admin":
            user.is_superadmin = False
        if user.role == "banned":
            revoke_sessions(user)      # out on every device, straight away
    if "is_superadmin" in changes:
        if changes["is_superadmin"] and user.role != "admin":
            raise HTTPException(status_code=409, detail="Make them an admin first")
        user.is_superadmin = changes["is_superadmin"]
    if "commission_pct" in changes:
        user.commission_pct = changes["commission_pct"]
    if "verified" in changes:
        user.verified_at = datetime.now(timezone.utc) if changes["verified"] else None
    await log_event(db, "user_updated", user.id, admin.id, {**{k: _iso(v) for k, v in changes.items()}, "reason": body.reason})
    return _user_out(user)


# ── Listings ──────────────────────────────────────────────────────────────────

@router.get("/listings")
async def list_listings(
    q: Optional[str] = None,
    state: Optional[Literal["live", "pending", "paused"]] = None,
    page: int = Query(1, ge=1),
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    stmt = select(Property, User.name, User.phone).join(User, User.id == Property.owner_id).options(selectinload(Property.images))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Property.title.ilike(like), User.name.ilike(like), User.phone.ilike(like)))
    if state == "live":
        stmt = stmt.where(Property.active == True)
    elif state == "pending":
        stmt = stmt.where(Property.active == False, Property.verified_tier == 0)
    elif state == "paused":
        stmt = stmt.where(Property.active == False, Property.verified_tier > 0)
    rows = (await db.execute(stmt.order_by(Property.created_at.desc()).offset((page - 1) * PAGE).limit(PAGE))).all()
    owner_ids = {p.owner_id for p, _, _ in rows}
    owners = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(owner_ids)))).scalars()} if owner_ids else {}
    return [{
        "id": p.id, "title": p.title, "type": p.type, "area": p.area, "price_per_night": p.price_per_night,
        "active": p.active, "verified_tier": p.verified_tier, "photos": len(p.images),
        "cover": next((i.cloudinary_url for i in sorted(p.images, key=lambda i: i.display_order)), None),
        "owner_name": name, "owner_phone": phone, "created_at": _iso(p.created_at),
        "missing": missing_for_live(p, owners.get(p.owner_id)),
    } for p, name, phone in rows]


@router.get("/listings/{property_id}")
async def get_listing(property_id: str, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Everything about one listing, live or not, for the edit form."""
    prop = (await db.execute(select(Property).where(Property.id == property_id)
                             .options(selectinload(Property.images)))).scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Listing not found")
    return {**PropertyOut.model_validate(prop).model_dump(mode="json"),
            "active": prop.active, "verified_tier": prop.verified_tier}


@router.put("/listings/{property_id}")
async def edit_listing(property_id: str, body: PropertyCreate, admin: User = Depends(require_admin),
                       db: AsyncSession = Depends(get_db)):
    """Edit anything on any listing (fix a typo, a price, a rule) — logged."""
    prop = await db.get(Property, property_id)
    if not prop:
        raise HTTPException(status_code=404, detail="Listing not found")
    changes = body.model_dump(exclude_unset=True)
    before = {k: getattr(prop, k) for k in changes}
    for k, v in changes.items():
        setattr(prop, k, v)
    diff = {k: {"from": _iso(before[k]), "to": _iso(getattr(prop, k))} for k in changes if before[k] != getattr(prop, k)}
    await log_event(db, "listing_edited_by_admin", prop.id, admin.id, diff)
    return {"id": prop.id, "changed": sorted(diff)}


class ListingStatus(BaseModel):
    active: bool
    verified_tier: Optional[int] = Field(None, ge=0, le=3)
    reason: Optional[str] = Field(None, max_length=300)


@router.post("/listings/{property_id}/status")
async def set_listing_status(property_id: str, body: ListingStatus, admin: User = Depends(require_admin),
                             db: AsyncSession = Depends(get_db)):
    """Put a listing live or pause it."""
    prop = await db.get(Property, property_id)
    if not prop:
        raise HTTPException(status_code=404, detail="Listing not found")
    if body.active:
        problem = go_live_error(prop, await db.get(User, prop.owner_id))
        if problem:
            raise HTTPException(status_code=409, detail=problem)
    prop.active = body.active
    if body.verified_tier is not None:
        prop.verified_tier = body.verified_tier
    elif body.active and prop.verified_tier == 0:
        prop.verified_tier = 1          # going live = checked by the team
    await log_event(db, "listing_live" if body.active else "listing_paused", prop.id, admin.id,
                    {"verified_tier": prop.verified_tier, "reason": body.reason})
    return {"id": prop.id, "active": prop.active, "verified_tier": prop.verified_tier}


# ── Bookings ──────────────────────────────────────────────────────────────────

@router.get("/bookings")
async def list_bookings(
    q: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    guest = User.__table__.alias("guest")
    stmt = (select(Booking, Property.title, guest.c.name, guest.c.phone)
            .join(Property, Property.id == Booking.property_id)
            .join(guest, guest.c.id == Booking.guest_id))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Property.title.ilike(like), guest.c.name.ilike(like), guest.c.phone.ilike(like),
                              Booking.mpesa_ref.ilike(like), cast(Booking.id, String).ilike(like)))
    if status_filter:
        stmt = stmt.where(Booking.status == status_filter)
    rows = (await db.execute(stmt.order_by(Booking.created_at.desc()).offset((page - 1) * PAGE).limit(PAGE))).all()
    return [{
        "id": b.id, "property_title": title, "guest_name": gname, "guest_phone": gphone,
        "check_in": _iso(b.check_in), "check_out": _iso(b.check_out), "status": b.status,
        "total_amount": b.total_amount, "deposit_status": b.deposit_status, "mpesa_ref": b.mpesa_ref,
        "cancelled_by": b.cancelled_by, "created_at": _iso(b.created_at),
    } for b, title, gname, gphone in rows]


@router.get("/bookings/{booking_id}/payments")
async def booking_payments(booking_id: str, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Payment).where(Payment.booking_id == booking_id).order_by(Payment.created_at))).scalars().all()
    return [_payment_out(p) for p in rows]


class AdminCancel(BaseModel):
    reason: str = Field(..., min_length=5, max_length=300)
    refund: Literal["full", "none"] = "full"


@router.post("/bookings/{booking_id}/cancel")
async def admin_cancel(booking_id: str, body: AdminCancel, admin: User = Depends(require_admin),
                       db: AsyncSession = Depends(get_db)):
    """Team cancellation (e.g. safety issue, host unreachable). Full refund by default."""
    booking = await lock_booking(db, booking_id)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status not in ("pending", "confirmed"):
        raise HTTPException(status_code=400, detail=f"Can't cancel a {booking.status} booking here. Use a dispute ruling")
    was_pending = booking.status == "pending"
    paid = await amount_paid(db, booking.id) + await card_fees_paid(db, booking.id)  # not the guest's doing
    booking.status, booking.cancelled_by, booking.cancelled_at = "cancelled", "admin", datetime.now(timezone.utc)
    if booking.deposit_status == "held":
        booking.deposit_status = "refunded"
    await release_booking_dates(db, booking, release_promo=was_pending)
    refund = queue_b2c(db, booking, "refund", paid) if body.refund == "full" else None
    await db.flush()
    await log_event(db, "booking_cancelled_by_admin", booking.id, admin.id,
                    {"reason": body.reason, "refund": paid if refund else 0})
    dispatch_b2c(refund)
    return {"status": "cancelled", "refund": paid if refund else 0}


# ── Payments ──────────────────────────────────────────────────────────────────

def _payment_out(p: Payment) -> dict:
    return {"id": p.id, "booking_id": p.booking_id, "type": p.type, "amount": p.amount, "status": p.status,
            "method": p.method, "card_fee": p.fee_amount or 0,
            "mpesa_ref": p.mpesa_ref, "provider_request_id": p.provider_request_id, "created_at": _iso(p.created_at)}


@router.get("/payments")
async def list_payments(
    status_filter: Optional[str] = Query(None, alias="status"),
    type_filter: Optional[str] = Query(None, alias="type"),
    method_filter: Optional[Literal["mpesa", "card"]] = Query(None, alias="method"),
    page: int = Query(1, ge=1),
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    stmt = select(Payment)
    if status_filter:
        stmt = stmt.where(Payment.status == status_filter)
    if type_filter:
        stmt = stmt.where(Payment.type == type_filter)
    if method_filter:
        stmt = stmt.where(Payment.method == method_filter)
    rows = (await db.execute(stmt.order_by(Payment.created_at.desc()).offset((page - 1) * PAGE).limit(PAGE))).scalars().all()
    return [_payment_out(p) for p in rows]


@router.post("/payments/{payment_id}/retry")
async def retry_payment(payment_id: str, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Send a FAILED payout/refund again as a new row. Never for 'processing' —
    that money may already have left; resolve it instead."""
    p = (await db.execute(select(Payment).where(Payment.id == payment_id).with_for_update())).scalar_one_or_none()
    if not p or p.type == "charge":
        raise HTTPException(status_code=404, detail="Payout or refund not found")
    if p.status != "failed":
        raise HTTPException(status_code=409, detail="Only failed payments can be retried")
    already = (await db.execute(select(Payment.id).where(
        Payment.booking_id == p.booking_id, Payment.type == p.type, Payment.amount == p.amount,
        Payment.status.in_(["pending", "processing", "completed"]), Payment.created_at > p.created_at))).first()
    if already:
        raise HTTPException(status_code=409, detail="This payment was already retried")
    booking = await db.get(Booking, p.booking_id)
    new = queue_b2c(db, booking, p.type, p.amount) if booking else None
    if new is None:
        raise HTTPException(status_code=409, detail="Nothing to send for this payment")
    await db.flush()
    await log_event(db, "payment_retried", p.booking_id, admin.id, {"failed": p.id, "new": new.id})
    dispatch_b2c(new)
    return _payment_out(new)


class ResolvePayment(BaseModel):
    status: Literal["completed", "failed"]
    mpesa_ref: Optional[str] = Field(None, max_length=50)
    note: str = Field(..., min_length=5, max_length=300)


@router.post("/payments/{payment_id}/resolve")
async def resolve_payment(payment_id: str, body: ResolvePayment, admin: User = Depends(require_superadmin),
                          db: AsyncSession = Depends(get_db)):
    """After checking the M-Pesa org portal: record what really happened to a
    payment stuck in 'processing' (e.g. a timeout after sending)."""
    p = (await db.execute(select(Payment).where(Payment.id == payment_id).with_for_update())).scalar_one_or_none()
    if not p or p.type == "charge":
        raise HTTPException(status_code=404, detail="Payout or refund not found")
    if p.status not in ("processing", "pending"):
        raise HTTPException(status_code=409, detail=f"Payment is already {p.status}")
    old = p.status
    p.status = body.status
    if body.mpesa_ref:
        p.mpesa_ref = body.mpesa_ref
    if p.status == "completed" and p.type == "agent_commission":
        await mark_commission_paid(db, p)
    await log_event(db, "payment_resolved_manually", p.booking_id, admin.id,
                    {"payment_id": p.id, "from": old, "to": body.status, "mpesa_ref": body.mpesa_ref, "note": body.note})
    return _payment_out(p)


# ── Promo codes ───────────────────────────────────────────────────────────────

class PromoIn(BaseModel):
    code: str = Field(..., min_length=3, max_length=30, pattern=r"^[A-Za-z0-9_-]+$")
    discount_kes: int = Field(..., gt=0, le=100_000)
    max_uses: int = Field(1, ge=1, le=100_000)
    expires_at: Optional[datetime] = None


def _promo_out(p: PromoCode) -> dict:
    return {"id": p.id, "code": p.code, "discount_kes": p.discount_kes, "max_uses": p.max_uses,
            "used_count": p.used_count, "expires_at": _iso(p.expires_at)}


@router.get("/promo-codes")
async def list_promos(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    return [_promo_out(p) for p in (await db.execute(select(PromoCode).order_by(PromoCode.code))).scalars().all()]


@router.post("/promo-codes", status_code=status.HTTP_201_CREATED)
async def create_promo(body: PromoIn, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    code = body.code.upper()
    if (await db.execute(select(PromoCode.id).where(PromoCode.code == code))).first():
        raise HTTPException(status_code=409, detail="That code already exists")
    promo = PromoCode(code=code, discount_kes=body.discount_kes, max_uses=body.max_uses, expires_at=body.expires_at)
    db.add(promo)
    await db.flush()
    await log_event(db, "promo_created", promo.id, admin.id, {"code": code, "discount_kes": body.discount_kes})
    return _promo_out(promo)


@router.put("/promo-codes/{promo_id}")
async def update_promo(promo_id: str, body: PromoIn, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    promo = await db.get(PromoCode, promo_id)
    if not promo:
        raise HTTPException(status_code=404, detail="Promo code not found")
    if body.max_uses < promo.used_count:
        raise HTTPException(status_code=409, detail=f"Already used {promo.used_count} times")
    promo.discount_kes, promo.max_uses, promo.expires_at = body.discount_kes, body.max_uses, body.expires_at
    await log_event(db, "promo_updated", promo.id, admin.id, {"code": promo.code})
    return _promo_out(promo)


@router.post("/promo-codes/{promo_id}/end")
async def end_promo(promo_id: str, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Stop a code now (kept for the booking records that used it)."""
    promo = await db.get(PromoCode, promo_id)
    if not promo:
        raise HTTPException(status_code=404, detail="Promo code not found")
    promo.expires_at = datetime.now(timezone.utc)
    await log_event(db, "promo_ended", promo.id, admin.id, {"code": promo.code})
    return _promo_out(promo)


# ── Settings ──────────────────────────────────────────────────────────────────

@router.get("/settings")
async def get_settings(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    return {"can_edit": admin.is_superadmin,
            "settings": platform_settings.as_list(await platform_settings.refresh(db, force=True))}


@router.put("/settings")
async def put_settings(body: dict, admin: User = Depends(require_superadmin), db: AsyncSession = Depends(get_db)):
    try:
        current = await platform_settings.update(db, body, admin.id)
    except (ValueError, TypeError) as exc:
        await db.rollback()
        raise HTTPException(status_code=422, detail=str(exc))
    return {"can_edit": True, "settings": platform_settings.as_list(current)}


# ── Audit log ─────────────────────────────────────────────────────────────────

@router.get("/audit")
async def audit_log(
    event: Optional[str] = None,
    entity: Optional[str] = None,
    page: int = Query(1, ge=1),
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    stmt = select(AuditLog, User.name).outerjoin(User, cast(User.id, String) == AuditLog.actor_id)
    if event:
        stmt = stmt.where(AuditLog.event_type.ilike(f"%{event}%"))
    if entity:
        stmt = stmt.where(AuditLog.entity_id == entity)
    rows = (await db.execute(stmt.order_by(AuditLog.created_at.desc()).offset((page - 1) * PAGE).limit(PAGE))).all()
    return [{"id": a.id, "event": a.event_type, "entity_id": a.entity_id, "actor": name or (a.actor_id and "user") or "system",
             "details": a.metadata_json, "at": _iso(a.created_at)} for a, name in rows]


# ── Agents ────────────────────────────────────────────────────────────────────

@router.get("/agents")
async def list_agents(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Agent, User.name, User.phone).join(User, User.id == Agent.user_id).order_by(Agent.created_at.desc())
    )).all()
    counts = {k: v for k, v in (await db.execute(
        select(AgentReferral.agent_id, func.count()).group_by(AgentReferral.agent_id))).all()}
    return [{"id": a.id, "name": name, "phone": phone, "agency_name": a.agency_name, "status": a.status,
             "commission_pct": a.commission_pct, "ref_code": a.ref_code, "total_earned": a.total_earned,
             "referrals": counts.get(a.id, 0), "created_at": _iso(a.created_at)} for a, name, phone in rows]


class AgentPatch(BaseModel):
    status: Optional[Literal["pending", "active", "suspended"]] = None
    commission_pct: Optional[int] = Field(None, ge=0, le=20)


@router.patch("/agents/{agent_id}")
async def update_agent(agent_id: str, body: AgentPatch, admin: User = Depends(require_admin),
                       db: AsyncSession = Depends(get_db)):
    """Approve or suspend an agent, or change their commission (new bookings only)."""
    agent = await db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(agent, k, v)
    await log_event(db, "agent_updated", agent.id, admin.id, changes)
    return {"id": agent.id, "status": agent.status, "commission_pct": agent.commission_pct}


# ── Reports ───────────────────────────────────────────────────────────────────

@router.get("/reports/levy")
async def levy_report(
    month: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="YYYY-MM"),
    format: Literal["json", "csv"] = "json",
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    """Tourism levy collected on stays checking in during the month — what to
    declare and remit to the Tourism Fund (eLevy). Cancelled bookings excluded."""
    y, m = map(int, month.split("-"))
    start = date(y, m, 1)
    end = date(y + (m == 12), (m % 12) + 1, 1)
    rows = (await db.execute(
        select(Booking, Property.title)
        .join(Property, Property.id == Booking.property_id)
        .where(Booking.status.in_(LIVE_BOOKING), Booking.check_in >= start, Booking.check_in < end)
        .order_by(Booking.check_in)
    )).all()
    lines = [{"booking": b.id[:8].upper(), "property": t, "check_in": _iso(b.check_in), "check_out": _iso(b.check_out),
              "room_amount": b.room_amount, "levy": b.levy_amount, "mpesa_ref": b.mpesa_ref} for b, t in rows]
    totals = {"bookings": len(lines), "room_amount": sum(r["room_amount"] for r in lines), "levy": sum(r["levy"] for r in lines)}
    if format == "csv":
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=list(lines[0]) if lines else ["booking", "property", "check_in", "check_out", "room_amount", "levy", "mpesa_ref"])
        w.writeheader()
        w.writerows(lines)
        w.writerow({"booking": "TOTAL", "room_amount": totals["room_amount"], "levy": totals["levy"]})
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                                 headers={"Content-Disposition": f'attachment; filename="naivastay-tourism-levy-{month}.csv"'})
    return {"month": month, "totals": totals, "lines": lines}



@router.get("/reports/withholding")
async def withholding_report(
    month: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="YYYY-MM"),
    format: Literal["json", "csv"] = "json",
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    """Withholding tax deducted from host payouts in the month: what to file and
    remit to KRA, with each host's KRA PIN (blank PINs need chasing)."""
    y, m = map(int, month.split("-"))
    start = datetime(y, m, 1, tzinfo=timezone.utc)
    end = datetime(y + (m == 12), (m % 12) + 1, 1, tzinfo=timezone.utc)
    rows = (await db.execute(
        select(Payment, Booking, Property.title, User.name, User.kra_pin)
        .join(Booking, Booking.id == Payment.booking_id)
        .join(Property, Property.id == Booking.property_id)
        .join(User, User.id == Property.owner_id)
        .where(Payment.type == "payout", Payment.status.in_(["pending", "processing", "completed"]),
               Payment.created_at >= start, Payment.created_at < end)
        .order_by(Payment.created_at)
    )).all()
    lines = [{"date": _iso(p.created_at)[:10], "host": name or "Host", "kra_pin": pin or "",
              "property": title, "booking": b.id[:8].upper(),
              "gross": b.room_amount - b.commission_kes, "tax_withheld": p.tax_withheld or 0,
              "paid_to_host": p.amount, "status": p.status}
             for p, b, title, name, pin in rows]
    totals = {"payouts": len(lines), "gross": sum(r["gross"] for r in lines),
              "tax_withheld": sum(r["tax_withheld"] for r in lines),
              "missing_pins": len({r["host"] for r in lines if not r["kra_pin"]})}
    if format == "csv":
        buf = io.StringIO()
        fields = ["date", "host", "kra_pin", "property", "booking", "gross", "tax_withheld", "paid_to_host", "status"]
        w = csv.DictWriter(buf, fieldnames=fields)
        w.writeheader()
        w.writerows(lines)
        w.writerow({"date": "TOTAL", "gross": totals["gross"], "tax_withheld": totals["tax_withheld"]})
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                                 headers={"Content-Disposition": f'attachment; filename="naivastay-withholding-tax-{month}.csv"'})
    return {"month": month, "totals": totals, "lines": lines}
