"""
Platform settings the operator can change without a deploy (Admin → Settings).

Defaults below are the values the business launched with. Reads are sync and
cheap — `S()` returns the cached snapshot; money paths call `await refresh(db)`
first, which reloads from the database at most every REFRESH_SECONDS.
"""
import logging
import time
from dataclasses import dataclass, fields, replace
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)
REFRESH_SECONDS = 30


@dataclass(frozen=True)
class PlatformSettings:
    service_fee_kes: int = 300            # flat guest fee per booking
    tourism_levy_pct: float = 2.0         # Tourism Act levy on the room price
    default_commission_pct: int = 10      # for newly approved hosts
    booking_hold_minutes: int = 15        # unpaid booking holds dates this long
    guest_dispute_hours: int = 24         # payout waits this long after check-in
    deposit_hold_days: int = 2            # deposit returned this long after check-out
    owner_cancel_penalty_pct: int = 10    # of the room price, from the next payout
    owner_strike_limit: int = 3           # cancellations in 12 months before a listing pauses
    card_surcharge_pct: float = 3.5       # guest pays this on card payments (covers Paystack's fee)
    withholding_tax_pct: float = 5.0      # deducted from host payouts and remitted to KRA
    support_phone: str = "+254700000000"
    support_email: str = "hello@naivastay.com"
    site_notice: str = ""                 # optional banner text across the site


# key -> (label, help, min, max). Strings have no bounds.
SPEC: dict[str, tuple[str, str, float | None, float | None]] = {
    "service_fee_kes": ("Guest service fee (KES)", "Added to every booking", 0, 5_000),
    "tourism_levy_pct": ("Tourism levy (%)", "Set by law. Change only if the Tourism Act rate changes", 0, 10),
    "default_commission_pct": ("Default host commission (%)", "Applies to hosts approved from now on", 0, 30),
    "booking_hold_minutes": ("Booking hold (minutes)", "How long unpaid dates stay held", 5, 120),
    "guest_dispute_hours": ("Problem-report window (hours)", "Payout is sent after this many hours from check-in", 1, 168),
    "deposit_hold_days": ("Deposit hold (days)", "Deposit is returned this many days after check-out", 1, 30),
    "owner_cancel_penalty_pct": ("Host cancellation penalty (%)", "Of the room price, taken from the next payout", 0, 50),
    "owner_strike_limit": ("Cancellation strikes before pause", "Within 12 months", 1, 10),
    "card_surcharge_pct": ("Card surcharge (%)", "Added when a guest pays by card. Set it to cover Paystack's fee. Not refunded when the guest cancels.", 0, 10),
    "withholding_tax_pct": ("Withholding tax on host payouts (%)", "Deducted from each payout and remitted to KRA. Confirm the current rate with your accountant.", 0, 30),
    "support_phone": ("Support phone", "Shown to guests and hosts", None, None),
    "support_email": ("Support email", "Shown to guests and hosts", None, None),
    "site_notice": ("Site notice", "Optional banner, e.g. planned maintenance. Leave empty for none.", None, None),
}

_current = PlatformSettings()
_loaded_at = 0.0


def S() -> PlatformSettings:
    return _current


def _coerce(key: str, raw: Any) -> Any:
    kind = type(getattr(PlatformSettings(), key))
    _, _, lo, hi = SPEC[key]
    value = kind(raw)
    if kind is str:
        return value.strip()[:300]
    if (lo is not None and value < lo) or (hi is not None and value > hi):
        raise ValueError(f"{SPEC[key][0]} must be between {lo:g} and {hi:g}")
    return value


async def refresh(db: AsyncSession, force: bool = False) -> PlatformSettings:
    global _current, _loaded_at
    if not force and time.monotonic() - _loaded_at < REFRESH_SECONDS:
        return _current
    from app.models.models import PlatformSetting
    rows = (await db.execute(select(PlatformSetting))).scalars().all()
    values = {}
    for row in rows:
        if row.key in SPEC:
            try:
                values[row.key] = _coerce(row.key, row.value.get("v"))
            except (TypeError, ValueError):
                log.error("Ignoring invalid platform setting %s=%r", row.key, row.value)
    _current = replace(PlatformSettings(), **values)
    _loaded_at = time.monotonic()
    return _current


async def update(db: AsyncSession, changes: dict[str, Any], actor_id: str) -> PlatformSettings:
    """Validate and save; raises ValueError with a readable message. Commits."""
    from app.core.audit_log import log_event
    from app.models.models import PlatformSetting
    unknown = set(changes) - set(SPEC)
    if unknown:
        raise ValueError(f"Unknown setting(s): {', '.join(sorted(unknown))}")
    clean = {k: _coerce(k, v) for k, v in changes.items()}
    before = S()
    for key, value in clean.items():
        row = await db.get(PlatformSetting, key)
        if row:
            row.value, row.updated_by = {"v": value}, actor_id
        else:
            db.add(PlatformSetting(key=key, value={"v": value}, updated_by=actor_id))
    await log_event(db, "settings_updated", "platform", actor_id,
                    {k: {"from": getattr(before, k), "to": v} for k, v in clean.items() if getattr(before, k) != v})
    return await refresh(db, force=True)


def as_list(current: PlatformSettings) -> list[dict]:
    return [{"key": f.name, "value": getattr(current, f.name), "default": f.default,
             "label": SPEC[f.name][0], "help": SPEC[f.name][1], "min": SPEC[f.name][2], "max": SPEC[f.name][3],
             "type": "text" if f.type in (str, "str") else "number"} for f in fields(PlatformSettings)]
