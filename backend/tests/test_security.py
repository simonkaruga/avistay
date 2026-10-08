"""Security review fixes (2026-10-06): each test is an attack that must fail."""
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from app.core.security import create_access_token, create_refresh_token
from app.models.models import Property, Review, User
from app.services.ical import UnsafeUrl, check_public_https_url
from tests.conftest import auth_cookies


async def _user(db, role="guest", **kw):
    u = User(id=str(uuid.uuid4()), phone=f"+2547{uuid.uuid4().int % 10**8:08d}", role=role, **kw)
    db.add(u)
    await db.commit()
    return u


@pytest.mark.asyncio
async def test_banned_user_is_locked_out_everywhere(client, db):
    u = await _user(db)
    cookies = auth_cookies(u.id)
    assert (await client.get("/api/auth/me", cookies=cookies)).status_code == 200
    u.role = "banned"
    await db.commit()
    assert (await client.get("/api/auth/me", cookies=cookies)).status_code == 401           # old login dead
    assert (await client.get("/api/bookings/mine", cookies=cookies)).status_code == 401


@pytest.mark.asyncio
async def test_sign_out_everywhere_kills_old_tokens(client, db):
    u = await _user(db)
    old = create_access_token(u.id)
    old_refresh, _ = create_refresh_token(u.id)
    u.sessions_revoked_at = datetime.now(timezone.utc) + timedelta(seconds=1)
    await db.commit()
    assert (await client.get("/api/auth/me", cookies={"access_token": old})).status_code == 401
    r = await client.post("/api/auth/refresh", json={"refresh_token": old_refresh}, headers={"X-Client": "native"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_host_cannot_reply_on_another_hosts_review(client, db):
    victim, attacker, guest = await _user(db, "owner"), await _user(db, "owner"), await _user(db)
    prop = Property(id=str(uuid.uuid4()), owner_id=victim.id, title="Victim Cottage", type="cottage", price_per_night=5000, active=True)
    db.add(prop)
    await db.flush()
    from app.models.models import Booking
    from datetime import date
    b = Booking(id=str(uuid.uuid4()), guest_id=guest.id, property_id=prop.id, check_in=date(2026, 1, 1),
                check_out=date(2026, 1, 3), total_amount=1, platform_fee=0, status="completed")
    db.add(b)
    await db.flush()
    rv = Review(id=str(uuid.uuid4()), booking_id=b.id,
                accuracy_score=5, cleanliness_score=5, location_score=5, value_score=5, comment="Lovely")
    db.add(rv)
    await db.commit()
    r = await client.post(f"/api/reviews/{rv.id}/respond", cookies=auth_cookies(attacker.id), json={"response": "Spam"})
    assert r.status_code == 404
    r = await client.post(f"/api/reviews/{rv.id}/respond", cookies=auth_cookies(victim.id), json={"response": "Thank you!"})
    assert r.status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("url", [
    "http://example.com/cal.ics",                    # not https
    "https://127.0.0.1/cal.ics",                     # this server
    "https://169.254.169.254/latest/meta-data/",     # cloud metadata
    "https://10.0.0.5/cal.ics", "https://192.168.1.10/x", "https://[::1]/x",
    "https://user:pass@example.com/cal.ics",
    "file:///etc/passwd",
])
async def test_calendar_import_refuses_internal_addresses(url):
    with pytest.raises(UnsafeUrl):
        await check_public_https_url(url)


@pytest.mark.asyncio
async def test_application_status_reveals_nothing_private(client, db):
    from app.models.models import OwnerApplication
    for _ in range(2):   # applied twice: used to crash
        db.add(OwnerApplication(full_name="Jane", phone="+254733111222", national_id="12345678",
                                property_type="cottage", property_location="South Lake", status="rejected",
                                rejection_reason="Private note about the applicant"))
    await db.commit()
    r = await client.get("/api/applications/status/0733111222")
    assert r.status_code == 200 and r.json() == {"status": "rejected"}


@pytest.mark.asyncio
async def test_limits_still_hold_without_redis(client):
    from app.core import deps
    with patch.object(deps.redis, "incr", side_effect=ConnectionError("redis down")):
        codes = [(await client.post("/api/auth/email/login", json={"email": "victim@example.com", "password": "guess"})).status_code
                 for _ in range(12)]
    assert 429 in codes                                     # brute force is stopped


@pytest.mark.asyncio
async def test_security_headers_on_api(client):
    r = await client.get("/api/site")
    assert r.headers["x-frame-options"] == "DENY" and r.headers["x-content-type-options"] == "nosniff"
    assert (await client.get("/api/auth/me")).headers.get("cache-control") == "no-store"


@pytest.mark.asyncio
async def test_visitors_behind_the_proxy_get_their_own_limits(client):
    """On the live site every request comes via Vercel/Railway. One busy visitor
    must not use up the limit for everyone else."""
    def sign_in_code(ip):
        return client.post("/api/auth/otp/request", json={"phone": f"07{uuid.uuid4().int % 10**8:08d}"},
                           headers={"X-Forwarded-For": f"{ip}, 76.76.21.21"})
    first = [(await sign_in_code("41.90.1.1")).status_code for _ in range(11)]
    assert 429 in first                                       # that visitor is limited…
    assert (await sign_in_code("41.90.2.2")).status_code == 204   # …but the next one isn't


def test_callback_secret_never_reaches_logs(monkeypatch):
    import main
    from app.core.config import settings
    monkeypatch.setattr(settings, "MPESA_CALLBACK_SECRET", "abc-very-secret-callback-token-1234567890")
    assert "abc-very" not in main._redact("/api/payments/mpesa/callback/abc-very-secret-callback-token-1234567890")
    event = main._scrub_event({"request": {"url": "https://api.naivastay.com/api/payments/mpesa/callback/abc-very-secret-callback-token-1234567890"}}, None)
    assert "abc-very" not in event["request"]["url"]


@pytest.mark.asyncio
async def test_guests_never_get_the_host_commission(client):
    """The commission is between NaivaStay and the host. The settings every guest page
    loads must not carry it; only the Become-a-host page asks for it."""
    site = (await client.get("/api/site")).json()
    assert not any("commission" in k for k in site)
    assert (await client.get("/api/site/hosting")).json()["commission_pct"] == 10


@pytest.mark.asyncio
async def test_host_text_commands_need_the_webhook_secret(client, monkeypatch):
    """Anyone can fake the sender number, so without the secret URL a stranger could
    block or unblock a host's dates. Wrong or missing secret: nothing runs."""
    from app.api import whatsapp
    from app.core.config import settings
    ran = []

    async def fake_handle(sender, text):
        ran.append((sender, text))
        return "ok"
    monkeypatch.setattr(whatsapp, "_handle_command", fake_handle)
    monkeypatch.setattr(settings, "AT_API_KEY", "")            # don't send real replies
    cmd = {"from": "+254700000001", "text": "UNBLOCK abcd1234 2026-12-01 2026-12-05"}

    monkeypatch.setattr(settings, "AT_WEBHOOK_SECRET", "")     # not configured: off
    assert (await client.post("/api/whatsapp/incoming/anything", data=cmd)).status_code == 404
    monkeypatch.setattr(settings, "AT_WEBHOOK_SECRET", "s" * 40)
    for path in ("/api/whatsapp/incoming/wrong", "/api/whatsapp/sms-incoming/wrong"):
        assert (await client.post(path, data=cmd)).status_code == 404
    assert (await client.post("/api/whatsapp/incoming", data=cmd)).status_code in (404, 405)
    assert ran == []

    assert (await client.post(f"/api/whatsapp/incoming/{'s' * 40}", data=cmd)).status_code == 200
    assert (await client.post(f"/api/whatsapp/sms-incoming/{'s' * 40}", data=cmd)).status_code == 200
    assert len(ran) == 2


def _start_live(env: dict):
    """Load the settings in a fresh Python as the live site would."""
    import os
    import subprocess
    import sys
    base = {"FRONTEND_URL": "https://naivastay.com", "JWT_SECRET_KEY": "x" * 48, "PAYSTACK_SECRET_KEY": "",
            "MPESA_CONSUMER_KEY": "", "AT_WEBHOOK_SECRET": ""}
    return subprocess.run(
        [sys.executable, "-c", "from app.core.config import settings; print(settings.ALLOWED_ORIGINS)"],
        env={**os.environ, **base, **env}, capture_output=True, text=True, cwd=os.path.dirname(os.path.dirname(__file__)))


def test_live_site_refuses_paystack_test_key_and_drops_dev_origin():
    bad = _start_live({"PAYSTACK_SECRET_KEY": "sk_test_abc"})
    assert bad.returncode != 0 and "test key" in bad.stderr
    ok = _start_live({"PAYSTACK_SECRET_KEY": "sk_live_abc"})
    assert ok.returncode == 0, ok.stderr
    assert "http://localhost:5173" not in ok.stdout and "https://localhost" in ok.stdout
