import uuid
from datetime import date, timedelta
from unittest.mock import patch

import pytest
from sqlalchemy import delete, select

from app.models.models import AuditLog, Booking, Payment, PlatformSetting, Property, User
from app.services import settings as platform_settings
from tests.conftest import auth_cookies

B2C = "app.workers.tasks.send_b2c_payment.delay"


async def _user(db, role="guest", superadmin=False):
    u = User(id=str(uuid.uuid4()), phone=f"2547{uuid.uuid4().int % 10**8:08d}", role=role, is_superadmin=superadmin)
    db.add(u)
    await db.commit()
    return u.id


async def _booking(db, status="confirmed", paid=12_000):
    owner = await _user(db, "owner")
    guest = await _user(db)
    prop = Property(id=str(uuid.uuid4()), owner_id=owner, title="Lake Cottage", type="cottage",
                    price_per_night=5000, active=True)
    db.add(prop)
    await db.flush()
    b = Booking(id=str(uuid.uuid4()), guest_id=guest, property_id=prop.id,
                check_in=date.today() + timedelta(days=5), check_out=date.today() + timedelta(days=7),
                total_amount=paid, platform_fee=300, room_amount=10_000, levy_amount=200, status=status)
    db.add(b)
    await db.flush()
    db.add(Payment(booking_id=b.id, type="charge", amount=paid, status="completed", mpesa_ref="QAB123"))
    await db.commit()
    return b.id, prop.id


@pytest.fixture
async def reset_settings(db):
    yield
    await db.rollback()
    await db.execute(delete(PlatformSetting))
    await db.commit()
    await platform_settings.refresh(db, force=True)


# ── Access ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_console_is_admin_only(client, db):
    owner = await _user(db, "owner")
    for path in ("/api/admin/console/overview", "/api/admin/console/users", "/api/admin/console/settings"):
        assert (await client.get(path, cookies=auth_cookies(owner))).status_code == 403
    admin = await _user(db, "admin")
    r = await client.get("/api/admin/console/overview", cookies=auth_cookies(admin))
    assert r.status_code == 200 and "needs_attention" in r.json()


@pytest.mark.asyncio
async def test_only_superadmin_changes_staff_access(client, db):
    admin = await _user(db, "admin")
    boss = await _user(db, "admin", superadmin=True)
    target = await _user(db)

    r = await client.patch(f"/api/admin/console/users/{target}", cookies=auth_cookies(admin), json={"role": "admin"})
    assert r.status_code == 403
    # plain admin can still do ordinary changes
    r = await client.patch(f"/api/admin/console/users/{target}", cookies=auth_cookies(admin), json={"verified": True})
    assert r.status_code == 200 and r.json()["verified_at"]

    r = await client.patch(f"/api/admin/console/users/{target}", cookies=auth_cookies(boss), json={"is_superadmin": True})
    assert r.status_code == 409          # must be admin first
    r = await client.patch(f"/api/admin/console/users/{target}", cookies=auth_cookies(boss), json={"role": "admin"})
    assert r.status_code == 200 and r.json()["role"] == "admin"

    r = await client.patch(f"/api/admin/console/users/{boss}", cookies=auth_cookies(boss), json={"is_superadmin": False})
    assert r.status_code == 409          # can't lock yourself out
    logged = (await db.execute(select(AuditLog).where(AuditLog.entity_id == target))).scalars().all()
    assert {a.event_type for a in logged} == {"user_updated"}


# ── Settings ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_settings_change_prices_immediately(client, db, reset_settings):
    admin = await _user(db, "admin")
    boss = await _user(db, "admin", superadmin=True)
    _, prop_id = await _booking(db)
    q = {"property_id": prop_id, "check_in": (date.today() + timedelta(days=20)).isoformat(),
         "check_out": (date.today() + timedelta(days=22)).isoformat()}

    r = await client.get("/api/admin/console/settings", cookies=auth_cookies(admin))
    assert r.status_code == 200 and r.json()["can_edit"] is False
    assert (await client.put("/api/admin/console/settings", cookies=auth_cookies(admin),
                             json={"service_fee_kes": 500})).status_code == 403

    r = await client.put("/api/admin/console/settings", cookies=auth_cookies(boss), json={"service_fee_kes": 99_999})
    assert r.status_code == 422
    r = await client.put("/api/admin/console/settings", cookies=auth_cookies(boss), json={"nope": 1})
    assert r.status_code == 422

    r = await client.put("/api/admin/console/settings", cookies=auth_cookies(boss), json={"service_fee_kes": 500})
    assert r.status_code == 200
    quote = (await client.get("/api/bookings/quote", params=q)).json()
    assert quote["platform_fee"] == 500


