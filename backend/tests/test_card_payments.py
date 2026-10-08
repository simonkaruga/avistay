"""Card payments via Paystack: surcharge, signed webhook, amount checks,
refunds back to the card, and the same safety rules as M-Pesa."""
import hashlib
import hmac
import json
import uuid
from datetime import date, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

import app.core.database as database
from app.core.config import settings
from app.models.models import Booking, Payment, Property, User
from app.services.payments import card_fee
from app.workers.tasks import _send_b2c_async
from tests.conftest import auth_cookies, session_factory

KEY = "sk_test_naivastay"
TOTAL = 15_500          # 10,000 room + 200 levy + 300 fee + 5,000 deposit
FEE = card_fee(TOTAL)   # 3.5% rounded up → 543


@pytest.fixture(autouse=True)
def _wire(monkeypatch):
    monkeypatch.setattr(settings, "PAYSTACK_SECRET_KEY", KEY)
    monkeypatch.setattr(database, "AsyncSessionLocal", session_factory)
    with patch("app.workers.tasks.send_b2c_payment.delay") as b2c, \
         patch("app.workers.tasks.send_booking_notifications.delay"), \
         patch("app.workers.tasks._send_sms", new=AsyncMock()):
        yield b2c


def _phone() -> str:
    return f"2547{uuid.uuid4().int % 10**8:08d}"


async def _pending_booking(db, *, email="guest@example.com", status="pending"):
    owner = User(id=str(uuid.uuid4()), phone=_phone(), role="owner")
    guest = User(id=str(uuid.uuid4()), phone=_phone(), role="guest", email=email and f"{uuid.uuid4().hex[:6]}{email}")
    db.add_all([owner, guest])
    await db.flush()
    prop = Property(id=str(uuid.uuid4()), owner_id=owner.id, title="Lake Villa", type="villa",
                    price_per_night=5000, active=True, deposit_amount=5000)
    db.add(prop)
    await db.flush()
    b = Booking(id=str(uuid.uuid4()), guest_id=guest.id, property_id=prop.id,
                check_in=date.today() + timedelta(days=20), check_out=date.today() + timedelta(days=22),
                total_amount=TOTAL, platform_fee=300, deposit_amount=5000, room_amount=10_000, levy_amount=200,
                status=status)
    db.add(b)
    await db.commit()
    return guest.id, b.id


def _signed(body: dict) -> tuple[bytes, dict]:
    raw = json.dumps(body).encode()
    sig = hmac.new(KEY.encode(), raw, hashlib.sha512).hexdigest()
    return raw, {"x-paystack-signature": sig, "content-type": "application/json"}


async def _start_card(client, guest_id, booking_id, **body):
    with patch("app.services.paystack.initialize", new=AsyncMock(return_value="https://checkout.paystack.com/abc")) as init:
        r = await client.post("/api/payments/card/initialize", cookies=auth_cookies(guest_id),
                              json={"booking_id": booking_id, **body})
    return r, init


async def _charge(booking_id) -> Payment:
    async with session_factory() as s:
        return (await s.execute(select(Payment).where(Payment.booking_id == booking_id, Payment.type == "charge")
                                .order_by(Payment.created_at.desc()))).scalars().first()


def test_card_fee_rounds_up():
    assert card_fee(15_500) == 543        # 542.5 → 543
    assert card_fee(10_000) == 350
    assert card_fee(0) == 0


@pytest.mark.asyncio
async def test_quote_shows_card_fee(client, db):
    _, booking_id = await _pending_booking(db)
    prop_id = (await db.get(Booking, booking_id)).property_id
    q = (await client.get("/api/bookings/quote", params={
        "property_id": prop_id, "check_in": (date.today() + timedelta(days=40)).isoformat(),
        "check_out": (date.today() + timedelta(days=42)).isoformat()})).json()
    assert q["card_fee"] == card_fee(q["total_amount"]) and q["card_surcharge_pct"] == 3.5


@pytest.mark.asyncio
async def test_start_card_payment_charges_total_plus_fee(client, db):
    guest_id, booking_id = await _pending_booking(db)
    r, init = await _start_card(client, guest_id, booking_id)
    assert r.status_code == 201, r.text
    assert r.json()["authorization_url"].startswith("https://checkout.paystack.com/")
    assert init.call_args.kwargs["amount_kes"] == TOTAL + FEE
    assert f"/booking-confirm/{booking_id}" in init.call_args.kwargs["callback_url"]
    p = await _charge(booking_id)
    assert (p.method, p.amount, p.fee_amount, p.status) == ("card", TOTAL, FEE, "pending")
    assert p.provider_request_id == f"NSC-{p.id}"


