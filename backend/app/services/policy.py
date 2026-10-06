"""
Cancellation policies and money splits. Pure functions, no I/O, so the
rules shown to guests (cancel preview, property page) are exactly the rules
applied when they cancel.
"""
from dataclasses import dataclass
from datetime import date, timedelta

# policy -> list of (min whole days before check-in, % of the stay refunded),
# checked top-down. Exactly the terms owners agreed to in the listing form —
# changing these changes promises already made, so treat as a contract.
CANCELLATION_POLICIES: dict[str, list[tuple[int, int]]] = {
    "flexible": [(1, 100)],   # full refund up to 1 day before check-in
    "moderate": [(5, 100)],   # full refund up to 5 days before
    "strict":   [(7, 50)],    # 50% refund up to 7 days before
}
DEFAULT_POLICY = "moderate"

POLICY_SUMMARIES = {
    "flexible": "Free cancellation until 1 day before check-in.",
    "moderate": "Free cancellation until 5 days before check-in.",
    "strict":   "50% refund if you cancel at least 7 days before check-in. Non-refundable after that.",
}

# Penalty %, strike limit and the dispute/deposit windows are platform settings
# (services/settings.py) so the operator can tune them without a deploy.
OWNER_STRIKE_WINDOW_DAYS = 365


def refund_pct(policy: str, check_in: date, today: date) -> int:
    days_before = (check_in - today).days
    for min_days, pct in CANCELLATION_POLICIES.get(policy, CANCELLATION_POLICIES[DEFAULT_POLICY]):
        if days_before >= min_days:
            return pct
    return 0


def free_cancellation_until(policy: str, check_in: date) -> date | None:
    """Last day the guest can cancel for a full refund (None if never)."""
    for min_days, pct in CANCELLATION_POLICIES.get(policy, CANCELLATION_POLICIES[DEFAULT_POLICY]):
        if pct == 100:
            return check_in - timedelta(days=min_days)
    return None


@dataclass(frozen=True)
class GuestCancelSplit:
    refund_pct: int
    guest_refund: int     # back to the guest's M-Pesa
    owner_payout: int     # owner's share of the non-refunded stay, after commission
    platform_keeps: int


def guest_cancel_split(
    *, paid: int, room: int, levy: int, fee: int, deposit: int, commission: int, pct: int,
) -> GuestCancelSplit:
    """Guest cancels a paid booking.

    - Deposit always comes back in full (no stay, no damage).
    - The stay (room + levy) is refunded at the policy %.
    - The KES fee is kept unless the refund is 100%.
    - The owner is paid the room they lost, minus commission.
    Anything the guest paid that isn't refunded or paid out stays with the platform.
    """
    stay_refund = (room + levy) * pct // 100
    fee_refund = fee if pct == 100 else 0
    guest_refund = min(paid, deposit + stay_refund + fee_refund)
    kept_room = room - room * pct // 100
    owner_payout = max(0, kept_room - commission * (100 - pct) // 100)
    return GuestCancelSplit(pct, guest_refund, owner_payout, paid - guest_refund - owner_payout)


def owner_payout_amount(room: int, commission: int) -> int:
    return max(0, room - commission)
