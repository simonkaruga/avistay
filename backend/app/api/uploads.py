from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.deps import get_current_user, rate_limit
from app.models.models import User
from app.services.media import signed_upload_params

router = APIRouter(tags=["uploads"])


class SignatureRequest(BaseModel):
    purpose: Literal["listing", "dispute", "site"]


@router.post("/signature")
async def upload_signature(body: SignatureRequest, user: User = Depends(get_current_user)):
    """Short-lived signature for one direct-to-Cloudinary upload."""
    if body.purpose == "listing" and user.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only hosts can upload listing photos")
    if body.purpose == "site" and user.role != "admin":
        raise HTTPException(status_code=403, detail="Only the Avistay team can upload home-page images")
    await rate_limit(f"upload_sig:{user.id}", limit=300, window=3600)
    try:
        return signed_upload_params(body.purpose, user.id)
    except RuntimeError:
        raise HTTPException(status_code=503, detail="Photo uploads are not configured")