# ── Bookings & money ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_cancel_refunds_what_was_paid(client, db):
    admin = await _user(db, "admin")
    booking_id, _ = await _booking(db, paid=12_000)
    with patch(B2C) as sent:
        r = await client.post(f"/api/admin/console/bookings/{booking_id}/cancel", cookies=auth_cookies(admin),
                              json={"reason": "Host unreachable before arrival"})
    assert r.status_code == 200 and r.json()["refund"] == 12_000
    assert sent.call_count == 1
    db.expire_all()
    b = await db.get(Booking, booking_id)
    assert b.status == "cancelled" and b.cancelled_by == "admin"

    r = await client.post(f"/api/admin/console/bookings/{booking_id}/cancel", cookies=auth_cookies(admin),
                          json={"reason": "Twice by mistake"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_retry_only_failed_and_only_once(client, db):
    admin = await _user(db, "admin")
    booking_id, _ = await _booking(db, status="completed")
    stuck = Payment(booking_id=booking_id, type="payout", amount=8_700, status="processing")
    failed = Payment(booking_id=booking_id, type="refund", amount=500, status="failed")
    db.add_all([stuck, failed])
    await db.commit()

    r = await client.post(f"/api/admin/console/payments/{stuck.id}/retry", cookies=auth_cookies(admin))
    assert r.status_code == 409          # may already have been sent
    with patch(B2C) as sent:
        r = await client.post(f"/api/admin/console/payments/{failed.id}/retry", cookies=auth_cookies(admin))
    assert r.status_code == 200 and r.json()["status"] == "pending" and sent.call_count == 1
    r = await client.post(f"/api/admin/console/payments/{failed.id}/retry", cookies=auth_cookies(admin))
    assert r.status_code == 409          # no double payment


@pytest.mark.asyncio
async def test_resolving_stuck_payment_needs_superadmin(client, db):
    admin = await _user(db, "admin")
    boss = await _user(db, "admin", superadmin=True)
    booking_id, _ = await _booking(db, status="completed")
    stuck = Payment(booking_id=booking_id, type="payout", amount=8_700, status="processing")
    db.add(stuck)
    await db.commit()
    body = {"status": "completed", "mpesa_ref": "SFX12345", "note": "Seen in M-Pesa org portal"}
    assert (await client.post(f"/api/admin/console/payments/{stuck.id}/resolve", cookies=auth_cookies(admin),
                              json=body)).status_code == 403
    r = await client.post(f"/api/admin/console/payments/{stuck.id}/resolve", cookies=auth_cookies(boss), json=body)
    assert r.status_code == 200 and r.json()["status"] == "completed" and r.json()["mpesa_ref"] == "SFX12345"


# ── Listings, promos, reports ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_edits_any_listing(client, db):
    admin = await _user(db, "admin")
    _, prop_id = await _booking(db)
    listing = (await client.get(f"/api/admin/console/listings/{prop_id}", cookies=auth_cookies(admin))).json()
    payload = {k: listing[k] for k in ("title", "type", "price_per_night", "description", "min_nights", "cancellation_policy")}
    payload.update(title="Lake Cottage with Jetty", price_per_night=6500)
    r = await client.put(f"/api/admin/console/listings/{prop_id}", cookies=auth_cookies(admin), json=payload)
    assert r.status_code == 200 and set(r.json()["changed"]) == {"title", "price_per_night"}

    r = await client.post(f"/api/admin/console/listings/{prop_id}/status", cookies=auth_cookies(admin),
                          json={"active": False, "reason": "Photos don't match"})
    assert r.status_code == 200 and r.json()["active"] is False


@pytest.mark.asyncio
async def test_promo_codes(client, db):
    admin = await _user(db, "admin")
    code = f"LAKE{uuid.uuid4().hex[:5]}"
    r = await client.post("/api/admin/console/promo-codes", cookies=auth_cookies(admin),
                          json={"code": code.lower(), "discount_kes": 1000, "max_uses": 20})
    assert r.status_code == 201 and r.json()["code"] == code.upper()
    assert (await client.post("/api/admin/console/promo-codes", cookies=auth_cookies(admin),
                              json={"code": code, "discount_kes": 1000})).status_code == 409
    r = await client.post(f"/api/admin/console/promo-codes/{r.json()['id']}/end", cookies=auth_cookies(admin))
    assert r.status_code == 200 and r.json()["expires_at"]


@pytest.mark.asyncio
async def test_levy_report(client, db):
    admin = await _user(db, "admin")
    booking_id, _ = await _booking(db)
    month = (date.today() + timedelta(days=5)).strftime("%Y-%m")
    r = await client.get("/api/admin/console/reports/levy", params={"month": month}, cookies=auth_cookies(admin))
    assert r.status_code == 200
    assert booking_id[:8].upper() in {line["booking"] for line in r.json()["lines"]}
    r = await client.get("/api/admin/console/reports/levy", params={"month": month, "format": "csv"},
                         cookies=auth_cookies(admin))
    assert r.status_code == 200 and r.text.startswith("booking,") and "TOTAL" in r.text


@pytest.mark.asyncio
async def test_site_notice_is_public(client, db, reset_settings):
    boss = await _user(db, "admin", superadmin=True)
    assert (await client.get("/api/site")).json()["site_notice"] is None
    await client.put("/api/admin/console/settings", cookies=auth_cookies(boss),
                     json={"site_notice": "M-Pesa maintenance tonight 11pm–1am"})
    assert (await client.get("/api/site")).json()["site_notice"].startswith("M-Pesa")
    me = (await client.get("/api/auth/me", cookies=auth_cookies(boss))).json()
    assert me["is_superadmin"] is True


@pytest.mark.asyncio
async def test_dashboard_shows_paystack(client, db, monkeypatch):
    """The overview says whether Paystack is on and splits money in by M-Pesa vs Paystack;
    the payments list can show Paystack only."""
    from app.core.config import settings
    admin = await _user(db, "admin")

    def overview():
        return client.get("/api/admin/console/overview", cookies=auth_cookies(admin))

    monkeypatch.setattr(settings, "PAYSTACK_SECRET_KEY", "")
    assert (await overview()).json()["guest_payments"]["paystack"] == "off"
    monkeypatch.setattr(settings, "PAYSTACK_SECRET_KEY", "sk_test_x")
    before = (await overview()).json()["guest_payments"]
    assert before["paystack"] == "test"

    booking_id, _ = await _booking(db, paid=12_000)                     # M-Pesa charge
    db.add(Payment(booking_id=booking_id, type="charge", method="card", amount=20_000, fee_amount=700,
                   status="completed", provider_request_id=f"NSC-{uuid.uuid4()}"))
    await db.commit()

    after = (await overview()).json()["guest_payments"]["last_30_days"]
    was = before["last_30_days"]
    assert after["mpesa"]["amount"] - was["mpesa"]["amount"] == 12_000
    assert after["card"]["amount"] - was["card"]["amount"] == 20_000
    assert after["card"]["card_fees"] - was["card"]["card_fees"] == 700
    assert after["card"]["count"] - was["card"]["count"] == 1

    rows = (await client.get("/api/admin/console/payments", params={"method": "card"},
                             cookies=auth_cookies(admin))).json()
    assert rows and all(r["method"] == "card" for r in rows)

    monkeypatch.setattr(settings, "PAYSTACK_SECRET_KEY", "sk_live_x")
    assert (await overview()).json()["guest_payments"]["paystack"] == "live"
