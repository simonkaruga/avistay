
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel

from app.workers.queue import enqueue
from app.core.database import get_db
from app.core.deps import require_owner
from app.models.models import User, Property, Booking, ExternalCalendar
from app.services.ical import UnsafeUrl, generate_ical, parse_remote_ical

router = APIRouter(tags=["ical"])

PLATFORMS = {"airbnb", "booking", "vrbo", "other"}


# ── iCal export (Avistay → Airbnb/Booking.com) ──────────────────────────

@router.get("/export/{property_uuid}")
async def export_ical(property_uuid: str, db: AsyncSession = Depends(get_db)):
    """Public iCal feed — owner pastes this URL into Airbnb/Booking.com."""
    prop = (await db.execute(select(Property).where(Property.id == property_uuid))).scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    result = await db.execute(
        select(Booking).where(
            Booking.property_id == property_uuid,
            Booking.status.in_(["confirmed", "checked_in", "completed"]),
        )
    )
    bookings = result.scalars().all()
    cal_bytes = generate_ical(property_uuid, [
        {"id": b.id, "check_in": b.check_in, "check_out": b.check_out} for b in bookings
    ])
    return Response(
        content=cal_bytes,
        media_type="text/calendar",
        headers={"Content-Disposition": f'attachment; filename="avistay-{property_uuid[:8]}.ics"'},
    )

# Keep old URL working for any already-connected platforms
@router.get("/{property_uuid}")
async def export_ical_legacy(property_uuid: str, db: AsyncSession = Depends(get_db)):
    return await export_ical(property_uuid, db)


# ── External calendars CRUD ───────────────────────────────────────────────────

class CalendarAdd(BaseModel):
    property_id: str
    platform: str          # "airbnb" | "booking" | "vrbo" | "other"
    ical_url: str


@router.get("/calendars/{property_id}")
async def list_calendars(
    property_id: str,
    owner: User = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    """List all connected external calendars for a property."""
    prop = (await db.execute(
        select(Property).where(Property.id == property_id, Property.owner_id == owner.id)
    )).scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    cals = (await db.execute(
        select(ExternalCalendar).where(ExternalCalendar.property_id == property_id)
    )).scalars().all()

    return [
        {
            "id":             c.id,
            "platform":       c.platform,
            "ical_url":       c.ical_url[:60] + "…" if len(c.ical_url) > 60 else c.ical_url,
            "last_synced_at": c.last_synced_at.isoformat() if c.last_synced_at else None,
        }
        for c in cals
    ]


@router.post("/calendars", status_code=status.HTTP_201_CREATED)
async def add_calendar(
    body: CalendarAdd,
    owner: User = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    """Add an Airbnb/Booking.com/VRBO iCal URL and trigger immediate sync."""
    if body.platform not in PLATFORMS:
        raise HTTPException(status_code=400, detail=f"platform must be one of {sorted(PLATFORMS)}")

    prop = (await db.execute(
        select(Property).where(Property.id == body.property_id, Property.owner_id == owner.id)
    )).scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    # Validate the URL is safe and reachable before saving
    try:
        await parse_remote_ical(body.ical_url)
    except UnsafeUrl as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        raise HTTPException(status_code=400, detail="Could not fetch that iCal URL. Make sure it is public and correct")

    cal = ExternalCalendar(
        property_id=body.property_id,
        platform=body.platform,
        ical_url=body.ical_url,
    )
    db.add(cal)
    await db.commit()
    await db.refresh(cal)

    # Immediate sync so blocked dates appear right away
    from app.workers.tasks import sync_all_icals
    enqueue(sync_all_icals)

    return {"id": cal.id, "message": f"{body.platform.title()} calendar connected. Syncing now…"}


@router.delete("/calendars/{calendar_id}", status_code=204)
async def remove_calendar(
    calendar_id: str,
    owner: User = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    """Remove a connected external calendar."""
    cal = (await db.execute(select(ExternalCalendar).where(ExternalCalendar.id == calendar_id))).scalar_one_or_none()
    if not cal:
        raise HTTPException(status_code=404, detail="Calendar not found")

    # Verify ownership
    prop = (await db.execute(
        select(Property).where(Property.id == cal.property_id, Property.owner_id == owner.id)
    )).scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=403, detail="Not your property")

    await db.execute(delete(ExternalCalendar).where(ExternalCalendar.id == calendar_id))
    await db.commit()
