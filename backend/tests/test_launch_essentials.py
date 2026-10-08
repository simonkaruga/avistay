"""Launch essentials: KRA PIN + TRA licence, withholding tax, guest details for hosts, messaging."""
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import select

import app.core.database as database
from app.core.timeutil import today_eat
from app.models.models import Booking, Payment, Property, User
from app.workers.tasks import _release_due_async
from tests.conftest import auth_cookies, session_factory


@pytest.fixture(autouse=True)
def _wire(monkeypatch):
    monkeypatch.setattr(database, "AsyncSessionLocal", session_factory)
    with patch("app.workers.tasks.send_b2c_payment.delay"), \
         patch("app.workers.tasks.notify_new_message.delay") as note:
        yield note


def _phone():
    return f"+2547{uuid.uuid4().int % 10**8:08d}"


async def _setup(db, *, status="confirmed", check_in=None, kra=None, tra=None):
    owner = User(id=str(uuid.uuid4()), phone=_phone(), role="owner", name="Mary Host", kra_pin=kra)
    guest = User(id=str(uuid.uuid4()), phone=_phone(), role="guest", name="John Guest", email=f"{uuid.uuid4().hex[:6]}@x.com")
    db.add_all([owner, guest])
    await db.flush()
    prop = Property(id=str(uuid.uuid4()), owner_id=owner.id, title="Essentials Cottage", type="cottage",
                    price_per_night=10_000, active=False, tra_licence_no=tra)
    db.add(prop)
    await db.flush()
    ci = check_in or today_eat() + timedelta(days=10)
    b = Booking(id=str(uuid.uuid4()), guest_id=guest.id, property_id=prop.id, check_in=ci, check_out=ci + timedelta(days=2),
                total_amount=20_700, platform_fee=300, room_amount=20_000, levy_amount=400, commission_kes=2_000,
                status=status, guests=3)
    db.add(b)
    await db.commit()
    return owner, guest, prop, b


async def _admin(db):
    a = User(id=str(uuid.uuid4()), phone=_phone(), role="admin")
    db.add(a)
    await db.commit()
    return a


# ── KRA PIN + TRA licence ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_listing_cannot_go_live_without_kra_pin_and_tra_licence(client, db):
    owner, _, prop, _ = await _setup(db)
    admin = await _admin(db)
    r = await client.post(f"/api/admin/console/listings/{prop.id}/status", cookies=auth_cookies(admin.id), json={"active": True})
    assert r.status_code == 409 and "KRA PIN" in r.json()["detail"] and "TRA" in r.json()["detail"]

    assert (await client.put("/api/owner/compliance", cookies=auth_cookies(owner.id), json={"kra_pin": "12345"})).status_code == 422
    r = await client.put("/api/owner/compliance", cookies=auth_cookies(owner.id), json={"kra_pin": "a 012345678 z"})
    assert r.status_code == 200 and r.json()["kra_pin"] == "A012345678Z"
    c = (await client.get("/api/owner/compliance", cookies=auth_cookies(owner.id))).json()
    assert c["listings"][0]["missing"] == ["the Tourism Regulatory Authority (TRA) licence number"]

    async with session_factory() as s:
        p = await s.get(Property, prop.id)
        p.tra_licence_no = "TRA/NKR/2026/0123"
        await s.commit()
    r = await client.post(f"/api/admin/console/listings/{prop.id}/status", cookies=auth_cookies(admin.id), json={"active": True})
    assert r.status_code == 200 and r.json()["active"] is True


