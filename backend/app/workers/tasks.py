import asyncio
from app.workers.celery_app import celery


# ── Booking notifications ─────────────────────────────────────────────────────

@celery.task(bind=True, max_retries=3)
def send_booking_notifications(self, booking_id: str) -> None:
    """Fire SMS to guest + owner after payment confirmed. Retries 3× on failure."""
    try:
        asyncio.run(_send_booking_notifications_async(booking_id))
    except Exception as exc:
        raise self.retry(exc=exc, countdown=30)


async def _send_booking_notifications_async(booking_id: str) -> None:
    from app.services.settings import S, refresh as refresh_settings
    from sqlalchemy import select
    from app.core.database import AsyncSessionLocal
    from app.models.models import Booking, Property, User

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Booking).where(Booking.id == booking_id)
        )
        booking = result.scalar_one_or_none()
        if not booking:
            return
        await refresh_settings(db, force=True)   # the worker is its own process

        prop_result = await db.execute(select(Property).where(Property.id == booking.property_id))
        prop = prop_result.scalar_one_or_none()

        guest_result = await db.execute(select(User).where(User.id == booking.guest_id))
        guest = guest_result.scalar_one_or_none()

        owner = (await db.execute(select(User).where(User.id == prop.owner_id))).scalar_one_or_none() if prop else None

        if guest and prop:
            sms = (
                f"Booking confirmed! {prop.title}. "
                f"Check-in: {booking.check_in}. Code: {booking.checkin_code}. "
                f"Ref: {booking.mpesa_ref}"
            )
            wa = (
                f"✅ *Booking Confirmed!*\n\n"
                f"🏡 *{prop.title}*\n"
                f"📅 Check-in:  {booking.check_in}\n"
                f"📅 Check-out: {booking.check_out}\n"
                f"💰 Paid: KES {booking.total_amount:,}\n\n"
                f"🔐 *Check-in Code: {booking.checkin_code}*\n"
                f"Show this to the owner on arrival.\n\n"
                f"NaivaStay only pays the host {S().guest_dispute_hours}h after you check in. Report any problem in the app.\n"
                + (f"Your KES {booking.deposit_amount:,} deposit comes back {S().deposit_hold_days} day(s) after check-out.\n"
                   if booking.deposit_status == "held" else "")
                + "NaivaStay 🌿"
            )
            await _notify(guest, sms, wa)

        if owner and prop:
            nights = (booking.check_out - booking.check_in).days
            from app.services.payments import host_net_payout
            payout = host_net_payout(booking)
            who = f"{guest.name or 'Guest'}, {guest.phone or 'no phone'}" if guest else "Guest"
            sms = (
                f"New booking! {prop.title}. "
                f"{booking.check_in} to {booking.check_out} ({nights} nights), {booking.guests} guest(s): {who}. "
                f"KES {payout:,} paid to you {S().guest_dispute_hours}h after check-in."
            )
            wa = (
                f"🎉 *New Booking!*\n\n"
                f"🏡 *{prop.title}*\n"
                f"📅 {booking.check_in} → {booking.check_out} ({nights} night{'s' if nights != 1 else ''})\n"
                f"👤 {who} · {booking.guests} guest(s)\n"
                f"💵 Your payout: *KES {payout:,}*\n\n"
                f"Sent to your M-Pesa {S().guest_dispute_hours}h after the guest checks in.\n"
                f"Log in to your dashboard to manage this booking.\n"
                f"NaivaStay Host 🌿"
            )
            await _notify(owner, sms, wa)


# ── M-Pesa B2C (owner payouts + guest refunds) ───────────────────────────────

B2C_TYPES = {   # type -> M-Pesa remarks prefix
    "payout": "Payout",
    "claim_payout": "Damage award",
    "refund": "Refund",
    "deposit_refund": "Deposit refund",
    "agent_commission": "Agent commission",
}
OWNER_B2C_TYPES = ("payout", "claim_payout")
GUEST_B2C_TYPES = ("refund", "deposit_refund")   # guest money: goes back the way it came (card or M-Pesa)

