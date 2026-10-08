"""Airbnb / Booking.com calendar sync: block, unblock, alert on real double bookings."""
import uuid
from datetime import timedelta
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

import app.core.database as database
from app.core.timeutil import today_eat
from app.models.models import Availability, AuditLog, Booking, ExternalCalendar, Property, User
from app.workers.tasks import _sync_icals_async
from tests.conftest import auth_cookies, session_factory

T = today_eat()
def D(n):
    return T + timedelta(days=n)


@pytest.fixture(autouse=True)
def _wire(monkeypatch):
    monkeypatch.setattr(database, "AsyncSessionLocal", session_factory)
    with patch("app.workers.tasks._notify", new=AsyncMock()) as notify, \
         patch("app.workers.tasks._throttle", new=AsyncMock(return_value=True)):
        yield notify


async def _home(db, *platforms):
    owner = User(id=str(uuid.uuid4()), phone=f"+2547{uuid.uuid4().int % 10**8:08d}", role="owner")
    db.add(owner)
    await db.flush()
    p = Property(id=str(uuid.uuid4()), owner_id=owner.id, title="Sync Cottage", type="cottage", price_per_night=5000, active=True)
    db.add(p)
    await db.flush()
    for pl in platforms:
        db.add(ExternalCalendar(property_id=p.id, platform=pl, ical_url=f"https://{pl}.example.com/{uuid.uuid4().hex}.ics"))
    await db.commit()
    return owner, p


async def _nights(prop_id):
    async with session_factory() as s:
        return {r.date: (r.is_blocked, r.source) for r in
                (await s.execute(select(Availability).where(Availability.property_id == prop_id))).scalars()}


def _calendars(**by_platform):
    """Fake Airbnb/Booking.com feeds: platform -> list of (start, end) or an Exception."""
    async def fake(url):
        for pl, ranges in by_platform.items():
            if f"//{pl}." in url:
                if isinstance(ranges, Exception):
                    raise ranges
                return ranges
        return []
    return patch("app.services.ical.parse_remote_ical", side_effect=fake)


@pytest.mark.asyncio
async def test_airbnb_and_booking_nights_block_naivastay_bookings(client, db):
    owner, prop = await _home(db, "airbnb", "booking")
    with _calendars(airbnb=[(D(10), D(12))], booking=[(D(20), D(21))]):
        await _sync_icals_async()
    n = await _nights(prop.id)
    assert n[D(10)] == (True, "ical") and n[D(11)] == (True, "ical") and n[D(20)] == (True, "ical")
    assert D(12) not in n                                   # check-out day stays free

    guest = User(id=str(uuid.uuid4()), phone=f"+2541{uuid.uuid4().int % 10**8:08d}")
    db.add(guest)
    await db.commit()
    r = await client.post("/api/bookings/", cookies=auth_cookies(guest.id), json={
        "property_id": prop.id, "check_in": D(11).isoformat(), "check_out": D(13).isoformat(),
        "guests": 2, "terms_accepted": True})
    assert r.status_code == 409                             # can't book a night sold on Airbnb


@pytest.mark.asyncio
async def test_night_the_host_had_opened_still_gets_blocked(db):
    owner, prop = await _home(db, "airbnb")
    db.add(Availability(property_id=prop.id, date=D(5), is_blocked=False, source="manual"))
    await db.commit()
    with _calendars(airbnb=[(D(5), D(6))]):
        await _sync_icals_async()
    assert (await _nights(prop.id))[D(5)] == (True, "ical")


@pytest.mark.asyncio
async def test_cancelled_elsewhere_opens_again_but_not_if_a_calendar_failed(db):
    owner, prop = await _home(db, "airbnb", "booking")
    with _calendars(airbnb=[(D(8), D(10))], booking=[]):
        await _sync_icals_async()
    assert D(8) in await _nights(prop.id)
    with _calendars(airbnb=[], booking=ConnectionError("down")):   # one site unreachable
        await _sync_icals_async()
    assert D(8) in await _nights(prop.id)                          # stays blocked: play safe
    with _calendars(airbnb=[], booking=[]):                        # Airbnb guest cancelled
        await _sync_icals_async()
    assert D(8) not in await _nights(prop.id)


