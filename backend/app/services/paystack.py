"""
Thin Paystack client for card payments. No database access. State changes
live in app/services/payments.py, shared with M-Pesa.

Amounts are whole KES everywhere in Avistay; Paystack wants the subunit
(cents), so convert only at this boundary.
"""
import hashlib
import hmac
import logging
from dataclasses import dataclass

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)
HTTP_TIMEOUT = 20
CURRENCY = "KES"


class PaystackError(Exception):
    """`ambiguous`: the request may have been carried out (timeout after
    sending) — callers that move money must not blindly retry."""

    def __init__(self, message: str, ambiguous: bool = False):
        super().__init__(message)
        self.ambiguous = ambiguous


@dataclass(frozen=True)
class ChargeStatus:
    state: str              # "success" | "failed" | "pending"
    amount_kes: int | None  # what was actually charged
    currency: str | None
    gateway_status: str     # Paystack's own word, for the audit log


def enabled() -> bool:
    return bool(settings.PAYSTACK_SECRET_KEY)


def _headers() -> dict:
    return {"Authorization": f"Bearer {settings.PAYSTACK_SECRET_KEY}", "Content-Type": "application/json"}


async def _call(method: str, path: str, *, json: dict | None = None, money_moving: bool = False) -> dict:
    url = f"{settings.PAYSTACK_BASE_URL}{path}"
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            r = await client.request(method, url, json=json, headers=_headers())
    except (httpx.TimeoutException, httpx.RemoteProtocolError, httpx.ReadError) as exc:
        raise PaystackError(f"{path}: {exc.__class__.__name__}", ambiguous=money_moving) from exc
    except httpx.HTTPError as exc:   # couldn't connect. Nothing was sent
        raise PaystackError(f"{path}: {exc.__class__.__name__}") from exc
    try:
        body = r.json()
    except ValueError:
        raise PaystackError(f"{path}: HTTP {r.status_code} non-JSON", ambiguous=money_moving and r.status_code >= 500)
    if r.status_code >= 400 or not body.get("status"):
        raise PaystackError(f"{path}: {body.get('message') or r.status_code}", ambiguous=money_moving and r.status_code >= 500)
    return body.get("data") or {}


async def initialize(*, reference: str, amount_kes: int, email: str, callback_url: str, metadata: dict) -> str:
    """Start a card checkout; returns the hosted payment page URL."""
    data = await _call("POST", "/transaction/initialize", json={
        "reference": reference,
        "amount": amount_kes * 100,
        "currency": CURRENCY,
        "email": email,
        "callback_url": callback_url,
        "channels": ["card", "apple_pay"],
        "metadata": metadata,
    })
    url = data.get("authorization_url")
    if not url:
        raise PaystackError("initialize: no authorization_url")
    return url


def _charge_state(status: str) -> str:
    if status == "success":
        return "success"
    if status in ("failed", "reversed"):
        return "failed"
    return "pending"   # ongoing, pending, abandoned (guest can still finish), queued…


async def verify(reference: str) -> ChargeStatus:
    data = await _call("GET", f"/transaction/verify/{reference}")
    status = str(data.get("status") or "")
    amount = data.get("amount")
    return ChargeStatus(state=_charge_state(status),
                        amount_kes=int(amount) // 100 if amount is not None else None,
                        currency=data.get("currency"), gateway_status=status)


def charge_from_webhook(data: dict) -> ChargeStatus:
    status = str(data.get("status") or "")
    amount = data.get("amount")
    return ChargeStatus(state=_charge_state(status),
                        amount_kes=int(amount) // 100 if amount is not None else None,
                        currency=data.get("currency"), gateway_status=status)


def refund_state(status: str) -> str:
    """Paystack refund status → our Payment status."""
    if status == "processed":
        return "completed"
    if status == "failed":
        return "failed"
    return "processing"


async def refund(*, reference: str, amount_kes: int, note: str) -> tuple[str, str]:
    """Refund (part of) a card charge back to the card. Returns (refund_id, status)."""
    data = await _call("POST", "/refund", money_moving=True, json={
        "transaction": reference, "amount": amount_kes * 100, "currency": CURRENCY, "merchant_note": note[:200],
    })
    refund_id = data.get("id")
    if refund_id is None:
        raise PaystackError("refund: no id in response", ambiguous=True)
    return str(refund_id), str(data.get("status") or "pending")


async def fetch_refund(refund_id: str) -> str:
    data = await _call("GET", f"/refund/{refund_id}")
    return str(data.get("status") or "pending")


def valid_signature(raw_body: bytes, signature: str | None) -> bool:
    """Paystack signs each webhook: HMAC-SHA512 of the raw body with the secret key."""
    if not signature or not settings.PAYSTACK_SECRET_KEY:
        return False
    expected = hmac.new(settings.PAYSTACK_SECRET_KEY.encode(), raw_body, hashlib.sha512).hexdigest()
    return hmac.compare_digest(expected, signature)