@celery.task(bind=True, max_retries=3)
def send_b2c_payment(self, payment_id: str) -> None:
    """Send one payout/refund Payment row via M-Pesa B2C — at most once.

    Retrying is safe: the row is moved to `processing` and committed BEFORE the
    request goes out, so a retry (or a duplicate task) sees it and stops.
    """
    try:
        asyncio.run(_send_b2c_async(payment_id))
    except Exception as exc:
        raise self.retry(exc=exc, countdown=60)


async def _send_b2c_async(payment_id: str) -> None:
    import logging
    from sqlalchemy import select
    from app.core.database import AsyncSessionLocal
    from app.core.config import settings
    from app.core.audit_log import log_event
    from app.models.models import Booking, Property, User, Payment
    from app.services import mpesa

    log = logging.getLogger(__name__)

    async with AsyncSessionLocal() as db:
        payment = (await db.execute(
            select(Payment).where(Payment.id == payment_id).with_for_update()
        )).scalar_one_or_none()
        if not payment or payment.status != "pending" or payment.type not in B2C_TYPES:
            return  # already sent, settled, or not a B2C row

        booking = (await db.execute(select(Booking).where(Booking.id == payment.booking_id))).scalar_one()

        # Guest money goes back the way it came: card payments → the card.
        if payment.type in GUEST_B2C_TYPES:
            charge = await _original_charge(db, booking, payment)
            if charge is not None and charge.method == "card":
                await _send_card_refund(db, booking, payment, charge)
                return

        recipient_id: str | None
        if payment.type in OWNER_B2C_TYPES:
            prop = (await db.execute(select(Property).where(Property.id == booking.property_id))).scalar_one()
            recipient_id = prop.owner_id
        elif payment.type == "agent_commission":
            from app.models.models import Agent
            agent = await db.get(Agent, booking.agent_id) if booking.agent_id else None
            recipient_id = agent.user_id if agent else None
        else:
            recipient_id = booking.guest_id
        recipient = await db.get(User, recipient_id) if recipient_id else None

        try:
            phone = mpesa.normalize_msisdn(recipient.phone if recipient else None)
        except ValueError:
            payment.status = "failed"
            await log_event(db, f"b2c_{payment.type}_failed", booking.id, None,
                            {"payment_id": payment.id, "reason": "recipient has no valid M-Pesa number"})
            log.error("B2C %s %s: recipient %s has no valid phone", payment.type, payment.id, recipient_id)
            return

        if not settings.MPESA_CONSUMER_KEY:
            log.warning("[DEV] Would send B2C %s KES %s to %s", payment.type, payment.amount, phone)
            if payment.type in GUEST_B2C_TYPES:
                await _send_sms(phone, f"Your refund of KES {payment.amount:,} is being processed.")
            return

        payment.status = "processing"
        await db.commit()

        remarks = f"{B2C_TYPES[payment.type]} booking {booking.id[:8]}"
        try:
            conversation_id = await mpesa.b2c_payment(phone, payment.amount, remarks)
        except mpesa.MpesaError as exc:
            if exc.ambiguous:
                # May have been sent. Leave `processing` — a human must check the
                # M-Pesa org portal before retrying, or we risk paying twice.
                log.error("B2C %s %s AMBIGUOUS — reconcile manually: %s", payment.type, payment.id, exc)
                await log_event(db, f"b2c_{payment.type}_ambiguous", booking.id, None,
                                {"payment_id": payment.id, "error": str(exc)[:500]})
                return
            payment.status = "failed"
            log.error("B2C %s %s rejected: %s", payment.type, payment.id, exc)
            await log_event(db, f"b2c_{payment.type}_failed", booking.id, None,
                            {"payment_id": payment.id, "error": str(exc)[:500]})
            return

        payment.provider_request_id = conversation_id
        await log_event(db, f"b2c_{payment.type}_sent", booking.id, None,
                        {"payment_id": payment.id, "amount": payment.amount, "phone": phone})

        if payment.type in GUEST_B2C_TYPES:
            what = "deposit" if payment.type == "deposit_refund" else "refund"
            await _send_sms(phone, f"Your NaivaStay {what} of KES {payment.amount:,} has been sent to M-Pesa.")
        elif payment.type == "agent_commission":
            await _send_sms(phone, f"NaivaStay agent commission of KES {payment.amount:,} sent to your M-Pesa "
                                   f"(booking {booking.id[:8].upper()}).")
        else:
            await _send_sms(phone, f"NaivaStay payout of KES {payment.amount:,} sent to your M-Pesa "
                                   f"(booking {booking.check_in} to {booking.check_out}).")


