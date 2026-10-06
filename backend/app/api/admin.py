from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime, timezone

from app.core.database import get_db
from app.core.security import revoke_sessions
from app.core.deps import require_admin
from app.core.audit_log import log_event
from app.models.models import User, Property, Booking

router = APIRouter(tags=["admin"])


class VerifyProperty(BaseModel):
    tier: int  # 1, 2, or 3
    reason: Optional[str] = None


class SuspendProperty(BaseModel):
    reason: str


class VerifyOwner(BaseModel):
    user_id: str
    verified: bool = True


class BlacklistGuest(BaseModel):
    user_id: str
    reason: str


@router.get("/stats")
async def platform_stats(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    total_listings = (await db.execute(select(func.count(Property.id)))).scalar()
    active_listings = (await db.execute(select(func.count(Property.id)).where(Property.active == True))).scalar()
    total_bookings = (await db.execute(select(func.count(Booking.id)))).scalar()
    confirmed_bookings = (await db.execute(
        select(func.count(Booking.id)).where(Booking.status.in_(["confirmed", "checked_in", "completed"]))
    )).scalar()
    total_revenue = (await db.execute(
        select(func.coalesce(func.sum(Booking.platform_fee), 0)).where(
            Booking.status.in_(["confirmed", "checked_in", "completed"])
        )
    )).scalar()

    return {
        "listings": {"total": total_listings, "active": active_listings},
        "bookings": {"total": total_bookings, "confirmed": confirmed_bookings},
        "revenue_kes": total_revenue,
    }


@router.get("/pending-listings")
async def pending_listings(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Property).where(Property.active == False, Property.verified_tier == 0))
    return result.scalars().all()


@router.post("/listings/{property_id}/approve")
async def approve_listing(
    property_id: str,
    body: VerifyProperty,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    prop = (await db.execute(select(Property).where(Property.id == property_id))).scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    prop.active = True
    prop.verified_tier = body.tier
    await db.commit()
    await log_event(db, "listing_approved", property_id, admin.id,
                    {"tier": body.tier, "reason": body.reason})
    return {"status": "approved", "tier": body.tier}


@router.post("/listings/{property_id}/suspend")
async def suspend_listing(
    property_id: str,
    body: SuspendProperty,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    prop = (await db.execute(select(Property).where(Property.id == property_id))).scalar_one_or_none()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    prop.active = False
    await db.commit()
    await log_event(db, "listing_suspended", property_id, admin.id, {"reason": body.reason})
    return {"status": "suspended"}


@router.post("/owners/verify")
async def verify_owner(
    body: VerifyOwner,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = (await db.execute(select(User).where(User.id == body.user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.verified_at = datetime.now(timezone.utc) if body.verified else None
    await db.commit()
    await log_event(db, "owner_verified", body.user_id, admin.id, {"verified": body.verified})
    return {"status": "verified" if body.verified else "unverified"}


@router.get("/owners")
async def list_owners(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.role == "owner"))
    users = result.scalars().all()
    return [
        {"id": u.id, "name": u.name, "phone": u.phone, "verified_at": u.verified_at,
         "commission_pct": u.commission_pct}
        for u in users
    ]


class CommissionUpdate(BaseModel):
    commission_pct: int = Field(..., ge=0, le=30)


@router.put("/owners/{user_id}/commission")
async def set_commission(
    user_id: str,
    body: CommissionUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """10% standard; 7% for the first 20 founding-partner owners. Applies to new bookings only —
    existing bookings keep the commission locked in when they were made."""
    user = (await db.execute(select(User).where(User.id == user_id, User.role == "owner"))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Owner not found")
    old = user.commission_pct
    user.commission_pct = body.commission_pct
    await log_event(db, "owner_commission_changed", user_id, admin.id, {"from": old, "to": body.commission_pct})
    return {"commission_pct": user.commission_pct}


@router.post("/guests/blacklist")
async def blacklist_guest(
    body: BlacklistGuest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = (await db.execute(select(User).where(User.id == body.user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Mark role as banned
    user.role = "banned"
    revoke_sessions(user)
    await db.commit()
    await log_event(db, "guest_blacklisted", body.user_id, admin.id,
                    {"reason": body.reason, "phone": user.phone})
    return {"status": "blacklisted"}
