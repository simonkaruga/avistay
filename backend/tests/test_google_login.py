"""Google sign-in: friendly when not set up, forged links rejected, no takeover via unverified email."""
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models.models import User


@pytest.fixture
def google_on(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET", "secret")


def _google_returns(info: dict):
    """Patch httpx so Google's token + userinfo calls return `info`."""
    client = MagicMock()
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    client.post = AsyncMock(return_value=MagicMock(is_success=True, json=lambda: {"access_token": "g"}))
    client.get = AsyncMock(return_value=MagicMock(is_success=True, json=lambda: info))
    return patch("httpx.AsyncClient", return_value=client)


async def _start(client):
    r = await client.get("/api/auth/google", follow_redirects=False)
    state = r.headers["location"].split("state=")[1].split("&")[0]
    return state, r.cookies.get("g_state")


@pytest.mark.asyncio
async def test_not_set_up_sends_people_back_with_a_message(client, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "")
    r = await client.get("/api/auth/google", follow_redirects=False)
    assert r.status_code in (302, 307) and r.headers["location"].endswith("/profile?error=google_unavailable")
    assert (await client.get("/api/site")).json()["google_login"] is False


@pytest.mark.asyncio
async def test_forged_or_cancelled_callbacks_are_rejected(client, google_on):
    r = await client.get("/api/auth/google/callback?code=x&state=forged", follow_redirects=False)
    assert r.headers["location"].endswith("error=google_expired")
    r = await client.get("/api/auth/google/callback?error=access_denied", follow_redirects=False)
    assert r.headers["location"].endswith("error=google_cancelled")


@pytest.mark.asyncio
async def test_google_sign_in_works(client, db, google_on):
    state, cookie = await _start(client)
    gid = str(uuid.uuid4().int)[:18]
    with _google_returns({"id": gid, "email": f"{gid}@gmail.com", "verified_email": True, "name": "Wanjiru K"}):
        r = await client.get(f"/api/auth/google/callback?code=c&state={state}", cookies={"g_state": cookie},
                             follow_redirects=False)
    assert r.headers["location"].endswith("/profile") and "access_token" in r.cookies
    u = (await db.execute(select(User).where(User.google_id == gid))).scalar_one()
    assert u.name == "Wanjiru K"


@pytest.mark.asyncio
async def test_unverified_google_email_cannot_take_over_an_account(client, db, google_on):
    victim = User(id=str(uuid.uuid4()), email=f"victim{uuid.uuid4().hex[:6]}@example.com", role="owner")
    db.add(victim)
    await db.commit()
    state, cookie = await _start(client)
    with _google_returns({"id": "999" + uuid.uuid4().hex[:9], "email": victim.email, "verified_email": False}):
        await client.get(f"/api/auth/google/callback?code=c&state={state}", cookies={"g_state": cookie},
                         follow_redirects=False)
    await db.refresh(victim)
    assert victim.google_id is None                      # not linked to the attacker's Google account
