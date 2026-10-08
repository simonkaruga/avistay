"""
Booking/payment state machine. Every path that moves money or changes a
booking's payment state goes through here. The STK callback, the status
poll, the expiry reconciler, check-in and cancellation, so the safety rules
are written once:

  * Callbacks are idempotent: a payment is only ever settled once.
  * Money received is never silently kept: a payment that lands on a booking
    that is no longer pending (expired, cancelled, or already paid by an
    earlier prompt) is refunded in full automatically.
  * Payouts/refunds are created as `pending` Payment rows inside the same
    transaction as the state change, then sent by a Celery task that refuses
    to send the same row twice.

Booking:  pending ──paid──▶ confirmed ──code──▶ checked_in ──▶ completed
             │                  │
             └─expired/cancel───┴──▶ cancelled
Payment:  pending ──▶ processing (B2C sent) ──▶ completed | failed

Money timeline for a paid booking (see app/services/policy.py for the numbers):
  check-in + 24h, no open guest dispute  → owner payout (room − commission ± ledger)
  check-out + 2 days, no open damage claim → deposit refunded to guest
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit_log import log_event
from app.core.timeutil import EAT
from app.models.models import (
    Availability, Booking, Dispute, OwnerAdjustment, Payment, Property, PromoCode,
)
from app.services import policy
from app.services.settings import S
from app.workers.queue import enqueue

log = logging.getLogger(__name__)

STK_TIMEOUT_SECONDS = 90      # PIN prompt expires on the handset after ~60s
STK_QUERY_AFTER_SECONDS = 30  # give the callback a head start before polling Daraja
CARD_TIMEOUT_SECONDS = 10 * 60  # guest may be on the card page / bank's 3-D Secure screen
CARD_VERIFY_AFTER_SECONDS = 10  # webhook usually lands first; then ask Paystack


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def aware_utc(dt: datetime) -> datetime:
    # SQLite (tests) returns naive datetimes; Postgres returns aware ones.
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def hold_expires_at(booking: Booking) -> datetime:
    return aware_utc(booking.created_at) + timedelta(minutes=S().booking_hold_minutes)


def charge_in_flight(payment: Payment | None) -> bool:
    """True while the guest may still be looking at the PIN prompt / card page."""
    window = CARD_TIMEOUT_SECONDS if payment is not None and payment.method == "card" else STK_TIMEOUT_SECONDS
    return bool(
        payment
        and payment.type == "charge"
        and payment.status == "pending"
        and _utcnow() - aware_utc(payment.created_at) < timedelta(seconds=window)
    )


def card_fee(total_kes: int) -> int:
    """Card surcharge the guest pays on top of the booking total (whole KES, rounded up)."""
    pct = S().card_surcharge_pct
    return -(-total_kes * round(pct * 100) // 10_000) if pct > 0 else 0


async def card_fees_paid(db: AsyncSession, booking_id: str) -> int:
    """Card surcharges collected on this booking — refunded only when the
    cancellation isn't the guest's choice (host or NaivaStay cancels)."""
    return int((await db.execute(
        select(func.coalesce(func.sum(Payment.fee_amount), 0)).where(
            Payment.booking_id == booking_id, Payment.type == "charge", Payment.status == "completed",
        )
    )).scalar_one())


def owner_payout_amount(booking: Booking) -> int:
    """Room price minus the commission locked in at booking time. The platform
    keeps the guest fee and the tourism levy (remitted to TRA)."""
    return policy.owner_payout_amount(booking.room_amount, booking.commission_kes)


def withholding_tax(gross: int) -> int:
    """Withholding tax on a host payout (Admin → Settings), whole KES rounded down."""
    pct = S().withholding_tax_pct
    return int(gross * pct // 100) if pct > 0 and gross > 0 else 0


def host_net_payout(booking: Booking) -> int:
    """What actually reaches the host's M-Pesa for this stay (before any penalties)."""
    gross = owner_payout_amount(booking)
    return gross - withholding_tax(gross)


def _eat_midnight(d) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=EAT)


def payout_due_at(booking: Booking) -> datetime:
    """Guest's window to report a problem closes here; the owner is paid after."""
    if booking.checked_in_at:
        return aware_utc(booking.checked_in_at) + timedelta(hours=S().guest_dispute_hours)
    # Never checked in (no-show): window runs to the end of the day after check-in.
    return _eat_midnight(booking.check_in) + timedelta(days=1, hours=S().guest_dispute_hours)


