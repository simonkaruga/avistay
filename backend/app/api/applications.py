from fastapi import APIRouter, Request, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone

from app.core.database import get_db
from app.core.deps import require_admin, client_ip
from app.core.audit_log import log_event
from app.models.models import User, OwnerApplication

from app.core.deps import rate_limit
from app.core.phone import stored_variants, try_normalize
router = APIRouter(tags=["applications"])


class ApplicationSubmit(BaseModel):
    full_name: str
    phone: str
    email: Optional[str] = None
    national_id: str
    property_type: str
    property_location: str
    property_description: Optional[str] = None


class ApplicationReview(BaseModel):
    status: str  # "approved" or "rejected"
    rejection_reason: Optional[str] = None


@router.post("/", status_code=status.HTTP_201_CREATED)
async def submit_application(body: ApplicationSubmit, db: AsyncSession = Depends(get_db)):
    # Prevent duplicate pending applications for same phone
    existing = (await db.execute(
        select(OwnerApplication).where(
            OwnerApplication.phone == body.phone,
            OwnerApplication.status == "pending",
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="You already have a pending application")

    # Check if already an owner
    user = (await db.execute(select(User).where(User.phone == body.phone))).scalar_one_or_none()
    if user and user.role in ("owner", "admin"):
        raise HTTPException(status_code=400, detail="This phone is already registered as an owner")

    app = OwnerApplication(
        user_id=user.id if user else None,
        full_name=body.full_name.strip(),
        phone=body.phone,
        email=body.email,
        national_id=body.national_id.strip(),
        property_type=body.property_type,
        property_location=body.property_location.strip(),
        property_description=body.property_description,
    )
    db.add(app)
    await db.commit()
    await db.refresh(app)
    return {"id": app.id, "status": app.status}


def _phone_forms(phone: str) -> list[str]:
    e164 = try_normalize(phone)
    return stored_variants(e164) if e164 else [phone]


@router.get("/status/{phone}")
async def check_application_status(phone: str, request: Request, db: AsyncSession = Depends(get_db)):
    # Public lookup by phone: say only the status. The rejection reason is
    # private (shown to the applicant when signed in / by SMS), and limits stop
    # anyone checking numbers in bulk.
    await rate_limit(f"app_status:{client_ip(request)}", limit=20, window=3600)
    app = (await db.execute(
        select(OwnerApplication).where(OwnerApplication.phone.in_(_phone_forms(phone)))
        .order_by(OwnerApplication.created_at.desc()).limit(1)
    )).scalars().first()
    return {"status": app.status if app else "none"}


# ── Admin endpoints ────────────────────────────────────────────────────────────

@router.get("/admin/list")
async def list_applications(
    status_filter: Optional[str] = None,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    q = select(OwnerApplication).order_by(OwnerApplication.created_at.desc())
    if status_filter:
        q = q.where(OwnerApplication.status == status_filter)
    result = await db.execute(q)
    apps = result.scalars().all()
    return [
        {
            "id": a.id, "full_name": a.full_name, "phone": a.phone, "email": a.email,
            "national_id": a.national_id, "property_type": a.property_type,
            "property_location": a.property_location, "property_description": a.property_description,
            "status": a.status, "rejection_reason": a.rejection_reason,
            "created_at": a.created_at.isoformat(),
        }
        for a in apps
    ]


@router.post("/admin/{application_id}/review")
async def review_application(
    application_id: str,
    body: ApplicationReview,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if body.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be 'approved' or 'rejected'")

    app = (await db.execute(
        select(OwnerApplication).where(OwnerApplication.id == application_id)
    )).scalar_one_or_none()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    app.status = body.status
    app.rejection_reason = body.rejection_reason
    app.reviewed_by = admin.id
    app.reviewed_at = datetime.now(timezone.utc)

    if body.status == "approved":
        # Find or create user and promote to owner
        user = (await db.execute(select(User).where(User.phone == app.phone))).scalar_one_or_none()
        if not user:
            user = User(phone=app.phone, name=app.full_name)
            db.add(user)
        user.role = "owner"
        from app.services.settings import S, refresh as refresh_settings
        await refresh_settings(db)
        user.commission_pct = S().default_commission_pct
        user.name = user.name or app.full_name
        app.user_id = user.id

    await db.commit()
    await log_event(db, f"application_{body.status}", application_id, admin.id,
                    {"phone": app.phone, "reason": body.rejection_reason})

    # Send email notification if email provided
    if app.email:
        from app.services.email import send_email, application_approved_html
        if body.status == "approved":
            await send_email(app.email, "Your Avistay application is approved!",
                application_approved_html(app.full_name))
        elif body.rejection_reason:
            await send_email(app.email, "Update on your Avistay application",
                f"<p>Hi {app.full_name},</p><p>Unfortunately your application was not approved at this time.</p><p>Reason: {body.rejection_reason}</p>")

    return {"status": app.status}