async def _original_charge(db, booking, refund):
    """The guest payment a refund belongs to: the one it names, else the one
    that confirmed the booking, else the earliest completed charge."""
    from sqlalchemy import select
    from app.models.models import Payment

    if refund.refund_of:
        return await db.get(Payment, refund.refund_of)
    charges = (await db.execute(
        select(Payment).where(Payment.booking_id == booking.id, Payment.type == "charge",
                              Payment.status == "completed").order_by(Payment.created_at)
    )).scalars().all()
    return next((c for c in charges if booking.mpesa_ref and c.mpesa_ref == booking.mpesa_ref), charges[0] if charges else None)


async def _send_card_refund(db, booking, payment, charge) -> None:
    """Refund to the guest's card via Paystack. Same at-most-once rule as B2C:
    mark `processing` and commit before calling out."""
    import logging
    from app.core.audit_log import log_event
    from app.models.models import User
    from app.services import paystack

    log = logging.getLogger(__name__)
    payment.method = "card"
    if not paystack.enabled():
        log.warning("[DEV] Would refund KES %s to card %s", payment.amount, charge.provider_request_id)
        await db.commit()
        return

    payment.status = "processing"
    await db.commit()
    what = "Deposit return" if payment.type == "deposit_refund" else "Refund"
    try:
        refund_id, status = await paystack.refund(reference=charge.provider_request_id, amount_kes=payment.amount,
                                                  note=f"{what} booking {booking.id[:8].upper()}")
    except paystack.PaystackError as exc:
        if exc.ambiguous:
            log.error("Card %s %s AMBIGUOUS — check the Paystack dashboard: %s", payment.type, payment.id, exc)
            await log_event(db, f"card_{payment.type}_ambiguous", booking.id, None,
                            {"payment_id": payment.id, "error": str(exc)[:500]})
            return
        payment.status = "failed"
        log.error("Card %s %s rejected: %s", payment.type, payment.id, exc)
        await log_event(db, f"card_{payment.type}_failed", booking.id, None,
                        {"payment_id": payment.id, "error": str(exc)[:500]})
        return

    payment.provider_request_id = f"psr_{refund_id}"
    payment.status = paystack.refund_state(status)
    await log_event(db, f"card_{payment.type}_sent", booking.id, None,
                    {"payment_id": payment.id, "amount": payment.amount, "refund_id": refund_id})
    guest = await db.get(User, booking.guest_id)
    if guest and guest.phone:
        await _send_sms(guest.phone, f"NaivaStay: your {what.lower()} of KES {payment.amount:,} is on its way back "
                                     f"to your card. Banks usually show it within 5-10 working days.")


async def _sync_card_refunds(db) -> None:
    """Backstop for missed refund webhooks: ask Paystack about card refunds
    still processing after 10 minutes."""
    from datetime import datetime, timedelta, timezone
    from sqlalchemy import select
    from app.core.audit_log import log_event
    from app.models.models import Payment
    from app.services import paystack

    if not paystack.enabled():
        return
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
    rows = (await db.execute(select(Payment).where(
        Payment.method == "card", Payment.type != "charge", Payment.status == "processing",
        Payment.provider_request_id.like("psr_%"), Payment.created_at <= cutoff,
    ))).scalars().all()
    for p in rows:
        try:
            new = paystack.refund_state(await paystack.fetch_refund(p.provider_request_id.removeprefix("psr_")))
        except paystack.PaystackError:
            continue
        if new != "processing":
            p.status = new
            await log_event(db, f"card_{p.type}_{new}", p.booking_id, None, {"payment_id": p.id, "source": "sync"})


# ── Unpaid booking expiry + lost-callback reconciliation ─────────────────────

@celery.task
def expire_unpaid_bookings() -> None:
    """Every 5 min: settle M-Pesa/card payments whose notification never
    arrived (STK query / Paystack verify), then cancel pending bookings past
    their hold so the dates reopen. Also syncs card refunds still processing."""
    asyncio.run(_expire_unpaid_async())


