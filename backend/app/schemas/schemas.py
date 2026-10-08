from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, field_validator, Field

from app.core.phone import normalize_ke

KRA_PIN_RE = r"^[A-Z]\d{9}[A-Z]$"


def clean_tra_licence(v: Optional[str]) -> Optional[str]:
    """Tourism Regulatory Authority number: uppercase, letters/digits and / - . only."""
    v = (v or "").strip().upper()
    if not v:
        return None
    if len(v) < 3 or not all(c.isalnum() or c in "/-. " for c in v):
        raise ValueError("Enter the licence number exactly as it appears on your TRA certificate")
    return v   # e.g. A012345678Z (people) / P051234567A (companies)


# ── Auth ─────────────────────────────────────────────────────────────────────


class OTPRequest(BaseModel):
    phone: str = Field(..., examples=["+254712345678"])

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_ke(v)


class OTPVerify(BaseModel):
    phone: str
    code: str = Field(..., min_length=6, max_length=6)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_ke(v)

class TokenResponse(BaseModel):
    user_id: str
    role: str
    phone: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    sms_opt_in: bool = True
    is_superadmin: bool = False
    # Only for the mobile app (X-Client: native) — the web uses httpOnly cookies
    # so tokens are never readable by page scripts.
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    expires_in: Optional[int] = None


# ── Properties ───────────────────────────────────────────────────────────────

class PropertyImageOut(BaseModel):
    cloudinary_url: str
    is_primary: bool
    display_order: int

    class Config:
        from_attributes = True

def _hhmm(v: str) -> str:
    """'9:00' / '09:00' → '09:00'; rejects anything that isn't a 24h time."""
    import re
    m = re.fullmatch(r"([01]?\d|2[0-3]):([0-5]\d)", (v or "").strip())
    if not m:
        raise ValueError("Use a 24-hour time like 14:00")
    return f"{int(m.group(1)):02d}:{m.group(2)}"


class PropertyCreate(BaseModel):
    title: str = Field(..., min_length=5, max_length=200)
    type: str
    price_per_night: int = Field(..., gt=0, description="KES integers only")
    description: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    what3words: Optional[str] = None
    landmark_instructions: Optional[str] = None
    min_nights: int = 1
    no_checkout_days: Optional[str] = None  # comma-separated day numbers e.g. "0,6"
    response_time_hours: Optional[int] = None
    cancellation_policy: str = "moderate"
    area: Optional[str] = None
    # House rules & policies
    deposit_amount: int = Field(0, ge=0, le=100_000, description="KES; 0 = no damage deposit")
    max_guests: Optional[int] = Field(None, ge=1, le=100)
    check_in_from: str = "14:00"
    check_in_until: Optional[str] = None
    check_out_until: str = "10:00"
    children_allowed: bool = True
    pets_allowed: bool = False
    smoking_allowed: bool = False
    parties_allowed: bool = False
    quiet_hours: Optional[str] = None
    house_rules: Optional[str] = Field(None, max_length=2000)
    tra_licence_no: Optional[str] = Field(None, max_length=40)   # Tourism Regulatory Authority number

    @field_validator("tra_licence_no")
    @classmethod
    def _tra(cls, v: Optional[str]) -> Optional[str]:
        return clean_tra_licence(v)

    @field_validator("check_in_from", "check_out_until")
    @classmethod
    def _time(cls, v: str) -> str:
        return _hhmm(v)

    @field_validator("check_in_until")
    @classmethod
    def _opt_time(cls, v: Optional[str]) -> Optional[str]:
        return _hhmm(v) if v else None

    @field_validator("quiet_hours")
    @classmethod
    def _quiet(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return None
        start, _, end = v.partition("-")
        return f"{_hhmm(start.strip())}-{_hhmm(end.strip())}"

    @field_validator("cancellation_policy")
    @classmethod
    def _policy(cls, v: str) -> str:
        if v not in ("flexible", "moderate", "strict"):
            raise ValueError("cancellation_policy must be flexible, moderate or strict")
        return v

    @field_validator("area")
    @classmethod
    def _known_area(cls, v: Optional[str]) -> Optional[str]:
        from app.models.models import NAIVASHA_AREAS
        if v and v not in NAIVASHA_AREAS:
            raise ValueError(f"area must be one of: {', '.join(NAIVASHA_AREAS)}")
        return v or None

class PropertyOut(BaseModel):
    id: str
    title: str
    type: str
    price_per_night: int
    description: Optional[str]
    lat: Optional[float]
    lng: Optional[float]
    what3words: Optional[str]
    landmark_instructions: Optional[str]
    verified_tier: int
    min_nights: int
    no_checkout_days: Optional[str]
    response_time_hours: Optional[int]
    cancellation_policy: str = "moderate"
    area: Optional[str] = None
    deposit_amount: int = 0
    max_guests: Optional[int] = None
    check_in_from: str = "14:00"
    check_in_until: Optional[str] = None
    check_out_until: str = "10:00"
    children_allowed: bool = True
    pets_allowed: bool = False
    smoking_allowed: bool = False
    parties_allowed: bool = False
    quiet_hours: Optional[str] = None
    house_rules: Optional[str] = None
    tra_licence_no: Optional[str] = None
    active: bool
    images: list[PropertyImageOut] = []

    class Config:
        from_attributes = True

class PropertyDetailOut(PropertyOut):
    """Public property page: listing + what a guest needs to decide."""
    area_label: Optional[str] = None
    host_name: Optional[str] = None
    host_since: Optional[datetime] = None
    host_id_verified: bool = False
    deposit_amount: int = 0
    policy_summary: Optional[str] = None


class PropertyListOut(BaseModel):
    id: str
    title: str
    type: str
    price_per_night: int
    verified_tier: int
    primary_image: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    avg_rating: Optional[float] = None
    review_count: Optional[int] = None
    area: Optional[str] = None
    min_nights: int = 1
    max_guests: Optional[int] = None

    class Config:
        from_attributes = True


# ── Bookings ─────────────────────────────────────────────────────────────────

class BookingCreate(BaseModel):
    property_id: str
    check_in: date
    check_out: date
    guests: int = Field(..., ge=1)
    promo_code: Optional[str] = None
    terms_accepted: bool = Field(..., description="Must be True to proceed")
    group_name: Optional[str] = None
    is_corporate: bool = False
    company_name: Optional[str] = None
    kra_pin: Optional[str] = None
    ref_code: Optional[str] = Field(None, max_length=12)   # agent who referred the guest (?ref= link)

class BookingOut(BaseModel):
    id: str
    property_id: str
    property_title: Optional[str] = None
    check_in: date
    check_out: date
    total_amount: int
    platform_fee: int
    deposit_amount: int
    guests: int = 1
    group_name: Optional[str] = None
    is_corporate: bool = False
    company_name: Optional[str] = None
    kra_pin: Optional[str] = None
    status: str
    checkin_code: Optional[str] = None
    mpesa_ref: Optional[str] = None
    created_at: datetime
    # Price snapshot + money state
    room_amount: int = 0
    levy_amount: int = 0
    cancellation_policy: str = "moderate"
    deposit_status: str = "none"
    checked_in_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    cancelled_by: Optional[str] = None
    # Guest "manage booking" view (computed; only set by /bookings/mine)
    policy_summary: Optional[str] = None
    free_cancellation_until: Optional[date] = None
    deposit_note: Optional[str] = None
    dispute_id: Optional[str] = None
    dispute_status: Optional[str] = None
    host: Optional[dict] = None              # host name + phone once paid (guest view)
    unread_messages: int = 0
    can_cancel: bool = False
    can_report: bool = False

    class Config:
        from_attributes = True
