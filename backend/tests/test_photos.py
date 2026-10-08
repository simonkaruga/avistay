import hashlib
import uuid

import pytest

from app.core.config import settings
from app.models.models import Property, User
from app.services.media import is_our_media_url, sign_params
from tests.conftest import auth_cookies

CLOUD = "staycloud"


@pytest.fixture(autouse=True)
def _cloudinary(monkeypatch):
    monkeypatch.setattr(settings, "CLOUDINARY_URL", f"cloudinary://123456:s3cr3t@{CLOUD}")


def url(name: str, cloud: str = CLOUD, kind: str = "image") -> str:
    return f"https://res.cloudinary.com/{cloud}/{kind}/upload/v1/naivastay/listings/{name}.jpg"


async def _owner_with_property(db):
    owner = User(id=str(uuid.uuid4()), phone=f"2547{uuid.uuid4().int % 10**8:08d}", role="owner")
    db.add(owner)
    await db.flush()
    prop = Property(id=str(uuid.uuid4()), owner_id=owner.id, title="Gallery Villa", type="villa",
                    price_per_night=5000, min_nights=1, active=True)
    db.add(prop)
    await db.commit()
    return owner.id, prop.id


def test_signature_matches_cloudinary_algorithm():
    params = {"timestamp": 1700000000, "folder": "naivastay/listings/u1"}
    expected = hashlib.sha1(b"folder=naivastay/listings/u1&timestamp=1700000000s3cr3t").hexdigest()
    assert sign_params(params, "s3cr3t") == expected


@pytest.mark.parametrize("candidate,ok", [
    (url("a"), True),
    (url("v", kind="video"), True),
    (url("a", cloud="someone-else"), False),
    ("http://res.cloudinary.com/staycloud/image/upload/a.jpg", False),
    ("https://evil.example.com/staycloud/image/upload/a.jpg", False),
    ("javascript:alert(1)", False),
    ("https://res.cloudinary.com/staycloud/raw/upload/a.pdf", False),
])
def test_only_our_cloudinary_media_is_accepted(candidate, ok):
    assert is_our_media_url(candidate) is ok


@pytest.mark.asyncio
async def test_signature_endpoint_scopes_folder_and_role(client, db):
    owner_id, _ = await _owner_with_property(db)
    r = await client.post("/api/uploads/signature", json={"purpose": "listing"}, cookies=auth_cookies(owner_id))
    assert r.status_code == 200
    body = r.json()
    assert body["folder"] == f"naivastay/listings/{owner_id}"
    assert body["cloud_name"] == CLOUD and "api_secret" not in body
    assert body["signature"] == sign_params({"timestamp": body["timestamp"], "folder": body["folder"]}, "s3cr3t")

    guest = User(id=str(uuid.uuid4()), phone=f"2547{uuid.uuid4().int % 10**8:08d}", role="guest")
    db.add(guest)
    await db.commit()
    assert (await client.post("/api/uploads/signature", json={"purpose": "listing"},
                              cookies=auth_cookies(guest.id))).status_code == 403
    assert (await client.post("/api/uploads/signature", json={"purpose": "dispute"},
                              cookies=auth_cookies(guest.id))).status_code == 200
    assert (await client.post("/api/uploads/signature", json={"purpose": "listing"})).status_code == 401


@pytest.mark.asyncio
async def test_gallery_add_reorder_delete(client, db):
    owner_id, prop_id = await _owner_with_property(db)
    c = auth_cookies(owner_id)
    base = f"/api/owner/properties/{prop_id}/images"

    r = await client.post(base, json={"urls": [url("a"), url("b"), url("c"), url("a")]}, cookies=c)
    assert r.status_code == 201
    imgs = r.json()
    assert [i["cloudinary_url"] for i in imgs] == [url("a"), url("b"), url("c")]   # deduped, in order
    assert [i["is_primary"] for i in imgs] == [True, False, False]

    ids = [i["id"] for i in imgs]
    r = await client.put(f"{base}/order", json={"image_ids": [ids[2], ids[0], ids[1]]}, cookies=c)
    assert [i["cloudinary_url"] for i in r.json()] == [url("c"), url("a"), url("b")]
    assert r.json()[0]["is_primary"] is True

    assert (await client.delete(f"/api/owner/images/{ids[2]}", cookies=c)).status_code == 204
    left = (await client.get(base, cookies=c)).json()
    assert [i["cloudinary_url"] for i in left] == [url("a"), url("b")]
    assert left[0]["is_primary"] is True                      # next photo promoted to cover

    stale = await client.put(f"{base}/order", json={"image_ids": ids}, cookies=c)
    assert stale.status_code == 409


@pytest.mark.asyncio
async def test_gallery_rejects_foreign_urls_limits_and_other_owners(client, db):
    owner_id, prop_id = await _owner_with_property(db)
    other_id, _ = await _owner_with_property(db)
    base = f"/api/owner/properties/{prop_id}/images"

    r = await client.post(base, json={"urls": ["https://evil.example.com/x.jpg"]}, cookies=auth_cookies(owner_id))
    assert r.status_code == 422
    r = await client.post(base, json={"urls": [url(f"p{i}") for i in range(31)]}, cookies=auth_cookies(owner_id))
    assert r.status_code == 422
    r = await client.post(base, json={"urls": [url("x")]}, cookies=auth_cookies(other_id))
    assert r.status_code == 404

    legacy = await client.post("/api/owner/images", cookies=auth_cookies(owner_id),
                               json={"property_id": prop_id, "cloudinary_url": url("legacy")})
    assert legacy.status_code == 201
