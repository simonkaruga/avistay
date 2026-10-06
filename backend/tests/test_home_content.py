import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import delete

from app.models.models import Booking, Destination, Offer, PromoCode, Property, User
from tests.conftest import auth_cookies

NOW = datetime.now(timezone.utc)


async def _user(db, role):
    u = User(id=str(uuid.uuid4()), phone=f"2547{uuid.uuid4().int % 10**8:08d}", role=role)
    db.add(u)
    await db.commit()
    return u.id


@pytest.fixture
async def clean(db):
    # Home content is global — start each test from an empty slate.
    for model in (Offer, Destination):
        await db.execute(delete(model))
    await db.execute(Property.__table__.update().values(featured_rank=None))
    await db.commit()


@pytest.mark.asyncio
async def test_offers_show_only_while_running(client, db, clean):
    db.add_all([
        Offer(title="Running now", link="/search", starts_at=NOW - timedelta(days=1), ends_at=NOW + timedelta(days=1)),
        Offer(title="Not started", link="/search", starts_at=NOW + timedelta(days=2)),
        Offer(title="Finished", link="/search", ends_at=NOW - timedelta(hours=1)),
        Offer(title="Switched off", link="/search", active=False),
    ])
    await db.commit()
    titles = [o["title"] for o in (await client.get("/api/home")).json()["offers"]]
    assert titles == ["Running now"]


@pytest.mark.asyncio
async def test_offer_validation(client, db, clean):
    admin = await _user(db, "admin")
    c = auth_cookies(admin)
    base = {"title": "Weekend escape"}
    for bad_link in ("https://evil.example.com", "//evil.example.com", "javascript:alert(1)"):
        r = await client.post("/api/admin/offers", cookies=c, json={**base, "link": bad_link})
        assert r.status_code == 422, bad_link
    r = await client.post("/api/admin/offers", cookies=c, json={**base, "promo_code": "NOPE"})
    assert r.status_code == 422
    r = await client.post("/api/admin/offers", cookies=c, json={
        **base, "starts_at": NOW.isoformat(), "ends_at": (NOW - timedelta(days=1)).isoformat()})
    assert r.status_code == 422
    r = await client.post("/api/admin/offers", cookies=c, json={**base, "image_url": "https://evil.example.com/x.jpg"})
    assert r.status_code == 422

    db.add(PromoCode(code="ESCAPE500", discount_kes=500, max_uses=50))
    await db.commit()
    r = await client.post("/api/admin/offers", cookies=c, json={
        **base, "link": "/search?type=cottage", "promo_code": " escape500 "})
    assert r.status_code == 201 and r.json()["promo_code"] == "ESCAPE500"


@pytest.mark.asyncio
async def test_only_admins_manage_home_content(client, db, clean):
    owner = await _user(db, "owner")
    for method, path in (("post", "/api/admin/offers"), ("post", "/api/admin/destinations"), ("get", "/api/admin/featured")):
        r = await getattr(client, method)(path, cookies=auth_cookies(owner), **({"json": {"title": "x", "name": "x"}} if method == "post" else {}))
        assert r.status_code == 403


@pytest.mark.asyncio
async def test_destinations_trend_by_recent_bookings(client, db, clean):
    owner = await _user(db, "owner")
    guest = await _user(db, "guest")
    db.add_all([
        Destination(name="Crescent Island", area="south-lake", sort_order=0),
        Destination(name="Hell's Gate", area="hells-gate", sort_order=1),
    ])
    camp = Property(id=str(uuid.uuid4()), owner_id=owner, title="Gorge Camp", type="campsite",
                    price_per_night=3000, active=True, area="hells-gate")
    db.add(camp)
    await db.flush()
    for i in range(2):
        db.add(Booking(guest_id=guest, property_id=camp.id, check_in=date.today() + timedelta(days=5 + i * 3),
                       check_out=date.today() + timedelta(days=6 + i * 3), total_amount=3000, platform_fee=300,
                       status="confirmed"))
    await db.commit()

    dests = (await client.get("/api/home")).json()["destinations"]
    assert [d["name"] for d in dests][:2] == ["Hell's Gate", "Crescent Island"]   # bookings beat manual order
    assert dests[0]["bookings_recent"] == 2 and dests[0]["stays"] >= 1
    assert dests[0]["area_label"] == "Hell's Gate & Olkaria"


@pytest.mark.asyncio
async def test_featured_stays_follow_admin_order(client, db, clean):
    admin, owner = await _user(db, "admin"), await _user(db, "owner")
    ids = []
    for title in ("Lake Jetty Cottage", "Treetop Tent"):
        p = Property(id=str(uuid.uuid4()), owner_id=owner, title=title, type="cottage", price_per_night=7000, active=True)
        db.add(p)
        ids.append(p.id)
    hidden = Property(id=str(uuid.uuid4()), owner_id=owner, title="Unapproved", type="villa", price_per_night=9000, active=False)
    db.add(hidden)
    await db.commit()

    c = auth_cookies(admin)
    assert (await client.put(f"/api/admin/featured/{ids[1]}", cookies=c, json={"featured_rank": 1, "featured_tagline": "Sleep in the acacias"})).status_code == 200
    assert (await client.put(f"/api/admin/featured/{ids[0]}", cookies=c, json={"featured_rank": 2})).status_code == 200
    assert (await client.put(f"/api/admin/featured/{hidden.id}", cookies=c, json={"featured_rank": 3})).status_code == 409

    featured = (await client.get("/api/home")).json()["featured"]
    assert [f["title"] for f in featured] == ["Treetop Tent", "Lake Jetty Cottage"]
    assert featured[0]["featured_tagline"] == "Sleep in the acacias"

    await client.put(f"/api/admin/featured/{ids[1]}", cookies=c, json={"featured_rank": None})
    assert [f["title"] for f in (await client.get("/api/home")).json()["featured"]] == ["Lake Jetty Cottage"]