@pytest.mark.asyncio
async def test_card_needs_email_and_a_key(client, db, monkeypatch):
    guest_id, booking_id = await _pending_booking(db, email=None)
    r, _ = await _start_card(client, guest_id, booking_id)
    assert r.status_code == 422 and "email" in r.json()["detail"]
    r, _ = await _start_card(client, guest_id, booking_id, email="me@example.com")
    assert r.status_code == 201
    monkeypatch.setattr(settings, "PAYSTACK_SECRET_KEY", "")
    r, _ = await _start_card(client, guest_id, booking_id, email="me@example.com")
    assert r.status_code == 503
    assert (await client.get("/api/site")).json()["card_payments"] is False


@pytest.mark.asyncio
async def test_other_guest_cannot_pay_my_booking(client, db):
    _, booking_id = await _pending_booking(db)
    stranger, _ = await _pending_booking(db)
    r, _ = await _start_card(client, stranger, booking_id)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_webhook_rejects_bad_signature(client, db):
    raw = json.dumps({"event": "charge.success", "data": {}}).encode()
    r = await client.post("/api/payments/paystack/webhook", content=raw,
                          headers={"x-paystack-signature": "forged", "content-type": "application/json"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_webhook_confirms_booking_once(client, db):
    guest_id, booking_id = await _pending_booking(db)
    await _start_card(client, guest_id, booking_id)
    ref = (await _charge(booking_id)).provider_request_id
    raw, headers = _signed({"event": "charge.success", "data": {
        "reference": ref, "status": "success", "amount": (TOTAL + FEE) * 100, "currency": "KES"}})
    for _ in range(2):   # Paystack retries — must be idempotent
        assert (await client.post("/api/payments/paystack/webhook", content=raw, headers=headers)).status_code == 200
    async with session_factory() as s:
        b = await s.get(Booking, booking_id)
        assert (b.status, b.deposit_status, b.mpesa_ref) == ("confirmed", "held", ref)
    p = await _charge(booking_id)
    assert p.status == "completed"
    status = (await client.get(f"/api/payments/status/{booking_id}", cookies=auth_cookies(guest_id))).json()
    assert status["payment_state"] == "paid" and status["method"] == "card"


@pytest.mark.asyncio
async def test_webhook_wrong_amount_or_currency_is_not_confirmed(client, db):
    for amount, currency in ((TOTAL * 100, "KES"), ((TOTAL + FEE) * 100, "USD")):   # fee missing / wrong currency
        guest_id, booking_id = await _pending_booking(db)
        await _start_card(client, guest_id, booking_id)
        ref = (await _charge(booking_id)).provider_request_id
        raw, headers = _signed({"event": "charge.success", "data": {
            "reference": ref, "status": "success", "amount": amount, "currency": currency}})
        await client.post("/api/payments/paystack/webhook", content=raw, headers=headers)
        async with session_factory() as s:
            assert (await s.get(Booking, booking_id)).status == "pending"


@pytest.mark.asyncio
async def test_status_poll_verifies_with_paystack(client, db):
    from app.services.paystack import ChargeStatus
    guest_id, booking_id = await _pending_booking(db)
    await _start_card(client, guest_id, booking_id)
    async with session_factory() as s:   # pretend the guest has been on the card page a while
        p = (await s.execute(select(Payment).where(Payment.booking_id == booking_id))).scalar_one()
        p.created_at = p.created_at - timedelta(minutes=1)
        await s.commit()
    with patch("app.services.paystack.verify", new=AsyncMock(
            return_value=ChargeStatus("success", TOTAL + FEE, "KES", "success"))):
        r = await client.get(f"/api/payments/status/{booking_id}", cookies=auth_cookies(guest_id))
    assert r.json()["payment_state"] == "paid"


@pytest.mark.asyncio
async def test_late_card_payment_is_refunded_in_full_to_the_card(client, db, _wire):
    guest_id, booking_id = await _pending_booking(db)
    await _start_card(client, guest_id, booking_id)
    charge = await _charge(booking_id)
    async with session_factory() as s:      # hold expired before the bank approved it
        (await s.get(Booking, booking_id)).status = "cancelled"
        await s.commit()
    raw, headers = _signed({"event": "charge.success", "data": {
        "reference": charge.provider_request_id, "status": "success", "amount": (TOTAL + FEE) * 100, "currency": "KES"}})
    await client.post("/api/payments/paystack/webhook", content=raw, headers=headers)
    async with session_factory() as s:
        refund = (await s.execute(select(Payment).where(Payment.booking_id == booking_id, Payment.type == "refund"))).scalar_one()
    assert (refund.amount, refund.method, refund.refund_of) == (TOTAL + FEE, "card", charge.id)

    # The worker sends it back to the card, not to M-Pesa.
    with patch("app.services.paystack.refund", new=AsyncMock(return_value=("98765", "pending"))) as pr, \
         patch("app.services.mpesa.b2c_payment", new=AsyncMock()) as b2c:
        await _send_b2c_async(refund.id)
    pr.assert_awaited_once()
    assert pr.call_args.kwargs == {**pr.call_args.kwargs, "reference": charge.provider_request_id, "amount_kes": TOTAL + FEE}
    b2c.assert_not_called()
    async with session_factory() as s:
        r = await s.get(Payment, refund.id)
        assert (r.status, r.provider_request_id) == ("processing", "psr_98765")

    # Paystack confirms the refund later.
    raw, headers = _signed({"event": "refund.processed", "data": {"id": 98765, "status": "processed"}})
    await client.post("/api/payments/paystack/webhook", content=raw, headers=headers)
    async with session_factory() as s:
        assert (await s.get(Payment, refund.id)).status == "completed"


@pytest.mark.asyncio
async def test_guest_cancel_refunds_booking_money_but_not_card_fee(client, db):
    guest_id, booking_id = await _pending_booking(db)
    await _start_card(client, guest_id, booking_id)
    ref = (await _charge(booking_id)).provider_request_id
    raw, headers = _signed({"event": "charge.success", "data": {
        "reference": ref, "status": "success", "amount": (TOTAL + FEE) * 100, "currency": "KES"}})
    await client.post("/api/payments/paystack/webhook", content=raw, headers=headers)

    r = await client.post(f"/api/bookings/{booking_id}/cancel", cookies=auth_cookies(guest_id), json={"reason": "Plans changed"})
    assert r.status_code == 200, r.text
    async with session_factory() as s:
        refund = (await s.execute(select(Payment).where(Payment.booking_id == booking_id, Payment.type == "refund"))).scalar_one()
    assert refund.amount == TOTAL          # far out → 100% of the booking, card fee kept

    with patch("app.services.paystack.refund", new=AsyncMock(return_value=("555", "processed"))) as pr:
        await _send_b2c_async(refund.id)
    assert pr.call_args.kwargs["reference"] == ref
    async with session_factory() as s:
        assert (await s.get(Payment, refund.id)).status == "completed"


@pytest.mark.asyncio
async def test_host_cancel_refunds_card_fee_too(client, db):
    guest_id, booking_id = await _pending_booking(db)
    await _start_card(client, guest_id, booking_id)
    ref = (await _charge(booking_id)).provider_request_id
    raw, headers = _signed({"event": "charge.success", "data": {
        "reference": ref, "status": "success", "amount": (TOTAL + FEE) * 100, "currency": "KES"}})
    await client.post("/api/payments/paystack/webhook", content=raw, headers=headers)
    async with session_factory() as s:
        b = await s.get(Booking, booking_id)
        owner_id = (await s.get(Property, b.property_id)).owner_id
    with patch("app.workers.tasks.notify_owner_cancellation.delay"):
        r = await client.post(f"/api/owner/bookings/{booking_id}/cancel", cookies=auth_cookies(owner_id),
                              json={"reason": "Burst water pipe in the kitchen"})
    assert r.status_code == 200, r.text
    async with session_factory() as s:
        refund = (await s.execute(select(Payment).where(Payment.booking_id == booking_id, Payment.type == "refund"))).scalar_one()
    assert refund.amount == TOTAL + FEE


@pytest.mark.asyncio
async def test_ambiguous_card_refund_is_left_for_a_human(client, db):
    from app.services.paystack import PaystackError
    guest_id, booking_id = await _pending_booking(db, status="confirmed")
    async with session_factory() as s:
        charge = Payment(booking_id=booking_id, type="charge", method="card", amount=TOTAL, fee_amount=FEE,
                         status="completed", provider_request_id=f"NSC-{uuid.uuid4()}")
        s.add(charge)
        await s.flush()
        refund = Payment(booking_id=booking_id, type="deposit_refund", amount=5000, status="pending")
        s.add(refund)
        await s.commit()
    with patch("app.services.paystack.refund", new=AsyncMock(side_effect=PaystackError("timeout", ambiguous=True))):
        await _send_b2c_async(refund.id)
    async with session_factory() as s:
        assert (await s.get(Payment, refund.id)).status == "processing"   # not retried, not failed