async def _expire_unpaid_async() -> None:
    from datetime import datetime, timedelta, timezone
    from sqlalchemy import select
    from app.core.database import AsyncSessionLocal
    from app.core.config import settings
    from app.models.models import Booking, Payment
    from app.services import mpesa, paystack
    from app.api.payments import settle_card_from_paystack
    from app.services.payments import (
        apply_stk_result, charge_in_flight, expire_if_unpaid, lock_booking,
    )
    from app.services.settings import S, refresh as refresh_settings

    async with AsyncSessionLocal() as db:
        await refresh_settings(db, force=True)
        await _sync_card_refunds(db)
        await db.commit()
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=S().booking_hold_minutes)
    async with AsyncSessionLocal() as db:
        ids = (await db.execute(
            select(Booking.id).where(Booking.status == "pending", Booking.created_at <= cutoff)
        )).scalars().all()

    for booking_id in ids:
        async with AsyncSessionLocal() as db:
            charges = (await db.execute(
                select(Payment).where(
                    Payment.booking_id == booking_id,
                    Payment.type == "charge",
                    Payment.status == "pending",
                )
            )).scalars().all()
            if any(charge_in_flight(c) for c in charges):
                continue  # guest is entering their PIN right now. Next run
            for c in charges:
                if c.method == "card":
                    if paystack.enabled():
                        try:
                            await settle_card_from_paystack(db, c, source="reconciler")
                        except paystack.PaystackError:
                            pass
                elif settings.MPESA_CONSUMER_KEY and c.provider_request_id:
                    result = await mpesa.stk_query(c.provider_request_id)
                    if result.state != "pending":
                        await apply_stk_result(db, c, success=result.state == "success", source="reconciler")
            # If still unsettled, cancel anyway: a success callback arriving later
            # is auto-refunded by apply_stk_result, so the guest is never charged
            # for dates we released.
            booking = await lock_booking(db, booking_id)
            if booking and not await expire_if_unpaid(db, booking, reason="payment_timeout"):
                await db.rollback()


# ── Escrow release: payouts 24h after check-in, deposits 2 days after check-out ──

@celery.task
def release_due_payouts() -> None:
    asyncio.run(_release_due_async())


async def _release_due_async() -> None:
    from datetime import datetime, timezone
    from sqlalchemy import select
    from app.core.database import AsyncSessionLocal
    from app.core.audit_log import log_event
    from app.core.timeutil import today_eat
    from app.models.models import Booking
    from app.services.agents import pending_referral, queue_agent_commission
    from app.services.payments import (
        deposit_due_at, dispatch_b2c, lock_booking, open_dispute, payout_due_at,
        queue_deposit_refund, queue_payout,
    )

    from app.services.settings import refresh as refresh_settings

    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        await refresh_settings(db, force=True)   # payout/deposit windows are settings
        candidates = (await db.execute(
            select(Booking.id).where(
                Booking.status.in_(["confirmed", "checked_in", "completed"]),
                Booking.check_in <= today_eat(),
            )
        )).scalars().all()

    for booking_id in candidates:
        async with AsyncSessionLocal() as db:
            booking = await lock_booking(db, booking_id)
            if booking is None or booking.status == "cancelled":
                continue
            sent = []
            if now >= payout_due_at(booking) and not await open_dispute(db, booking.id, "guest"):
                payout = await queue_payout(db, booking)
                if payout:
                    sent.append(payout)
                # The agent is paid when the host is (and never for cancelled/disputed stays).
                commission = queue_agent_commission(db, booking, await pending_referral(db, booking))
                if commission:
                    await db.flush()
                    sent.append(commission)
            if now >= deposit_due_at(booking) and not await open_dispute(db, booking.id, "owner"):
                refund = await queue_deposit_refund(db, booking)
                if refund:
                    sent.append(refund)
            if sent:
                await log_event(db, "escrow_released", booking.id, None,
                                {"payments": [{"id": p.id, "type": p.type, "amount": p.amount} for p in sent]})
                dispatch_b2c(*sent)
            else:
                await db.commit()  # persists deposit_status change on a zero-amount refund, releases lock

    # Safety net: payouts/refunds created but never handed to the worker (e.g.
    # Redis was down at that moment). send_b2c_payment only sends rows that are
    # still `pending` and locks them first, so re-queuing can never pay twice.
    from datetime import timedelta
    from app.models.models import Payment
    async with AsyncSessionLocal() as db:
        stuck = (await db.execute(select(Payment.id).where(
            Payment.type != "charge", Payment.status == "pending",
            Payment.created_at <= now - timedelta(minutes=10),
        ))).scalars().all()
    for payment_id in stuck:
        send_b2c_payment.delay(payment_id)


