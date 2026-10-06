from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.workers.queue import enqueue
from app.core.audit_log import log_event
from app.core.database import get_db
from app.core.deps import get_current_user, rate_limit, require_admin
from app.models.models import Booking, Dispute, DisputeMessage, Property, User
from app.services.disputes import (
    MAX_MESSAGE_CHARS, REASON_LABELS, DisputeError, apply_ruling, can_open, party_role,
    refundable_to_guest, validate_attachments, validate_reason,
)
from app.services.payments import dispatch_b2c, lock_booking, payout_due_at, deposit_due_at

router = APIRouter(tags=["disputes"])


class DisputeCreate(BaseModel):
    booking_id: str
    reason: str
    claimed_amount: int = Field(0, ge=0)
    message: str = Field(..., min_length=10, max_length=MAX_MESSAGE_CHARS)
    attachments: list[str] = []


class MessageCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=MAX_MESSAGE_CHARS)
    attachments: list[str] = []


class Ruling(BaseModel):
    ruling: str = Field(..., min_length=10, max_length=MAX_MESSAGE_CHARS)
    guest_refund_kes: int = Field(0, ge=0)
    owner_award_kes: int = Field(0, ge=0)
    deduct_from_owner: bool = True


async def _load(db: AsyncSession, dispute_id: str, user: User, lock: bool = False):
    q = select(Dispute).where(Dispute.id == dispute_id)
    dispute = (await db.execute(q.with_for_update() if lock else q)).scalar_one_or_none()
    if not dispute:
        raise HTTPException(status_code=404, detail="Dispute not found")
    booking = (await db.execute(select(Booking).where(Booking.id == dispute.booking_id))).scalar_one()
    prop = (await db.execute(select(Property).where(Property.id == booking.property_id))).scalar_one()
    role = party_role(user, booking, prop.owner_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Dispute not found")
    return dispute, booking, prop, role


def _notify(dispute_id: str, event: str, actor_role: str) -> None:
    from app.workers.tasks import notify_dispute_event
    enqueue(notify_dispute_event, dispute_id, event, actor_role)


@router.post("/", status_code=status.HTTP_201_CREATED)
async def open_dispute(
    body: DisputeCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await rate_limit(f"dispute_open:{user.id}", limit=5, window=86400)
    booking = await lock_booking(db, body.booking_id)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    prop = (await db.execute(select(Property).where(Property.id == booking.property_id))).scalar_one()
    role = party_role(user, booking, prop.owner_id)
    if role not in ("guest", "owner"):
        raise HTTPException(status_code=404, detail="Booking not found")
    if not can_open(role, booking):
        raise HTTPException(status_code=400, detail="Problems can be reported from check-in day until shortly after check-out")
    try:
        validate_reason(role, body.reason)
        attachments = validate_attachments(body.attachments)
    except DisputeError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    dispute = Dispute(
        booking_id=booking.id, opened_by=user.id, opener_role=role,
        reason=body.reason, claimed_amount=body.claimed_amount,
    )
    db.add(dispute)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="You already have an open report for this booking")
    db.add(DisputeMessage(dispute_id=dispute.id, author_id=user.id, author_role=role,
                          body=body.message.strip(), attachments=attachments))
    await log_event(db, "dispute_opened", dispute.id, user.id,
                    {"booking_id": booking.id, "role": role, "reason": body.reason})
    _notify(dispute.id, "opened", role)
    return {"id": dispute.id, "status": dispute.status}


@router.get("/")
async def list_disputes(
    status_filter: str | None = Query(None, alias="status"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = (select(Dispute, Booking, Property.title)
         .join(Booking, Booking.id == Dispute.booking_id)
         .join(Property, Property.id == Booking.property_id))
    if user.role != "admin":
        q = q.where((Booking.guest_id == user.id) | (Property.owner_id == user.id))
    if status_filter:
        q = q.where(Dispute.status == status_filter)
    rows = (await db.execute(q.order_by(Dispute.created_at.desc()).limit(200))).all()
    return [_summary(d, b, title) for d, b, title in rows]


def _summary(d: Dispute, b: Booking, title: str) -> dict:
    return {
        "id": d.id, "booking_id": b.id, "property_title": title,
        "check_in": b.check_in.isoformat(), "check_out": b.check_out.isoformat(),
        "opener_role": d.opener_role, "reason": d.reason, "reason_label": REASON_LABELS.get(d.reason, d.reason),
        "claimed_amount": d.claimed_amount, "status": d.status,
        "guest_refund_kes": d.guest_refund_kes, "owner_award_kes": d.owner_award_kes,
        "created_at": d.created_at.isoformat(),
    }


@router.get("/{dispute_id}")
async def get_dispute(
    dispute_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    dispute, booking, prop, role = await _load(db, dispute_id, user)
    messages = (await db.execute(
        select(DisputeMessage).where(DisputeMessage.dispute_id == dispute.id).order_by(DisputeMessage.created_at)
    )).scalars().all()
    out = _summary(dispute, booking, prop.title)
    out.update({
        "viewer_role": role,
        "ruling": dispute.ruling,
        "resolved_at": dispute.resolved_at.isoformat() if dispute.resolved_at else None,
        "booking": {
            "total_amount": booking.total_amount, "deposit_amount": booking.deposit_amount,
            "deposit_status": booking.deposit_status, "status": booking.status,
            "payout_due_at": payout_due_at(booking).isoformat(),
            "deposit_due_at": deposit_due_at(booking).isoformat(),
        },
        "messages": [{
            "id": m.id, "author_role": m.author_role, "mine": m.author_id == user.id,
            "body": m.body, "attachments": m.attachments or [], "created_at": m.created_at.isoformat(),
        } for m in messages],
        "can_reply": dispute.status == "open",
        "can_withdraw": dispute.status == "open" and dispute.opened_by == user.id,
        "can_resolve": dispute.status == "open" and role == "admin",
    })
    if role == "admin" and dispute.status == "open":
        out["max_guest_refund"] = await refundable_to_guest(db, booking) if dispute.opener_role == "guest" else 0
        out["max_owner_award"] = (booking.deposit_amount if booking.deposit_status == "held" else 0) \
            if dispute.opener_role == "owner" else 0
    return out


@router.post("/{dispute_id}/messages", status_code=status.HTTP_201_CREATED)
async def post_message(
    dispute_id: str,
    body: MessageCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await rate_limit(f"dispute_msg:{user.id}", limit=60, window=3600)
    dispute, _, _, role = await _load(db, dispute_id, user)
    if dispute.status != "open":
        raise HTTPException(status_code=400, detail="This case is closed")
    try:
        attachments = validate_attachments(body.attachments)
    except DisputeError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    msg = DisputeMessage(dispute_id=dispute.id, author_id=user.id, author_role=role,
                         body=body.body.strip(), attachments=attachments)
    db.add(msg)
    await db.commit()
    _notify(dispute.id, "message", role)
    return {"id": msg.id}


@router.post("/{dispute_id}/withdraw")
async def withdraw(
    dispute_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    dispute, _, _, role = await _load(db, dispute_id, user, lock=True)
    if dispute.status != "open" or dispute.opened_by != user.id:
        raise HTTPException(status_code=400, detail="Only the person who opened an open case can withdraw it")
    dispute.status = "withdrawn"
    await log_event(db, "dispute_withdrawn", dispute.id, user.id, {})
    _notify(dispute.id, "withdrawn", role)
    return {"status": dispute.status}


@router.post("/{dispute_id}/resolve")
async def resolve(
    dispute_id: str,
    body: Ruling,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    dispute, _, _, _ = await _load(db, dispute_id, admin, lock=True)
    if dispute.status != "open":
        raise HTTPException(status_code=400, detail="This case is already closed")
    booking = await lock_booking(db, dispute.booking_id)
    if booking is None:
        raise HTTPException(status_code=404, detail="Booking not found")
    try:
        payments = await apply_ruling(
            db, dispute, booking,
            guest_refund_kes=body.guest_refund_kes, owner_award_kes=body.owner_award_kes,
            deduct_from_owner=body.deduct_from_owner,
        )
    except DisputeError as exc:
        await db.rollback()
        raise HTTPException(status_code=422, detail=str(exc))

    dispute.status = "resolved"
    dispute.ruling = body.ruling.strip()
    dispute.resolved_by = admin.id
    dispute.resolved_at = datetime.now(timezone.utc)
    db.add(DisputeMessage(dispute_id=dispute.id, author_id=admin.id, author_role="admin",
                          body=f"Decision: {dispute.ruling}"))
    await log_event(db, "dispute_resolved", dispute.id, admin.id, {
        "guest_refund_kes": body.guest_refund_kes, "owner_award_kes": body.owner_award_kes,
        "deduct_from_owner": body.deduct_from_owner,
    })
    dispatch_b2c(*payments)
    _notify(dispute.id, "resolved", "admin")
    return {"status": dispute.status}
