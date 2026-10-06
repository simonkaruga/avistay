from typing import Literal, Optional
from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import extract, false, func, or_, select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import require_owner, rate_limit, client_ip
from app.models.models import NAIVASHA_AREAS, User, Property, Review, Booking, Availability
from app.schemas.schemas import PropertyDetailOut, PropertyCreate, PropertyOut, PropertyListOut
from app.services import ai, paystack, policy
from app.services.settings import refresh as refresh_settings

router = APIRouter(tags=["properties"])


@router.get("/", response_model=list[PropertyListOut])
async def list_properties(
    request: Request,
    location: Optional[str] = Query(None),
    min_price: Optional[int] = Query(None),
    max_price: Optional[int] = Query(None),
    guests: Optional[int] = Query(None),
    property_type: Optional[str] = Query(None),
    area: Optional[str] = Query(None),
    owner: Optional[str] = Query(None),
    check_in: Optional[date] = Query(None),
    check_out: Optional[date] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(lambda: None),
):
    await rate_limit(f"search:{client_ip(request)}", limit=100, window=60)

    # owner=me — return this authenticated owner's own properties (active or not)
    if owner == "me":
        from app.core.deps import _access_token, _user_from_token
        me = await _user_from_token(_access_token(request, request.cookies.get("access_token")), db)
        owner_id: Optional[str] = me.id if me else None
        if not owner_id:
            return []
        stmt = (
            select(Property)
            .where(Property.owner_id == owner_id)
            .options(selectinload(Property.images))
            .offset(skip).limit(limit)
        )
        result = await db.execute(stmt)
        properties = result.scalars().all()
        return [_to_list_out(p, None, None) for p in properties]

    stmt = (
        select(Property)
        .where(Property.active == True)
        .options(selectinload(Property.images))
        .offset(skip)
        .limit(limit)
    )
    if min_price:
        stmt = stmt.where(Property.price_per_night >= min_price)
    if max_price:
        stmt = stmt.where(Property.price_per_night <= max_price)
    if property_type:
        stmt = stmt.where(Property.type == property_type)
    if area:
        stmt = stmt.where(Property.area == area)
    if location and location.strip():
        # Free text from the search box: match name, description, directions or area name.
        term = f"%{location.strip()[:80]}%"
        area_slugs = [k for k, v in NAIVASHA_AREAS.items() if location.strip().lower() in v.lower()]
        stmt = stmt.where(or_(
            Property.title.ilike(term),
            Property.description.ilike(term),
            Property.landmark_instructions.ilike(term),
            Property.area.in_(area_slugs) if area_slugs else false(),
        ))

    if check_in and check_out and check_out > check_in:
        nights = (check_out - check_in).days
        # Exclude properties already blocked on any of the requested dates
        blocked_ids_stmt = (
            select(Availability.property_id)
            .where(
                Availability.is_blocked == True,
                Availability.date >= check_in,
                Availability.date < check_out,
            )
            .distinct()
        )
        stmt = stmt.where(Property.id.not_in(blocked_ids_stmt))
        # Respect minimum stay rules
        stmt = stmt.where(Property.min_nights <= nights)

    result = await db.execute(stmt)
    properties = result.scalars().all()

    rating_map = await ratings_for(db, [p.id for p in properties])

    out = []
    for p in properties:
        avg, cnt = rating_map.get(p.id, (None, None))
        out.append(_to_list_out(p, avg, cnt))
    return out


async def ratings_for(db: AsyncSession, ids: list[str]) -> dict[str, tuple[float, int]]:
    """Average review score and review count per property, in one query."""
    if not ids:
        return {}
    rows = await db.execute(
        select(
            Booking.property_id,
            func.avg(
                (Review.accuracy_score + Review.cleanliness_score +
                 Review.location_score + Review.value_score) / 4.0
            ).label("avg"),
            func.count(Review.id).label("cnt"),
        )
        .join(Review, Review.booking_id == Booking.id)
        .where(Booking.property_id.in_(ids))
        .group_by(Booking.property_id)
    )
    return {row.property_id: (row.avg, row.cnt) for row in rows}


def _to_list_out(p: Property, avg_rating, review_count) -> PropertyListOut:
    primary = next((img.cloudinary_url for img in p.images if img.is_primary), None)
    if not primary and p.images:
        primary = sorted(p.images, key=lambda i: i.display_order)[0].cloudinary_url
    return PropertyListOut(
        id=p.id, title=p.title, type=p.type,
        price_per_night=p.price_per_night, verified_tier=p.verified_tier,
        primary_image=primary, lat=p.lat, lng=p.lng, area=p.area, min_nights=p.min_nights, max_guests=p.max_guests,
        avg_rating=round(float(avg_rating), 1) if avg_rating else None,
        review_count=int(review_count) if review_count else None,
    )


