"""Owner-approved money rules: deposit, 24h payout hold, commission,
policy-based guest cancellation, owner cancellation penalty, disputes."""
import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import select

import app.core.database as database
from app.models.models import (
    Availability, Booking, OwnerAdjustment, Payment, Property, User,
)
from app.workers.tasks import _release_due_async
from tests.conftest import auth_cookies, session_factory

ROOM = 10_000   # 2 nights x 5,000
LEVY = 200
FEE = 300
DEPOSIT = 5_000  # tier for 5,000/night
TOTAL = ROOM + LEVY + FEE + DEPOSIT


@pytest.fixture(autouse=True)
def _wire(monkeypatch):
    # Celery tasks open their own sessions — point them at the test DB.
    monkeypatch.setattr(database, "AsyncSessionLocal", session_factory)
    # These tests check commission/penalty/deposit rules on gross amounts;
    # withholding tax has its own test (test_launch_essentials.py).
    from dataclasses import replace
    from app.services import settings as platform_settings
    fixed = replace(platform_settings.S(), withholding_tax_pct=0.0)
    monkeypatch.setattr(platform_settings, "_current", fixed)

    async def _no_reload(db, force=False):
        return fixed
    monkeypatch.setattr(platform_settings, "refresh", _no_reload)
    with patch("app.workers.tasks.send_b2c_payment.delay") as b2c, \
         patch("app.workers.tasks.notify_dispute_event.delay"), \
         patch("app.workers.tasks.notify_owner_cancellation.delay"), \
         patch("app.workers.tasks.send_booking_notifications.delay"):
        yield b2c


def _phone() -> str:
    return f"2547{uuid.uuid4().int % 10**8:08d}"


async def _owner_property(db, commission_pct=10, policy="moderate"):
    owner = User(id=str(uuid.uuid4()), phone=_phone(), role="owner", commission_pct=commission_pct)
    prop = Property(id=str(uuid.uuid4()), owner_id=owner.id, title="Lake Villa", type="villa",
                    price_per_night=5000, min_nights=1, active=True, cancellation_policy=policy,
                    deposit_amount=DEPOSIT)
    db.add(owner)
    await db.flush()
    db.add(prop)
    await db.commit()
    return owner.id, prop.id


async def _guest(db) -> str:
    g = User(id=str(uuid.uuid4()), phone=_phone(), role="guest")
    db.add(g)
    await db.commit()
    return g.id


async def _paid_booking(db, *, check_in: date, status="confirmed", commission_pct=10, policy="moderate",
                        checked_in_at=None):
    """A booking as it looks after a successful M-Pesa payment."""
    owner_id, prop_id = await _owner_property(db, commission_pct, policy)
    guest_id = await _guest(db)
    b = Booking(id=str(uuid.uuid4()), guest_id=guest_id, property_id=prop_id,
                check_in=check_in, check_out=check_in + timedelta(days=2),
                total_amount=TOTAL, platform_fee=FEE, deposit_amount=DEPOSIT,
                room_amount=ROOM, levy_amount=LEVY, commission_kes=ROOM * commission_pct // 100,
                cancellation_policy=policy, deposit_status="held", status=status,
                checkin_code="4321", checked_in_at=checked_in_at)
    db.add(b)
    await db.flush()
    for i in range(2):
        db.add(Availability(property_id=prop_id, date=check_in + timedelta(days=i),
                            is_blocked=True, source="booking", booking_id=b.id))
    db.add(Payment(booking_id=b.id, amount=TOTAL, type="charge", status="completed", mpesa_ref="QX1"))
    await db.commit()
    return owner_id, guest_id, prop_id, b.id


async def _payments(booking_id, type_=None):
    async with session_factory() as s:
        q = select(Payment).where(Payment.booking_id == booking_id)
        if type_:
            q = q.where(Payment.type == type_)
        return (await s.execute(q)).scalars().all()


