"""Incoming WhatsApp / SMS webhook from Africa's Talking.

Owners can text a simple command from their phone to instantly block dates
without opening an app. Useful when they get an Airbnb notification.

Supported commands (case-insensitive):

  BLOCK <property-code> <check-in YYYY-MM-DD> <check-out YYYY-MM-DD>
      → Instantly blocks those dates on NaivaStay
      → Replies with confirmation

  UNBLOCK <property-code> <check-in> <check-out>
      → Removes the manual block (e.g. cancelled Airbnb booking)

  STATUS <property-code>
      → Lists next 5 blocked ranges for that property

The property-code is the first 8 chars of the property UUID (shown in the
owner dashboard). Owners can also use the full UUID.
"""
import hmac
import re
from datetime import date, timedelta

from fastapi import APIRouter, Form, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.models import Property, User, Availability

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])

DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _parse_date(s: str) -> date | None:
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


async def _find_property_by_code(code: str, owner_phone: str, db: AsyncSession) -> Property | None:
    """Find property by full UUID or first-8-char prefix, owned by this phone number."""
    owner = (await db.execute(select(User).where(User.phone == owner_phone))).scalar_one_or_none()
    if not owner:
        return None

    result = await db.execute(
        select(Property).where(Property.owner_id == owner.id, Property.active == True)
    )
    props = result.scalars().all()
    code_lower = code.lower()
    for p in props:
        if p.id == code or p.id.lower().startswith(code_lower):
            return p
    return None


async def _handle_command(sender: str, text: str) -> str:
    """Parse and execute owner command. Returns reply message."""
    parts = text.strip().split()
    if not parts:
        return _help_text()

    cmd = parts[0].upper()

    async with AsyncSessionLocal() as db:

        if cmd == "BLOCK" and len(parts) == 4:
            _, code, ci_str, co_str = parts
            check_in  = _parse_date(ci_str)
            check_out = _parse_date(co_str)
            if not check_in or not check_out or check_out <= check_in:
                return "❌ Invalid dates. Use: BLOCK <code> YYYY-MM-DD YYYY-MM-DD"

            prop = await _find_property_by_code(code, sender, db)
            if not prop:
                return f"❌ Property '{code}' not found under your account. Check your property code in the owner dashboard."

            nights = (check_out - check_in).days
            if nights > 90:
                return "❌ Cannot block more than 90 days at once."

            # Remove existing manual blocks for this range so we don't duplicate
            await db.execute(
                delete(Availability).where(
                    Availability.property_id == prop.id,
                    Availability.date >= check_in,
                    Availability.date < check_out,
                    Availability.source == "manual",
                )
            )

            current = check_in
            while current < check_out:
                existing = (await db.execute(
                    select(Availability).where(
                        Availability.property_id == prop.id,
                        Availability.date == current,
                    )
                )).scalar_one_or_none()
                if not existing:
                    db.add(Availability(
                        property_id=prop.id,
                        date=current,
                        is_blocked=True,
                        source="manual",
                    ))
                current += timedelta(days=1)

            await db.commit()
            return (
                f"✅ Done! *{prop.title}*: {check_in} to {check_out} ({nights} night{'s' if nights != 1 else ''}) "
                f"is now blocked on NaivaStay. "
                f"No new bookings can come in for those dates."
            )

        elif cmd == "UNBLOCK" and len(parts) == 4:
            _, code, ci_str, co_str = parts
            check_in  = _parse_date(ci_str)
            check_out = _parse_date(co_str)
            if not check_in or not check_out or check_out <= check_in:
                return "❌ Invalid dates. Use: UNBLOCK <code> YYYY-MM-DD YYYY-MM-DD"

            prop = await _find_property_by_code(code, sender, db)
            if not prop:
                return f"❌ Property '{code}' not found."

            await db.execute(
                delete(Availability).where(
                    Availability.property_id == prop.id,
                    Availability.date >= check_in,
                    Availability.date < check_out,
                    Availability.source.in_(["manual", "ical"]),
                )
            )
            await db.commit()
            nights = (check_out - check_in).days
            return f"✅ Unblocked {nights} night{'s' if nights != 1 else ''} on *{prop.title}*. Dates are open again."

        elif cmd == "STATUS" and len(parts) == 2:
            _, code = parts
            prop = await _find_property_by_code(code, sender, db)
            if not prop:
                return f"❌ Property '{code}' not found."

            today = date.today()
            rows = (await db.execute(
                select(Availability).where(
                    Availability.property_id == prop.id,
                    Availability.is_blocked == True,
                    Availability.date >= today,
                ).order_by(Availability.date).limit(30)
            )).scalars().all()

            if not rows:
                return f"*{prop.title}*: no blocked dates in the next 30 days. ✅"

            # Collapse consecutive days into ranges
            ranges: list[tuple[date, date]] = []
            start = rows[0].date
            prev  = rows[0].date
            for row in rows[1:]:
                if (row.date - prev).days == 1:
                    prev = row.date
                else:
                    ranges.append((start, prev + timedelta(days=1)))
                    start = prev = row.date
            ranges.append((start, prev + timedelta(days=1)))

            lines = [f"*{prop.title}*: blocked dates:"]
            for s, e in ranges[:5]:
                lines.append(f"  • {s} → {e}")
            if len(ranges) > 5:
                lines.append(f"  … and {len(ranges) - 5} more ranges")
            return "\n".join(lines)

        else:
            return _help_text()


