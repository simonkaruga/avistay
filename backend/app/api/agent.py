"""Agent / broker portal API.

Agents register, browse properties, create bookings on behalf of clients,
track their referral commissions, and download booking vouchers.
"""
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.models import User, Agent, AgentReferral, Booking, Property

router = APIRouter(prefix="/agent", tags=["agent"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class AgentRegister(BaseModel):
    agency_name: str | None = None

class AgentOut(BaseModel):
    id: str
    ref_code: str
    agency_name: str | None
    commission_pct: int
    status: str
    total_earned: int

    class Config:
        from_attributes = True

class ReferralOut(BaseModel):
    id: str
    booking_id: str
    commission_kes: int
    status: str
    paid_at: str | None
    check_in: str | None = None
    check_out: str | None = None
    property_title: str | None = None

    class Config:
        from_attributes = True


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_active_agent(user: User, db: AsyncSession) -> Agent:
    result = await db.execute(select(Agent).where(Agent.user_id == user.id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent account not found. Apply first.")
    if agent.status != "active":
        raise HTTPException(status_code=403, detail=f"Agent account is {agent.status}. Contact support.")
    return agent


# ── Registration ──────────────────────────────────────────────────────────────

@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register_agent(
    body: AgentRegister,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    existing = (await db.execute(select(Agent).where(Agent.user_id == user.id))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Agent account already exists")

    agent = Agent(user_id=user.id, agency_name=body.agency_name)
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return {"message": "Application submitted. You'll be notified via WhatsApp/SMS once approved.", "agent_id": agent.id}


# ── Profile ───────────────────────────────────────────────────────────────────

@router.get("/me", response_model=AgentOut)
async def get_agent_profile(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Agent).where(Agent.user_id == user.id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="No agent account found")
    return agent


# ── Referrals / commission tracking ──────────────────────────────────────────

@router.get("/referrals")
async def get_referrals(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    agent = await _get_active_agent(user, db)

    result = await db.execute(
        select(AgentReferral).where(AgentReferral.agent_id == agent.id)
        .order_by(AgentReferral.created_at.desc())
    )
    referrals = result.scalars().all()

    out = []
    for r in referrals:
        booking = (await db.execute(select(Booking).where(Booking.id == r.booking_id))).scalar_one_or_none()
        prop = None
        if booking:
            prop = (await db.execute(select(Property).where(Property.id == booking.property_id))).scalar_one_or_none()
        out.append({
            "id":             r.id,
            "booking_id":     r.booking_id,
            "commission_kes": r.commission_kes,
            "status":         r.status,
            "paid_at":        r.paid_at.isoformat() if r.paid_at else None,
            "check_in":       booking.check_in.isoformat() if booking else None,
            "check_out":      booking.check_out.isoformat() if booking else None,
            "property_title": prop.title if prop else None,
        })
    return out


@router.get("/dashboard")
async def agent_dashboard(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    agent = await _get_active_agent(user, db)

    referrals = (await db.execute(
        select(AgentReferral).where(AgentReferral.agent_id == agent.id)
    )).scalars().all()

    total_bookings = len(referrals)
    total_earned   = sum(r.commission_kes for r in referrals if r.status == "paid")
    pending_payout = sum(r.commission_kes for r in referrals if r.status == "pending")

    return {
        "agency_name":    agent.agency_name,
        "commission_pct": agent.commission_pct,
        "total_bookings": total_bookings,
        "total_earned":   total_earned,
        "pending_payout": pending_payout,
        "status":         agent.status,
    }


# ── Record a referral (called when agent creates booking for client) ──────────

class RecordReferral(BaseModel):
    booking_id: str

@router.post("/referrals", status_code=status.HTTP_201_CREATED)
async def record_referral(
    body: RecordReferral,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    agent = await _get_active_agent(user, db)

    booking = (await db.execute(select(Booking).where(Booking.id == body.booking_id))).scalar_one_or_none()
    # Agents book for their clients from their own account. Anything else would
    # let an agent claim commission on bookings they had nothing to do with.
    if not booking or booking.guest_id != user.id:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status == "cancelled":
        raise HTTPException(status_code=409, detail="This booking was cancelled")
    created = booking.created_at if booking.created_at.tzinfo else booking.created_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - created > timedelta(days=2):
        raise HTTPException(status_code=409, detail="Referrals must be recorded within 2 days of booking")

    existing = (await db.execute(
        select(AgentReferral).where(AgentReferral.booking_id == body.booking_id)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Referral already recorded for this booking")

    commission = booking.room_amount * agent.commission_pct // 100   # room price only: not the deposit, levy or fee
    booking.agent_id = agent.id
    referral = AgentReferral(
        agent_id=agent.id,
        booking_id=booking.id,
        commission_kes=commission,
    )
    db.add(referral)
    await db.commit()
    await db.refresh(referral)
    return {"commission_kes": commission, "referral_id": referral.id}
