from datetime import date as date_type, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.workers.queue import enqueue
from app.core.audit_log import log_event
from app.core.database import get_db
from app.core.deps import rate_limit, require_owner
from app.core.timeutil import today_eat
from app.models.models import (
    ExternalCalendar, AuditLog,
    User, Property, PropertyImage, Booking, Availability, Dispute, OwnerAdjustment, Payment,
)
from app.services import ai, policy
from app.services.settings import S, refresh as refresh_settings
from app.services.media import is_our_media_url
from app.services.disputes import can_open
from app.services.payments import (
    amount_paid, card_fees_paid, dispatch_b2c, host_net_payout, lock_booking, payout_due_at, queue_b2c,
)

from app.services.compliance import missing_for_live
from app.api.messages import unread_counts
from app.schemas.schemas import KRA_PIN_RE, clean_tra_licence
router = APIRouter(tags=["owner"])


# ── Dashboard stats ───────────────────────────────────────────────────────────

@router.get("/dashboard")
async def owner_dashboard(owner: User = Depends(require_owner), db: AsyncSession = Depends(get_db)):
    props = (await db.execute(select(Property).where(Property.owner_id == owner.id))).scalars().all()
    property_ids = [p.id for p in props]

    if not property_ids:
        return {"properties": 0, "bookings": 0, "total_earned": 0, "pending_payout": 0, "upcoming": [],
                "calendar_sync": {"linked": 0, "last_synced_at": None, "double_bookings": []}}

    bookings_result = await db.execute(
        select(Booking).where(
            Booking.property_id.in_(property_ids),
            Booking.status.in_(["confirmed", "checked_in", "completed"]),
        ).order_by(Booking.check_in.asc())
    )
    bookings = bookings_result.scalars().all()

    paid_out = (await db.execute(
        select(Payment.booking_id, func.sum(Payment.amount))
        .where(Payment.booking_id.in_([b.id for b in bookings]),
               Payment.type.in_(["payout", "claim_payout"]),
               Payment.status.in_(["processing", "completed"]))
        .group_by(Payment.booking_id)
    )).all()
    paid_map: dict[str, int] = {k: int(v) for k, v in paid_out}
    total_earned = sum(int(v) for v in paid_map.values())
    pending_payout = sum(host_net_payout(b) for b in bookings
                         if b.status in ("confirmed", "checked_in") and b.id not in paid_map)

    upcoming = [
        {
            "id": b.id,
            "property_id": b.property_id,
            "check_in": b.check_in.isoformat(),
            "check_out": b.check_out.isoformat(),
            "status": b.status,
            "total_amount": b.total_amount,
            "your_payout": host_net_payout(b),
            "property_title": next((p.title for p in props if p.id == b.property_id), None),
        }
        for b in bookings if b.status == "confirmed"
    ]

    return {
        "properties": len(props),
        "bookings": len(bookings),
        "total_earned": total_earned,
        "pending_payout": pending_payout,
        "upcoming": upcoming[:10],
        "calendar_sync": await _calendar_sync_status(db, property_ids, {p.id: p.title for p in props}),
    }


async def _calendar_sync_status(db: AsyncSession, property_ids: list[str], titles: dict[str, str]) -> dict:
    """Airbnb/Booking.com links: how many, when last checked, and any open double bookings."""
    cals = (await db.execute(select(ExternalCalendar).where(ExternalCalendar.property_id.in_(property_ids)))).scalars().all()
    synced = [c.last_synced_at for c in cals if c.last_synced_at]
    since = datetime.now(timezone.utc) - timedelta(days=7)
    events = (await db.execute(select(AuditLog).where(
        AuditLog.event_type == "double_booking_detected", AuditLog.created_at >= since,
    ).order_by(AuditLog.created_at.desc()))).scalars().all()
    clashes, seen = [], set()
    for e in events:
        pid = (e.metadata_json or {}).get("property_id")
        if pid not in titles or e.entity_id in seen:
            continue
        booking = await db.get(Booking, e.entity_id)
        if not booking or booking.status not in ("pending", "confirmed", "checked_in"):
            continue                                   # already resolved
        seen.add(e.entity_id)
        clashes.append({"booking_id": booking.id, "property_title": titles[pid],
                        "nights": (e.metadata_json or {}).get("nights", [])})
    return {"linked": len(cals), "last_synced_at": max(synced).isoformat() if synced else None,
            "double_bookings": clashes}


