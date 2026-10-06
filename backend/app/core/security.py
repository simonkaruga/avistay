import uuid
from datetime import datetime, timedelta, timezone

import jwt   # PyJWT (python-jose was dropped: unmaintained, pulls in vulnerable ecdsa)

from app.core.config import settings

ALGORITHM = settings.JWT_ALGORITHM
JWTError = jwt.PyJWTError   # what callers catch: bad signature, expired, malformed, wrong type


def create_access_token(subject: str) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": subject, "exp": expire, "iat": now, "type": "access"}, settings.JWT_SECRET_KEY, ALGORITHM)


def create_refresh_token(subject: str) -> tuple[str, str]:
    """Returns (token, session id). Each login/device is its own session."""
    jti = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    expire = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    token = jwt.encode({"sub": subject, "exp": expire, "iat": now, "type": "refresh", "jti": jti},
                       settings.JWT_SECRET_KEY, ALGORITHM)
    return token, jti


def decode_token(token: str, expected_type: str | None = None) -> dict:
    """Raises JWTError if invalid, expired, or not the expected kind of token
    (a 30-day refresh token must never work as an access token)."""
    payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[ALGORITHM])
    if expected_type and payload.get("type") != expected_type:
        raise jwt.InvalidTokenError("wrong token type")
    return payload


def session_still_valid(user, payload: dict) -> bool:
    """False if the user is banned/deleted or signed out everywhere after this token was issued."""
    if user is None or user.deleted_at is not None or user.role == "banned":
        return False
    revoked = user.sessions_revoked_at
    if revoked is None:
        return True
    if revoked.tzinfo is None:
        revoked = revoked.replace(tzinfo=timezone.utc)
    issued = payload.get("iat")
    return issued is not None and datetime.fromtimestamp(issued, timezone.utc) >= revoked.replace(microsecond=0)


def revoke_sessions(user) -> None:
    """Sign this person out on every device (caller commits)."""
    user.sessions_revoked_at = datetime.now(timezone.utc)
