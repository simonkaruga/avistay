import pytest
import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch
from sqlalchemy import select

from app.core.config import settings
from app.models.models import User, Property, Booking, Payment, Availability
from tests.conftest import session_factory

SECRET = "test-callback-secret-0123456789abcdef"
AMOUNT = 16600


@pytest.fixture(autouse=True)
def _callback_secret(monkeypatch):
    monkeypatch.setattr(settings, "MPESA_CALLBACK_SECRET", SECRET)


@pytest.fixture(autouse=True)
def _no_celery():
    with patch("app.workers.tasks.send_booking_notifications.delay") as notify, \
         patch("app.workers.tasks.send_b2c_payment.delay") as b2c:
        yield {"notify": notify, "b2c": b2c}


async def _seed(db, booking_status: str = "pending") -> tuple[str, str]:
    """Pending booking with its availability rows and one in-flight STK charge."""
    owner_id, guest_id, prop_id, booking_id = (str(uuid.uuid4()) for _ in range(4))
    checkout_id = f"ws_CO_{uuid.uuid4().hex[:20]}"
    checkin = date.today() + timedelta(days=3)

    db.add(User(id=owner_id, phone=f"2547{uuid.uuid4().int % 10**8:08d}", role="owner"))
    db.add(User(id=guest_id, phone=f"2547{uuid.uuid4().int % 10**8:08d}", role="guest"))
    db.add(Property(id=prop_id, owner_id=owner_id, title="Callback Test Villa",
                    type="villa", price_per_night=8000, min_nights=1, active=True))
    await db.flush()
    db.add(Booking(id=booking_id, guest_id=guest_id, property_id=prop_id,
                   check_in=checkin, check_out=checkin + timedelta(days=2),
                   total_amount=AMOUNT, platform_fee=300, status=booking_status, checkin_code="9999"))
    await db.flush()
    for d in range(2):
        db.add(Availability(property_id=prop_id, date=checkin + timedelta(days=d),
                            is_blocked=True, source="booking", booking_id=booking_id))
    db.add(Payment(booking_id=booking_id, amount=AMOUNT, type="charge",
                   status="pending", provider_request_id=checkout_id))
    await db.commit()
    return booking_id, checkout_id


def _payload(checkout_id: str, result_code: int = 0, amount: int = AMOUNT, receipt: str = "QKJ38ABCDE"):
    """Shape of a real Daraja STK callback — note there is NO AccountReference."""
    cb = {
        "MerchantRequestID": "29115-34620561-1",
        "CheckoutRequestID": checkout_id,
        "ResultCode": result_code,
        "ResultDesc": "ok" if result_code == 0 else "Request cancelled by user",
    }
    if result_code == 0:
        cb["CallbackMetadata"] = {"Item": [
            {"Name": "Amount", "Value": amount},
            {"Name": "MpesaReceiptNumber", "Value": receipt},
            {"Name": "TransactionDate", "Value": 20261005101010},
            {"Name": "PhoneNumber", "Value": 254700000002},
        ]}
    return {"Body": {"stkCallback": cb}}


async def _post(client, payload, secret=SECRET):
    return await client.post(f"/api/payments/mpesa/callback/{secret}", json=payload)


async def _state(booking_id):
    async with session_factory() as s:
        b = (await s.execute(select(Booking).where(Booking.id == booking_id))).scalar_one()
        pays = (await s.execute(select(Payment).where(Payment.booking_id == booking_id))).scalars().all()
        nights = (await s.execute(select(Availability).where(Availability.booking_id == booking_id))).scalars().all()
        return b, pays, nights


@pytest.mark.asyncio
async def test_successful_callback_confirms_booking(client, db, _no_celery):
    booking_id, checkout_id = await _seed(db)

    r = await _post(client, _payload(checkout_id))
    assert r.status_code == 200

    b, pays, nights = await _state(booking_id)
    assert b.status == "confirmed"
    assert b.mpesa_ref == "QKJ38ABCDE"
    assert [p.status for p in pays] == ["completed"]
    assert len(nights) == 2  # callback no longer inserts duplicate nights
    _no_celery["notify"].assert_called_once_with(booking_id)


@pytest.mark.asyncio
async def test_duplicate_callback_is_idempotent(client, db, _no_celery):
    booking_id, checkout_id = await _seed(db)

    for _ in range(3):
        assert (await _post(client, _payload(checkout_id))).status_code == 200

    b, pays, _ = await _state(booking_id)
    assert b.status == "confirmed"
    assert len(pays) == 1
    _no_celery["notify"].assert_called_once()
    _no_celery["b2c"].assert_not_called()


@pytest.mark.asyncio
async def test_failed_callback_leaves_booking_pending(client, db):
    booking_id, checkout_id = await _seed(db)

    r = await _post(client, _payload(checkout_id, result_code=1032))
    assert r.status_code == 200

    b, pays, nights = await _state(booking_id)
    assert b.status == "pending"          # guest can retry within the hold
    assert pays[0].status == "failed"
    assert len(nights) == 2               # dates still held