# ── Guest details for the host ────────────────────────────────────────────────

GUEST_DETAILS_DAYS_AFTER = 30   # contact details stay visible this long after check-out


def guest_card(guest: User | None, b: Booking) -> dict | None:
    """Who is coming. Contact details only for a paid booking, and not forever
    (data protection: share what the host needs, for as long as they need it)."""
    if guest is None or guest.deleted_at is not None:
        return None
    paid = b.status in ("confirmed", "checked_in", "completed")
    recent = b.check_out >= today_eat() - timedelta(days=GUEST_DETAILS_DAYS_AFTER)
    first = (guest.name or "").split(" ")[0] or "Guest"
    if not (paid and recent):
        return {"name": first, "phone": None, "email": None, "id_verified": bool(guest.verified_at), "shared": False}
    return {"name": guest.name or first, "phone": guest.phone, "email": guest.email,
            "id_verified": bool(guest.verified_at), "shared": True}


# ── Tax details (KRA PIN) and listing licences ────────────────────────────────

class ComplianceIn(BaseModel):
    kra_pin: str = Field(..., pattern=KRA_PIN_RE)

    @field_validator("kra_pin", mode="before")
    @classmethod
    def _upper(cls, v):
        return str(v or "").strip().upper().replace(" ", "")


@router.get("/compliance")
async def get_compliance(owner: User = Depends(require_owner), db: AsyncSession = Depends(get_db)):
    """What's still needed before the host's listings can go live and be paid."""
    props = (await db.execute(select(Property).where(Property.owner_id == owner.id))).scalars().all()
    return {
        "kra_pin": owner.kra_pin,
        "payout_phone": owner.phone,
        "withholding_tax_pct": S().withholding_tax_pct,
        "listings": [{"id": p.id, "title": p.title, "active": p.active, "tra_licence_no": p.tra_licence_no,
                      "missing": missing_for_live(p, owner)} for p in props],
    }


@router.put("/compliance")
async def put_compliance(body: ComplianceIn, owner: User = Depends(require_owner), db: AsyncSession = Depends(get_db)):
    owner.kra_pin = body.kra_pin
    await log_event(db, "host_kra_pin_set", owner.id, owner.id, {})
    return {"kra_pin": owner.kra_pin}


class LicenceIn(BaseModel):
    tra_licence_no: str = Field(..., min_length=3, max_length=40)


@router.put("/properties/{property_id}/licence")
async def put_licence(property_id: str, body: LicenceIn, owner: User = Depends(require_owner),
                      db: AsyncSession = Depends(get_db)):
    """Save a listing's Tourism Regulatory Authority licence number."""
    prop = await _owned_property(db, property_id, owner)
    try:
        prop.tra_licence_no = clean_tra_licence(body.tra_licence_no)   # same rules as the listing form
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    await log_event(db, "listing_licence_set", prop.id, owner.id, {"tra_licence_no": prop.tra_licence_no})
    return {"id": prop.id, "tra_licence_no": prop.tra_licence_no, "missing": missing_for_live(prop, owner)}


# ── Owner bookings list ────────────────────────────────────────────────────────