@router.get("/summary")
async def property_summary(db: AsyncSession = Depends(get_db)):
    """Counts for the home page: homes per type and per area (live listings only)."""
    by_type = {k: v for k, v in (await db.execute(
        select(Property.type, func.count()).where(Property.active == True).group_by(Property.type)
    )).all()}
    by_area = {k: v for k, v in (await db.execute(
        select(Property.area, func.count())
        .where(Property.active == True, Property.area.is_not(None)).group_by(Property.area)
    )).all()}
    return {
        "total": sum(by_type.values()),
        "types": by_type,
        "areas": [{"slug": k, "label": v, "count": by_area.get(k, 0)} for k, v in NAIVASHA_AREAS.items()],
    }


@router.get("/stats")
async def property_stats(db: AsyncSession = Depends(get_db)):
    prop_count = (await db.execute(select(func.count()).where(Property.active == True))).scalar_one()
    booking_count = (await db.execute(select(func.count()).select_from(Booking))).scalar_one()
    avg_rating_row = await db.execute(
        select(func.avg((Review.accuracy_score + Review.cleanliness_score + Review.location_score + Review.value_score) / 4.0))
    )
    avg_rating = avg_rating_row.scalar_one() or 0
    return {"property_count": prop_count, "booking_count": booking_count, "avg_rating": round(float(avg_rating), 1)}


@router.get("/sitemap.xml", include_in_schema=False)
async def sitemap_xml(db: AsyncSession = Depends(get_db)):
    today = datetime.now(timezone.utc).date().isoformat()
    urls: list[tuple[str, str, str, str]] = []   # (loc, lastmod, changefreq, priority)

    for path, priority, freq in STATIC_PAGES:
        urls.append((f"{BASE}{path}", today, freq, priority))

    result = await db.execute(
        select(Property.id, Property.created_at)
        .where(Property.active == True)
        .order_by(Property.created_at.desc())
    )
    for prop_id, created_at in result.all():
        lastmod = created_at.date().isoformat() if created_at else today
        urls.append((f"{BASE}/property/{prop_id}", lastmod, "weekly", "0.9"))

    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, lastmod, freq, priority in urls:
        lines.append(
            f"  <url>"
            f"<loc>{loc}</loc>"
            f"<lastmod>{lastmod}</lastmod>"
            f"<changefreq>{freq}</changefreq>"
            f"<priority>{priority}</priority>"
            f"</url>"
        )
    lines.append("</urlset>")

    return Response("\n".join(lines), media_type="application/xml")


@router.get("/{property_id}", response_model=PropertyDetailOut)
async def get_property(property_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Property)
        .where(Property.id == property_id)
        .options(selectinload(Property.images))
    )
    prop = result.scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    from app.api.reviews import public_name
    from app.services.policy import POLICY_SUMMARIES
    host = await db.get(User, prop.owner_id)
    out = PropertyOut.model_validate(prop).model_dump()
    out.update({
        "area_label": NAIVASHA_AREAS.get(prop.area or ""),
        "host_name": public_name(host.name, host.deleted_at) if host else None,
        "host_since": host.created_at if host else None,
        "host_id_verified": bool(host and host.verified_at),
        "policy_summary": POLICY_SUMMARIES.get(prop.cancellation_policy or "moderate"),
    })
    return out


@router.post("/", response_model=PropertyOut, status_code=status.HTTP_201_CREATED)
async def create_property(
    body: PropertyCreate,
    owner: User = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    # Rate limit: 5 new listings per owner per day
    await rate_limit(f"create_prop:{owner.id}", limit=5, window=86400)

    prop = Property(
        owner_id=owner.id,
        **body.model_dump(),
        active=False,  # Goes live only after admin approves + 8 photos verified
    )
    db.add(prop)
    await db.commit()
    return await _reload(db, prop.id)


@router.get("/{property_id}/availability")
async def property_availability(
    property_id: str,
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Availability).where(
            Availability.property_id == property_id,
            extract("year", Availability.date) == year,
            extract("month", Availability.date) == month,
        )
    )
    rows = result.scalars().all()
    return [{"date": r.date.isoformat(), "is_blocked": r.is_blocked, "source": r.source} for r in rows]


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=1500)


class ChatIn(BaseModel):
    message: str = Field(..., min_length=1, max_length=500)
    history: list[ChatTurn] = Field(default_factory=list, max_length=20)


def _yes_no(v: bool) -> str:
    return "yes" if v else "no"