# ── New message notifications ─────────────────────────────────────────────────

@celery.task(bind=True, max_retries=2)
def notify_new_message(self, booking_id: str, recipient_id: str, sender_role: str) -> None:
    try:
        asyncio.run(_notify_new_message_async(booking_id, recipient_id, sender_role))
    except Exception as exc:
        raise self.retry(exc=exc, countdown=60)


async def _notify_new_message_async(booking_id: str, recipient_id: str, sender_role: str) -> None:
    from app.core.config import settings
    from app.core.database import AsyncSessionLocal
    from app.models.models import Booking, Property, User
    # One alert per conversation per 30 minutes: a chat shouldn't become an SMS storm.
    if not await _throttle(f"msgnote:{booking_id}:{recipient_id}", 1800):
        return
    async with AsyncSessionLocal() as db:
        booking = await db.get(Booking, booking_id)
        user = await db.get(User, recipient_id)
        prop = await db.get(Property, booking.property_id) if booking else None
        if not booking or not user or not prop:
            return
        who = {"guest": "your guest", "host": "your host", "admin": "the NaivaStay team"}.get(sender_role, "someone")
        path = f"/owner/messages/{booking_id}" if recipient_id == prop.owner_id else f"/messages/{booking_id}"
        await _notify(user, f"NaivaStay: new message from {who} about {prop.title}. "
                            f"Read and reply: {settings.FRONTEND_URL}{path}")


# ── Dispute + cancellation notifications ──────────────────────────────────────

@celery.task(bind=True, max_retries=3)
def notify_dispute_event(self, dispute_id: str, event: str, actor_role: str) -> None:
    try:
        asyncio.run(_notify_dispute_async(dispute_id, event, actor_role))
    except Exception as exc:
        raise self.retry(exc=exc, countdown=30)


async def _notify_dispute_async(dispute_id: str, event: str, actor_role: str) -> None:
    from sqlalchemy import select
    from app.core.config import settings
    from app.core.database import AsyncSessionLocal
    from app.models.models import Booking, Dispute, Property, User
    from app.services.disputes import REASON_LABELS

    async with AsyncSessionLocal() as db:
        d = (await db.execute(select(Dispute).where(Dispute.id == dispute_id))).scalar_one_or_none()
        if not d:
            return
        b = (await db.execute(select(Booking).where(Booking.id == d.booking_id))).scalar_one()
        p = (await db.execute(select(Property).where(Property.id == b.property_id))).scalar_one()
        users = {u.id: u for u in (await db.execute(
            select(User).where(User.id.in_([b.guest_id, p.owner_id]))
        )).scalars().all()}

    link = f"{settings.FRONTEND_URL}/disputes/{d.id}"
    reason = REASON_LABELS.get(d.reason, d.reason)
    texts = {
        "opened": f"NaivaStay: a problem was reported on {p.title} ({reason}). Reply here: {link}",
        "message": f"NaivaStay: new message on your case for {p.title}: {link}",
        "withdrawn": f"NaivaStay: the case for {p.title} was withdrawn. {link}",
        "resolved": f"NaivaStay: a decision was made on your case for {p.title}. Details: {link}",
    }
    recipients = {"guest": b.guest_id, "owner": p.owner_id}
    for role, user_id in recipients.items():
        if role == actor_role or user_id not in users:
            continue
        if event == "message" and not await _throttle(f"dispute_notify:{d.id}:{user_id}", 1800):
            continue  # at most one "new message" ping per 30 min per person
        await _notify(users[user_id], texts[event])


async def _throttle(key: str, seconds: int) -> bool:
    from app.core.redis import redis
    try:
        return bool(await redis.set(key, 1, ex=seconds, nx=True))
    except Exception:
        return True


