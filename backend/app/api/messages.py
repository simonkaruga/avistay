"""
Guest ↔ host messages, one conversation per booking. Keeps questions, arrival
details and changes on NaivaStay (where the guest is protected) instead of moving
to WhatsApp. The NaivaStay team can read a conversation when helping with a dispute.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user, rate_limit
from app.core.timeutil import today_eat
from app.models.models import Booking, Message, Property, User
from app.workers.queue import enqueue

router = APIRouter(tags=["messages"])
MAX_CHARS = 2000
OPEN_DAYS_AFTER_CHECKOUT = 30   # conversation can still be used this long after the stay


class MessageIn(BaseModel):
    body: str = Field(..., min_length=1, max_length=MAX_CHARS)


async def _party(db: AsyncSession, booking_id: str, user: User) -> tuple[Booking, Property, str]:
    """The booking, its home, and the viewer's role (guest / host / admin) or 404."""
    booking = await db.get(Booking, booking_id)
    prop = await db.get(Property, booking.property_id) if booking else None
    if not booking or not prop:
        raise HTTPException(status_code=404, detail="Booking not found")
    if user.id == booking.guest_id:
        return booking, prop, "guest"
    if user.id == prop.owner_id:
        return booking, prop, "host"
    if user.role == "admin":
        return booking, prop, "admin"
    raise HTTPException(status_code=404, detail="Booking not found")


def _can_write(booking: Booking) -> bool:
    if booking.status == "cancelled":
        cancelled = booking.cancelled_at
        if cancelled is None:
            return False
        if cancelled.tzinfo is None:
            cancelled = cancelled.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) - cancelled < timedelta(days=14)   # sort out refunds etc.
    return booking.check_out >= today_eat() - timedelta(days=OPEN_DAYS_AFTER_CHECKOUT)


def _out(m: Message, viewer_id: str, names: dict[str, str]) -> dict:
    return {"id": m.id, "body": m.body, "mine": m.sender_id == viewer_id,
            "sender": names.get(m.sender_id, "NaivaStay"), "created_at": m.created_at.isoformat(),
            "read": m.read_at is not None}


async def unread_counts(db: AsyncSession, user_id: str, booking_ids: list[str]) -> dict[str, int]:
    """Messages not yet read by this person, per booking."""
    if not booking_ids:
        return {}
    rows = (await db.execute(
        select(Message.booking_id, func.count()).where(
            Message.booking_id.in_(booking_ids), Message.sender_id != user_id, Message.read_at.is_(None),
        ).group_by(Message.booking_id)
    )).all()
    return {k: v for k, v in rows}


@router.get("/bookings/{booking_id}/messages")
async def list_messages(booking_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    booking, prop, role = await _party(db, booking_id, user)
    msgs = (await db.execute(
        select(Message).where(Message.booking_id == booking.id).order_by(Message.created_at)
    )).scalars().all()
    if role != "admin":   # reading marks the other side's messages as read (the team reads silently)
        now = datetime.now(timezone.utc)
        for m in msgs:
            if m.sender_id != user.id and m.read_at is None:
                m.read_at = now
        await db.commit()
    people = (await db.execute(select(User).where(User.id.in_({m.sender_id for m in msgs} | {booking.guest_id, prop.owner_id})))).scalars()
    names = {}
    for u in people:
        first = (u.name or "").split(" ")[0]
        names[u.id] = "NaivaStay team" if u.role == "admin" and u.id not in (booking.guest_id, prop.owner_id) \
            else first or ("Host" if u.id == prop.owner_id else "Guest")
    other = prop.owner_id if role == "guest" else booking.guest_id
    return {
        "booking": {"id": booking.id, "property_title": prop.title, "check_in": booking.check_in.isoformat(),
                    "check_out": booking.check_out.isoformat(), "status": booking.status},
        "role": role,
        "with": names.get(other, "Host" if role == "guest" else "Guest"),
        "can_write": role == "admin" or _can_write(booking),
        "messages": [_out(m, user.id, names) for m in msgs],
    }


@router.post("/bookings/{booking_id}/messages", status_code=status.HTTP_201_CREATED)
async def send_message(booking_id: str, body: MessageIn, user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    booking, prop, role = await _party(db, booking_id, user)
    if role != "admin" and not _can_write(booking):
        raise HTTPException(status_code=409, detail="This conversation is closed. Contact NaivaStay support if you need help.")
    await rate_limit(f"msg:{user.id}", limit=60, window=3600)
    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Write a message first")
    m = Message(booking_id=booking.id, sender_id=user.id, body=text)
    db.add(m)
    await db.commit()
    await db.refresh(m)
    # Tell the other side (SMS/WhatsApp, at most every 30 minutes per conversation).
    recipients = [prop.owner_id] if role == "guest" else [booking.guest_id] if role == "host" else [booking.guest_id, prop.owner_id]
    from app.workers.tasks import notify_new_message
    for rid in recipients:
        enqueue(notify_new_message, booking.id, rid, role)
    return _out(m, user.id, {user.id: (user.name or "").split(" ")[0] or "You"})


@router.get("/messages/unread")
async def unread_total(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Badge count: unread messages across all of this person's bookings."""
    own = select(Property.id).where(Property.owner_id == user.id)
    ids = (await db.execute(select(Booking.id).where(
        (Booking.guest_id == user.id) | Booking.property_id.in_(own)))).scalars().all()
    counts = await unread_counts(db, user.id, list(ids))
    return {"total": sum(counts.values()), "by_booking": counts}
