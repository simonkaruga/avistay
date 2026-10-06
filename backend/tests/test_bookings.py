import pytest
import uuid
from datetime import date, timedelta
from sqlalchemy import select

from app.models.models import User, Property, Booking
from tests.conftest import auth_cookies, session_factory


async def _seed_owner_and_property(db) -> tuple[str, str]:
    owner_id = str(uuid.uuid4())
    prop_id  = str(uuid.uuid4())
    db.add(User(id=owner_id, phone=f"+2547{owner_id[:8]}", role="owner"))
    db.add(Property(
        id=prop_id, owner_id=owner_id, title="Test Cottage",
        type="cottage", price_per_night=5000, min_nights=1, active=True,
    ))
    await db.commit()
    return owner_id, prop_id


async def _seed_guest(db) -> str:
    guest_id = str(uuid.uuid4())
    db.add(User(id=guest_id, phone=f"+2541{guest_id[:8]}", role="guest"))
    await db.commit()
    return guest_id


@pytest.mark.asyncio
async def test_create_booking(client, db):
    _, prop_id = await _seed_owner_and_property(db)
    guest_id   = await _seed_guest(db)

    tomorrow  = date.today() + timedelta(days=1)
    day_after = tomorrow + timedelta(days=2)

    r = await client.post(
        "/api/bookings/",
        json={
            "property_id": prop_id,
            "check_in":  tomorrow.isoformat(),
            "check_out": day_after.isoformat(),
            "guests": 2,
            "terms_accepted": True,
        },
        cookies=auth_cookies(guest_id),
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "pending"
    assert r.json()["property_id"] == prop_id


@pytest.mark.asyncio
async def test_double_booking_rejected(client, db):
    _, prop_id = await _seed_owner_and_property(db)
    g1 = await _seed_guest(db)
    g2 = await _seed_guest(db)

    checkin  = date.today() + timedelta(days=20)
    checkout = checkin + timedelta(days=2)
    payload  = {
        "property_id": prop_id,
        "check_in":  checkin.isoformat(),
        "check_out": checkout.isoformat(),
        "guests": 1,
        "terms_accepted": True,
    }

    r1 = await client.post("/api/bookings/", json=payload, cookies=auth_cookies(g1))
    assert r1.status_code == 201, r1.text

    b = (await db.execute(select(Booking).where(Booking.id == r1.json()["id"]))).scalar_one()
    b.status = "confirmed"
    await db.commit()

    r2 = await client.post("/api/bookings/", json=payload, cookies=auth_cookies(g2))
    assert r2.status_code == 409


@pytest.mark.asyncio
async def test_cancel_full_refund_when_far_out(client, db):
    _, prop_id = await _seed_owner_and_property(db)
    guest_id   = await _seed_guest(db)

    checkin  = date.today() + timedelta(days=10)
    checkout = checkin + timedelta(days=2)

    r = await client.post(
        "/api/bookings/",
        json={
            "property_id": prop_id,
            "check_in":  checkin.isoformat(),
            "check_out": checkout.isoformat(),
            "guests": 1,
            "terms_accepted": True,
        },
        cookies=auth_cookies(guest_id),
    )
    assert r.status_code == 201, r.text
    booking_id = r.json()["id"]

    b = (await db.execute(select(Booking).where(Booking.id == booking_id))).scalar_one()
    b.status = "confirmed"
    await db.commit()

    r2 = await client.post(
        f"/api/bookings/{booking_id}/cancel",
        json={"reason": "Changed plans"},
        cookies=auth_cookies(guest_id),
    )
    assert r2.status_code == 200
    assert r2.json()["refund_pct"] == 100


# ── Integrity fixes ───────────────────────────────────────────────────────────

from unittest.mock import patch
from app.models.models import Availability, Payment
from tests.conftest import auth_cookies as _cookies


def _payload(prop_id, check_in, nights=2):
    return {"property_id": prop_id, "check_in": check_in.isoformat(),
            "check_out": (check_in + timedelta(days=nights)).isoformat(),
            "guests": 1, "terms_accepted": True}


@pytest.mark.asyncio
async def test_overlapping_range_rejected(client, db):
    """Old Redis lock was keyed on the exact range, so 1–5 and 3–7 both got through."""
    _, prop_id = await _seed_owner_and_property(db)
    g1, g2 = await _seed_guest(db), await _seed_guest(db)
    start = date.today() + timedelta(days=30)

    r1 = await client.post("/api/bookings/", json=_payload(prop_id, start, 4), cookies=_cookies(g1))
    r2 = await client.post("/api/bookings/", json=_payload(prop_id, start + timedelta(days=2), 4), cookies=_cookies(g2))
    assert r1.status_code == 201, r1.text
    assert r2.status_code == 409


@pytest.mark.asyncio
async def test_availability_rows_linked_and_freed_on_cancel(client, db):
    _, prop_id = await _seed_owner_and_property(db)
    guest_id = await _seed_guest(db)
    start = date.today() + timedelta(days=40)

    r = await client.post("/api/bookings/", json=_payload(prop_id, start), cookies=_cookies(guest_id))
    booking_id = r.json()["id"]
    async with session_factory() as s:
        rows = (await s.execute(select(Availability).where(Availability.property_id == prop_id))).scalars().all()
    assert len(rows) == 2 and all(a.booking_id == booking_id for a in rows)

    r = await client.post(f"/api/bookings/{booking_id}/cancel", json={}, cookies=_cookies(guest_id))
    assert r.status_code == 200
    async with session_factory() as s:
        left = (await s.execute(select(Availability).where(Availability.property_id == prop_id))).scalars().all()
    assert left == []  # dates bookable again

    other = await _seed_guest(db)
    r = await client.post("/api/bookings/", json=_payload(prop_id, start), cookies=_cookies(other))
    assert r.status_code == 201


@pytest.mark.asyncio
async def test_past_checkin_rejected(client, db):
    _, prop_id = await _seed_owner_and_property(db)
    guest_id = await _seed_guest(db)
    r = await client.post("/api/bookings/", json=_payload(prop_id, date.today() - timedelta(days=3)),
                          cookies=_cookies(guest_id))
    assert r.status_code == 400


async def _confirmed_booking(client, db, days_ahead=0):
    owner_id, prop_id = await _seed_owner_and_property(db)
    guest_id = await _seed_guest(db)
    r = await client.post("/api/bookings/", json=_payload(prop_id, date.today() + timedelta(days=days_ahead)),
                          cookies=_cookies(guest_id))
    booking_id = r.json()["id"]
    b = (await db.execute(select(Booking).where(Booking.id == booking_id))).scalar_one()
    b.status = "confirmed"
    db.add(Payment(booking_id=booking_id, amount=b.total_amount, type="charge", status="completed"))
    await db.commit()
    return owner_id, guest_id, booking_id, b.checkin_code


@pytest.mark.asyncio
async def test_other_users_cannot_view_or_cancel(client, db):
    _, _, booking_id, _ = await _confirmed_booking(client, db, days_ahead=50)
    stranger_owner, _ = await _seed_owner_and_property(db)

    assert (await client.get(f"/api/bookings/{booking_id}", cookies=_cookies(stranger_owner))).status_code == 404
    r = await client.post(f"/api/bookings/{booking_id}/cancel", json={}, cookies=_cookies(stranger_owner))
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_host_never_sees_checkin_code(client, db):
    owner_id, _, booking_id, _ = await _confirmed_booking(client, db, days_ahead=50)
    r = await client.get(f"/api/bookings/{booking_id}", cookies=_cookies(owner_id))
    assert r.status_code == 200 and r.json()["checkin_code"] is None
    r = await client.get("/api/owner/bookings", cookies=_cookies(owner_id))
    assert all("checkin_code" not in b for b in r.json())


@pytest.mark.asyncio
async def test_checkin_only_by_host_and_starts_payout_hold(client, db):
    owner_id, guest_id, booking_id, code = await _confirmed_booking(client, db, days_ahead=0)

    with patch("app.workers.tasks.send_b2c_payment.delay") as b2c:
        r = await client.post(f"/api/bookings/{booking_id}/checkin?code={code}", cookies=_cookies(guest_id))
        assert r.status_code == 404  # guest cannot release the escrow to the host
        r = await client.post(f"/api/bookings/{booking_id}/checkin?code={code}", cookies=_cookies(owner_id))
        assert r.status_code == 204, r.text
        r = await client.post(f"/api/bookings/{booking_id}/checkin?code={code}", cookies=_cookies(owner_id))
        assert r.status_code == 400  # already checked in

    async with session_factory() as s:
        b = (await s.execute(select(Booking).where(Booking.id == booking_id))).scalar_one()
        payouts = (await s.execute(select(Payment).where(
            Payment.booking_id == booking_id, Payment.type == "payout"))).scalars().all()
    assert b.checked_in_at is not None
    assert payouts == []          # paid 24h later by release_due_payouts, not at the door
    b2c.assert_not_called()


@pytest.mark.asyncio
async def test_cancel_refunds_amount_actually_paid(client, db):
    _, guest_id, booking_id, _ = await _confirmed_booking(client, db, days_ahead=10)
    with patch("app.workers.tasks.send_b2c_payment.delay") as b2c:
        r = await client.post(f"/api/bookings/{booking_id}/cancel", json={}, cookies=_cookies(guest_id))
    assert r.status_code == 200
    async with session_factory() as s:
        refund = (await s.execute(select(Payment).where(
            Payment.booking_id == booking_id, Payment.type == "refund"))).scalar_one()
    assert refund.amount == r.json()["refund_amount"] > 0
    b2c.assert_called_once_with(refund.id)