@router.get("/bookings")
async def owner_bookings(
    property_id: Optional[str] = None,
    owner: User = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    props = (await db.execute(select(Property).where(Property.owner_id == owner.id))).scalars().all()
    ids = [p.id for p in props]
    if not ids:
        return []
    q = select(Booking).where(Booking.property_id.in_(ids))
    if property_id:
        q = q.where(Booking.property_id == property_id)
    bookings = (await db.execute(q.order_by(Booking.check_in.desc()))).scalars().all()
    ids = [b.id for b in bookings]
    payouts = {k: v for k, v in (await db.execute(
        select(Payment.booking_id, Payment.status)
        .where(Payment.booking_id.in_(ids), Payment.type == "payout", Payment.status != "failed")
    )).all()}
    disputes = {}
    for d in (await db.execute(
        select(Dispute).where(Dispute.booking_id.in_(ids)).order_by(Dispute.created_at)
    )).scalars().all():
        disputes[d.booking_id] = d  # latest wins
    titles = {p.id: p.title for p in props}
    guests = {u.id: u for u in (await db.execute(
        select(User).where(User.id.in_({b.guest_id for b in bookings})))).scalars()} if bookings else {}
    unread = await unread_counts(db, owner.id, ids)

    out = []
    for b in bookings:
        # checkin_code is the guest's proof of arrival — the host must get it from the guest.
        row = {k: v for k, v in vars(b).items() if not k.startswith("_") and k != "checkin_code"}
        case = disputes.get(b.id)
        row.update({
            "property_title": titles.get(b.property_id),
            "your_payout": host_net_payout(b),
            "payout_status": payouts.get(b.id),
            "payout_due_at": payout_due_at(b).isoformat() if b.status in ("confirmed", "checked_in") else None,
            "dispute": {"id": case.id, "status": case.status, "opener_role": case.opener_role} if case else None,
            "can_cancel": b.status == "confirmed" and b.check_in >= today_eat(),
            "can_report_damage": can_open("owner", b) and not (case and case.status == "open" and case.opener_role == "owner"),
            "guest": guest_card(guests.get(b.guest_id), b),
            "unread_messages": unread.get(b.id, 0),
        })
        out.append(row)
    return out


# ── Availability toggle ────────────────────────────────────────────────────────

class AvailabilityToggle(BaseModel):
    property_id: str
    date: date_type
    is_blocked: bool


@router.post("/availability", status_code=200)
async def toggle_availability(
    body: AvailabilityToggle,
    owner: User = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    prop = (await db.execute(
        select(Property).where(Property.id == body.property_id, Property.owner_id == owner.id)
    )).scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    existing = (await db.execute(
        select(Availability).where(
            Availability.property_id == body.property_id,
            Availability.date == body.date,
        )
    )).scalar_one_or_none()

    if existing and existing.source == "booking":
        raise HTTPException(status_code=409, detail="This night is booked by a guest. Cancel the booking instead")
    if existing:
        existing.is_blocked = body.is_blocked
    else:
        db.add(Availability(
            property_id=body.property_id,
            date=body.date,
            is_blocked=body.is_blocked,
            source="manual",
        ))
    await db.commit()
    return {"date": body.date.isoformat(), "is_blocked": body.is_blocked}


# ── Listing photos ────────────────────────────────────────────────────────────
# Files go straight from the browser to Cloudinary (signed, see api/uploads.py);
# these endpoints only record, order and remove them.

MAX_LISTING_PHOTOS = 30


class ImageRecord(BaseModel):
    property_id: str
    cloudinary_url: str
    is_primary: bool = False
    display_order: int = 0


class ImageBatch(BaseModel):
    urls: list[str] = Field(..., min_length=1, max_length=MAX_LISTING_PHOTOS)


class ImageOrder(BaseModel):
    image_ids: list[str] = Field(..., min_length=1, max_length=MAX_LISTING_PHOTOS)


async def _owned_property(db: AsyncSession, property_id: str, owner: User) -> Property:
    prop = (await db.execute(
        select(Property).where(Property.id == property_id, Property.owner_id == owner.id)
    )).scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    return prop


async def _gallery(db: AsyncSession, property_id: str) -> list[PropertyImage]:
    return list((await db.execute(
        select(PropertyImage).where(PropertyImage.property_id == property_id)
        .order_by(PropertyImage.display_order, PropertyImage.id)
    )).scalars().all())


def _renumber(images: list[PropertyImage]) -> None:
    """Order = list order; the first photo is the cover."""
    for i, img in enumerate(images):
        img.display_order = i
        img.is_primary = i == 0


def _image_out(img: PropertyImage) -> dict:
    return {"id": img.id, "cloudinary_url": img.cloudinary_url,
            "is_primary": img.is_primary, "display_order": img.display_order}


@router.get("/properties/{property_id}/images")
async def list_images(property_id: str, owner: User = Depends(require_owner), db: AsyncSession = Depends(get_db)):
    await _owned_property(db, property_id, owner)
    return [_image_out(i) for i in await _gallery(db, property_id)]


@router.post("/properties/{property_id}/images", status_code=201)
async def add_images(
    property_id: str,
    body: ImageBatch,
    owner: User = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    """Append photos in the order given — all or nothing."""
    await _owned_property(db, property_id, owner)
    bad = [u for u in body.urls if not is_our_media_url(u)]
    if bad:
        raise HTTPException(status_code=422, detail="Photos must be uploaded through NaivaStay")
    images = await _gallery(db, property_id)
    known = {i.cloudinary_url for i in images}
    new_urls = list(dict.fromkeys(u for u in body.urls if u not in known))  # dedupe, keep order
    if len(images) + len(new_urls) > MAX_LISTING_PHOTOS:
        raise HTTPException(status_code=422, detail=f"A listing can have at most {MAX_LISTING_PHOTOS} photos")
    for url in new_urls:
        img = PropertyImage(property_id=property_id, cloudinary_url=url)
        db.add(img)
        images.append(img)
    _renumber(images)
    await db.commit()
    return [_image_out(i) for i in images]


@router.put("/properties/{property_id}/images/order")
async def reorder_images(
    property_id: str,
    body: ImageOrder,
    owner: User = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    """Set the full gallery order. The first photo becomes the cover."""
    await _owned_property(db, property_id, owner)
    images = {i.id: i for i in await _gallery(db, property_id)}
    if sorted(body.image_ids) != sorted(images):
        raise HTTPException(status_code=409, detail="The gallery changed. Refresh and try again")
    ordered = [images[i] for i in body.image_ids]
    _renumber(ordered)
    await db.commit()
    return [_image_out(i) for i in ordered]


@router.delete("/images/{image_id}", status_code=204)
async def delete_image(image_id: str, owner: User = Depends(require_owner), db: AsyncSession = Depends(get_db)):
    img = (await db.execute(select(PropertyImage).where(PropertyImage.id == image_id))).scalar_one_or_none()
    if not img:
        raise HTTPException(status_code=404, detail="Photo not found")
    await _owned_property(db, img.property_id, owner)
    property_id = img.property_id
    await db.delete(img)
    await db.flush()
    _renumber(await _gallery(db, property_id))   # promote the next photo to cover if needed
    await db.commit()


@router.post("/images", status_code=201)
async def add_image(
    body: ImageRecord,
    owner: User = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    """Single-photo variant, kept for older app versions."""
    images = await add_images(body.property_id, ImageBatch(urls=[body.cloudinary_url]), owner, db)
    img = next(i for i in images if i["cloudinary_url"] == body.cloudinary_url)
    return {"id": img["id"], "cloudinary_url": img["cloudinary_url"]}


# ── Claude listing description writer ────────────────────────────────────────

class DescriptionRequest(BaseModel):
    raw_details: str  # Owner types: "3 bed cottage, lake view, sleeps 6, has wifi, bbq"
    property_type: str
    price_per_night: int


@router.post("/ai/description")
async def generate_description(
    body: DescriptionRequest,
    owner: User = Depends(require_owner),
):
    """Turn the host's rough notes into a listing description they can edit."""
    await rate_limit(f"ai_desc:{owner.id}", limit=20, window=86400)   # cost guard
    text = await ai.ask(
        system=(
            "You write holiday-home listings for NaivaStay, a booking site for Naivasha, Kenya. "
            "Write from the host's notes only: never add amenities, views or distances they didn't mention. "
            "Warm, specific and honest, like a proud local host. Two short paragraphs, 90 to 150 words, "
            "plain text, no headings, no emojis, no em dashes, no clichés like 'nestled' or 'oasis'."
        ),
        messages=[{"role": "user", "content": (
            f"Type: {body.property_type}\nPrice: KES {body.price_per_night:,} per night\n"
            f"Host's notes: {body.raw_details[:1500]}"
        )}],
        max_tokens=400,
    )
    if text is None:
        return {"description": f"A {body.property_type} in Naivasha. {body.raw_details.strip()}", "ai": False}
    return {"description": text, "ai": True}


# ── Owner cancellation ────────────────────────────────────────────────────────
# Booking.com-style: the guest is made whole, the owner pays for it.

class OwnerCancel(BaseModel):
    reason: str = Field(..., min_length=10, max_length=500)


async def _strikes(db: AsyncSession, owner_id: str) -> int:
    since = datetime.now(timezone.utc) - timedelta(days=policy.OWNER_STRIKE_WINDOW_DAYS)
    return (await db.execute(
        select(func.count(Booking.id))
        .join(Property, Property.id == Booking.property_id)
        .where(Property.owner_id == owner_id, Booking.cancelled_by == "owner", Booking.cancelled_at >= since)
    )).scalar_one()


@router.get("/bookings/{booking_id}/cancel-preview")
async def owner_cancel_preview(
    booking_id: str,
    owner: User = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    await refresh_settings(db)
    booking, _ = await _owned_booking(db, booking_id, owner, lock=False)
    strikes = await _strikes(db, owner.id)
    return {
        "guest_refund": await amount_paid(db, booking.id) + await card_fees_paid(db, booking.id),
        "penalty": booking.room_amount * S().owner_cancel_penalty_pct // 100,
        "strikes_after": strikes + 1,
        "strike_limit": S().owner_strike_limit,
        "will_pause_listing": strikes + 1 >= S().owner_strike_limit,
    }


@router.post("/bookings/{booking_id}/cancel")
async def owner_cancel_booking(
    booking_id: str,
    body: OwnerCancel,
    owner: User = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    await refresh_settings(db)
    booking, prop = await _owned_booking(db, booking_id, owner, lock=True)
    if booking.status != "confirmed":
        raise HTTPException(status_code=400, detail="Only confirmed bookings that haven't started can be cancelled")

    paid = await amount_paid(db, booking.id) + await card_fees_paid(db, booking.id)   # guest gets every shilling back
    penalty = booking.room_amount * S().owner_cancel_penalty_pct // 100

    booking.status = "cancelled"
    booking.cancelled_by = "owner"
    booking.cancelled_at = datetime.now(timezone.utc)
    if booking.deposit_status == "held":
        booking.deposit_status = "refunded"     # part of the full refund below
    # Dates stay blocked: an owner can't cancel to resell the same nights.
    await db.execute(
        update(Availability).where(Availability.booking_id == booking.id)
        .values(source="manual", booking_id=None)
    )
    refund = queue_b2c(db, booking, "refund", paid)   # 100%, fees included
    if penalty:
        db.add(OwnerAdjustment(owner_id=owner.id, booking_id=booking.id, amount=-penalty,
                               reason="owner_cancellation"))
    await db.flush()

    strikes = await _strikes(db, owner.id)
    paused = strikes >= S().owner_strike_limit and prop.active
    if paused:
        prop.active = False
    await log_event(db, "owner_cancelled_booking", booking.id, owner.id, {
        "reason": body.reason, "refund": paid, "penalty": penalty, "strikes": strikes, "listing_paused": paused,
    })
    dispatch_b2c(refund)

    from app.workers.tasks import notify_owner_cancellation
    enqueue(notify_owner_cancellation, booking.id, paused)
    return {"status": "cancelled", "guest_refund": paid, "penalty": penalty,
            "strikes": strikes, "listing_paused": paused}


async def _owned_booking(db: AsyncSession, booking_id: str, owner: User, lock: bool):
    booking = await lock_booking(db, booking_id) if lock else \
        (await db.execute(select(Booking).where(Booking.id == booking_id))).scalar_one_or_none()
    prop = (await db.execute(
        select(Property).where(Property.id == booking.property_id, Property.owner_id == owner.id)
    )).scalar_one_or_none() if booking else None
    if not booking or not prop:
        raise HTTPException(status_code=404, detail="Booking not found")
    return booking, prop


@router.get("/earnings")
async def owner_earnings(owner: User = Depends(require_owner), db: AsyncSession = Depends(get_db)):
    """Payout statement: what was paid, what's coming, what was deducted."""
    rows = (await db.execute(
        select(Payment, Booking, Property.title)
        .join(Booking, Booking.id == Payment.booking_id)
        .join(Property, Property.id == Booking.property_id)
        .where(Property.owner_id == owner.id, Payment.type.in_(["payout", "claim_payout"]))
        .order_by(Payment.created_at.desc()).limit(200)
    )).all()
    adjustments = (await db.execute(
        select(OwnerAdjustment).where(OwnerAdjustment.owner_id == owner.id)
        .order_by(OwnerAdjustment.created_at.desc()).limit(100)
    )).scalars().all()
    return {
        "commission_pct": owner.commission_pct,
        "payouts": [{
            "id": p.id, "booking_id": b.id, "property_title": title, "type": p.type,
            "check_in": b.check_in.isoformat(), "check_out": b.check_out.isoformat(),
            "room_amount": b.room_amount, "commission_kes": b.commission_kes,
            "amount": p.amount, "status": p.status, "mpesa_ref": p.mpesa_ref,
            "created_at": p.created_at.isoformat(),
        } for p, b, title in rows],
        "adjustments": [{
            "id": a.id, "booking_id": a.booking_id, "amount": a.amount, "reason": a.reason,
            "applied": a.applied_payment_id is not None, "created_at": a.created_at.isoformat(),
        } for a in adjustments],
        "outstanding_deductions": sum(a.amount for a in adjustments if a.applied_payment_id is None),
    }


# ── Seasonal pricing ──────────────────────────────────────────────────────────

class PricingRule(BaseModel):
    property_id: str
    price_per_night: int


@router.put("/pricing")
async def update_pricing(
    body: PricingRule,
    owner: User = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    prop = (await db.execute(
        select(Property).where(Property.id == body.property_id, Property.owner_id == owner.id)
    )).scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    prop.price_per_night = body.price_per_night
    await db.commit()
    return {"price_per_night": prop.price_per_night}


# ── Quick date blocker (prevents cross-platform double-booking) ───────────────

class BlockDates(BaseModel):
    property_id: str
    check_in: date_type
    check_out: date_type


@router.post("/block-dates", status_code=204)
async def block_dates(
    body: BlockDates,
    owner: User = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    """Owner manually blocks dates — used when they receive an Airbnb/Booking.com booking."""
    if body.check_out <= body.check_in:
        raise HTTPException(status_code=400, detail="Check-out must be after check-in")

    prop = (await db.execute(
        select(Property).where(Property.id == body.property_id, Property.owner_id == owner.id)
    )).scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    from datetime import timedelta
    from sqlalchemy import delete as sa_delete
    # Clear existing manual blocks in this range first to avoid duplicates
    await db.execute(
        sa_delete(Availability).where(
            Availability.property_id == prop.id,
            Availability.date >= body.check_in,
            Availability.date < body.check_out,
            Availability.source == "manual",
        )
    )
    current = body.check_in
    while current < body.check_out:
        existing = (await db.execute(
            select(Availability).where(
                Availability.property_id == prop.id,
                Availability.date == current,
            )
        )).scalar_one_or_none()
        if not existing:
            db.add(Availability(
                property_id=prop.id,
                date=current,
                is_blocked=True,
                source="manual",
            ))
        current += timedelta(days=1)
    await db.commit()
