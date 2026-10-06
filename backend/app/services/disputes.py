"""
Dispute rules. Who may open what, when, and what a ruling does to the money.

  Guest  → "problem with my stay" (no access, not as described, ...)
           window: check-in day → day after check-out
           effect: owner payout is frozen while open
           ruling: guest_refund_kes back to guest, deducted from the owner
                   (via the payout ledger, so it works even if already paid)

  Owner  → "damage / house rules"
           window: check-in day → check-out + deposit hold days (a platform setting)
           effect: deposit refund is frozen while open
           ruling: owner_award_kes from the held deposit, rest back to guest
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import today_eat
from app.models.models import (
    GUEST_DISPUTE_REASONS, OWNER_DISPUTE_REASONS, Booking, Dispute, OwnerAdjustment, Payment, User,
)
from app.services.media import is_our_media_url
from app.services.settings import S
from app.services.payments import (
    amount_paid, deposit_due_at, owner_payout_amount, property_owner_id, queue_b2c, queue_deposit_refund,
)

MAX_ATTACHMENTS = 6
MAX_MESSAGE_CHARS = 4000

REASON_LABELS = {
    "no_access": "Couldn't get into the property",
    "not_as_described": "Property not as described",
    "safety": "Safety concern",
    "cleanliness": "Cleanliness",
    "damage": "Damage to the property",
    "house_rules": "House rules broken",
    "other": "Something else",
}


class DisputeError(ValueError):
    """Rule violation — message is safe to show the user."""


def party_role(user: User, booking: Booking, owner_id: str) -> str | None:
    if booking.guest_id == user.id:
        return "guest"
    if owner_id == user.id:
        return "owner"
    if user.role == "admin":
        return "admin"
    return None


def can_open(role: str, booking: Booking, now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    today = today_eat()
    if booking.status not in ("confirmed", "checked_in", "completed"):
        return False
    if today < booking.check_in:
        return False
    if role == "guest":
        return today <= booking.check_out + timedelta(days=1)
    if role == "owner":
        return now < deposit_due_at(booking)
    return False


def validate_attachments(urls: list[str] | None) -> list[str]:
    """Only images we host — no arbitrary links in a channel admins act on."""
    urls = urls or []
    if len(urls) > MAX_ATTACHMENTS:
        raise DisputeError(f"Attach at most {MAX_ATTACHMENTS} photos")
    if not all(is_our_media_url(u) for u in urls):
        raise DisputeError("Photos must be uploaded through Avistay")
    return urls


def validate_reason(role: str, reason: str) -> None:
    allowed = GUEST_DISPUTE_REASONS if role == "guest" else OWNER_DISPUTE_REASONS
    if reason not in allowed:
        raise DisputeError("Choose one of the listed reasons")


async def refundable_to_guest(db: AsyncSession, booking: Booking) -> int:
    """Stay money the guest paid that hasn't already been refunded (deposit excluded)."""
    paid = await amount_paid(db, booking.id)
    refunded = (await db.execute(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(
            Payment.booking_id == booking.id,
            Payment.type == "refund",
            Payment.status != "failed",
        )
    )).scalar_one()
    deposit = booking.deposit_amount if booking.deposit_status in ("held", "refunded", "claimed") else 0
    return max(0, paid - deposit - int(refunded))


async def apply_ruling(
    db: AsyncSession, dispute: Dispute, booking: Booking, *,
    guest_refund_kes: int, owner_award_kes: int, deduct_from_owner: bool,
) -> list[Payment]:
    """Move the money a ruling decides. Caller holds locks and commits."""
    if guest_refund_kes < 0 or owner_award_kes < 0:
        raise DisputeError("Amounts cannot be negative")
    payments: list[Payment | None] = []

    if dispute.opener_role == "guest":
        if owner_award_kes:
            raise DisputeError("A guest's dispute cannot award the owner money")
        cap = await refundable_to_guest(db, booking)
        if guest_refund_kes > cap:
            raise DisputeError(f"Refund cannot exceed KES {cap:,} (what the guest paid for the stay)")
        payments.append(queue_b2c(db, booking, "refund", guest_refund_kes))
        if guest_refund_kes and deduct_from_owner:
            db.add(OwnerAdjustment(
                owner_id=await property_owner_id(db, booking), booking_id=booking.id,
                amount=-min(guest_refund_kes, owner_payout_amount(booking)), reason="dispute_refund",
            ))
    else:
        if guest_refund_kes:
            raise DisputeError("Use the guest's own dispute to refund them")
        held = booking.deposit_amount if booking.deposit_status == "held" else 0
        if owner_award_kes > held:
            raise DisputeError(f"Award cannot exceed the held deposit (KES {held:,})")
        if held:
            payments.append(queue_b2c(db, booking, "claim_payout", owner_award_kes))
            payments.append(await queue_deposit_refund(db, booking, amount=held - owner_award_kes))

    dispute.guest_refund_kes = guest_refund_kes
    dispute.owner_award_kes = owner_award_kes
    await db.flush()
    return [p for p in payments if p is not None]


def deposit_policy_note(booking: Booking) -> str | None:
    if booking.deposit_status != "held":
        return None
    return (f"Your KES {booking.deposit_amount:,} deposit is returned "
            f"{S().deposit_hold_days} days after check-out unless the host reports damage.")
