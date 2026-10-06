"""Agent programme: referral codes credit bookings, agents are paid with the host."""
import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

import app.core.database as database
from app.core.config import settings
from app.models.models import Agent, AgentReferral, Booking, Payment, Property, User
from app.workers.tasks import _release_due_async, _send_b2c_async
from tests.conftest import auth_cookies, session_factory

SECRET = "test-callback-secret-0123456789abcdef"


@pytest.fixture(autouse=True)
def _wire(monkeypatch):
    monkeypatch.setattr(database, "AsyncSessionLocal", session_factory)
    monkeypatch.setattr(settings, "MPESA_CALLBACK_SECRET", SECRET)
    with patch("app.workers.tasks.send_b2c_payment.delay") as b2c, \
         patch("app.workers.tasks.send_booking_notifications.delay"), \
         patch("app.workers.tasks._send_sms", new=AsyncMock()):
        yield b2c


def _phone():
    return f"+2547{uuid.uuid4().int % 10**8:08d}"


async def _setup(db, agent_status="active"):
    owner = User(id=str(uuid.uuid4()), phone=_phone(), role="owner")
    guest = User(id=str(uuid.uuid4()), phone=_phone(), role="guest")
    agent_user = User(id=str(uuid.uuid4()), phone=_phone(), role="guest")
    db.add_all([owner, guest, agent_user])
    await db.flush()
    agent = Agent(user_id=agent_user.id, status=agent_status, commission_pct=5)
    prop = Property(id=str(uuid.uuid4()), owner_id=owner.id, title="Agent Test Cottage", type="cottage",
                    price_per_night=10_000, min_nights=1, active=True)
    db.add_all([agent, prop])
    await db.commit()
    return owner, guest, agent, agent_user, prop


_offset = iter(range(40, 400, 5))


async def _book(client, guest_id, prop_id, ref):
    ci = date.today() + timedelta(days=next(_offset))
    r = await client.post("/api/bookings/", cookies=auth_cookies(guest_id), json={
        "property_id": prop_id, "check_in": ci.isoformat(), "check_out": (ci + timedelta(days=2)).isoformat(),
        "guests": 2, "terms_accepted": True, "ref_code": ref})
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.mark.asyncio
async def test_referral_code_credits_the_agent_on_room_price(client, db):
    _, guest, agent, _, prop = await _setup(db)
    booking_id = await _book(client, guest.id, prop.id, agent.ref_code.lower())   # codes are case-insensitive
    async with session_factory() as s:
        b = await s.get(Booking, booking_id)
        ref = (await s.execute(select(AgentReferral).where(AgentReferral.booking_id == booking_id))).scalar_one()
    assert b.agent_id == agent.id and ref.commission_kes == 1_000      # 5% of 20,000 room, nothing on fees


@pytest.mark.asyncio
async def test_codes_that_must_not_earn(client, db):
    owner, guest, agent, agent_user, prop = await _setup(db, agent_status="pending")
    for code in (agent.ref_code, "AVNOPE99", None):                       # unapproved, unknown, none
        booking_id = await _book(client, guest.id, prop.id, code)
        async with session_factory() as s:
            assert (await s.get(Booking, booking_id)).agent_id is None
    # An agent can't earn on their own listing.
    async with session_factory() as s:
        a = await s.get(Agent, agent.id)
        a.status = "active"
        p = await s.get(Property, prop.id)
        p.owner_id = agent_user.id
        await s.commit()
    booking_id = await _book(client, guest.id, prop.id, agent.ref_code)
    async with session_factory() as s:
        assert (await s.get(Booking, booking_id)).agent_id is None


@pytest.mark.asyncio
async def test_agent_paid_with_the_host_and_marked_paid_on_confirmation(client, db, _wire):
    _, guest, agent, agent_user, prop = await _setup(db)
    booking_id = await _book(client, guest.id, prop.id, agent.ref_code)
    async with session_factory() as s:   # paid, checked in two days ago, no complaints
        b = await s.get(Booking, booking_id)
        b.status, b.check_in = "checked_in", date.today() - timedelta(days=2)
        b.check_out = date.today() + timedelta(days=1)
        b.checked_in_at = datetime.now(timezone.utc) - timedelta(days=2)
        s.add(Payment(booking_id=b.id, type="charge", amount=b.total_amount, status="completed", mpesa_ref="QAG1"))
        await s.commit()
    await _release_due_async()
    async with session_factory() as s:
        pays = {p.type: p for p in (await s.execute(select(Payment).where(Payment.booking_id == booking_id))).scalars()}
    assert "payout" in pays and pays["agent_commission"].amount == 1_000

    # The commission goes to the agent's phone, not the host's or guest's.
    monkey_key = settings.MPESA_CONSUMER_KEY
    settings.MPESA_CONSUMER_KEY = "configured"
    try:
        with patch("app.services.mpesa.b2c_payment", new=AsyncMock(return_value="AG-CONV-1")) as b2c:
            await _send_b2c_async(pays["agent_commission"].id)
    finally:
        settings.MPESA_CONSUMER_KEY = monkey_key
    assert b2c.call_args.args[0] == agent_user.phone.lstrip("+")

    await client.post(f"/api/payments/mpesa/callback/{SECRET}/b2c/result", json={
        "Result": {"ConversationID": "AG-CONV-1", "ResultCode": 0, "TransactionID": "SAG123", "ResultDesc": "ok"}})
    async with session_factory() as s:
        ref = (await s.execute(select(AgentReferral).where(AgentReferral.booking_id == booking_id))).scalar_one()
        a = await s.get(Agent, agent.id)
    assert ref.status == "paid" and a.total_earned == 1_000

    await _release_due_async()   # running again never pays twice
    async with session_factory() as s:
        n = len((await s.execute(select(Payment).where(Payment.booking_id == booking_id,
                                                        Payment.type == "agent_commission"))).scalars().all())
    assert n == 1


@pytest.mark.asyncio
async def test_admin_approves_agents(client, db):
    _, _, agent, _, _ = await _setup(db, agent_status="pending")
    admin = User(id=str(uuid.uuid4()), phone=_phone(), role="admin")
    db.add(admin)
    await db.commit()
    rows = (await client.get("/api/admin/console/agents", cookies=auth_cookies(admin.id))).json()
    assert any(r["id"] == agent.id and r["ref_code"] == agent.ref_code for r in rows)
    r = await client.patch(f"/api/admin/console/agents/{agent.id}", cookies=auth_cookies(admin.id),
                           json={"status": "active", "commission_pct": 7})
    assert r.json() == {"id": agent.id, "status": "active", "commission_pct": 7}