def _listing_facts(prop: Property, cfg, cards: bool) -> str:
    """Everything the assistant may state about this home. It must not go beyond this."""
    days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    no_checkout = ", ".join(days[int(d)] for d in (prop.no_checkout_days or "").split(",") if d.strip().isdigit() and int(d) < 7)
    lines = [
        f"Name: {prop.title}",
        f"Type: entire {prop.type}",
        f"Area: {NAIVASHA_AREAS.get(prop.area or '', 'Naivasha')}, Naivasha, Kenya",
        f"Price: KES {prop.price_per_night:,} per night",
        f"Minimum stay: {prop.min_nights} night(s)",
        f"Sleeps up to: {prop.max_guests} guests" if prop.max_guests else "Maximum guests: not stated (ask the host)",
        f"Check-in: from {prop.check_in_from}" + (f" until {prop.check_in_until}" if prop.check_in_until else ""),
        f"Check-out: by {prop.check_out_until}",
        f"Children welcome: {_yes_no(prop.children_allowed)}",
        f"Pets allowed: {_yes_no(prop.pets_allowed)}",
        f"Smoking allowed: {_yes_no(prop.smoking_allowed)}",
        f"Parties/events allowed: {_yes_no(prop.parties_allowed)}",
        f"Quiet hours: {prop.quiet_hours}" if prop.quiet_hours else "",
        f"No check-out on: {no_checkout}" if no_checkout else "",
        f"Refundable damage deposit: KES {prop.deposit_amount:,}" if prop.deposit_amount else "Damage deposit: none",
        f"Cancellation policy: {policy.POLICY_SUMMARIES.get(prop.cancellation_policy or policy.DEFAULT_POLICY, '')}",
        f"Directions/landmark: {prop.landmark_instructions}" if prop.landmark_instructions else "",
        f"Host's other rules: {prop.house_rules}" if prop.house_rules else "",
        f"Description (written by the host): {prop.description}" if prop.description else "",
        "\nHow booking works on Avistay:",
        f"- Guests tap 'Book now' on this page. Payment by M-Pesa{' or card (Visa, Mastercard, Apple Pay; a card fee applies)' if cards else ''}, in Kenyan shillings.",
        f"- On top of the room price: a KES {cfg.service_fee_kes:,} service fee and a {cfg.tourism_levy_pct:g}% tourism levy.",
        f"- Avistay pays the host only {cfg.guest_dispute_hours} hours after check-in, so guests can report a problem in the app before then.",
        f"- Avistay support: {cfg.support_phone} (WhatsApp) or {cfg.support_email}.",
    ]
    return "\n".join(line for line in lines if line)


@router.post("/{property_id}/chat")
async def property_chat(
    property_id: str,
    body: ChatIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Ask Avi: the guest AI assistant, answering questions about this one home from its listing."""
    ip = client_ip(request)
    await rate_limit(f"chat:{ip}", limit=30, window=3600)   # cost guard

    prop = (await db.execute(
        select(Property).where(Property.id == property_id, Property.active == True)
    )).scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    cfg = await refresh_settings(db)

    if not ai.enabled():
        return {"reply": f"I can't answer questions just yet. For anything about {prop.title}, WhatsApp Avistay on {cfg.support_phone} and we'll check with the host.",
                "ai": False}

    system = f"""You are Avi, Avistay's friendly AI assistant, on the page for one holiday home in Naivasha, Kenya.
If asked who you are, say you're Avi, Avistay's AI assistant.
Answer the guest's questions about this home using ONLY the facts below. If the answer isn't in the facts
(for example WiFi speed, a heated pool, exact distances), say you're not sure and suggest they ask the host
or WhatsApp Avistay. Never invent amenities, prices, availability or promises. You can't check dates or make
bookings: for availability, point them to the calendar on this page. You can share general, well-known tips
about visiting Naivasha (Hell's Gate, Crescent Island, Mount Longonot, boat rides), but keep the focus on this home.
Be warm, clear and brief: under 90 words, plain sentences, no markdown, no em dashes.

FACTS ABOUT THIS HOME
{_listing_facts(prop, cfg, paystack.enabled())}"""

    turns = [{"role": t.role, "content": t.content} for t in body.history[-8:]]
    while turns and turns[0]["role"] != "user":   # the API needs the first turn to be the guest's
        turns.pop(0)
    reply = await ai.ask(system=system, messages=turns + [{"role": "user", "content": body.message}], max_tokens=350)
    if reply is None:
        return {"reply": f"Sorry, I couldn't answer that right now. Try again in a moment, or WhatsApp Avistay on {cfg.support_phone}.",
                "ai": True}
    return {"reply": reply, "ai": True}


@router.put("/{property_id}", response_model=PropertyOut)
async def update_property(
    property_id: str,
    body: PropertyCreate,
    owner: User = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Property).where(Property.id == property_id, Property.owner_id == owner.id))
    prop = result.scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(prop, field, value)
    await db.commit()
    return await _reload(db, prop.id)


async def _reload(db: AsyncSession, property_id: str) -> Property:
    """Fresh copy with photos loaded — the response includes them, and async
    SQLAlchemy can't lazy-load during serialisation."""
    db.expire_all()
    return (await db.execute(
        select(Property).where(Property.id == property_id).options(selectinload(Property.images))
    )).scalar_one()


# ── Dynamic sitemap ────────────────────────────────────────────────────────────

BASE = "https://avistay.com"

STATIC_PAGES = [
    ("/",                    "1.0",  "daily"),
    ("/search",              "0.9",  "daily"),
    ("/how-it-works",        "0.8",  "monthly"),
    ("/about",               "0.7",  "monthly"),
    ("/list-your-property",  "0.7",  "monthly"),
    ("/terms",               "0.4",  "yearly"),
    ("/privacy",             "0.4",  "yearly"),
]