# ── Pricing ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_quote_and_booking_include_deposit_and_lock_commission(client, db):
    _, prop_id = await _owner_property(db, commission_pct=7)
    guest_id = await _guest(db)
    ci = date.today() + timedelta(days=20)
    params = {"property_id": prop_id, "check_in": ci.isoformat(), "check_out": (ci + timedelta(days=2)).isoformat()}

    q = (await client.get("/api/bookings/quote", params=params)).json()
    assert (q["room_amount"], q["levy_amount"], q["platform_fee"], q["deposit_amount"]) == (ROOM, LEVY, FEE, DEPOSIT)
    assert q["total_amount"] == TOTAL
    assert "commission_kes" not in q            # owner-side number never shown to guests
    assert q["free_cancellation_until"] == (ci - timedelta(days=5)).isoformat()

    r = await client.post("/api/bookings/", json={**params, "guests": 2, "terms_accepted": True},
                          cookies=auth_cookies(guest_id))
    assert r.status_code == 201, r.text
    assert r.json()["total_amount"] == TOTAL
    b = (await db.execute(select(Booking).where(Booking.id == r.json()["id"]))).scalar_one()
    assert b.commission_kes == 700 and b.cancellation_policy == "moderate"


# ── 24h payout hold + deposit return ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_payout_released_24h_after_checkin_net_of_commission(db, _wire):
    now = datetime.now(timezone.utc)
    _, _, _, bid = await _paid_booking(db, check_in=date.today() - timedelta(days=1), status="checked_in",
                                       checked_in_at=now - timedelta(hours=23))
    await _release_due_async()
    assert await _payouts_of(bid) == []          # still inside the guest's 24h window

    async with session_factory() as s:
        b = (await s.execute(select(Booking).where(Booking.id == bid))).scalar_one()
        b.checked_in_at = now - timedelta(hours=25)
        await s.commit()
    await _release_due_async()
    await _release_due_async()                   # second run must not pay twice
    payouts = await _payouts_of(bid)
    assert [p.amount for p in payouts] == [ROOM - 1000]   # room minus 10% commission
    _wire.assert_called_once_with(payouts[0].id)


async def _payouts_of(bid):
    return await _payments(bid, "payout")


@pytest.mark.asyncio
async def test_open_guest_dispute_freezes_payout(client, db):
    now = datetime.now(timezone.utc)
    _, guest_id, _, bid = await _paid_booking(db, check_in=date.today(), status="checked_in",
                                              checked_in_at=now - timedelta(hours=2))
    r = await client.post("/api/disputes/", cookies=auth_cookies(guest_id), json={
        "booking_id": bid, "reason": "not_as_described", "message": "No hot water and the pool is drained."})
    assert r.status_code == 201, r.text

    async with session_factory() as s:
        b = (await s.execute(select(Booking).where(Booking.id == bid))).scalar_one()
        b.checked_in_at = now - timedelta(hours=30)
        await s.commit()
    await _release_due_async()
    assert await _payouts_of(bid) == []          # frozen until admin rules


@pytest.mark.asyncio
async def test_deposit_returned_two_days_after_checkout(db, _wire):
    _, _, _, bid = await _paid_booking(db, check_in=date.today() - timedelta(days=5), status="completed",
                                       checked_in_at=datetime.now(timezone.utc) - timedelta(days=5))
    await _release_due_async()
    refunds = await _payments(bid, "deposit_refund")
    assert [r.amount for r in refunds] == [DEPOSIT]
    async with session_factory() as s:
        assert (await s.execute(select(Booking.deposit_status).where(Booking.id == bid))).scalar_one() == "refunded"