def _help_text() -> str:
    return (
        "*NaivaStay owner commands:*\n\n"
        "BLOCK <code> <from> <to>\n"
        "  Block dates when you get an Airbnb booking\n"
        "  _e.g. BLOCK abc12345 2026-07-01 2026-07-05_\n\n"
        "UNBLOCK <code> <from> <to>\n"
        "  Open dates again (Airbnb booking cancelled)\n\n"
        "STATUS <code>\n"
        "  See upcoming blocked dates\n\n"
        "Your property code = first 8 chars of property ID in your dashboard."
    )


# ── Africa's Talking incoming webhook ────────────────────────────────────────

def _check_secret(secret: str) -> None:
    """Africa's Talking doesn't sign its webhooks, and the sender number in the body
    can be faked. A secret in the URL (only AT knows it) proves the call is real.
    No secret configured = commands are off."""
    from app.core.config import settings
    expected = settings.AT_WEBHOOK_SECRET
    if not expected or not hmac.compare_digest(secret.encode(), expected.encode()):
        raise HTTPException(status_code=404, detail="Not found")


@router.post("/incoming/{secret}")
async def whatsapp_incoming(
    secret: str,
    from_: str = Form(alias="from", default=""),
    text:   str = Form(default=""),
):
    """Africa's Talking posts to this URL when owner sends us a WhatsApp message."""
    _check_secret(secret)
    sender = from_.strip()
    if not sender or not text:
        return PlainTextResponse("ok")

    reply = await _handle_command(sender, text.strip())

    # Send reply back via Africa's Talking WhatsApp API
    from app.core.config import settings
    import httpx
    if settings.AT_API_KEY and settings.AT_WHATSAPP_NUMBER:
        async with httpx.AsyncClient() as client:
            await client.post(
                "https://chat.africastalking.com/whatsapp/message",
                json={"username": settings.AT_USERNAME, "to": sender, "message": reply},
                headers={"apiKey": settings.AT_API_KEY, "Content-Type": "application/json"},
                timeout=10,
            )

    return PlainTextResponse("ok")


# ── SMS fallback (owners without WhatsApp) ────────────────────────────────────

@router.post("/sms-incoming/{secret}")
async def sms_incoming(
    secret: str,
    from_: str = Form(alias="from", default=""),
    text:  str = Form(default=""),
):
    """Africa's Talking SMS incoming — same command syntax works over plain SMS."""
    _check_secret(secret)
    sender = from_.strip()
    if not sender or not text:
        return PlainTextResponse("ok")

    reply = await _handle_command(sender, text.strip())

    from app.api.auth import _send_sms   # same sender as login codes; no SDK needed
    await _send_sms(sender, reply[:160])

    return PlainTextResponse("ok")
