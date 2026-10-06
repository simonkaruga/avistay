"""
Home-page content.

Public:  GET /api/home. Offers running now, destinations (trending first),
         featured stays. One request so the landing page loads fast on mobile.
Admin:   manage offers, destinations and featured stays without a deploy.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit_log import log_event
from app.core.config import settings
from app.core.database import get_db
from app.core.deps import require_admin
from app.models.models import NAIVASHA_AREAS, Booking, Destination, Offer, PromoCode, Property, User
from app.api.properties import _to_list_out, ratings_for
from app.services.media import is_our_media_url
from app.services import paystack
from app.services.settings import refresh as refresh_settings

router = APIRouter(tags=["home"])

TRENDING_WINDOW_DAYS = 30
MAX_FEATURED = 12


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Public ────────────────────────────────────────────────────────────────────

@router.get("/site")
async def site_info(db: AsyncSession = Depends(get_db)):
    """Public bits of Admin → Settings: support contacts and the site notice."""
    cfg = await refresh_settings(db)
    return {"support_phone": cfg.support_phone, "support_email": cfg.support_email,
            "site_notice": cfg.site_notice or None,
            "card_payments": paystack.enabled(), "card_surcharge_pct": cfg.card_surcharge_pct,
            "guest_dispute_hours": cfg.guest_dispute_hours, "deposit_hold_days": cfg.deposit_hold_days,
            "service_fee_kes": cfg.service_fee_kes, "tourism_levy_pct": cfg.tourism_levy_pct,
            "booking_hold_minutes": cfg.booking_hold_minutes, "default_commission_pct": cfg.default_commission_pct,
            "google_login": bool(settings.GOOGLE_CLIENT_ID)}


@router.get("/home")
async def home_content(db: AsyncSession = Depends(get_db)):
    now = _now()
    offers = (await db.execute(
        select(Offer).where(
            Offer.active == True,
            or_(Offer.starts_at.is_(None), Offer.starts_at <= now),
            or_(Offer.ends_at.is_(None), Offer.ends_at > now),
        ).order_by(Offer.sort_order, Offer.created_at.desc())
    )).scalars().all()

    destinations = (await db.execute(
        select(Destination).where(Destination.active == True).order_by(Destination.sort_order)
    )).scalars().all()

    # "Trending" = where guests actually booked in the last 30 days.
    since = now - timedelta(days=TRENDING_WINDOW_DAYS)
    recent = {k: v for k, v in (await db.execute(
        select(Property.area, func.count(Booking.id))
        .join(Booking, Booking.property_id == Property.id)
        .where(Booking.created_at >= since,
               Booking.status.in_(["confirmed", "checked_in", "completed"]),
               Property.area.is_not(None))
        .group_by(Property.area)
    )).all()}
    stays = {k: v for k, v in (await db.execute(
        select(Property.area, func.count()).where(Property.active == True, Property.area.is_not(None))
        .group_by(Property.area)
    )).all()}
    ranked = sorted(destinations, key=lambda d: (-recent.get(d.area, 0), d.sort_order))

    featured = (await db.execute(
        select(Property).options(selectinload(Property.images))
        .where(Property.active == True, Property.featured_rank.is_not(None))
        .order_by(Property.featured_rank).limit(MAX_FEATURED)
    )).scalars().all()
    ratings = await ratings_for(db, [p.id for p in featured])

    return {
        "offers": [_offer_out(o) for o in offers],
        "destinations": [{
            "id": d.id, "name": d.name, "tagline": d.tagline, "image_url": d.image_url,
            "area": d.area, "area_label": NAIVASHA_AREAS.get(d.area or ""),
            "stays": stays.get(d.area, 0), "bookings_recent": recent.get(d.area, 0),
        } for d in ranked],
        "featured": [{
            **_to_list_out(p, *ratings.get(p.id, (None, None))).model_dump(),
            "featured_tagline": p.featured_tagline,
        } for p in featured],
    }


def _offer_out(o: Offer) -> dict:
    return {
        "id": o.id, "title": o.title, "subtitle": o.subtitle, "body": o.body, "image_url": o.image_url,
        "cta_label": o.cta_label, "link": o.link, "promo_code": o.promo_code,
        "starts_at": o.starts_at.isoformat() if o.starts_at else None,
        "ends_at": o.ends_at.isoformat() if o.ends_at else None,
        "active": o.active, "sort_order": o.sort_order,
    }


# ── Admin: validation shared by offers and destinations ──────────────────────

def _check_image(v: Optional[str]) -> Optional[str]:
    if v and not is_our_media_url(v):
        raise ValueError("Upload images through Avistay")
    return v or None


class OfferIn(BaseModel):
    title: str = Field(..., min_length=3, max_length=80)
    subtitle: Optional[str] = Field(None, max_length=120)
    body: Optional[str] = Field(None, max_length=300)
    image_url: Optional[str] = None
    cta_label: str = Field("See stays", min_length=2, max_length=30)
    link: str = Field("/search", max_length=300)
    promo_code: Optional[str] = Field(None, max_length=30)
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    active: bool = True
    sort_order: int = Field(0, ge=0, le=999)

    @field_validator("image_url")
    @classmethod
    def _image(cls, v: Optional[str]) -> Optional[str]:
        return _check_image(v)

    @field_validator("link")
    @classmethod
    def _internal_link(cls, v: str) -> str:
        # Only paths on our own site — no external or javascript: links in a banner.
        if not v.startswith("/") or v.startswith("//") or "\\" in v:
            raise ValueError("Link must be a page on Avistay, starting with /")
        return v

    @field_validator("promo_code")
    @classmethod
    def _upper(cls, v: Optional[str]) -> Optional[str]:
        code = (v or "").strip().upper()
        return code or None

    @model_validator(mode="after")
    def _dates(self):
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("The offer must end after it starts")
        return self


class DestinationIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=60)
    tagline: Optional[str] = Field(None, max_length=120)
    image_url: Optional[str] = None
    area: Optional[str] = None
    active: bool = True
    sort_order: int = Field(0, ge=0, le=999)

    @field_validator("image_url")
    @classmethod
    def _image(cls, v: Optional[str]) -> Optional[str]:
        return _check_image(v)

    @field_validator("area")
    @classmethod
    def _known_area(cls, v: Optional[str]) -> Optional[str]:
        if v and v not in NAIVASHA_AREAS:
            raise ValueError("Choose one of the listed areas")
        return v or None


class FeatureIn(BaseModel):
    featured_rank: Optional[int] = Field(None, ge=1, le=99)   # None = not featured
    featured_tagline: Optional[str] = Field(None, max_length=80)


# ── Admin: offers ─────────────────────────────────────────────────────────────

@router.get("/admin/offers")
async def list_offers(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Offer).order_by(Offer.sort_order, Offer.created_at.desc()))).scalars().all()
    return [_offer_out(o) for o in rows]


async def _check_promo(db: AsyncSession, code: Optional[str]) -> None:
    if code and not (await db.execute(select(PromoCode.id).where(PromoCode.code == code))).first():
        raise HTTPException(status_code=422, detail=f"Promo code {code} doesn't exist. Create it first")


@router.post("/admin/offers", status_code=status.HTTP_201_CREATED)
async def create_offer(body: OfferIn, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    await _check_promo(db, body.promo_code)
    offer = Offer(**body.model_dump())
    db.add(offer)
    await db.flush()
    await log_event(db, "offer_created", offer.id, admin.id, {"title": offer.title})
    return _offer_out(offer)


@router.put("/admin/offers/{offer_id}")
async def update_offer(offer_id: str, body: OfferIn, admin: User = Depends(require_admin),
                       db: AsyncSession = Depends(get_db)):
    offer = await db.get(Offer, offer_id)
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")
    await _check_promo(db, body.promo_code)
    for k, v in body.model_dump().items():
        setattr(offer, k, v)
    await log_event(db, "offer_updated", offer.id, admin.id, {"title": offer.title})
    return _offer_out(offer)


@router.delete("/admin/offers/{offer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_offer(offer_id: str, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    offer = await db.get(Offer, offer_id)
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")
    await db.delete(offer)
    await log_event(db, "offer_deleted", offer_id, admin.id, {"title": offer.title})


# ── Admin: destinations ──────────────────────────────────────────────────────

def _dest_out(d: Destination) -> dict:
    return {"id": d.id, "name": d.name, "tagline": d.tagline, "image_url": d.image_url, "area": d.area,
            "active": d.active, "sort_order": d.sort_order}


@router.get("/admin/destinations")
async def list_destinations(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Destination).order_by(Destination.sort_order))).scalars().all()
    return [_dest_out(d) for d in rows]


@router.post("/admin/destinations", status_code=status.HTTP_201_CREATED)
async def create_destination(body: DestinationIn, admin: User = Depends(require_admin),
                             db: AsyncSession = Depends(get_db)):
    d = Destination(**body.model_dump())
    db.add(d)
    await db.flush()
    await log_event(db, "destination_created", d.id, admin.id, {"name": d.name})
    return _dest_out(d)


@router.put("/admin/destinations/{dest_id}")
async def update_destination(dest_id: str, body: DestinationIn, admin: User = Depends(require_admin),
                             db: AsyncSession = Depends(get_db)):
    d = await db.get(Destination, dest_id)
    if not d:
        raise HTTPException(status_code=404, detail="Destination not found")
    for k, v in body.model_dump().items():
        setattr(d, k, v)
    await log_event(db, "destination_updated", d.id, admin.id, {"name": d.name})
    return _dest_out(d)


@router.delete("/admin/destinations/{dest_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_destination(dest_id: str, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    d = await db.get(Destination, dest_id)
    if not d:
        raise HTTPException(status_code=404, detail="Destination not found")
    await db.delete(d)
    await log_event(db, "destination_deleted", dest_id, admin.id, {"name": d.name})


# ── Admin: featured stays ────────────────────────────────────────────────────

@router.get("/admin/featured")
async def featured_candidates(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """All live listings, featured first, so admins can pick and order them."""
    props = (await db.execute(
        select(Property).options(selectinload(Property.images)).where(Property.active == True)
        .order_by(Property.featured_rank.is_(None), Property.featured_rank, Property.title)
    )).scalars().all()
    ratings = await ratings_for(db, [p.id for p in props])
    return [{
        **_to_list_out(p, *ratings.get(p.id, (None, None))).model_dump(),
        "featured_rank": p.featured_rank, "featured_tagline": p.featured_tagline,
    } for p in props]


@router.put("/admin/featured/{property_id}")
async def set_featured(property_id: str, body: FeatureIn, admin: User = Depends(require_admin),
                       db: AsyncSession = Depends(get_db)):
    prop = await db.get(Property, property_id)
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    if body.featured_rank is not None and not prop.active:
        raise HTTPException(status_code=409, detail="Only live listings can be featured")
    prop.featured_rank = body.featured_rank
    prop.featured_tagline = (body.featured_tagline or "").strip() or None
    await log_event(db, "property_featured" if body.featured_rank else "property_unfeatured", prop.id, admin.id,
                    {"rank": body.featured_rank, "tagline": prop.featured_tagline})
    return {"id": prop.id, "featured_rank": prop.featured_rank, "featured_tagline": prop.featured_tagline}
