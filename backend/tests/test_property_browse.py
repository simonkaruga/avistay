import uuid
from datetime import date, timedelta

import pytest

from app.models.models import Availability, Property, User


async def _host_with(db, **props):
    owner = User(id=str(uuid.uuid4()), phone=f"2547{uuid.uuid4().int % 10**8:08d}", role="owner")
    db.add(owner)
    await db.flush()
    fields = {"title": "Fig Tree Cottage", "type": "cottage", **props}
    p = Property(id=str(uuid.uuid4()), owner_id=owner.id, price_per_night=6000, min_nights=1, active=True, **fields)
    db.add(p)
    await db.commit()
    return p


@pytest.mark.asyncio
async def test_area_filter_and_summary(client, db):
    tag = uuid.uuid4().hex[:6]
    a = await _host_with(db, title=f"Lakeside {tag}", area="south-lake")
    await _host_with(db, title=f"Gorge Camp {tag}", area="hells-gate", type="campsite")

    r = await client.get("/api/properties/", params={"area": "south-lake", "location": tag})
    assert [p["id"] for p in r.json()] == [a.id]
    assert r.json()[0]["area"] == "south-lake"

    s = (await client.get("/api/properties/summary")).json()
    areas = {x["slug"]: x for x in s["areas"]}
    assert areas["south-lake"]["label"] == "South Lake Road" and areas["south-lake"]["count"] >= 1
    assert s["types"]["campsite"] >= 1


@pytest.mark.asyncio
async def test_search_box_text_matches_name_and_area_name(client, db):
    tag = uuid.uuid4().hex[:6]
    p = await _host_with(db, title=f"Acacia {tag}", area="longonot")
    by_name = (await client.get("/api/properties/", params={"location": f"acacia {tag}"})).json()
    assert [x["id"] for x in by_name] == [p.id]
    by_area = [x["id"] for x in (await client.get("/api/properties/", params={"location": "Longonot", "limit": 100})).json()]
    assert p.id in by_area


@pytest.mark.asyncio
async def test_weekend_availability_excludes_booked_homes(client, db):
    tag = uuid.uuid4().hex[:6]
    free = await _host_with(db, title=f"Free {tag}")
    busy = await _host_with(db, title=f"Busy {tag}")
    fri = date.today() + timedelta(days=30)
    db.add(Availability(property_id=busy.id, date=fri, is_blocked=True, source="manual"))
    await db.commit()
    r = await client.get("/api/properties/", params={
        "location": tag, "check_in": fri.isoformat(), "check_out": (fri + timedelta(days=2)).isoformat()})
    assert [x["id"] for x in r.json()] == [free.id]


@pytest.mark.asyncio
async def test_unknown_area_rejected(client, db):
    owner = User(id=str(uuid.uuid4()), phone=f"2547{uuid.uuid4().int % 10**8:08d}", role="owner")
    db.add(owner)
    await db.commit()
    from tests.conftest import auth_cookies
    r = await client.post("/api/properties/", cookies=auth_cookies(owner.id), json={
        "title": "Nowhere Villa", "type": "villa", "price_per_night": 9000, "area": "atlantis"})
    assert r.status_code == 422


def test_public_name_never_reveals_full_name():
    from datetime import datetime, timezone
    from app.api.reviews import public_name
    assert public_name("wanjiru kamau njoroge") == "Wanjiru N."
    assert public_name("Brian") == "Brian"
    assert public_name(None) == "Verified guest"
    assert public_name("Ann Lee", datetime.now(timezone.utc)) == "Verified guest"   # deleted account


@pytest.mark.asyncio
async def test_property_page_has_host_and_policy(client, db):
    p = await _host_with(db, title=f"Detail {uuid.uuid4().hex[:6]}", area="south-lake", cancellation_policy="strict",
                         deposit_amount=5000, max_guests=6, pets_allowed=True, quiet_hours="22:00-07:00")
    d = (await client.get(f"/api/properties/{p.id}")).json()
    assert d["area_label"] == "South Lake Road"
    assert d["deposit_amount"] == 5000                       # the owner's choice
    assert d["max_guests"] == 6 and d["pets_allowed"] is True and d["quiet_hours"] == "22:00-07:00"
    assert d["policy_summary"].startswith("50% refund")
    assert "phone" not in d and "owner_id" not in d          # host contact details stay private


@pytest.mark.asyncio
async def test_owner_house_rules_validation_and_guest_limit(client, db):
    from tests.conftest import auth_cookies
    owner = User(id=str(uuid.uuid4()), phone=f"2547{uuid.uuid4().int % 10**8:08d}", role="owner")
    db.add(owner)
    await db.commit()
    c = auth_cookies(owner.id)
    base = {"title": "Rules Villa", "type": "villa", "price_per_night": 9000}
    assert (await client.post("/api/properties/", cookies=c, json={**base, "check_in_from": "25:00"})).status_code == 422
    assert (await client.post("/api/properties/", cookies=c, json={**base, "cancellation_policy": "lenient"})).status_code == 422
    assert (await client.post("/api/properties/", cookies=c, json={**base, "deposit_amount": -1})).status_code == 422
    r = await client.post("/api/properties/", cookies=c, json={
        **base, "deposit_amount": 0, "max_guests": 2, "check_in_from": "9:00", "quiet_hours": "22:00 - 6:30"})
    assert r.status_code == 201, r.text
    assert r.json()["check_in_from"] == "09:00" and r.json()["quiet_hours"] == "22:00-06:30"

    # Editing works too and keeps the owner's rules.
    upd = await client.put(f"/api/properties/{r.json()['id']}", cookies=c, json={**base, "max_guests": 2, "pets_allowed": True})
    assert upd.status_code == 200, upd.text
    assert upd.json()["pets_allowed"] is True and upd.json()["images"] == []

    # Guest limit is enforced at booking time.
    prop_id = r.json()["id"]
    await db.execute(Property.__table__.update().where(Property.id == prop_id).values(active=True))
    await db.commit()
    guest = User(id=str(uuid.uuid4()), phone=f"2547{uuid.uuid4().int % 10**8:08d}", role="guest")
    db.add(guest)
    await db.commit()
    ci = date.today() + timedelta(days=40)
    payload = {"property_id": prop_id, "check_in": ci.isoformat(), "check_out": (ci + timedelta(days=2)).isoformat(),
               "terms_accepted": True}
    too_many = await client.post("/api/bookings/", cookies=auth_cookies(guest.id), json={**payload, "guests": 3})
    assert too_many.status_code == 400 and "up to 2" in too_many.json()["detail"]
    ok = await client.post("/api/bookings/", cookies=auth_cookies(guest.id), json={**payload, "guests": 2})
    assert ok.status_code == 201 and ok.json()["deposit_amount"] == 0