@pytest.mark.asyncio
async def test_wrong_secret_rejected_and_nothing_changes(client, db):
    booking_id, checkout_id = await _seed(db)

    r = await _post(client, _payload(checkout_id), secret="guessed")
    assert r.status_code == 404

    b, _, _ = await _state(booking_id)
    assert b.status == "pending"


@pytest.mark.asyncio
async def test_spoofed_safaricom_ip_no_longer_grants_access(client, db):
    booking_id, checkout_id = await _seed(db)
    r = await client.post("/api/payments/mpesa/callback", json=_payload(checkout_id),
                          headers={"X-Forwarded-For": "196.201.214.200"})
    assert r.status_code in (404, 405)
    b, _, _ = await _state(booking_id)
    assert b.status == "pending"


@pytest.mark.asyncio
async def test_amount_mismatch_does_not_confirm(client, db):
    booking_id, checkout_id = await _seed(db)

    await _post(client, _payload(checkout_id, amount=1))

    b, pays, _ = await _state(booking_id)
    assert b.status == "pending"
    assert pays[0].status == "pending"   # held for manual review


@pytest.mark.asyncio
async def test_unknown_checkout_id_is_ignored(client, db):
    booking_id, _ = await _seed(db)
    r = await _post(client, _payload("ws_CO_unknown"))
    assert r.status_code == 200
    b, _, _ = await _state(booking_id)
    assert b.status == "pending"


@pytest.mark.asyncio
async def test_late_payment_on_cancelled_booking_is_refunded(client, db, _no_celery):
    booking_id, checkout_id = await _seed(db, booking_status="cancelled")

    await _post(client, _payload(checkout_id))

    b, pays, _ = await _state(booking_id)
    assert b.status == "cancelled"        # never resurrected
    charge = next(p for p in pays if p.type == "charge")
    refund = next(p for p in pays if p.type == "refund")
    assert charge.status == "completed"
    assert refund.amount == AMOUNT and refund.status == "pending"
    _no_celery["b2c"].assert_called_once_with(refund.id)
    _no_celery["notify"].assert_not_called()


@pytest.mark.asyncio
async def test_b2c_result_settles_payout(client, db):
    booking_id, _ = await _seed(db, booking_status="checked_in")
    payout_id = str(uuid.uuid4())
    db.add(Payment(id=payout_id, booking_id=booking_id, amount=16300, type="payout",
                   status="processing", provider_request_id="AG_20261005_abc"))
    await db.commit()

    body = {"Result": {"ResultCode": 0, "ResultDesc": "ok", "ConversationID": "AG_20261005_abc",
                       "OriginatorConversationID": "x", "TransactionID": "RJ12ABC"}}
    for _ in range(2):  # Safaricom may resend
        r = await client.post(f"/api/payments/mpesa/callback/{SECRET}/b2c/result", json=body)
        assert r.status_code == 200

    async with session_factory() as s:
        p = (await s.execute(select(Payment).where(Payment.id == payout_id))).scalar_one()
        assert p.status == "completed" and p.mpesa_ref == "RJ12ABC"


@pytest.mark.asyncio
async def test_stk_push_blocked_while_prompt_in_flight(client, db, monkeypatch):
    from tests.conftest import auth_cookies
    booking_id, _ = await _seed(db)
    guest_id = (await db.execute(select(Booking.guest_id).where(Booking.id == booking_id))).scalar_one()
    monkeypatch.setattr(settings, "MPESA_CONSUMER_KEY", "configured")

    with patch("app.services.mpesa.stk_push") as stk:
        r = await client.post("/api/payments/mpesa/stk-push", json={"booking_id": booking_id},
                              cookies=auth_cookies(guest_id))
    assert r.status_code == 409   # one prompt at a time → no double charge
    stk.assert_not_called()


@pytest.mark.asyncio
async def test_status_poll_reconciles_lost_callback(client, db, monkeypatch, _no_celery):
    from tests.conftest import auth_cookies
    from app.services.mpesa import StkQueryResult

    booking_id, checkout_id = await _seed(db)
    guest_id = (await db.execute(select(Booking.guest_id).where(Booking.id == booking_id))).scalar_one()
    charge = (await db.execute(select(Payment).where(Payment.provider_request_id == checkout_id))).scalar_one()
    charge.created_at = datetime.now(timezone.utc) - timedelta(seconds=45)
    await db.commit()
    monkeypatch.setattr(settings, "MPESA_CONSUMER_KEY", "configured")

    async def _query(_id):
        return StkQueryResult("success", "0")

    with patch("app.services.mpesa.stk_query", side_effect=_query):
        r = await client.get(f"/api/payments/mpesa/status/{booking_id}", cookies=auth_cookies(guest_id))
    assert r.status_code == 200
    assert r.json()["status"] == "confirmed"
    assert r.json()["payment_state"] == "paid"
