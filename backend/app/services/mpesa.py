"""
Thin Daraja client. No database access here. State transitions live in
app/services/payments.py so the callback, the status poll and the reconciler
all apply exactly the same rules.
"""
import base64
import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime

import httpx

from app.core.config import settings
from app.core.timeutil import EAT

log = logging.getLogger(__name__)

HTTP_TIMEOUT = 15
TOKEN_CACHE_SECONDS = 50 * 60  # Daraja tokens live 60 min
STK_PENDING_ERROR_CODE = "500.001.1001"  # "The transaction is being processed"

_token_cache: tuple[str, float] | None = None


class MpesaError(Exception):
    """Daraja rejected or failed a request.

    `ambiguous` is True when the request may still have been executed by
    Safaricom (timeout / connection drop after sending). Callers that move
    money MUST NOT blindly retry an ambiguous failure.
    """

    def __init__(self, message: str, ambiguous: bool = False):
        super().__init__(message)
        self.ambiguous = ambiguous


@dataclass(frozen=True)
class StkQueryResult:
    state: str          # "success" | "failed" | "pending"
    result_code: str | None = None
    description: str = ""


_MSISDN_RE = re.compile(r"^254(7|1)\d{8}$")


def normalize_msisdn(phone: str | None) -> str:
    """'+254 712 345678' / '0712345678' / '254712345678' -> '254712345678'. Raises ValueError."""
    if not phone:
        raise ValueError("Phone number required")
    digits = re.sub(r"[^\d]", "", phone)
    if digits.startswith("0") and len(digits) == 10:
        digits = "254" + digits[1:]
    elif len(digits) == 9 and digits[0] in "71":
        digits = "254" + digits
    if not _MSISDN_RE.match(digits):
        raise ValueError("Enter a valid Safaricom number, e.g. 0712 345 678")
    return digits


def callback_url(suffix: str = "") -> str:
    return f"{settings.MPESA_CALLBACK_URL.rstrip('/')}/{settings.MPESA_CALLBACK_SECRET}{suffix}"


async def get_access_token() -> str:
    global _token_cache
    if _token_cache and _token_cache[1] > time.monotonic():
        return _token_cache[0]
    credentials = base64.b64encode(
        f"{settings.MPESA_CONSUMER_KEY}:{settings.MPESA_CONSUMER_SECRET}".encode()
    ).decode()
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.get(
                f"{settings.MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials",
                headers={"Authorization": f"Basic {credentials}"},
            )
            resp.raise_for_status()
            token = resp.json()["access_token"]
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        # Nothing was sent to Safaricom yet — never ambiguous.
        raise MpesaError(f"Daraja auth failed: {exc}") from exc
    _token_cache = (token, time.monotonic() + TOKEN_CACHE_SECONDS)
    return token


def _stk_password() -> tuple[str, str]:
    timestamp = datetime.now(EAT).strftime("%Y%m%d%H%M%S")
    raw = f"{settings.MPESA_SHORTCODE}{settings.MPESA_PASSKEY}{timestamp}"
    return base64.b64encode(raw.encode()).decode(), timestamp


async def _post(path: str, payload: dict) -> httpx.Response:
    token = await get_access_token()
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            return await client.post(
                f"{settings.MPESA_BASE_URL}{path}",
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
            )
    except httpx.ConnectError as exc:
        raise MpesaError(f"Daraja unreachable: {exc}") from exc
    except httpx.HTTPError as exc:
        # Request may have reached Safaricom before the failure.
        raise MpesaError(f"Daraja request failed: {exc}", ambiguous=True) from exc


async def stk_push(phone: str, amount_kes: int, account_ref: str) -> str:
    """Send the PIN prompt. Returns CheckoutRequestID."""
    password, timestamp = _stk_password()
    resp = await _post("/mpesa/stkpush/v1/processrequest", {
        "BusinessShortCode": settings.MPESA_SHORTCODE,
        "Password": password,
        "Timestamp": timestamp,
        "TransactionType": "CustomerPayBillOnline",
        "Amount": amount_kes,
        "PartyA": phone,
        "PartyB": settings.MPESA_SHORTCODE,
        "PhoneNumber": phone,
        "CallBackURL": callback_url(),
        "AccountReference": account_ref,
        "TransactionDesc": "Avistay booking",
    })
    data = _json(resp)
    if resp.status_code != 200 or str(data.get("ResponseCode")) != "0" or not data.get("CheckoutRequestID"):
        raise MpesaError(f"STK push rejected: {resp.status_code} {data}")
    return data["CheckoutRequestID"]


async def stk_query(checkout_request_id: str) -> StkQueryResult:
    """Ask Safaricom for the outcome of an STK push. Never raises — unknown == pending."""
    password, timestamp = _stk_password()
    try:
        resp = await _post("/mpesa/stkpushquery/v1/query", {
            "BusinessShortCode": settings.MPESA_SHORTCODE,
            "Password": password,
            "Timestamp": timestamp,
            "CheckoutRequestID": checkout_request_id,
        })
    except MpesaError as exc:
        log.warning("stk_query %s failed: %s", checkout_request_id, exc)
        return StkQueryResult("pending")

    data = _json(resp)
    if data.get("errorCode") == STK_PENDING_ERROR_CODE:
        return StkQueryResult("pending")
    if "ResultCode" not in data:
        log.warning("stk_query %s unexpected response: %s %s", checkout_request_id, resp.status_code, data)
        return StkQueryResult("pending")
    code = str(data["ResultCode"])
    return StkQueryResult("success" if code == "0" else "failed", code, data.get("ResultDesc", ""))


async def b2c_payment(phone: str, amount_kes: int, remarks: str) -> str:
    """Send money to a customer (owner payout / guest refund). Returns ConversationID."""
    resp = await _post("/mpesa/b2c/v1/paymentrequest", {
        "InitiatorName": settings.MPESA_INITIATOR_NAME,
        "SecurityCredential": settings.MPESA_SECURITY_CREDENTIAL,
        "CommandID": "BusinessPayment",
        "Amount": amount_kes,
        "PartyA": settings.MPESA_SHORTCODE,
        "PartyB": phone,
        "Remarks": remarks[:100],
        "QueueTimeOutURL": callback_url("/b2c/timeout"),
        "ResultURL": callback_url("/b2c/result"),
        "Occasion": "",
    })
    data = _json(resp)
    if resp.status_code != 200 or str(data.get("ResponseCode")) != "0" or not data.get("ConversationID"):
        raise MpesaError(f"B2C rejected: {resp.status_code} {data}")
    return data["ConversationID"]


def _json(resp: httpx.Response) -> dict:
    try:
        data = resp.json()
        return data if isinstance(data, dict) else {}
    except ValueError:
        return {}
