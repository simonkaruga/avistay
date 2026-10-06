"""Bugs found in the full-project audit (2026-10-06). Run on Postgres to be meaningful."""
import uuid

import pytest

from app.models.models import Property, User
from tests.conftest import auth_cookies


async def _user(db, role):
    u = User(id=str(uuid.uuid4()), phone=f"2547{uuid.uuid4().int % 10**8:08d}", role=role)
    db.add(u)
    await db.commit()
    return u.id


@pytest.mark.asyncio
async def test_new_guest_with_no_bookings_can_open_my_trips(client, db):
    guest = await _user(db, "guest")
    r = await client.get("/api/bookings/mine", cookies=auth_cookies(guest))
    assert r.status_code == 200 and r.json() == []


@pytest.mark.asyncio
async def test_new_host_with_no_bookings_can_open_dashboard(client, db):
    owner = await _user(db, "owner")
    db.add(Property(id=str(uuid.uuid4()), owner_id=owner, title="Brand New Cottage", type="cottage",
                    price_per_night=5000, active=False))
    await db.commit()
    for path in ("/api/owner/dashboard", "/api/owner/bookings"):
        r = await client.get(path, cookies=auth_cookies(owner))
        assert r.status_code == 200, (path, r.text)


@pytest.mark.asyncio
async def test_malformed_ids_are_not_found_not_server_errors(client, db):
    admin = await _user(db, "admin")
    for path in ("/api/properties/abc", "/api/properties/abc/availability",
                 "/api/admin/console/listings/zzz", "/api/admin/console/bookings/zzz/payments"):
        r = await client.get(path, cookies=auth_cookies(admin))
        assert r.status_code < 500, (path, r.status_code)


@pytest.mark.asyncio
async def test_sitemap_is_not_mistaken_for_a_property(client):
    r = await client.get("/api/properties/sitemap.xml")
    assert r.status_code == 200 and "<urlset" in r.text


@pytest.mark.asyncio
async def test_agent_can_only_claim_their_own_booking_on_room_price(client, db):
    from datetime import date, timedelta
    from app.models.models import Agent, Booking
    agent_user = await _user(db, "guest")
    stranger = await _user(db, "guest")
    owner = await _user(db, "owner")
    db.add(Agent(user_id=agent_user, status="active", commission_pct=5))
    prop = Property(id=str(uuid.uuid4()), owner_id=owner, title="Lake House", type="house", price_per_night=10000, active=True)
    db.add(prop)
    await db.flush()
    def bk(guest):
        return Booking(id=str(uuid.uuid4()), guest_id=guest, property_id=prop.id, check_in=date.today() + timedelta(days=9),
                       check_out=date.today() + timedelta(days=11), total_amount=25_700, platform_fee=300,
                       room_amount=20_000, levy_amount=400, deposit_amount=5_000, status="confirmed")
    mine, theirs = bk(agent_user), bk(stranger)
    db.add_all([mine, theirs])
    await db.commit()
    r = await client.post("/api/agent/referrals", cookies=auth_cookies(agent_user), json={"booking_id": theirs.id})
    assert r.status_code == 404                         # can't claim a stranger's booking
    r = await client.post("/api/agent/referrals", cookies=auth_cookies(agent_user), json={"booking_id": mine.id})
    assert r.status_code == 201 and r.json()["commission_kes"] == 1_000   # 5% of the room, not of 25,700


@pytest.mark.asyncio
async def test_one_account_per_phone_whatever_the_format(client, db):
    from app.api import auth as auth_api
    from app.models.models import User as U
    old = U(id=str(uuid.uuid4()), phone="0711000111", role="guest")   # saved as typed, pre-fix
    db.add(old)
    await db.commit()
    for typed in ("0711 000 111", "+254711000111"):
        assert (await client.post("/api/auth/otp/request", json={"phone": typed})).status_code == 204
        code = auth_api._otp_fallback.get("+254711000111") or (await auth_api.redis.get("otp:+254711000111"))
        code = code.decode() if isinstance(code, bytes) else code
        r = await client.post("/api/auth/otp/verify", json={"phone": typed, "code": code})
        assert r.status_code == 200 and r.json()["user_id"] == old.id
    await db.refresh(old)
    assert old.phone == "+254711000111"
    assert (await client.post("/api/auth/otp/request", json={"phone": "12345"})).status_code == 422


@pytest.mark.asyncio
async def test_changing_phone_needs_the_sms_code(client, db):
    from app.api import auth as auth_api
    me = await _user(db, "guest")
    r = await client.put("/api/auth/me", cookies=auth_cookies(me), json={"phone": "0722 333 444"})
    assert r.status_code == 400                               # no code, no change
    await client.post("/api/auth/otp/request", json={"phone": "0722333444"})
    code = auth_api._otp_fallback.get("+254722333444") or (await auth_api.redis.get("otp:+254722333444"))
    code = code.decode() if isinstance(code, bytes) else code
    r = await client.put("/api/auth/me", cookies=auth_cookies(me), json={"phone": "0722 333 444", "phone_code": code})
    assert r.status_code == 200 and r.json()["phone"] == "+254722333444"


@pytest.mark.asyncio
async def test_sweep_resends_refunds_that_never_reached_the_worker(db, monkeypatch):
    from datetime import date, datetime, timedelta, timezone
    from unittest.mock import patch
    import app.core.database as database
    from app.models.models import Booking, Payment
    from app.workers.tasks import _release_due_async
    from tests.conftest import session_factory
    monkeypatch.setattr(database, "AsyncSessionLocal", session_factory)
    guest, owner = await _user(db, "guest"), await _user(db, "owner")
    prop = Property(id=str(uuid.uuid4()), owner_id=owner, title="Quiet Villa", type="villa", price_per_night=9000, active=True)
    db.add(prop)
    await db.flush()
    b = Booking(id=str(uuid.uuid4()), guest_id=guest, property_id=prop.id, check_in=date.today() + timedelta(days=30),
                check_out=date.today() + timedelta(days=31), total_amount=9500, platform_fee=300, status="cancelled")
    db.add(b)
    await db.flush()
    old = Payment(booking_id=b.id, type="refund", amount=9500, status="pending",
                  created_at=datetime.now(timezone.utc) - timedelta(minutes=30))
    fresh = Payment(booking_id=b.id, type="refund", amount=100, status="pending")
    db.add_all([old, fresh])
    await db.commit()
    with patch("app.workers.tasks.send_b2c_payment.delay") as send:
        await _release_due_async()
    sent = {c.args[0] for c in send.call_args_list}
    assert old.id in sent and fresh.id not in sent      # only rows stuck for 10+ minutes