@celery.task(bind=True, max_retries=3)
def notify_owner_cancellation(self, booking_id: str, listing_paused: bool) -> None:
    try:
        asyncio.run(_notify_owner_cancel_async(booking_id, listing_paused))
    except Exception as exc:
        raise self.retry(exc=exc, countdown=30)


async def _notify_owner_cancel_async(booking_id: str, listing_paused: bool) -> None:
    from sqlalchemy import select
    from app.core.config import settings
    from app.core.database import AsyncSessionLocal
    from app.models.models import Booking, Property, User

    async with AsyncSessionLocal() as db:
        b = (await db.execute(select(Booking).where(Booking.id == booking_id))).scalar_one()
        p = (await db.execute(select(Property).where(Property.id == b.property_id))).scalar_one()
        guest = (await db.execute(select(User).where(User.id == b.guest_id))).scalar_one_or_none()
        owner = (await db.execute(select(User).where(User.id == p.owner_id))).scalar_one_or_none()

    if guest:
        await _notify(guest,
                      f"Sorry, the host cancelled your stay at {p.title} ({b.check_in}). "
                      f"You'll get a full refund to M-Pesa. Find another stay: {settings.FRONTEND_URL}/search")
    if owner and listing_paused:
        await _notify(owner,
                      f"NaivaStay: {p.title} has been paused after repeated cancellations. "
                      f"Our team will contact you to review it.")


# ── Push notifications ────────────────────────────────────────────────────────

@celery.task
def send_push_notification(user_id: str, title: str, body: str) -> None:
    """FCM push — max 3/user/day, quiet hours 22:00–07:00 EAT."""
    import pytz
    from datetime import datetime

    eat = pytz.timezone("Africa/Nairobi")
    now_eat = datetime.now(eat)
    if now_eat.hour >= 22 or now_eat.hour < 7:
        return  # Respect quiet hours

    asyncio.run(_check_and_send_push(user_id, title, body))


async def _check_and_send_push(user_id: str, title: str, body: str) -> None:
    from app.core.redis import redis
    from datetime import date

    key = f"push_daily:{user_id}:{date.today().isoformat()}"
    try:
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, 86400)
        if count > 3:
            return  # Cap: max 3 push notifications per user per day
    except Exception:
        pass  # Redis unavailable. Allow through

    await _send_push_async(user_id, title, body)


async def _send_push_async(user_id: str, title: str, body: str) -> None:
    import httpx
    from sqlalchemy import select
    from app.core.database import AsyncSessionLocal
    from app.core.config import settings
    from app.models.models import User

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user or not user.fcm_token or not settings.FCM_SERVER_KEY:
            return

        async with httpx.AsyncClient() as client:
            await client.post(
                "https://fcm.googleapis.com/fcm/send",
                json={"to": user.fcm_token, "notification": {"title": title, "body": body}},
                headers={"Authorization": f"key={settings.FCM_SERVER_KEY}"},
                timeout=10,
            )


# ── iCal sync ────────────────────────────────────────────────────────────────

@celery.task
def sync_all_icals() -> None:
    """Poll all external calendars every 30 min to prevent cross-platform double-booking."""
    asyncio.run(_sync_icals_async())


ICAL_HORIZON_DAYS = 730   # never store more than two years ahead (stops runaway calendars)


