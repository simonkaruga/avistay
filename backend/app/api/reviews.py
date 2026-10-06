from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime

from app.core.database import get_db
from app.core.deps import get_current_user, require_owner
from app.models.models import User, Booking, Review, Property

router = APIRouter(tags=["reviews"])


class ReviewCreate(BaseModel):
    booking_id: str
    accuracy_score: int = Field(..., ge=1, le=5)
    cleanliness_score: int = Field(..., ge=1, le=5)
    location_score: int = Field(..., ge=1, le=5)
    value_score: int = Field(..., ge=1, le=5)
    comment: Optional[str] = Field(None, max_length=1000)


class ReviewOut(BaseModel):
    id: str
    booking_id: str
    accuracy_score: int
    cleanliness_score: int
    location_score: int
    value_score: int
    comment: Optional[str]
    owner_response: Optional[str]
    avg_score: float
    created_at: datetime
    guest_name: str = "Verified guest"   # first name + initial only, never the full name

    class Config:
        from_attributes = True


class OwnerResponse(BaseModel):
    response: str = Field(..., max_length=500)


@router.post("/", response_model=ReviewOut, status_code=status.HTTP_201_CREATED)
async def create_review(
    body: ReviewCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Only confirmed guests who stayed can review
    booking = (await db.execute(
        select(Booking).where(
            Booking.id == body.booking_id,
            Booking.guest_id == user.id,
            Booking.status.in_(["checked_in", "completed"]),
        )
    )).scalar_one_or_none()

    if not booking:
        raise HTTPException(status_code=403, detail="Only confirmed guests can leave a review")

    existing = (await db.execute(
        select(Review).where(Review.booking_id == body.booking_id)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Review already submitted for this booking")

    review = Review(
        booking_id=body.booking_id,
        accuracy_score=body.accuracy_score,
        cleanliness_score=body.cleanliness_score,
        location_score=body.location_score,
        value_score=body.value_score,
        comment=body.comment,
    )
    db.add(review)
    await db.commit()
    await db.refresh(review)
    return _with_avg(review)


@router.get("/property/{property_id}", response_model=list[ReviewOut])
async def list_property_reviews(property_id: str, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Review, User.name, User.deleted_at)
        .join(Booking, Review.booking_id == Booking.id)
        .join(User, User.id == Booking.guest_id)
        .where(Booking.property_id == property_id)
        .order_by(Review.created_at.desc())
    )).all()
    return [{**_with_avg(r), "guest_name": public_name(name, deleted)} for r, name, deleted in rows]


def public_name(name: Optional[str], deleted_at=None) -> str:
    """'Wanjiru Kamau' → 'Wanjiru K.' — enough to feel real, not enough to identify."""
    if deleted_at or not name or not name.strip():
        return "Verified guest"
    parts = name.split()
    return f"{parts[0].title()} {parts[-1][0].upper()}." if len(parts) > 1 else parts[0].title()


@router.post("/{review_id}/respond", response_model=ReviewOut)
async def owner_respond(
    review_id: str,
    body: OwnerResponse,
    owner: User = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    review = (await db.execute(select(Review).where(Review.id == review_id))).scalar_one_or_none()
    owns = review is not None and (await db.execute(
        select(Property.id).join(Booking, Booking.property_id == Property.id)
        .where(Booking.id == review.booking_id, Property.owner_id == owner.id))).first()
    if not review or not (owns or owner.role == "admin"):     # only the host of that home
        raise HTTPException(status_code=404, detail="Review not found")

    review.owner_response = body.response
    await db.commit()
    await db.refresh(review)
    return _with_avg(review)


def _with_avg(r: Review) -> dict:
    avg = (r.accuracy_score + r.cleanliness_score + r.location_score + r.value_score) / 4
    fields = {k: getattr(r, k) for k in ReviewOut.model_fields if k != "avg_score" and hasattr(r, k)}
    return ReviewOut.model_validate({**fields, "avg_score": round(avg, 1)}).model_dump()