# ── Damage claim against the deposit ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_damage_ruling_splits_deposit(client, db, _wire):
    owner_id, _, _, bid = await _paid_booking(db, check_in=date.today() - timedelta(days=2), status="completed",
                                              checked_in_at=datetime.now(timezone.utc) - timedelta(days=2))
    r = await client.post("/api/disputes/", cookies=auth_cookies(owner_id), json={
        "booking_id": bid, "reason": "damage", "claimed_amount": 3000,
        "message": "Broken glass table in the lounge.",
        "attachments": ["https://res.cloudinary.com/demo/image/upload/v1/table.jpg"]})
    assert r.status_code == 201, r.text
    dispute_id = r.json()["id"]

    await _release_due_async()
    assert await _payments(bid, "deposit_refund") == []   # frozen by the claim

    admin = User(id=str(uuid.uuid4()), phone=_phone(), role="admin")
    db.add(admin)
    await db.commit()
    r = await client.post(f"/api/disputes/{dispute_id}/resolve", cookies=auth_cookies(admin.id), json={
        "ruling": "Photos confirm the table was broken during the stay.", "owner_award_kes": 2000})
    assert r.status_code == 200, r.text
    award = await _payments(bid, "claim_payout")
    back = await _payments(bid, "deposit_refund")
    assert [a.amount for a in award] == [2000] and [b.amount for b in back] == [DEPOSIT - 2000]

    r = await client.post(f"/api/disputes/{dispute_id}/resolve", cookies=auth_cookies(admin.id), json={
        "ruling": "Trying to rule twice on the same case.", "owner_award_kes": 1})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_award_cannot_exceed_deposit(client, db):
    owner_id, _, _, bid = await _paid_booking(db, check_in=date.today() - timedelta(days=2), status="completed")
    r = await client.post("/api/disputes/", cookies=auth_cookies(owner_id), json={
        "booking_id": bid, "reason": "damage", "message": "Sofa ruined beyond repair."})
    admin = User(id=str(uuid.uuid4()), phone=_phone(), role="admin")
    db.add(admin)
    await db.commit()
    r = await client.post(f"/api/disputes/{r.json()['id']}/resolve", cookies=auth_cookies(admin.id), json={
        "ruling": "Award more than the deposit held.", "owner_award_kes": DEPOSIT + 1})
    assert r.status_code == 422


# ── Guest dispute ruling deducts from the owner ──────────────────────────────

@pytest.mark.asyncio
async def test_guest_refund_ruling_reduces_owner_payout(client, db, _wire):
    now = datetime.now(timezone.utc)
    _, guest_id, _, bid = await _paid_booking(db, check_in=date.today(), status="checked_in",
                                              checked_in_at=now - timedelta(hours=1))
    r = await client.post("/api/disputes/", cookies=auth_cookies(guest_id), json={
        "booking_id": bid, "reason": "cleanliness", "message": "Bedrooms were not cleaned at all."})
    admin = User(id=str(uuid.uuid4()), phone=_phone(), role="admin")
    db.add(admin)
    await db.commit()
    r = await client.post(f"/api/disputes/{r.json()['id']}/resolve", cookies=auth_cookies(admin.id), json={
        "ruling": "Partial refund for the uncleaned rooms.", "guest_refund_kes": 3000})
    assert r.status_code == 200, r.text
    assert [p.amount for p in await _payments(bid, "refund")] == [3000]

    async with session_factory() as s:
        b = (await s.execute(select(Booking).where(Booking.id == bid))).scalar_one()
        b.checked_in_at = now - timedelta(hours=25)
        await s.commit()
    await _release_due_async()
    assert [p.amount for p in await _payouts_of(bid)] == [ROOM - 1000 - 3000]


# ── Guest cancellation follows the property's policy ─────────────────────────

@pytest.mark.asyncio
async def test_guest_cancel_moderate_late_keeps_stay_pays_owner_returns_deposit(client, db, _wire):
    _, guest_id, _, bid = await _paid_booking(db, check_in=date.today() + timedelta(days=3), policy="moderate")

    preview = (await client.get(f"/api/bookings/{bid}/cancel-preview", cookies=auth_cookies(guest_id))).json()
    assert preview["refund_pct"] == 0 and preview["refund_amount"] == DEPOSIT

    r = await client.post(f"/api/bookings/{bid}/cancel", json={}, cookies=auth_cookies(guest_id))
    assert r.status_code == 200 and r.json()["refund_amount"] == DEPOSIT
    assert [p.amount for p in await _payments(bid, "refund")] == [DEPOSIT]
    assert [p.amount for p in await _payouts_of(bid)] == [ROOM - 1000]   # owner keeps the lost nights


