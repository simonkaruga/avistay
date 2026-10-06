import sentry_sdk
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError
from app.api import health, auth, properties, bookings, payments, ical, reviews, admin, owner, applications, agent, whatsapp, disputes, uploads, home, console, avi

import logging


def _redact(text: str) -> str:
    """The M-Pesa callback secret is part of the callback URL; never let it reach logs."""
    secret = settings.MPESA_CALLBACK_SECRET
    return text.replace(secret, "[redacted]") if secret and isinstance(text, str) else text


class _RedactSecrets(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = _redact(record.msg) if isinstance(record.msg, str) else record.msg
        if isinstance(record.args, tuple):
            record.args = tuple(_redact(a) if isinstance(a, str) else a for a in record.args)
        return True


for _name in ("uvicorn.access", "uvicorn.error", "app"):
    logging.getLogger(_name).addFilter(_RedactSecrets())


def _scrub_event(event, hint):
    """Same for error reports sent to Sentry (request URL, transaction name)."""
    req = event.get("request") or {}
    if "url" in req:
        req["url"] = _redact(req["url"])
    if "transaction" in event:
        event["transaction"] = _redact(event["transaction"])
    return event


sentry_sdk.init(dsn=settings.SENTRY_DSN, traces_sample_rate=0.1, send_default_pii=False,
                before_send=_scrub_event, before_send_transaction=_scrub_event)

app = FastAPI(title="Avistay API", version="1.0.0", docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(health.router,      prefix="/api")
app.include_router(auth.router,        prefix="/api/auth")
app.include_router(properties.router,  prefix="/api/properties")
app.include_router(bookings.router,    prefix="/api/bookings")
app.include_router(payments.router,    prefix="/api/payments")
app.include_router(ical.router,        prefix="/api/ical")
app.include_router(reviews.router,     prefix="/api/reviews")
app.include_router(owner.router,       prefix="/api/owner")
app.include_router(admin.router,       prefix="/api/admin")
app.include_router(console.router,     prefix="/api/admin/console")
app.include_router(applications.router, prefix="/api/applications")
app.include_router(disputes.router,     prefix="/api/disputes")
app.include_router(uploads.router,      prefix="/api/uploads")
app.include_router(home.router,         prefix="/api")
app.include_router(avi.router,          prefix="/api")
app.include_router(agent.router,        prefix="/api")
app.include_router(whatsapp.router,     prefix="/api")


@app.exception_handler(DBAPIError)
async def _bad_id_is_not_found(request: Request, exc: DBAPIError):
    """A malformed ID in a URL (e.g. /api/properties/abc) is 'not found', not a
    server error. Anything else is a real database error and is re-raised."""
    msg = str(getattr(exc, "orig", exc))
    if "invalid UUID" in msg or "invalid input syntax for type uuid" in msg:
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    raise exc


@app.middleware("http")
async def _security_headers(request: Request, call_next):
    """Browser protections on every API response. The website's own pages get
    theirs from frontend/vercel.json."""
    response = await call_next(request)
    h = response.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("X-Frame-Options", "DENY")
    h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    h.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
    if settings.FRONTEND_URL.startswith("https://"):
        h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    if request.url.path.startswith("/api/auth") or request.url.path.startswith("/api/admin"):
        h.setdefault("Cache-Control", "no-store")   # personal data never cached by proxies
    return response
