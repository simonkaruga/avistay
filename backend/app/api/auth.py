import hmac
import logging
import secrets
import string
from datetime import datetime, timezone
from urllib.parse import urlencode

from typing import Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Response, Request, status
from fastapi.responses import RedirectResponse
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.core.database import get_db
from app.core.redis import redis
from app.core.security import (
    create_access_token, create_refresh_token, decode_token, revoke_sessions, session_still_valid,
)
from app.core.config import settings
from app.core.phone import normalize_ke, stored_variants
from app.core.deps import rate_limit, get_current_user, get_current_user_optional, client_ip
from app.models.models import User
from app.schemas.schemas import OTPRequest, OTPVerify, TokenResponse

log = logging.getLogger(__name__)
router = APIRouter(tags=["auth"])

OTP_TTL = 300  # 5 minutes

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

GOOGLE_AUTH_URL    = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL   = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _otp_key(phone: str) -> str:
    return f"otp:{phone}"

def _generate_otp() -> str:
    return "".join(secrets.choice(string.digits) for _ in range(6))   # not `random`: codes must be unguessable

def _pw_reset_key(token: str) -> str:
    return f"pw_reset:{token}"

async def _redis_ok() -> bool:
    try:
        await redis.ping()
        return True
    except Exception:
        return False

REFRESH_COOKIE_PATH = "/api/auth"


def _is_native(request: Request | None) -> bool:
    """The iOS/Android app identifies itself; it keeps tokens in secure device storage."""
    return request is not None and request.headers.get("x-client") == "native"


def _session_key(user_id: str, jti: str) -> str:
    return f"refresh:{user_id}:{jti}"


def _set_cookies(response: Response, access: str, refresh: str) -> None:
    secure = settings.FRONTEND_URL.startswith("https://")   # https sites: cookies never travel unencrypted
    response.set_cookie("access_token", access, httponly=True, samesite="lax", secure=secure,
                        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60)
    response.set_cookie("refresh_token", refresh, httponly=True, samesite="lax", secure=secure,
                        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400, path=REFRESH_COOKIE_PATH)


def _clear_cookies(response: Response) -> None:
    response.delete_cookie("access_token")
    response.delete_cookie("refresh_token", path=REFRESH_COOKIE_PATH)

def _token_resp(user: User) -> TokenResponse:
    return TokenResponse(user_id=user.id, role=user.role, phone=user.phone,
                         name=user.name, email=user.email,
                         sms_opt_in=getattr(user, "sms_opt_in", True),
                         is_superadmin=bool(user.is_superadmin))

async def _issue_tokens(user: User, response: Response, request: Request | None = None) -> TokenResponse:
    """Start (or rotate) one session. Each device has its own, so signing in on
    the phone app doesn't sign you out of the website."""
    if user.role == "banned":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="This account has been suspended. Contact NaivaStay support if you think this is a mistake.")
    access = create_access_token(user.id)
    refresh, jti = create_refresh_token(user.id)
    if await _redis_ok():
        await redis.set(_session_key(user.id, jti), "1", ex=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400)
    out = _token_resp(user)
    if _is_native(request):
        out.access_token, out.refresh_token = access, refresh
        out.expires_in = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    else:
        _set_cookies(response, access, refresh)
    return out

async def _send_sms(phone: str, message: str) -> None:
    if not settings.AT_API_KEY:
        print(f"[DEV OTP] {phone}: {message}")   # dev only: never log codes in production
        return
    import httpx
    is_sandbox = settings.AT_USERNAME == "sandbox"
    url = ("https://api.sandbox.africastalking.com/version1/messaging" if is_sandbox
           else "https://api.africastalking.com/version1/messaging")
    async with httpx.AsyncClient() as client:
        r = await client.post(
            url,
            data={"username": settings.AT_USERNAME, "to": phone, "message": message},
            headers={"apiKey": settings.AT_API_KEY, "Accept": "application/json"},
        )
        if r.status_code >= 400:
            log.error("Africa's Talking SMS failed: HTTP %s", r.status_code)

async def _send_email(to: str, subject: str, body: str) -> None:
    print(f"[EMAIL] to={to}\nSubject: {subject}\n{body}")
    if not settings.SENDGRID_API_KEY:
        return
    import sendgrid
    from sendgrid.helpers.mail import Mail
    sg = sendgrid.SendGridAPIClient(api_key=settings.SENDGRID_API_KEY)
    message = Mail(
        from_email="noreply@naivastay.com",
        to_emails=to,
        subject=subject,
        plain_text_content=body,
    )
    sg.send(message)

# In-memory fallbacks for dev when Redis is unavailable
_otp_fallback:      dict[str, str] = {}
_pw_reset_fallback: dict[str, str] = {}  # token → user_id


# ── /me ───────────────────────────────────────────────────────────────────────