@pytest.mark.asyncio
async def test_guest_cancel_early_is_full_refund(client, db):
    _, guest_id, _, bid = await _paid_booking(db, check_in=date.today() + timedelta(days=10), policy="moderate")
    r = await client.post(f"/api/bookings/{bid}/cancel", json={}, cookies=auth_cookies(guest_id))
    assert r.json()["refund_amount"] == TOTAL
    assert await _payouts_of(bid) == []


# ── Owner cancellation ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_owner_cancel_full_refund_penalty_dates_stay_blocked(client, db, _wire):
    owner_id, _, prop_id, bid = await _paid_booking(db, check_in=date.today() + timedelta(days=4))
    preview = (await client.get(f"/api/owner/bookings/{bid}/cancel-preview", cookies=auth_cookies(owner_id))).json()
    assert preview["guest_refund"] == TOTAL and preview["penalty"] == 1000

    r = await client.post(f"/api/owner/bookings/{bid}/cancel", cookies=auth_cookies(owner_id),
                          json={"reason": "Water pump broke, house unusable"})
    assert r.status_code == 200, r.text
    assert [p.amount for p in await _payments(bid, "refund")] == [TOTAL]
    async with session_factory() as s:
        adj = (await s.execute(select(OwnerAdjustment).where(OwnerAdjustment.booking_id == bid))).scalar_one()
        nights = (await s.execute(select(Availability).where(Availability.property_id == prop_id))).scalars().all()
        b = (await s.execute(select(Booking).where(Booking.id == bid))).scalar_one()
    assert adj.amount == -1000
    assert len(nights) == 2 and all(n.is_blocked and n.booking_id is None for n in nights)
    assert b.cancelled_by == "owner"


@pytest.mark.asyncio
async def test_third_owner_cancellation_pauses_listing_and_penalty_nets_next_payout(client, db, _wire):
    owner_id, _, prop_id, first = await _paid_booking(db, check_in=date.today() + timedelta(days=30))
    bids = [first]
    async with session_factory() as s:   # two more bookings on the same property
        for k in (40, 50):
            g = User(id=str(uuid.uuid4()), phone=_phone(), role="guest")
            s.add(g)
            await s.flush()
            b = Booking(id=str(uuid.uuid4()), guest_id=g.id, property_id=prop_id,
                        check_in=date.today() + timedelta(days=k), check_out=date.today() + timedelta(days=k + 2),
                        total_amount=TOTAL, platform_fee=FEE, deposit_amount=DEPOSIT, room_amount=ROOM,
                        levy_amount=LEVY, commission_kes=1000, deposit_status="held", status="confirmed")
            s.add(b)
            await s.flush()
            s.add(Payment(booking_id=b.id, amount=TOTAL, type="charge", status="completed"))
            bids.append(b.id)
        await s.commit()

    results = []
    for bid in bids:
        r = await client.post(f"/api/owner/bookings/{bid}/cancel", cookies=auth_cookies(owner_id),
                              json={"reason": "Double-booked on another site"})
        results.append(r.json())
    assert [r["listing_paused"] for r in results] == [False, False, True]
    async with session_factory() as s:
        assert (await s.execute(select(Property.active).where(Property.id == prop_id))).scalar_one() is False

    # Next stay on another listing: 3 x 1,000 penalties come off that payout.
    async with session_factory() as s:
        other = Property(id=str(uuid.uuid4()), owner_id=owner_id, title="Cottage", type="cottage",
                         price_per_night=5000, min_nights=1, active=True)
        g = User(id=str(uuid.uuid4()), phone=_phone(), role="guest")
        s.add_all([other, g])
        await s.flush()
        b = Booking(id=str(uuid.uuid4()), guest_id=g.id, property_id=other.id,
                    check_in=date.today() - timedelta(days=1), check_out=date.today() + timedelta(days=1),
                    total_amount=TOTAL, platform_fee=FEE, deposit_amount=DEPOSIT, room_amount=ROOM,
                    levy_amount=LEVY, commission_kes=1000, deposit_status="held", status="checked_in",
                    checked_in_at=datetime.now(timezone.utc) - timedelta(hours=26))
        s.add(b)
        await s.flush()
        s.add(Payment(booking_id=b.id, amount=TOTAL, type="charge", status="completed"))
        await s.commit()
    await _release_due_async()
    assert [p.amount for p in await _payouts_of(b.id)] == [ROOM - 1000 - 3000]


