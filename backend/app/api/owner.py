from datetime import date as date_type, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.workers.queue import enqueue
from app.core.audit_log import log_event
from app.core.database import get_db
from app.core.deps import rate_limit, require_owner
from app.core.timeutil import today_eat
from app.models.models import (
    User, Property, PropertyImage, Booking, Availability, Dispute, OwnerAdjustment, Payment,
)
from app.services import ai, policy
from app.services.settings import S, refresh as refresh_settings
from app.services.media import is_our_media_url
from app.services.disputes import can_open
from app.services.payments import (
    amount_paid, card_fees_paid, dispatch_b2c, lock_booking, owner_payout_amount, payout_due_at, queue_b2c,
)

router = APIRouter(tags=["owner"])


# ── Dashboard stats ───────────────────────────────────────────────────────────

@router.get("/dashboard")
async def owner_dashboard(owner: User = Depends(require_owner), db: AsyncSession = Depends(get_db)):
    props = (await db.execute(select(Property).where(Property.owner_id == owner.id))).scalars().all()
    property_ids = [p.id for p in props]

    if not property_ids:
        return {"properties": 0, "bookings": 0, "total_earned": 0, "pending_payout": 0, "upcoming": []}

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
    pending_payout = sum(owner_payout_amount(b) for b in bookings
                         if b.status in ("confirmed", "checked_in") and b.id not in paid_map)

    upcoming = [
        {
            "id": b.id,
            "property_id": b.property_id,
            "check_in": b.check_in.isoformat(),
            "check_out": b.check_out.isoformat(),
            "status": b.status,
            "total_amount": b.total_amount,
            "your_payout": owner_payout_amount(b),
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
    }


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

    out = []
    for b in bookings:
        # checkin_code is the guest's proof of arrival — the host must get it from the guest.
        row = {k: v for k, v in vars(b).items() if not k.startswith("_") and k != "checkin_code"}
        case = disputes.get(b.id)
        row.update({
            "property_title": titles.get(b.property_id),
            "your_payout": owner_payout_amount(b),
            "payout_status": payouts.get(b.id),
            "payout_due_at": payout_due_at(b).isoformat() if b.status in ("confirmed", "checked_in") else None,
            "dispute": {"id": case.id, "status": case.status, "opener_role": case.opener_role} if case else None,
            "can_cancel": b.status == "confirmed" and b.check_in >= today_eat(),
            "can_report_damage": can_open("owner", b) and not (case and case.status == "open" and case.opener_role == "owner"),
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
        raise HTTPException(status_code=422, detail="Photos must be uploaded through Avistay")
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
            "You write holiday-home listings for Avistay, a booking site for Naivasha, Kenya. "
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
