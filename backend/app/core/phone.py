"""
One format for Kenyan mobile numbers everywhere: +2547XXXXXXXX / +2541XXXXXXXX.
People type '0712 345 678', '712345678', '254712345678' or '+254 712 345 678';
storing them as typed made one person look like several accounts and broke SMS
delivery (Africa's Talking needs the international form).
"""
import re

_KE = re.compile(r"^254(7|1)\d{8}$")
INVALID = "Enter a valid Kenyan mobile number, e.g. 0712 345 678"


def normalize_ke(raw: str | None) -> str:
    """Return '+2547XXXXXXXX'. Raises ValueError with a user-facing message."""
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("0") and len(digits) == 10:
        digits = "254" + digits[1:]
    elif len(digits) == 9 and digits[0] in "71":
        digits = "254" + digits
    if not _KE.match(digits):
        raise ValueError(INVALID)
    return "+" + digits


def try_normalize(raw: str | None) -> str | None:
    try:
        return normalize_ke(raw)
    except ValueError:
        return None


def stored_variants(e164: str) -> list[str]:
    """Formats older accounts may have been saved in, for lookups."""
    local = e164[4:]   # 712345678
    return [e164, e164[1:], "0" + local]
