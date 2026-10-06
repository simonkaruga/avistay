import hmac
import logging
import secrets
from datetime import date as date_type, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import delete, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit_log import log_event
from app.core.database import get_db
from app.core.deps import get_current_user, rate_limit
from app.core.timeutil import today_eat
from app.models.models import User, Property, Booking, Availability, PromoCode, Dispute
from app.schemas.schemas import BookingCreate, BookingOut
from app.services import policy
from app.services.settings import S, refresh as refresh_settings
from app.services.disputes import can_open, deposit_policy_note
from app.services.agents import credit_agent
from app.services.payments import (
    amount_paid,
    card_fee,
    charge_in_flight,
    dispatch_b2c,
    latest_charge,
    lock_booking,
    queue_b2c,
    queue_payout,
    release_booking_dates,
)

log = logging.getLogger(__name__)
router = APIRouter(tags=["bookings"])



CHECKIN_ATTEMPTS_PER_15_MIN = 5  # 4-digit code: 5 tries in 15 min makes guessing impractical


def _checkin_code() -> str:
    return f"{secrets.randbelow(10_000):04d}"


def _quote(prop: Property, owner_commission_pct: int, nights: int, check_in, discount: int = 0) -> dict:
    """Single source of truth for prices — the booking screen shows exactly this."""
    cfg = S()
    room = prop.price_per_night * nights
    levy = int(room * cfg.tourism_levy_pct / 100)
    deposit = prop.deposit_amount or 0      # the owner's choice; 0 = no deposit
    discount = min(discount, room)
    pol = prop.cancellation_policy or policy.DEFAULT_POLICY
    free_until = policy.free_cancellation_until(pol, check_in)
    return {
        "nights": nights,
        "price_per_night": prop.price_per_night,
        "room_amount": room,
        "levy_amount": levy,
        "platform_fee": cfg.service_fee_kes,
        "deposit_amount": deposit,
        "discount": discount,
        "total_amount": room + levy + cfg.service_fee_kes + deposit - discount,
        "commission_kes": room * owner_commission_pct // 100,
        "cancellation_policy": pol,
        "policy_summary": policy.POLICY_SUMMARIES.get(pol, ""),
        "free_cancellation_until": free_until.isoformat() if free_until and free_until >= today_eat() else None,
    }


async def _owner_commission_pct(db: AsyncSession, prop: Property) -> int:
    pct = (await db.execute(select(User.commission_pct).where(User.id == prop.owner_id))).scalar_one_or_none()
    return 10 if pct is None else pct


