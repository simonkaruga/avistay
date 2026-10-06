import time
from typing import Optional
from fastapi import Cookie, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import JWTError, decode_token, session_still_valid
from app.core.redis import redis
from app.models.models import User


def _access_token(request: Request, cookie_token: str | None) -> str | None:
    """Web sends an httpOnly cookie; the mobile app sends `Authorization: Bearer`."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return cookie_token


async def _user_from_token(token: str | None, db: AsyncSession) -> User | None:
    if not token:
        return None
    try:
        payload = decode_token(token, expected_type="access")
        user_id = payload["sub"]
    except (JWTError, KeyError):
        return None
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    return user if session_still_valid(user, payload) else None


async def get_current_user(
    request: Request,
    access_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    user = await _user_from_token(_access_token(request, access_token), db)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user


async def get_current_user_optional(
    request: Request,
    access_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    return await _user_from_token(_access_token(request, access_token), db)


async def require_owner(user: User = Depends(get_current_user)) -> User:
    if user.role not in ("owner", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner access required")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


async def require_superadmin(user: User = Depends(require_admin)) -> User:
    """Settings, staff access and money records."""
    if not user.is_superadmin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin access required")
    return user


def client_ip(request: Request) -> str:
    """The visitor's real address. On the live site every request arrives via
    Vercel/Railway proxies, so the socket address is the proxy's: using it would
    make all visitors share one rate limit. Proxies put the original address
    first in X-Forwarded-For (Vercel overwrites any value a client sends)."""
    forwarded = request.headers.get("x-forwarded-for", "")
    first = forwarded.split(",")[0].strip()
    if first:
        return first[:64]
    return request.client.host if request.client else "unknown"


_local_hits: dict[str, list[float]] = {}


def _local_rate_limit(key: str, limit: int, window: int) -> bool:
    """Per-process fallback so limits still hold if Redis is down. True = allowed."""
    now = time.monotonic()
    hits = [t for t in _local_hits.get(key, []) if now - t < window]
    hits.append(now)
    _local_hits[key] = hits
    if len(_local_hits) > 50_000:            # keep memory bounded
        _local_hits.clear()
    return len(hits) <= limit


async def rate_limit(key: str, limit: int, window: int) -> None:
    """Redis rate limiter, with an in-process fallback when Redis is unavailable
    (otherwise a Redis outage would allow unlimited password/code guessing)."""
    try:
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, window)
        allowed = count <= limit
    except Exception:
        allowed = _local_rate_limit(key, limit, window)
    if not allowed:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many attempts. Please wait a few minutes and try again.")
