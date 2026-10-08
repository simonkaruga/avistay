"""
Ask Avi (site-wide): NaivaStay's AI assistant on the home page. Helps guests
choose a home from the live listings and explains how booking, payment and
protection work. Property pages use /properties/{id}/chat instead.
"""
from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import rate_limit, client_ip
from app.models.models import NAIVASHA_AREAS, Destination, Property
from app.api.properties import ChatIn
from app.services import ai, paystack, policy
from app.services.settings import refresh as refresh_settings

router = APIRouter(tags=["avi"])
MAX_HOMES = 60


def _yn(v: bool) -> str:
    return "yes" if v else "no"


@router.post("/avi/chat")
async def avi_chat(body: ChatIn, request: Request, db: AsyncSession = Depends(get_db)):
    ip = client_ip(request)
    await rate_limit(f"chat:{ip}", limit=30, window=3600)   # shared with property chat
    cfg = await refresh_settings(db)

    if not ai.enabled():
        return {"reply": f"I can't answer questions just yet. WhatsApp NaivaStay on {cfg.support_phone} and the team will help you find a home.",
                "ai": False}

    homes = (await db.execute(
        select(Property).where(Property.active == True).order_by(Property.verified_tier.desc(), Property.created_at.desc()).limit(MAX_HOMES)
    )).scalars().all()
    dests = (await db.execute(select(Destination).where(Destination.active == True).order_by(Destination.sort_order))).scalars().all()

    home_lines = [
        f"- {p.title}: entire {p.type}, {NAIVASHA_AREAS.get(p.area or '', 'Naivasha')}, KES {p.price_per_night:,}/night, "
        f"min {p.min_nights} night(s), sleeps {p.max_guests or 'not stated'}, pets {_yn(p.pets_allowed)}, "
        f"children {_yn(p.children_allowed)}, deposit {'KES ' + format(p.deposit_amount, ',') if p.deposit_amount else 'none'}"
        for p in homes
    ]
    place_text = "\n".join(f"- {d.name}: {d.tagline or ''}" for d in dests) \
        or "- Hell's Gate, Crescent Island, Mount Longonot, Lake Naivasha boat rides"
    home_text = "\n".join(home_lines) or "- No homes are live yet."
    cards = paystack.enabled()
    system = f"""You are Avi, NaivaStay's friendly AI assistant. NaivaStay is a booking site for verified holiday homes in Naivasha, Kenya.
Help guests choose a home from the list below and explain how NaivaStay works. Only recommend homes from this list and only
state facts given here; never invent amenities, availability or prices. You can't check dates or book: tell guests to open
the home and use its calendar, or use the search bar at the top of the page. If you don't know, say so and suggest
WhatsApp support. Be warm and brief: under 110 words, plain sentences, no markdown, no em dashes.
If asked who you are, say you're Avi, NaivaStay's AI assistant.

HOW NAIVASTAY WORKS
- Payment by M-Pesa{' or card (Visa, Mastercard, Apple Pay; a card fee applies)' if cards else ''}, in Kenyan shillings.
- On top of the room price: KES {cfg.service_fee_kes:,} service fee and {cfg.tourism_levy_pct:g}% tourism levy. Some homes take a refundable damage deposit.
- NaivaStay pays the host only {cfg.guest_dispute_hours} hours after check-in, so guests can report a problem in the app and get help or a refund.
- Each home sets its cancellation policy: Flexible ({policy.POLICY_SUMMARIES['flexible']}) Moderate ({policy.POLICY_SUMMARIES['moderate']}) Strict ({policy.POLICY_SUMMARIES['strict']})
- Every listing is checked by the NaivaStay team before it goes live. Only guests who stayed can leave reviews.
- Support: WhatsApp {cfg.support_phone} or {cfg.support_email}.

PLACES GUESTS VISIT
{place_text}

HOMES ON NAIVASTAY NOW ({len(homes)})
{home_text}"""

    turns = [{"role": t.role, "content": t.content} for t in body.history[-8:]]
    while turns and turns[0]["role"] != "user":
        turns.pop(0)
    reply = await ai.ask(system=system, messages=turns + [{"role": "user", "content": body.message}], max_tokens=400)
    if reply is None:
        return {"reply": f"Sorry, I couldn't answer that right now. Try again in a moment, or WhatsApp NaivaStay on {cfg.support_phone}.", "ai": True}
    return {"reply": reply, "ai": True}
