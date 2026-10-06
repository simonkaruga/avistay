"""
Agent programme rules, in one place.

An agent shares links with their personal code (?ref=AV7K2Q9X). A booking made
with that code is credited to them: commission is a share of the room price
only (not the deposit, levy or fee). It's paid to the agent's M-Pesa together
with the host's payout, after check-in and once no guest problem is open, so
cancelled or disputed stays never pay commission.
"""
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Agent, AgentReferral, Booking, Payment, Property


async def credit_agent(db: AsyncSession, booking: Booking, prop: Property, ref_code: str | None) -> None:
    """Link a new booking to the agent whose code the guest arrived with."""
    if not ref_code:
        return
    agent = (await db.execute(
        select(Agent).where(Agent.ref_code == ref_code.strip().upper(), Agent.status == "active")
    )).scalar_one_or_none()
    if agent is None or agent.user_id == prop.owner_id:   # no commission for referring your own home
        return
    booking.agent_id = agent.id
    db.add(AgentReferral(agent_id=agent.id, booking_id=booking.id,
                         commission_kes=booking.room_amount * agent.commission_pct // 100))


def queue_agent_commission(db: AsyncSession, booking: Booking, referral: AgentReferral | None) -> Payment | None:
    """Create the agent's M-Pesa payout row. Caller has just queued the host payout."""
    if referral is None or referral.status != "pending" or referral.commission_kes <= 0:
        return None
    payment = Payment(booking_id=booking.id, amount=referral.commission_kes, type="agent_commission", status="pending")
    db.add(payment)
    return payment


async def pending_referral(db: AsyncSession, booking: Booking) -> AgentReferral | None:
    if not booking.agent_id:
        return None
    referral = (await db.execute(
        select(AgentReferral).where(AgentReferral.booking_id == booking.id).with_for_update()
    )).scalar_one_or_none()
    if referral is None or referral.status != "pending":
        return None
    already = (await db.execute(select(Payment.id).where(
        Payment.booking_id == booking.id, Payment.type == "agent_commission", Payment.status != "failed",
    ))).first()
    return None if already else referral


async def mark_commission_paid(db: AsyncSession, payment: Payment) -> None:
    """Called when an agent_commission payment completes."""
    referral = (await db.execute(
        select(AgentReferral).where(AgentReferral.booking_id == payment.booking_id).with_for_update()
    )).scalar_one_or_none()
    if referral is None or referral.status == "paid":
        return
    referral.status = "paid"
    referral.paid_at = datetime.now(timezone.utc)
    agent = await db.get(Agent, referral.agent_id)
    if agent:
        agent.total_earned = (agent.total_earned or 0) + payment.amount