@pytest.mark.asyncio
async def test_real_double_booking_alerts_the_host(db, _wire):
    owner, prop = await _home(db, "booking")
    guest = User(id=str(uuid.uuid4()), phone=f"+2541{uuid.uuid4().int % 10**8:08d}")
    db.add(guest)
    await db.flush()
    b = Booking(id=str(uuid.uuid4()), guest_id=guest.id, property_id=prop.id, check_in=D(15), check_out=D(17),
                total_amount=10_000, platform_fee=300, status="confirmed")
    db.add(b)
    await db.flush()
    for i in (15, 16):
        db.add(Availability(property_id=prop.id, date=D(i), is_blocked=True, source="booking", booking_id=b.id))
    await db.commit()
    with _calendars(booking=[(D(16), D(18))]):              # Booking.com sold the 16th too
        await _sync_icals_async()
    msg = _wire.call_args.args[1]
    assert "Double booking" in msg and b.id[:8].upper() in msg
    async with session_factory() as s:
        assert (await s.execute(select(AuditLog).where(AuditLog.event_type == "double_booking_detected",
                                                       AuditLog.entity_id == b.id))).first()
    n = await _nights(prop.id)
    assert n[D(16)] == (True, "booking") and n[D(17)] == (True, "ical")   # NaivaStay booking untouched


@pytest.mark.asyncio
async def test_no_false_alarm_for_bookings_in_the_gap(db, _wire):
    owner, prop = await _home(db, "airbnb")
    guest = User(id=str(uuid.uuid4()), phone=f"+2541{uuid.uuid4().int % 10**8:08d}")
    db.add(guest)
    await db.flush()
    b = Booking(id=str(uuid.uuid4()), guest_id=guest.id, property_id=prop.id, check_in=D(20), check_out=D(22),
                total_amount=1, platform_fee=0, status="confirmed")
    db.add(b)
    await db.flush()
    db.add(Availability(property_id=prop.id, date=D(20), is_blocked=True, source="booking", booking_id=b.id))
    await db.commit()
    with _calendars(airbnb=[(D(10), D(11)), (D(30), D(31))]):   # far either side
        await _sync_icals_async()
    _wire.assert_not_called()


@pytest.mark.asyncio
async def test_naivastay_feed_sends_bookings_and_host_closed_nights(client, db):
    owner, prop = await _home(db)
    db.add_all([Availability(property_id=prop.id, date=D(3), is_blocked=True, source="manual"),
                Availability(property_id=prop.id, date=D(4), is_blocked=True, source="manual"),
                Availability(property_id=prop.id, date=D(9), is_blocked=True, source="ical")])
    await db.commit()
    feed = (await client.get(f"/api/ical/export/{prop.id}")).text
    assert f"DTSTART;VALUE=DATE:{D(3):%Y%m%d}" in feed and f"DTEND;VALUE=DATE:{D(5):%Y%m%d}" in feed
    assert f"{D(9):%Y%m%d}" not in feed                      # imported nights aren't echoed back


@pytest.mark.asyncio
async def test_dashboards_show_sync_status_and_double_bookings(client, db, _wire):
    owner, prop = await _home(db, "airbnb")
    guest = User(id=str(uuid.uuid4()), phone=f"+2541{uuid.uuid4().int % 10**8:08d}")
    db.add(guest)
    await db.flush()
    b = Booking(id=str(uuid.uuid4()), guest_id=guest.id, property_id=prop.id, check_in=D(40), check_out=D(41),
                total_amount=1, platform_fee=0, status="confirmed")
    db.add(b)
    await db.flush()
    db.add(Availability(property_id=prop.id, date=D(40), is_blocked=True, source="booking", booking_id=b.id))
    await db.commit()
    with _calendars(airbnb=[(D(40), D(41))]):
        await _sync_icals_async()
    sync = (await client.get("/api/owner/dashboard", cookies=auth_cookies(owner.id))).json()["calendar_sync"]
    assert sync["linked"] == 1 and sync["last_synced_at"]
    assert sync["double_bookings"][0]["booking_id"] == b.id
    admin = User(id=str(uuid.uuid4()), phone=f"+2547{uuid.uuid4().int % 10**8:08d}", role="admin")
    db.add(admin)
    await db.commit()
    ov = (await client.get("/api/admin/console/overview", cookies=auth_cookies(admin.id))).json()
    assert ov["needs_attention"]["double_bookings"] >= 1
