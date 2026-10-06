"""Auth sessions: web cookies vs mobile-app tokens, per-device sessions,
refresh rotation, and self-service account deletion."""
import uuid
from datetime import date, timedelta

import fakeredis.aioredis
import pytest
from sqlalchemy import select

from app.core.security import create_refresh_token
from app.models.models import Booking, Property, User
from tests.conftest import session_factory

NATIVE = {"X-Client": "native"}


@pytest.fixture(autouse=True)
def _redis(monkeypatch):
    fake = fakeredis.aioredis.FakeRedis(decode_responses=True)
    for mod in ("app.core.redis", "app.api.auth", "app.core.deps"):
        monkeypatch.setattr(f"{mod}.redis", fake, raising=False)
    return fake


async def _register(client, headers=None):
    n = uuid.uuid4().int % 10**8
    r = await client.post("/api/auth/email/register", headers=headers or {}, json={
        "phone": f"+2547{n:08d}", "email": f"u{n}@example.com", "password": "securepass123"})
    assert r.status_code == 200, r.text
    return r


@pytest.mark.asyncio
async def test_web_gets_cookies_not_tokens(client):
    r = await _register(client)
    assert r.json()["access_token"] is None
    assert "access_token" in r.cookies


@pytest.mark.asyncio
async def test_app_gets_tokens_and_uses_bearer(client):
    r = await _register(client, NATIVE)
    body = r.json()
    assert body["access_token"] and body["refresh_token"] and body["expires_in"] == 15 * 60
    assert "access_token" not in r.cookies
    client.cookies.clear()
    me = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200 and me.json()["user_id"] == body["user_id"]


@pytest.mark.asyncio
async def test_refresh_token_is_not_an_access_token(client):
    body = (await _register(client, NATIVE)).json()
    client.cookies.clear()
    r = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['refresh_token']}"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_refresh_rotates_and_rejects_reuse(client):
    body = (await _register(client, NATIVE)).json()
    first = await client.post("/api/auth/refresh", headers=NATIVE, json={"refresh_token": body["refresh_token"]})
    assert first.status_code == 200 and first.json()["refresh_token"] != body["refresh_token"]
    replay = await client.post("/api/auth/refresh", headers=NATIVE, json={"refresh_token": body["refresh_token"]})
    assert replay.status_code == 401


@pytest.mark.asyncio
async def test_phone_and_web_sessions_are_independent(client, _redis):
    body = (await _register(client, NATIVE)).json()
    user_id = body["user_id"]
    # A second device signs in for the same user.
    other, jti = create_refresh_token(user_id)
    await _redis.set(f"refresh:{user_id}:{jti}", "1")

    assert (await client.post("/api/auth/refresh", headers=NATIVE, json={"refresh_token": other})).status_code == 200
    # ...and the first device is still signed in.
    assert (await client.post("/api/auth/refresh", headers=NATIVE,
                              json={"refresh_token": body["refresh_token"]})).status_code == 200


@pytest.mark.asyncio
async def test_logout_ends_only_that_session(client):
    body = (await _register(client, NATIVE)).json()
    assert (await client.post("/api/auth/logout", json={"refresh_token": body["refresh_token"]})).status_code == 204
    r = await client.post("/api/auth/refresh", headers=NATIVE, json={"refresh_token": body["refresh_token"]})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_web_refresh_via_cookie(client):
    await _register(client)
    r = await client.post("/api/auth/refresh")
    assert r.status_code == 200 and "access_token" in r.cookies


@pytest.mark.asyncio
async def test_account_deletion_wipes_personal_data_and_sessions(client):
    body = (await _register(client, NATIVE)).json()
    auth = {"Authorization": f"Bearer {body['access_token']}"}
    client.cookies.clear()
    assert (await client.delete("/api/auth/account", headers=auth)).status_code == 204

    async with session_factory() as s:
        u = (await s.execute(select(User).where(User.id == body["user_id"]))).scalar_one()
    assert u.deleted_at is not None and u.phone is None and u.email is None and u.password_hash is None
    assert (await client.get("/api/auth/me", headers=auth)).status_code == 401
    assert (await client.post("/api/auth/refresh", headers=NATIVE,
                              json={"refresh_token": body["refresh_token"]})).status_code == 401


@pytest.mark.asyncio
async def test_account_deletion_blocked_by_upcoming_stay(client, db):
    body = (await _register(client, NATIVE)).json()
    owner = User(id=str(uuid.uuid4()), phone=f"2547{uuid.uuid4().int % 10**8:08d}", role="owner")
    db.add(owner)
    await db.flush()
    prop = Property(id=str(uuid.uuid4()), owner_id=owner.id, title="Lake Villa", type="villa",
                    price_per_night=5000, min_nights=1, active=True)
    db.add(prop)
    await db.flush()
    db.add(Booking(guest_id=body["user_id"], property_id=prop.id, check_in=date.today() + timedelta(days=5),
                   check_out=date.today() + timedelta(days=7), total_amount=10_000, platform_fee=300,
                   status="confirmed"))
    await db.commit()
    client.cookies.clear()
    r = await client.delete("/api/auth/account", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert r.status_code == 409