async def _sync_icals_async() -> None:
    """Keep each home's NaivaStay calendar in step with its Airbnb/Booking.com/VRBO
    calendars. Per home, from today on:
      * nights booked elsewhere are blocked here (including nights the host had opened);
      * nights no longer booked elsewhere are opened again (a cancellation there);
      * nights booked elsewhere AND on NaivaStay are a real double booking: the host
        and the NaivaStay team are alerted straight away.
    If any of a home's calendars can't be read, nothing is opened that round
    (better to block for 10 more minutes than to sell a night twice)."""
    from collections import defaultdict
    from datetime import datetime, timedelta, timezone
    from sqlalchemy import select, update
    from app.core.audit_log import log_event
    from app.core.database import AsyncSessionLocal
    from app.core.timeutil import today_eat
    from app.models.models import Availability, Booking, ExternalCalendar, Property, User
    from app.services.ical import parse_remote_ical

    today = today_eat()
    horizon = today + timedelta(days=ICAL_HORIZON_DAYS)

    async with AsyncSessionLocal() as db:
        cals = (await db.execute(
            select(ExternalCalendar).join(Property, Property.id == ExternalCalendar.property_id)
            .where(Property.active == True)
        )).scalars().all()
    by_property: dict[str, list] = defaultdict(list)
    for c in cals:
        by_property[c.property_id].append(c)

    for property_id, prop_cals in by_property.items():
        outside: set = set()
        all_read = True
        read_ok: list[str] = []
        for cal in prop_cals:
            try:
                for start, end in await parse_remote_ical(cal.ical_url):
                    d = max(start, today)
                    while d < min(end, horizon):
                        outside.add(d)
                        d += timedelta(days=1)
                read_ok.append(cal.id)
            except Exception as exc:
                all_read = False
                print(f"[iCal sync] Could not read {cal.platform} calendar {cal.id}: {exc}")

        async with AsyncSessionLocal() as db:
            rows = {r.date: r for r in (await db.execute(
                select(Availability).where(Availability.property_id == property_id, Availability.date >= today)
            )).scalars().all()}
            clashes: dict[str, list] = defaultdict(list)
            for d in sorted(outside):
                row = rows.get(d)
                if row is None:
                    db.add(Availability(property_id=property_id, date=d, is_blocked=True, source="ical"))
                elif row.booking_id:                       # booked on NaivaStay too
                    clashes[row.booking_id].append(d)
                elif row.source != "booking":
                    row.is_blocked, row.source = True, "ical"
            if all_read:
                for d, row in rows.items():
                    if row.source == "ical" and d not in outside:
                        await db.delete(row)               # cancelled on the other site: open again

            # Record which calendars were read (only those that actually loaded).
            if read_ok:
                await db.execute(update(ExternalCalendar).where(ExternalCalendar.id.in_(read_ok))
                                 .values(last_synced_at=datetime.now(timezone.utc)))
            await db.commit()

            if not clashes:
                continue
            prop = await db.get(Property, property_id)
            owner = await db.get(User, prop.owner_id) if prop else None
            for booking_id, days in clashes.items():
                booking = await db.get(Booking, booking_id)
                if not booking or booking.status not in ("pending", "confirmed", "checked_in"):
                    continue
                if not await _throttle(f"dbl:{booking_id}:{min(days)}", 12 * 3600):
                    continue
                nights = ", ".join(d.strftime("%a %d %b") for d in days[:5]) + (" …" if len(days) > 5 else "")
                await log_event(db, "double_booking_detected", booking.id, None,
                                {"property_id": property_id, "nights": [d.isoformat() for d in days]})
                if owner and prop:
                    await _notify(owner,
                        f"⚠️ Double booking at {prop.title}: {nights} is booked on NaivaStay "
                        f"(booking {booking.id[:8].upper()}, {booking.check_in} to {booking.check_out}) "
                        f"AND on another site. Cancel the other booking now, or contact NaivaStay support.")


# ── Refund processing ────────────────────────────────────────────────────────

# ── Booking auto-completion ───────────────────────────────────────────────────

@celery.task
def auto_complete_bookings() -> None:
    """
    Runs nightly at 2 am EAT. Three cases:
    1. checked_in  + check_out <= today  → completed         (enables review)
    2. confirmed   + check_out <  today  → completed + payout (guest no-show)
    Unpaid pending bookings are handled every 5 min by expire_unpaid_bookings.
    """
    asyncio.run(_auto_complete_async())


async def _auto_complete_async() -> None:
    from sqlalchemy import select
    from app.core.database import AsyncSessionLocal
    from app.core.audit_log import log_event
    from app.core.timeutil import today_eat
    from app.models.models import Booking

    today = today_eat()

    async with AsyncSessionLocal() as db:

        # ── 1. checked_in → completed ─────────────────────────────────────────
        checked_in = (await db.execute(
            select(Booking).where(
                Booking.status == "checked_in",
                Booking.check_out <= today,
            )
        )).scalars().all()

        for b in checked_in:
            b.status = "completed"
            await log_event(db, "booking_auto_completed", b.id, None,
                            {"reason": "checkout_passed"})

        # ── 2. confirmed but never checked in (no-show) → completed ─────────
        # Money is handled by release_due_payouts / release_due_deposits.
        no_shows = (await db.execute(
            select(Booking).where(
                Booking.status == "confirmed",
                Booking.check_out < today,
            )
        )).scalars().all()

        for b in no_shows:
            b.status = "completed"
            await log_event(db, "booking_auto_completed", b.id, None,
                            {"reason": "guest_no_show"})

        await db.commit()