def deposit_due_at(booking: Booking) -> datetime:
    """Owner's window to claim damage closes here; the deposit is returned after."""
    return _eat_midnight(booking.check_out) + timedelta(days=S().deposit_hold_days)


async def open_dispute(db: AsyncSession, booking_id: str, opener_role: str) -> Dispute | None:
    return (await db.execute(
        select(Dispute).where(
            Dispute.booking_id == booking_id,
            Dispute.opener_role == opener_role,
            Dispute.status == "open",
        )
    )).scalar_one_or_none()


async def property_owner_id(db: AsyncSession, booking: Booking) -> str:
    return (await db.execute(
        select(Property.owner_id).where(Property.id == booking.property_id)
    )).scalar_one()


async def lock_booking(db: AsyncSession, booking_id: str) -> Booking | None:
    return (await db.execute(
        select(Booking).where(Booking.id == booking_id).with_for_update()
    )).scalar_one_or_none()


async def latest_charge(db: AsyncSession, booking_id: str) -> Payment | None:
    return (await db.execute(
        select(Payment)
        .where(Payment.booking_id == booking_id, Payment.type == "charge")
        .order_by(Payment.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()


async def amount_paid(db: AsyncSession, booking_id: str) -> int:
    return int((await db.execute(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(
            Payment.booking_id == booking_id,
            Payment.type == "charge",
            Payment.status == "completed",
        )
    )).scalar_one())


async def release_booking_dates(db: AsyncSession, booking: Booking, *, release_promo: bool) -> None:
    await db.execute(delete(Availability).where(Availability.booking_id == booking.id))
    if release_promo and booking.promo_code_id:
        await db.execute(
            update(PromoCode)
            .where(PromoCode.id == booking.promo_code_id, PromoCode.used_count > 0)
            .values(used_count=PromoCode.used_count - 1)
        )


async def apply_charge_result(
    db: AsyncSession,
    payment: Payment,
    *,
    success: bool,
    receipt: str | None = None,
    amount: int | None = None,
    currency: str | None = None,
    source: str,
) -> None:
    """Settle a charge (M-Pesa STK or card). Idempotent; safe to call from
    callback/webhook, poll and reconciler concurrently (the payment row is
    re-read under a row lock). `amount` is the gross the provider says it
    took — booking money plus any card surcharge. Commits."""
    payment = (await db.execute(
        select(Payment).where(Payment.id == payment.id).with_for_update()
    )).scalar_one()

    if payment.status == "completed":
        # Duplicate callback, or the callback arriving after the reconciler
        # already settled it via STK query — just backfill the receipt.
        if receipt and not payment.mpesa_ref:
            payment.mpesa_ref = receipt
            booking = await lock_booking(db, payment.booking_id)
            if booking and not booking.mpesa_ref:
                booking.mpesa_ref = receipt
            await db.commit()
        else:
            await db.rollback()
        return

    if not success:
        if payment.status == "pending":
            payment.status = "failed"
            await log_event(db, "payment_failed", payment.booking_id, None, {"source": source})
        else:
            await db.rollback()
        return

    # Success. Note: a payment we marked `failed` (e.g. STK query said timeout)
    # can still succeed later — the guest's money is gone either way, so honour it.
    gross = payment.amount + (payment.fee_amount or 0)
    wrong_currency = currency is not None and currency.upper() != "KES"
    if (amount is not None and int(amount) != gross) or wrong_currency:
        log.error("%s amount mismatch on payment %s: expected KES %s got %s %s",
                  payment.method, payment.id, gross, currency or "KES", amount)
        await log_event(db, "payment_amount_mismatch", payment.booking_id, None,
                        {"payment_id": payment.id, "expected": gross, "received": amount, "currency": currency,
                         "receipt": receipt, "source": source})
        return  # left pending for manual review. Never auto-confirm on a mismatch

    booking = await lock_booking(db, payment.booking_id)
    if booking is None:   # can't happen (foreign key), but never mark money settled without one
        log.error("Payment %s has no booking", payment.id)
        await db.rollback()
        return
    payment.status = "completed"
    payment.mpesa_ref = receipt

    if booking.status == "pending":
        booking.status = "confirmed"
        booking.mpesa_ref = receipt
        if booking.deposit_amount > 0:
            booking.deposit_status = "held"
        await log_event(db, "payment_received", booking.id, booking.guest_id,
                        {"ref": receipt, "method": payment.method, "amount": payment.amount,
                         "card_fee": payment.fee_amount or 0, "source": source})
        await _after_confirmed(booking)
        return

    # Paid for a booking that is no longer payable → full refund of this
    # payment, card surcharge included (the guest did nothing wrong).
    refund = Payment(booking_id=booking.id, amount=gross, type="refund", status="pending",
                     method=payment.method, refund_of=payment.id)
    db.add(refund)
    await db.flush()
    await log_event(db, "late_payment_refund", booking.id, booking.guest_id,
                    {"charge_id": payment.id, "booking_status": booking.status,
                     "amount": gross, "source": source})
    dispatch_b2c(refund)


apply_stk_result = apply_charge_result   # M-Pesa callers


async def _after_confirmed(booking: Booking) -> None:
    from app.api.ws import broadcast_booking
    from app.workers.tasks import send_booking_notifications

    try:
        await broadcast_booking(booking.property_id, booking.check_in.isoformat(), booking.check_out.isoformat())
    except Exception:  # live calendar refresh is best-effort
        log.exception("broadcast_booking failed for %s", booking.id)
    enqueue(send_booking_notifications, booking.id)


def queue_b2c(db: AsyncSession, booking: Booking, type_: str, amount: int) -> Payment | None:
    """Add a pending B2C row (caller flushes/commits, then dispatch_b2c)."""
    if amount <= 0:
        return None
    payment = Payment(booking_id=booking.id, amount=amount, type=type_, status="pending")
    db.add(payment)
    return payment


async def queue_payout(db: AsyncSession, booking: Booking, amount: int | None = None) -> Payment | None:
    """Create the owner payout row, netting any outstanding ledger adjustments
    (penalties, clawbacks) for this owner. Caller holds the booking lock and
    commits. Returns None if a payout already exists or nothing is owed."""
    existing = (await db.execute(
        select(Payment.id).where(
            Payment.booking_id == booking.id,
            Payment.type == "payout",
            Payment.status != "failed",
        )
    )).first()
    if existing or await amount_paid(db, booking.id) <= 0:
        return None

    gross = owner_payout_amount(booking) if amount is None else amount
    tax = withholding_tax(gross)
    owner_id = await property_owner_id(db, booking)
    adjustments = (await db.execute(
        select(OwnerAdjustment).where(
            OwnerAdjustment.owner_id == owner_id,
            OwnerAdjustment.applied_payment_id.is_(None),
        ).with_for_update()
    )).scalars().all()
    net = gross - tax + sum(a.amount for a in adjustments)

    payout = Payment(booking_id=booking.id, amount=max(net, 0), type="payout", tax_withheld=tax,
                     status="pending" if net > 0 else "completed")
    db.add(payout)
    await db.flush()
    for a in adjustments:
        a.applied_payment_id = payout.id
    if net < 0:
        # Deduction bigger than this payout — carry the rest to the next one.
        db.add(OwnerAdjustment(owner_id=owner_id, booking_id=booking.id, amount=net,
                               reason="carried_forward", applied_payment_id=None))
    return payout if net > 0 else None


async def queue_deposit_refund(db: AsyncSession, booking: Booking, amount: int | None = None) -> Payment | None:
    """Return the held deposit (or what is left of it after a damage award)."""
    if booking.deposit_status != "held":
        return None
    booking.deposit_status = "refunded" if amount is None else "claimed"
    refund = queue_b2c(db, booking, "deposit_refund", booking.deposit_amount if amount is None else amount)
    if refund:
        await db.flush()
    return refund


def dispatch_b2c(*payments: Payment | None) -> None:
    """Call AFTER commit so the worker can see the rows."""
    from app.workers.tasks import send_b2c_payment
    for payment in payments:
        if payment is not None and payment.status == "pending":
            enqueue(send_b2c_payment, payment.id)


async def expire_if_unpaid(db: AsyncSession, booking: Booking, reason: str) -> bool:
    """Cancel a pending booking whose hold has lapsed and free its dates.
    Caller holds the booking lock. Returns True if cancelled. Commits."""
    if booking.status != "pending":
        return False
    booking.status = "cancelled"
    await release_booking_dates(db, booking, release_promo=True)
    await log_event(db, "booking_auto_cancelled", booking.id, None, {"reason": reason})
    return True