@router.get("/me", response_model=TokenResponse)
async def get_me(user: User = Depends(get_current_user_optional)):
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return _token_resp(user)


class ProfileUpdate(BaseModel):
    name:  Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    phone_code: Optional[str] = Field(None, min_length=6, max_length=6)   # required when changing phone
    sms_opt_in: Optional[bool] = None

@router.put("/me", response_model=TokenResponse)
async def update_profile(
    body: ProfileUpdate,
    user: User = Depends(get_current_user_optional),
    db:   AsyncSession = Depends(get_db),
):
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if body.name is not None:
        user.name = body.name.strip() or None
    if body.email is not None:
        user.email = body.email.strip().lower() or None
    if body.phone is not None:
        if not body.phone.strip():
            user.phone = None
        else:
            try:
                ph = normalize_ke(body.phone)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc))
            if ph != user.phone:
                # Prove you own the number (same SMS code as sign-in). Otherwise anyone
                # could put a stranger's number on their account and capture their sign-in.
                if not body.phone_code or not await _consume_otp(ph, body.phone_code):
                    raise HTTPException(status_code=400, detail="Enter the code we sent to your new number")
                if (await db.execute(select(User.id).where(User.phone.in_(stored_variants(ph)), User.id != user.id))).first():
                    raise HTTPException(status_code=409, detail="This number is already on another NaivaStay account")
                user.phone = ph
    if body.sms_opt_in is not None:
        user.sms_opt_in = body.sms_opt_in
    await db.commit()
    await db.refresh(user)
    return _token_resp(user)


# ── Phone OTP ─────────────────────────────────────────────────────────────────

@router.post("/otp/request", status_code=status.HTTP_204_NO_CONTENT)
async def request_otp(body: OTPRequest, request: Request):
    await rate_limit(f"otp_req:{body.phone}", limit=3, window=1800)
    # Per-device too: stops one visitor making us text hundreds of numbers (cost + abuse).
    await rate_limit(f"otp_ip:{client_ip(request)}", limit=10, window=3600)
    otp = _generate_otp()
    if await _redis_ok():
        await redis.set(_otp_key(body.phone), otp, ex=OTP_TTL)
    else:
        _otp_fallback[body.phone] = otp
    await _send_sms(body.phone, f"Your NaivaStay code is {otp}. Valid 5 minutes.")


async def _consume_otp(phone: str, code: str) -> bool:
    """One guess per code: it's deleted whether right or wrong."""
    if await _redis_ok():
        stored = await redis.get(_otp_key(phone))
        await redis.delete(_otp_key(phone))
    else:
        stored = _otp_fallback.pop(phone, None)
    if isinstance(stored, bytes):
        stored = stored.decode()
    return bool(stored) and hmac.compare_digest(str(stored), code)