@router.get("/quote")
async def quote(
    property_id: str,
    check_in: date_type,
    check_out: date_type,
    promo_code: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Price breakdown + cancellation terms before the guest commits.
    Validates (but does not claim) a promo code."""
    if check_out <= check_in:
        raise HTTPException(status_code=400, detail="Check-out must be after check-in")
    await refresh_settings(db)
    prop = (await db.execute(
        select(Property).where(Property.id == property_id, Property.active == True)
    )).scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    discount, promo_error = 0, None
    if promo_code:
        promo = (await db.execute(select(PromoCode).where(
            PromoCode.code == promo_code.strip().upper(),
            PromoCode.used_count < PromoCode.max_uses,
            or_(PromoCode.expires_at.is_(None), PromoCode.expires_at > datetime.now(timezone.utc)),
        ))).scalar_one_or_none()
        if promo:
            discount = promo.discount_kes
        else:
            promo_error = "This promo code is invalid, expired or fully used"
    q = _quote(prop, 0, (check_out - check_in).days, check_in, discount)
    q.pop("commission_kes")  # owner-side figure, not for guests
    q["promo_error"] = promo_error
    q["card_fee"] = card_fee(q["total_amount"])           # only if they choose to pay by card
    q["card_surcharge_pct"] = S().card_surcharge_pct
    return q




@router.post("/", response_model=BookingOut, status_code=status.HTTP_201_CREATED)
async def create_booking(
    body: BookingCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await rate_limit(f"booking:{user.id}", limit=10, window=3600)
    await refresh_settings(db)

    if not body.terms_accepted:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Terms must be accepted")

    if body.check_out <= body.check_in:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Check-out must be after check-in")
    if body.check_in < today_eat():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Check-in date is in the past")

    # Load property
    result = await db.execute(select(Property).where(Property.id == body.property_id, Property.active == True))
    prop = result.scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    # Minimum stay rule
    nights = (body.check_out - body.check_in).days
    if nights < prop.min_nights:
        raise HTTPException(status_code=400, detail=f"Minimum stay is {prop.min_nights} nights")
    if prop.max_guests and body.guests > prop.max_guests:
        raise HTTPException(status_code=400, detail=f"This home sleeps up to {prop.max_guests} guests")

    # Fast-path availability check for a friendly error. The unique
    # (property_id, date) constraint below is what actually guarantees it.
    blocked = await db.execute(
        select(Availability.id).where(
            Availability.property_id == body.property_id,
            Availability.date >= body.check_in,
            Availability.date < body.check_out,
            Availability.is_blocked == True,
        ).limit(1)
    )
    if blocked.first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Dates not available")


    # Promo code — claimed atomically so max_uses cannot be exceeded under concurrency.
    discount = 0
    promo_id = None
    if body.promo_code:
        claimed = (await db.execute(
            update(PromoCode)
            .where(
                PromoCode.code == body.promo_code.strip().upper(),
                PromoCode.used_count < PromoCode.max_uses,
                or_(PromoCode.expires_at.is_(None), PromoCode.expires_at > datetime.now(timezone.utc)),
            )
            .values(used_count=PromoCode.used_count + 1)
            .returning(PromoCode.id, PromoCode.discount_kes)
        )).first()
        if not claimed:
            raise HTTPException(status_code=400, detail="Promo code is invalid, expired or fully used")
        promo_id = claimed.id
        discount = claimed.discount_kes

    q = _quote(prop, await _owner_commission_pct(db, prop), nights, body.check_in, discount)

    booking = Booking(
        guest_id=user.id,
        property_id=prop.id,
        check_in=body.check_in,
        check_out=body.check_out,
        total_amount=q["total_amount"],
        platform_fee=q["platform_fee"],
        deposit_amount=q["deposit_amount"],
        room_amount=q["room_amount"],
        levy_amount=q["levy_amount"],
        commission_kes=q["commission_kes"],
        cancellation_policy=q["cancellation_policy"],
        promo_code_id=promo_id,
        guests=body.guests,
        group_name=body.group_name,
        is_corporate=body.is_corporate,
        company_name=body.company_name,
        kra_pin=body.kra_pin,
        status="pending",
        checkin_code=_checkin_code(),
        terms_accepted_at=datetime.now(timezone.utc),
    )
    db.add(booking)
    await db.flush()  # assigns booking.id. The availability rows below must reference it
    await credit_agent(db, booking, prop, body.ref_code)

    # Owner-opened nights are stored as is_blocked=False rows; replace them.
    await db.execute(delete(Availability).where(
        Availability.property_id == prop.id,
        Availability.date >= body.check_in,
        Availability.date < body.check_out,
        Availability.is_blocked == False,
    ))
    current = body.check_in
    while current < body.check_out:
        db.add(Availability(
            property_id=prop.id,
            date=current,
            is_blocked=True,
            source="booking",
            booking_id=booking.id,
        ))
        current += timedelta(days=1)

    try:
        await db.commit()
    except IntegrityError:
        # Another guest (or an iCal sync) took one of these nights a moment ago.
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Dates just booked. Please try different dates")
    await db.refresh(booking)
    return booking


@router.get("/mine", response_model=list[BookingOut])
async def my_bookings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(Booking, Property.title.label("property_title"))
        .join(Property, Booking.property_id == Property.id)
        .where(Booking.guest_id == user.id)
        .order_by(Booking.created_at.desc())
    )).all()
    ids = [b.id for b, _ in rows]
    disputes: dict[str, Dispute] = {}
    for d in (await db.execute(
        select(Dispute).where(Dispute.booking_id.in_(ids), Dispute.opener_role == "guest")
        .order_by(Dispute.created_at)
    )).scalars().all():
        disputes[d.booking_id] = d  # latest wins

    result = []
    for booking, title in rows:
        out = {k: v for k, v in vars(booking).items() if not k.startswith("_")}
        dispute = disputes.get(booking.id)
        free_until = policy.free_cancellation_until(booking.cancellation_policy, booking.check_in)
        out.update({
            "property_title": title,
            "policy_summary": policy.POLICY_SUMMARIES.get(booking.cancellation_policy),
            "free_cancellation_until": free_until.isoformat() if free_until and free_until >= today_eat() else None,
            "deposit_note": deposit_policy_note(booking),
            "dispute_id": dispute.id if dispute else None,
            "dispute_status": dispute.status if dispute else None,
            "can_cancel": booking.status in ("pending", "confirmed"),
            "can_report": can_open("guest", booking) and not (dispute and dispute.status == "open"),
        })
        result.append(out)
    return result


@router.get("/{booking_id}", response_model=BookingOut)
async def get_booking(
    booking_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    booking = (await db.execute(select(Booking).where(Booking.id == booking_id))).scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    if booking.guest_id == user.id:
        return booking
    if user.role == "admin" or (user.role == "owner" and await _owns_property(db, user, booking.property_id)):
        # The check-in code is the guest's proof of arrival — never show it to the host.
        out = BookingOut.model_validate(booking, from_attributes=True)
        return out.model_copy(update={"checkin_code": None})
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")


async def _owns_property(db: AsyncSession, user: User, property_id: str) -> bool:
    return (await db.execute(
        select(Property.id).where(Property.id == property_id, Property.owner_id == user.id)
    )).first() is not None


@router.post("/{booking_id}/checkin", status_code=status.HTTP_204_NO_CONTENT)
async def confirm_checkin(
    booking_id: str,
    code: str = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Host enters the code the guest shows on arrival. Starts the 24h window in
    which the guest can report a problem; the payout is released after it."""
    await rate_limit(f"checkin:{booking_id}", limit=CHECKIN_ATTEMPTS_PER_15_MIN, window=900)

    booking = await lock_booking(db, booking_id)
    if not booking or not (user.role == "admin" or await _owns_property(db, user, booking.property_id)):
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status != "confirmed":
        raise HTTPException(status_code=400, detail="Booking not in confirmed state")
    today = today_eat()
    if not (booking.check_in <= today < booking.check_out):
        raise HTTPException(status_code=400, detail=f"Check-in opens on {booking.check_in}")
    if not booking.checkin_code or not hmac.compare_digest(booking.checkin_code, code):
        raise HTTPException(status_code=400, detail="Invalid check-in code")

    booking.status = "checked_in"
    booking.checked_in_at = datetime.now(timezone.utc)
    await log_event(db, "guest_checked_in", booking.id, user.id, {})


class CancelBooking(BaseModel):
    reason: str = "Guest cancellation"


def _guest_cancel_split(booking: Booking, paid: int) -> policy.GuestCancelSplit:
    pct = policy.refund_pct(booking.cancellation_policy, booking.check_in, today_eat())
    return policy.guest_cancel_split(
        paid=paid, room=booking.room_amount, levy=booking.levy_amount, fee=booking.platform_fee,
        deposit=booking.deposit_amount if booking.deposit_status == "held" else 0,
        commission=booking.commission_kes, pct=pct,
    )


@router.get("/{booking_id}/cancel-preview")
async def cancel_preview(
    booking_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """What the guest gets back if they cancel now — shown before they confirm."""
    booking = (await db.execute(select(Booking).where(Booking.id == booking_id))).scalar_one_or_none()
    if not booking or booking.guest_id != user.id:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status not in ("pending", "confirmed"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel a {booking.status} booking")
    paid = await amount_paid(db, booking.id)
    split = _guest_cancel_split(booking, paid)
    return {
        "paid": paid,
        "refund_pct": split.refund_pct,
        "refund_amount": split.guest_refund,
        "policy_summary": policy.POLICY_SUMMARIES.get(booking.cancellation_policy, ""),
    }



@router.post("/{booking_id}/cancel", status_code=status.HTTP_200_OK)
async def cancel_booking(
    booking_id: str,
    body: CancelBooking,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    booking = await lock_booking(db, booking_id)
    if not booking or not (booking.guest_id == user.id or user.role == "admin"):
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status not in ("pending", "confirmed"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel a {booking.status} booking")
    last = await latest_charge(db, booking.id) if booking.status == "pending" else None
    # Only an M-Pesa PIN prompt blocks (it resolves in a minute). An open card
    # page doesn't: if it's paid after cancelling, that payment is auto-refunded.
    if last is not None and last.method == "mpesa" and charge_in_flight(last):
        raise HTTPException(status_code=409, detail="A payment is in progress. Wait a minute, then try again")

    paid = await amount_paid(db, booking.id)
    split = _guest_cancel_split(booking, paid)
    was_pending = booking.status == "pending"

    booking.status = "cancelled"
    booking.cancelled_at = datetime.now(timezone.utc)
    booking.cancelled_by = "admin" if user.role == "admin" and booking.guest_id != user.id else "guest"
    if booking.deposit_status == "held":
        booking.deposit_status = "refunded"   # included in split.guest_refund
    await release_booking_dates(db, booking, release_promo=was_pending)
    refund = queue_b2c(db, booking, "refund", split.guest_refund)
    await db.flush()
    payout = await queue_payout(db, booking, amount=split.owner_payout) if split.owner_payout else None
    await log_event(db, "booking_cancelled", booking.id, user.id, {
        "reason": body.reason[:200], "refund_pct": split.refund_pct,
        "refund_amount": split.guest_refund, "owner_payout": split.owner_payout,
    })
    dispatch_b2c(refund, payout)
    refund_pct, refund_amount = split.refund_pct, split.guest_refund

    # Email notification — best effort; the cancellation is already committed.
    from app.services.email import send_email, booking_cancelled_html
    guest = (await db.execute(select(User).where(User.id == booking.guest_id))).scalar_one_or_none()
    prop  = (await db.execute(select(Property).where(Property.id == booking.property_id))).scalar_one_or_none()
    if guest and guest.email and prop:
        try:
            await send_email(guest.email, f"Booking cancelled · {prop.title}",
                booking_cancelled_html(guest.name or "", prop.title, refund_amount))
        except Exception:
            log.exception("Cancellation email failed for booking %s", booking.id)

    return {"status": "cancelled", "refund_pct": refund_pct, "refund_amount": refund_amount}