@pytest.mark.asyncio
async def test_owner_cannot_cancel_someone_elses_booking(client, db):
    _, _, _, bid = await _paid_booking(db, check_in=date.today() + timedelta(days=9))
    other_owner, _ = await _owner_property(db)
    r = await client.post(f"/api/owner/bookings/{bid}/cancel", cookies=auth_cookies(other_owner),
                          json={"reason": "Not my booking at all"})
    assert r.status_code == 404


# ── Dispute channel access + validation ──────────────────────────────────────

@pytest.mark.asyncio
async def test_dispute_thread_access_and_rules(client, db):
    owner_id, guest_id, _, bid = await _paid_booking(db, check_in=date.today(), status="checked_in",
                                                     checked_in_at=datetime.now(timezone.utc))
    bad = await client.post("/api/disputes/", cookies=auth_cookies(guest_id), json={
        "booking_id": bid, "reason": "no_access", "message": "Gate locked, host not answering.",
        "attachments": ["https://evil.example.com/x.jpg"]})
    assert bad.status_code == 422
    wrong_reason = await client.post("/api/disputes/", cookies=auth_cookies(guest_id), json={
        "booking_id": bid, "reason": "damage", "message": "Guests can't file damage claims."})
    assert wrong_reason.status_code == 422

    r = await client.post("/api/disputes/", cookies=auth_cookies(guest_id), json={
        "booking_id": bid, "reason": "no_access", "message": "Gate locked, host not answering."})
    did = r.json()["id"]
    dup = await client.post("/api/disputes/", cookies=auth_cookies(guest_id), json={
        "booking_id": bid, "reason": "other", "message": "Opening a second case."})
    assert dup.status_code == 409

    assert (await client.post(f"/api/disputes/{did}/messages", cookies=auth_cookies(owner_id),
                              json={"body": "Sorry! Caretaker is on the way."})).status_code == 201
    stranger = await _guest(db)
    assert (await client.get(f"/api/disputes/{did}", cookies=auth_cookies(stranger))).status_code == 404
    assert (await client.post(f"/api/disputes/{did}/resolve", cookies=auth_cookies(owner_id),
                              json={"ruling": "Owner tries to rule on own case."})).status_code == 403

    thread = (await client.get(f"/api/disputes/{did}", cookies=auth_cookies(guest_id))).json()
    assert [m["author_role"] for m in thread["messages"]] == ["guest", "owner"]
    assert thread["can_withdraw"] is True and thread["can_resolve"] is False

    w = await client.post(f"/api/disputes/{did}/withdraw", cookies=auth_cookies(guest_id))
    assert w.json()["status"] == "withdrawn"


@pytest.mark.asyncio
async def test_cannot_report_before_checkin_day(client, db):
    _, guest_id, _, bid = await _paid_booking(db, check_in=date.today() + timedelta(days=3))
    r = await client.post("/api/disputes/", cookies=auth_cookies(guest_id), json={
        "booking_id": bid, "reason": "other", "message": "Reporting before arrival."})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_quote_validates_promo_without_claiming_it(client, db):
    from app.models.models import PromoCode
    _, prop_id = await _owner_property(db)
    db.add(PromoCode(code="LAKE500", discount_kes=500, max_uses=1, used_count=0))
    await db.commit()
    ci = date.today() + timedelta(days=15)
    base = {"property_id": prop_id, "check_in": ci.isoformat(), "check_out": (ci + timedelta(days=2)).isoformat()}

    ok = (await client.get("/api/bookings/quote", params={**base, "promo_code": "lake500"})).json()
    assert ok["discount"] == 500 and ok["total_amount"] == TOTAL - 500 and ok["promo_error"] is None
    bad = (await client.get("/api/bookings/quote", params={**base, "promo_code": "FAKE"})).json()
    assert bad["discount"] == 0 and bad["promo_error"]
    async with session_factory() as s:
        used = (await s.execute(select(PromoCode.used_count).where(PromoCode.code == "LAKE500"))).scalar_one()
    assert used == 0   # quoting never consumes a use