@router.post("/otp/verify", response_model=TokenResponse)
async def verify_otp(body: OTPVerify, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    if not await _consume_otp(body.phone, body.code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired code")

    # Older accounts may hold the number as typed (07…, 254…): find them too,
    # and move them to the standard +254 form so there's one account per person.
    user = (await db.execute(
        select(User).where(User.phone.in_(stored_variants(body.phone)), User.deleted_at.is_(None))
        .order_by(User.created_at)
    )).scalars().first()
    if not user:
        user = User(phone=body.phone)
        db.add(user)
        await db.commit()
        await db.refresh(user)
    elif user.phone != body.phone:
        taken = (await db.execute(select(User.id).where(User.phone == body.phone))).first()
        if not taken:
            user.phone = body.phone
            await db.commit()

    return await _issue_tokens(user, response, request)


# ── Email / password auth ─────────────────────────────────────────────────────

class EmailLogin(BaseModel):
    email:    str
    password: str

class EmailRegister(BaseModel):
    email:    str
    password: str = Field(..., min_length=8)
    name:     Optional[str] = None


@router.post("/email/register", response_model=TokenResponse)
async def email_register(body: EmailRegister, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    await rate_limit(f"email_reg:{body.email.strip().lower()}", limit=5, window=3600)

    email = body.email.lower().strip()
    result = await db.execute(select(User).where(User.email == email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered. Sign in instead.")

    user = User(email=email, password_hash=pwd_ctx.hash(body.password), name=body.name)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return await _issue_tokens(user, response, request)


@router.post("/email/login", response_model=TokenResponse)
async def email_login(body: EmailLogin, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    await rate_limit(f"email_login:{body.email.strip().lower()}", limit=10, window=900)
    await rate_limit(f"email_login_ip:{client_ip(request)}", limit=30, window=900)

    email = body.email.lower().strip()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if not user or not user.password_hash or not pwd_ctx.verify(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    return await _issue_tokens(user, response, request)


# ── Forgot / reset password ───────────────────────────────────────────────────

class ForgotPasswordBody(BaseModel):
    email: str

class ResetPasswordBody(BaseModel):
    token:        str
    new_password: str = Field(..., min_length=8)


@router.post("/password/forgot", status_code=status.HTTP_204_NO_CONTENT)
async def forgot_password(body: ForgotPasswordBody, db: AsyncSession = Depends(get_db)):
    await rate_limit(f"pw_forgot:{body.email.strip().lower()}", limit=3, window=3600)

    email = body.email.lower().strip()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        return  # always 204. Don't reveal whether email exists

    token = secrets.token_urlsafe(32)
    if await _redis_ok():
        await redis.set(_pw_reset_key(token), user.id, ex=1800)
    else:
        _pw_reset_fallback[token] = user.id

    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={token}"
    if not settings.SENDGRID_API_KEY:
        print(f"[DEV PASSWORD RESET] {reset_url}")   # dev only: a logged link lets anyone reset the password

    await _send_email(
        to=email,
        subject="Reset your NaivaStay password",
        body=(
            f"Hi {user.name or 'there'},\n\n"
            f"Click the link below to reset your password:\n\n"
            f"{reset_url}\n\n"
            f"This link expires in 30 minutes.\n\n"
            f"If you didn't request this, just ignore this email.\n\n"
            f"The NaivaStay team"
        ),
    )


@router.post("/password/reset", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(body: ResetPasswordBody, db: AsyncSession = Depends(get_db)):
    if await _redis_ok():
        user_id = await redis.get(_pw_reset_key(body.token))
        await redis.delete(_pw_reset_key(body.token))
    else:
        user_id = _pw_reset_fallback.pop(body.token, None)

    if not user_id:
        raise HTTPException(status_code=400, detail="Reset link expired or already used")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=400, detail="Account not found")

    user.password_hash = pwd_ctx.hash(body.new_password)
    revoke_sessions(user)     # whoever had the old password is signed out everywhere
    await db.commit()


# ── Google OAuth ──────────────────────────────────────────────────────────────

def _google_fail(reason: str) -> RedirectResponse:
    """Send the person back to the sign-in page with a friendly message, never raw JSON."""
    return RedirectResponse(f"{settings.FRONTEND_URL}/profile?error=google_{reason}")


@router.get("/google")
async def google_auth():
    if not settings.GOOGLE_CLIENT_ID:
        return _google_fail("unavailable")

    # The state value is checked on the way back (stops forged sign-in links).
    # Kept in a short-lived cookie so it works with or without Redis.
    state = secrets.token_urlsafe(24)

    params = {
        "client_id":     settings.GOOGLE_CLIENT_ID,
        "redirect_uri":  f"{settings.BACKEND_URL}/api/auth/google/callback",
        "response_type": "code",
        "scope":         "email profile",
        "state":         state,
        "access_type":   "online",
    }
    redirect = RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}")
    redirect.set_cookie("g_state", state, max_age=600, httponly=True, samesite="lax",
                        secure=settings.BACKEND_URL.startswith("https://"), path="/api/auth/google")
    return redirect


@router.get("/google/callback")
async def google_callback(
    request:  Request,
    response: Response,
    code:     Optional[str] = None,
    state:    Optional[str] = None,
    db:       AsyncSession = Depends(get_db),
):
    if not settings.GOOGLE_CLIENT_ID:
        return _google_fail("unavailable")
    if not code:                      # the person pressed Cancel on Google's page
        return _google_fail("cancelled")
    expected = request.cookies.get("g_state")
    if not state or not expected or not hmac.compare_digest(state, expected):
        return _google_fail("expired")

    import httpx
    async with httpx.AsyncClient() as client:
        token_r = await client.post(GOOGLE_TOKEN_URL, data={
            "code":          code,
            "client_id":     settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri":  f"{settings.BACKEND_URL}/api/auth/google/callback",
            "grant_type":    "authorization_code",
        })
        if not token_r.is_success:
            return _google_fail("token")

        g_access = token_r.json()["access_token"]

        info_r = await client.get(GOOGLE_USERINFO_URL,
                                  headers={"Authorization": f"Bearer {g_access}"})
        if not info_r.is_success:
            return _google_fail("info")

        info = info_r.json()

    google_id = info["id"]
    email     = info.get("email", "").lower()
    name      = info.get("name")

    # Find existing user by google_id, then by matching email
    result = await db.execute(select(User).where(User.google_id == google_id))
    user   = result.scalar_one_or_none()

    # Only join an existing account by email if Google has verified that email,
    # otherwise anyone could claim someone else's NaivaStay account.
    if not user and email and info.get("verified_email"):
        result = await db.execute(select(User).where(User.email == email, User.deleted_at.is_(None)))
        user   = result.scalar_one_or_none()
        if user:
            user.google_id = google_id  # link Google to existing account

    if not user:
        taken = email and (await db.execute(select(User.id).where(User.email == email))).first()
        user = User(email=(email or None) if not taken else None, google_id=google_id, name=name)
        db.add(user)
        await db.commit()
        await db.refresh(user)
    else:
        if name and not user.name:
            user.name = name
        await db.commit()

    redirect = RedirectResponse(f"{settings.FRONTEND_URL}/profile")
    redirect.delete_cookie("g_state", path="/api/auth/google")
    await _issue_tokens(user, redirect)
    return redirect


# ── Token refresh ─────────────────────────────────────────────────────────────

class RefreshBody(BaseModel):
    refresh_token: Optional[str] = None


def _refresh_token_from(request: Request, body: RefreshBody | None) -> str | None:
    if body and body.refresh_token:      # mobile app
        return body.refresh_token
    return request.cookies.get("refresh_token")


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    request: Request,
    response: Response,
    body: Optional[RefreshBody] = None,
    db: AsyncSession = Depends(get_db),
):
    token = _refresh_token_from(request, body)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No refresh token")
    try:
        payload = decode_token(token, expected_type="refresh")
        user_id = payload["sub"]
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    # Rotation: each refresh token works once. A reused one means it leaked.
    if await _redis_ok():
        jti = payload.get("jti")
        if jti:
            if not await redis.delete(_session_key(user_id, jti)):
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
        else:
            # Token from before per-device sessions — accept once, then migrate.
            if await redis.get(f"refresh:{user_id}") != token:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
            await redis.delete(f"refresh:{user_id}")

    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None or not session_still_valid(user, payload):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    return await _issue_tokens(user, response, request)


# ── Push subscriptions ────────────────────────────────────────────────────────

@router.post("/push-subscribe", status_code=status.HTTP_204_NO_CONTENT)
async def push_subscribe(
    request: Request,
    user:    User = Depends(get_current_user_optional),
    db:      AsyncSession = Depends(get_db),
):
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    body     = await request.json()
    endpoint = body.get("endpoint", "")
    if endpoint:
        user.fcm_token = endpoint
        await db.commit()


# ── Logout ────────────────────────────────────────────────────────────────────

async def _end_session(token: str | None) -> None:
    if not token or not await _redis_ok():
        return
    try:
        payload = decode_token(token, expected_type="refresh")
    except Exception:
        return
    if payload.get("jti"):
        await redis.delete(_session_key(payload["sub"], payload["jti"]))
    else:
        await redis.delete(f"refresh:{payload['sub']}")


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response, body: Optional[RefreshBody] = None):
    await _end_session(_refresh_token_from(request, body))
    _clear_cookies(response)


# ── Account deletion (required by Google Play and the App Store) ─────────────

@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    response: Response,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Erase personal data and sign out everywhere. Booking and payment records
    are kept, anonymised, because Kenyan tax law requires 7 years' retention."""
    from app.core.audit_log import log_event
    from app.models.models import Booking, Dispute, Payment, Property

    live = ("pending", "confirmed", "checked_in")
    guest_live = (await db.execute(select(Booking.id).where(
        Booking.guest_id == user.id, Booking.status.in_(live)).limit(1))).first()
    host_live = (await db.execute(select(Booking.id).join(Property, Property.id == Booking.property_id).where(
        Property.owner_id == user.id, Booking.status.in_(live)).limit(1))).first()
    if guest_live or host_live:
        raise HTTPException(status_code=409, detail="You have upcoming or ongoing stays. Cancel them (or wait until they finish) before deleting your account.")
    money_in_flight = (await db.execute(
        select(Payment.id).join(Booking, Booking.id == Payment.booking_id)
        .join(Property, Property.id == Booking.property_id)
        .where(Payment.status.in_(["pending", "processing"]),
               (Booking.guest_id == user.id) | (Property.owner_id == user.id)).limit(1)
    )).first()
    open_case = (await db.execute(select(Dispute.id).where(
        Dispute.opened_by == user.id, Dispute.status == "open").limit(1))).first()
    if money_in_flight or open_case:
        raise HTTPException(status_code=409, detail="A payment or problem report is still being processed. Try again once it's finished.")

    await db.execute(update(Property).where(Property.owner_id == user.id).values(active=False))
    for field in ("name", "phone", "email", "password_hash", "google_id", "fcm_token",
                  "national_id_url", "passport_number"):
        setattr(user, field, None)
    user.sms_opt_in = False
    user.deleted_at = datetime.now(timezone.utc)
    revoke_sessions(user)
    await log_event(db, "account_deleted", user.id, user.id, {})

    if await _redis_ok():
        async for key in redis.scan_iter(match=f"refresh:{user.id}*"):
            await redis.delete(key)
    _clear_cookies(response)