# ── Check-in reminders ────────────────────────────────────────────────────────

@celery.task
def send_checkin_reminders() -> None:
    """Send 24-hour check-in reminder to guests checking in tomorrow."""
    asyncio.run(_send_reminders_async())


async def _send_reminders_async() -> None:
    from datetime import date, timedelta
    from sqlalchemy import select
    from app.core.database import AsyncSessionLocal
    from app.models.models import Booking, Property, User

    tomorrow = date.today() + timedelta(days=1)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Booking).where(
                Booking.check_in == tomorrow,
                Booking.status == "confirmed",
            )
        )
        bookings = result.scalars().all()

        for booking in bookings:
            prop = (await db.execute(select(Property).where(Property.id == booking.property_id))).scalar_one_or_none()
            guest = (await db.execute(select(User).where(User.id == booking.guest_id))).scalar_one_or_none()
            if guest and prop:
                sms = (
                    f"Reminder: Check-in tomorrow at {prop.title}. "
                    f"Code: {booking.checkin_code}. "
                    f"{prop.landmark_instructions or 'See booking confirmation for directions.'}"
                )
                wa = (
                    f"⏰ *Check-in Reminder*\n\n"
                    f"You check in *tomorrow* at:\n"
                    f"🏡 *{prop.title}*\n\n"
                    f"🔐 Your check-in code: *{booking.checkin_code}*\n\n"
                    + (f"📍 Directions: {prop.landmark_instructions}\n\n" if prop.landmark_instructions else "")
                    + "See you in Naivasha! 🌿\nNaivaStay"
                )
                await _notify(guest, sms, wa)


# ── Shared SMS helper ─────────────────────────────────────────────────────────

async def _send_sms(phone: str | None, message: str) -> None:
    import httpx
    from app.core.config import settings
    from app.core.phone import try_normalize

    phone = try_normalize(phone)   # Africa's Talking needs +2547…; skip people with no valid number
    if not phone:
        return
    if not settings.AT_API_KEY:
        print(f"[DEV SMS] {phone}: {message}")
        return

    async with httpx.AsyncClient() as client:
        await client.post(
            "https://api.africastalking.com/version1/messaging",
            data={"username": settings.AT_USERNAME, "to": phone, "message": message},
            headers={"apiKey": settings.AT_API_KEY, "Accept": "application/json"},
            timeout=10,
        )


# ── WhatsApp helper (Africa's Talking WhatsApp API) ───────────────────────────

async def _send_whatsapp(phone: str | None, message: str) -> None:
    """Send a WhatsApp message via Africa's Talking.
    Falls back silently if AT_WHATSAPP_NUMBER is not configured.
    """
    import httpx
    from app.core.config import settings
    from app.core.phone import try_normalize

    phone = try_normalize(phone)
    if not phone:
        return

    if not settings.AT_API_KEY or not settings.AT_WHATSAPP_NUMBER:
        print(f"[DEV WHATSAPP] {phone}: {message}")
        return

    async with httpx.AsyncClient() as client:
        await client.post(
            "https://chat.africastalking.com/whatsapp/message",
            json={
                "username":      settings.AT_USERNAME,
                "channelNumber": settings.AT_WHATSAPP_NUMBER,
                "to":            phone,
                "message":       message,
            },
            headers={"apiKey": settings.AT_API_KEY, "Content-Type": "application/json"},
            timeout=10,
        )


async def _notify(to, sms_text: str, wa_text: str | None = None) -> None:
    """SMS + WhatsApp in parallel. `to` is a User (respects their SMS switch in
    Profile) or a phone number. wa_text defaults to sms_text."""
    import asyncio as _asyncio
    phone = getattr(to, "phone", to)
    sends = [_send_whatsapp(phone, wa_text or sms_text)]
    if getattr(to, "sms_opt_in", True):
        sends.append(_send_sms(phone, sms_text))
    await _asyncio.gather(*sends, return_exceptions=True)