# ── Withholding tax ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_withholding_tax_is_deducted_from_payout_and_reported(client, db):
    owner, guest, prop, b = await _setup(db, status="checked_in", check_in=today_eat() - timedelta(days=2), kra="A012345678Z")
    async with session_factory() as s:
        bk = await s.get(Booking, b.id)
        bk.checked_in_at = datetime.now(timezone.utc) - timedelta(days=2)
        s.add(Payment(booking_id=b.id, type="charge", amount=20_700, status="completed", mpesa_ref="QWHT1"))
        await s.commit()
    await _release_due_async()
    async with session_factory() as s:
        payout = (await s.execute(select(Payment).where(Payment.booking_id == b.id, Payment.type == "payout"))).scalar_one()
    assert payout.tax_withheld == 900 and payout.amount == 17_100          # 18,000 gross, 5% withheld

    admin = await _admin(db)
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    rep = (await client.get("/api/admin/console/reports/withholding", params={"month": month}, cookies=auth_cookies(admin.id))).json()
    line = next(x for x in rep["lines"] if x["booking"] == b.id[:8].upper())
    assert line["kra_pin"] == "A012345678Z" and line["tax_withheld"] == 900 and line["gross"] == 18_000
    host = (await client.get("/api/owner/bookings", cookies=auth_cookies(owner.id))).json()[0]
    assert host["your_payout"] == 17_100


# ── Guest details for the host ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_host_sees_guest_contact_only_once_paid(client, db):
    owner, guest, prop, b = await _setup(db, status="pending")
    row = (await client.get("/api/owner/bookings", cookies=auth_cookies(owner.id))).json()[0]
    assert row["guest"] == {"name": "John", "phone": None, "email": None, "id_verified": False, "shared": False}
    async with session_factory() as s:
        (await s.get(Booking, b.id)).status = "confirmed"
        await s.commit()
    row = (await client.get("/api/owner/bookings", cookies=auth_cookies(owner.id))).json()[0]
    assert row["guest"]["name"] == "John Guest" and row["guest"]["phone"] == guest.phone and row["guests"] == 3
    mine = (await client.get("/api/bookings/mine", cookies=auth_cookies(guest.id))).json()[0]
    assert mine["host"] == {"name": "Mary", "phone": owner.phone}


# ── Messaging ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_guest_and_host_can_message_strangers_cannot(client, db, _wire):
    owner, guest, prop, b = await _setup(db)
    stranger = User(id=str(uuid.uuid4()), phone=_phone())
    db.add(stranger)
    await db.commit()
    url = f"/api/bookings/{b.id}/messages"
    r = await client.post(url, cookies=auth_cookies(guest.id), json={"body": "What time can we arrive?"})
    assert r.status_code == 201 and r.json()["mine"] is True
    assert _wire.call_args.args[1] == owner.id                                        # host is notified
    assert (await client.get("/api/messages/unread", cookies=auth_cookies(owner.id))).json()["total"] == 1
    assert (await client.get("/api/owner/bookings", cookies=auth_cookies(owner.id))).json()[0]["unread_messages"] == 1

    thread = (await client.get(url, cookies=auth_cookies(owner.id))).json()
    assert thread["role"] == "host" and thread["with"] == "John" and thread["messages"][0]["body"] == "What time can we arrive?"
    assert (await client.get("/api/messages/unread", cookies=auth_cookies(owner.id))).json()["total"] == 0  # read now
    await client.post(url, cookies=auth_cookies(owner.id), json={"body": "From 2pm. The gate code comes the day before."})
    thread = (await client.get(url, cookies=auth_cookies(guest.id))).json()
    assert [m["mine"] for m in thread["messages"]] == [True, False]

    assert (await client.get(url, cookies=auth_cookies(stranger.id))).status_code == 404
    assert (await client.post(url, cookies=auth_cookies(stranger.id), json={"body": "hi"})).status_code == 404
    assert (await client.post(url, cookies=auth_cookies(guest.id), json={"body": "x" * 2001})).status_code == 422
    admin = await _admin(db)
    assert (await client.get(url, cookies=auth_cookies(admin.id))).json()["role"] == "admin"


@pytest.mark.asyncio
async def test_old_conversations_close(client, db):
    owner, guest, prop, b = await _setup(db, status="completed", check_in=today_eat() - timedelta(days=60))
    r = await client.post(f"/api/bookings/{b.id}/messages", cookies=auth_cookies(guest.id), json={"body": "hello"})
    assert r.status_code == 409
