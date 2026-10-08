import hmac
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit_log import log_event
from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user, rate_limit
from app.core.redis import redis
from app.models.models import Booking, Payment, User
from app.services import mpesa, paystack
from app.services.agents import mark_commission_paid
from app.services.payments import (
    CARD_VERIFY_AFTER_SECONDS,
    STK_QUERY_AFTER_SECONDS,
    aware_utc,
    apply_charge_result,
    apply_stk_result,
    card_fee,
    charge_in_flight,
    hold_expires_at,
    latest_charge,
    lock_booking,
)
from app.services.settings import refresh as refresh_settings

log = logging.getLogger(__name__)
router = APIRouter(tags=["payments"])

ACCEPTED = {"ResultCode": 0, "ResultDesc": "Accepted"}


class STKRequest(BaseModel):
    booking_id: str
    phone: str | None = None  # pay from a different line than the account phone


def _check_callback_secret(secret: str) -> None:
    expected = settings.MPESA_CALLBACK_SECRET
    if not expected or not hmac.compare_digest(secret.encode(), expected.encode()):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)


# ── Guest-facing ──────────────────────────────────────────────────────────────

@router.post("/mpesa/stk-push", status_code=status.HTTP_202_ACCEPTED)
async def initiate_stk_push(
    body: STKRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await rate_limit(f"stk:{user.id}", limit=10, window=3600)

    booking = await lock_booking(db, body.booking_id)
    if not booking or booking.guest_id != user.id:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status != "pending":
        raise HTTPException(status_code=409, detail="This booking is no longer awaiting payment")
    if datetime.now(timezone.utc) >= hold_expires_at(booking):
        raise HTTPException(status_code=410, detail="Your booking hold expired. Please book again")

    # One PIN prompt at a time per booking. Two live prompts = two charges.
    # (An unfinished card page doesn't block switching to M-Pesa: if both
    # somehow succeed, the second payment is refunded automatically.)
    last = await latest_charge(db, booking.id)
    if last is not None and last.method == "mpesa" and charge_in_flight(last):
        raise HTTPException(status_code=409, detail="A payment request is already on your phone. Check it or wait a minute")

    try:
        phone = mpesa.normalize_msisdn(body.phone or user.phone)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    if not settings.MPESA_CONSUMER_KEY:
        log.warning("[DEV] Would send STK Push to %s for KES %s", phone, booking.total_amount)
        return {"message": "dev_mode_stk_skipped", "booking_id": booking.id}

    try:
        checkout_id = await mpesa.stk_push(
            phone=phone,
            amount_kes=booking.total_amount,
            account_ref=f"AV-{booking.id[:8].upper()}",
        )
    except mpesa.MpesaError as exc:
        log.error("STK push failed for booking %s: %s", booking.id, exc)
        raise HTTPException(status_code=502, detail="M-Pesa is not responding. Please try again in a moment")

    db.add(Payment(
        booking_id=booking.id,
        amount=booking.total_amount,
        type="charge",
        status="pending",
        provider_request_id=checkout_id,
    ))
    await log_event(db, "stk_push_sent", booking.id, user.id, {"checkout_request_id": checkout_id})
    return {"booking_id": booking.id, "hold_expires_at": hold_expires_at(booking).isoformat()}


class CardRequest(BaseModel):
    booking_id: str
    email: EmailStr | None = None   # Paystack sends the receipt here; needed if the account has none


@router.post("/card/initialize", status_code=status.HTTP_201_CREATED)
async def initialize_card_payment(
    body: CardRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Start a card payment on Paystack's hosted page. The guest pays the
    booking total plus the card surcharge; card details never reach us."""
    if not paystack.enabled():
        raise HTTPException(status_code=503, detail="Card payments aren't available yet. Please pay with M-Pesa")
    await rate_limit(f"card:{user.id}", limit=10, window=3600)
    await refresh_settings(db)

    booking = await lock_booking(db, body.booking_id)
    if not booking or booking.guest_id != user.id:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status != "pending":
        raise HTTPException(status_code=409, detail="This booking is no longer awaiting payment")
    if datetime.now(timezone.utc) >= hold_expires_at(booking):
        raise HTTPException(status_code=410, detail="Your booking hold expired. Please book again")
    last = await latest_charge(db, booking.id)
    if last is not None and last.method == "mpesa" and charge_in_flight(last):
        raise HTTPException(status_code=409, detail="An M-Pesa request is already on your phone. Finish or cancel it first")

    email = body.email or user.email
    if not email:
        raise HTTPException(status_code=422, detail="Add an email address for your card receipt")

    fee = card_fee(booking.total_amount)
    payment = Payment(booking_id=booking.id, amount=booking.total_amount, fee_amount=fee,
                      type="charge", status="pending", method="card")
    db.add(payment)
    await db.flush()
    reference = f"NSC-{payment.id}"
    payment.provider_request_id = reference
    try:
        url = await paystack.initialize(
            reference=reference, amount_kes=booking.total_amount + fee, email=str(email),
            callback_url=f"{settings.FRONTEND_URL}/booking-confirm/{booking.id}?method=card",
            metadata={"booking_id": booking.id, "card_fee_kes": fee},
        )
    except paystack.PaystackError as exc:
        await db.rollback()
        log.error("Paystack initialize failed for booking %s: %s", booking.id, exc)
        raise HTTPException(status_code=502, detail="Card payments are not responding. Try again or pay with M-Pesa")
    await log_event(db, "card_checkout_started", booking.id, user.id,
                    {"reference": reference, "amount": booking.total_amount, "card_fee": fee})
    return {"booking_id": booking.id, "authorization_url": url, "amount": booking.total_amount,
            "card_fee": fee, "hold_expires_at": hold_expires_at(booking).isoformat()}


@router.get("/status/{booking_id}")
@router.get("/mpesa/status/{booking_id}")
async def booking_payment_status(
    booking_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Frontend polls this every 3s. If the callback/webhook is late we ask
    Daraja or Paystack directly, so a lost notification never leaves a paying
    guest stuck on 'waiting'."""
    booking = (await db.execute(
        select(Booking).where(Booking.id == booking_id, Booking.guest_id == user.id)
    )).scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    charge = await latest_charge(db, booking.id)
    if (
        booking.status == "pending"
        and charge is not None
        and charge.status == "pending"
        and charge.method == "card"
        and paystack.enabled()
        and datetime.now(timezone.utc) - aware_utc(charge.created_at) > timedelta(seconds=CARD_VERIFY_AFTER_SECONDS)
        and await _query_slot_free(charge.id)
    ):
        try:
            await settle_card_from_paystack(db, charge, source="status_poll")
        except paystack.PaystackError as exc:
            log.warning("Paystack verify failed for %s: %s", charge.id, exc)
        await db.refresh(booking)
        await db.refresh(charge)
    elif (
        booking.status == "pending"
        and charge is not None
        and charge.status == "pending"
        and charge.method == "mpesa"
        and settings.MPESA_CONSUMER_KEY
        and datetime.now(timezone.utc) - aware_utc(charge.created_at) > timedelta(seconds=STK_QUERY_AFTER_SECONDS)
        and charge.provider_request_id
        and await _query_slot_free(charge.id)
    ):
        result = await mpesa.stk_query(charge.provider_request_id)
        if result.state != "pending":
            await apply_stk_result(db, charge, success=result.state == "success", source="status_poll")
            await db.refresh(booking)
            await db.refresh(charge)

    return {
        "booking_id": booking.id,
        "status": booking.status,
        "mpesa_ref": booking.mpesa_ref,
        "method": charge.method if charge else None,
        "payment_state": _payment_state(booking, charge),
        "hold_expires_at": hold_expires_at(booking).isoformat(),
    }


def _payment_state(booking: Booking, charge: Payment | None) -> str:
    """What the confirm screen should show: awaiting | paid | failed | expired | none."""
    if booking.status in ("confirmed", "checked_in", "completed"):
        return "paid"
    if booking.status == "cancelled" or datetime.now(timezone.utc) >= hold_expires_at(booking):
        return "expired"
    if charge is None:
        return "none"
    if charge.status == "failed":
        return "failed"
    return "awaiting"


async def settle_card_from_paystack(db: AsyncSession, charge: Payment, *, source: str) -> str:
    """Ask Paystack what happened to a card charge and apply it. Returns the state."""
    if not charge.provider_request_id:
        return "pending"
    result = await paystack.verify(charge.provider_request_id)
    if result.state != "pending":
        await apply_charge_result(db, charge, success=result.state == "success",
                                  receipt=charge.provider_request_id, amount=result.amount_kes,
                                  currency=result.currency, source=f"{source}:{result.gateway_status}")
    return result.state


async def _query_slot_free(payment_id: str) -> bool:
    """At most one Daraja STK query per payment per 10s across all pollers."""
    try:
        return bool(await redis.set(f"stkq:{payment_id}", 1, ex=10, nx=True))
    except Exception:
        return True


# ── Safaricom callbacks ───────────────────────────────────────────────────────
# Safaricom does not sign callbacks. They are authenticated by the secret path
# segment, then matched on CheckoutRequestID / ConversationID (only we and
# Safaricom know the pairing with our secret URL), then amount-checked.
# The previous X-Forwarded-For IP allowlist is removed: the first XFF value is
# client-controlled and trivially spoofable. Always return 200 to Safaricom for
# well-formed requests so it stops retrying; errors are logged instead.

@router.post("/mpesa/callback/{secret}", status_code=status.HTTP_200_OK)
async def mpesa_callback(secret: str, request: Request, db: AsyncSession = Depends(get_db)):
    _check_callback_secret(secret)
    try:
        payload = await request.json()
        cb = payload["Body"]["stkCallback"]
        checkout_id = cb["CheckoutRequestID"]
        result_code = int(cb["ResultCode"])
    except (ValueError, KeyError, TypeError):
        log.warning("Malformed STK callback")
        return ACCEPTED

    items = {i.get("Name"): i.get("Value") for i in cb.get("CallbackMetadata", {}).get("Item", [])}

    payment = (await db.execute(
        select(Payment).where(Payment.provider_request_id == checkout_id, Payment.type == "charge")
    )).scalar_one_or_none()
    if not payment:
        log.error("STK callback for unknown CheckoutRequestID %s", checkout_id)
        return ACCEPTED

    await apply_stk_result(
        db, payment,
        success=result_code == 0,
        receipt=items.get("MpesaReceiptNumber"),
        amount=items.get("Amount"),
        source=f"callback:{result_code}",
    )
    return ACCEPTED


@router.post("/mpesa/callback/{secret}/b2c/result", status_code=status.HTTP_200_OK)
async def b2c_result(secret: str, request: Request, db: AsyncSession = Depends(get_db)):
    _check_callback_secret(secret)
    try:
        result = (await request.json())["Result"]
        conversation_id = result["ConversationID"]
        result_code = int(result["ResultCode"])
    except (ValueError, KeyError, TypeError):
        log.warning("Malformed B2C result")
        return ACCEPTED

    payment = (await db.execute(
        select(Payment).where(Payment.provider_request_id == conversation_id).with_for_update()
    )).scalar_one_or_none()
    if not payment or payment.status in ("completed", "failed"):
        await db.rollback()
        return ACCEPTED

    payment.status = "completed" if result_code == 0 else "failed"
    payment.mpesa_ref = result.get("TransactionID") or payment.mpesa_ref
    if payment.status == "completed" and payment.type == "agent_commission":
        await mark_commission_paid(db, payment)
    if result_code != 0:
        log.error("B2C %s %s failed: %s", payment.type, payment.id, result.get("ResultDesc"))
    await log_event(db, f"b2c_{payment.type}_{payment.status}", payment.booking_id, None,
                    {"payment_id": payment.id, "result_code": result_code, "desc": result.get("ResultDesc")})
    return ACCEPTED


@router.post("/mpesa/callback/{secret}/b2c/timeout", status_code=status.HTTP_200_OK)
async def b2c_timeout(secret: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Request timed out in Safaricom's queue — it was not executed."""
    _check_callback_secret(secret)
    try:
        conversation_id = (await request.json())["Result"]["ConversationID"]
    except (ValueError, KeyError, TypeError):
        return ACCEPTED
    payment = (await db.execute(
        select(Payment).where(Payment.provider_request_id == conversation_id).with_for_update()
    )).scalar_one_or_none()
    if payment and payment.status == "processing":
        payment.status = "failed"
        log.error("B2C %s %s timed out in Safaricom queue", payment.type, payment.id)
        await log_event(db, f"b2c_{payment.type}_timeout", payment.booking_id, None, {"payment_id": payment.id})
    return ACCEPTED


# ── Paystack webhook ──────────────────────────────────────────────────────────
# Signed with HMAC-SHA512 of the raw body using our secret key, so unlike
# Safaricom's callbacks it can be verified. Amount and currency are still
# checked against what we asked for before a booking is confirmed.

@router.post("/paystack/webhook", status_code=status.HTTP_200_OK)
async def paystack_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    raw = await request.body()
    if not paystack.valid_signature(raw, request.headers.get("x-paystack-signature")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    try:
        payload = await request.json()
        event = str(payload["event"])
        data = payload.get("data") or {}
    except (ValueError, KeyError, TypeError):
        log.warning("Malformed Paystack webhook")
        return {"ok": True}

    if event == "charge.success":
        reference = str(data.get("reference") or "")
        payment = (await db.execute(
            select(Payment).where(Payment.provider_request_id == reference, Payment.type == "charge")
        )).scalar_one_or_none()
        if not payment:
            log.error("Paystack charge.success for unknown reference %s", reference)
            return {"ok": True}
        result = paystack.charge_from_webhook(data)
        await apply_charge_result(db, payment, success=result.state == "success", receipt=reference,
                                  amount=result.amount_kes, currency=result.currency,
                                  source=f"webhook:{result.gateway_status}")

    elif event.startswith("refund."):
        refund_id = str(data.get("id") or "")
        payment = (await db.execute(
            select(Payment).where(Payment.provider_request_id == f"psr_{refund_id}").with_for_update()
        )).scalar_one_or_none()
        if payment and payment.status == "processing":
            new = paystack.refund_state(str(data.get("status") or event.removeprefix("refund.")))
            if new != "processing":
                payment.status = new
                await log_event(db, f"card_{payment.type}_{new}", payment.booking_id, None,
                                {"payment_id": payment.id, "refund_id": refund_id})
        else:
            await db.rollback()
    return {"ok": True}
