from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/staynaivasha"
    REDIS_URL: str = "redis://localhost:6379/0"
    JWT_SECRET_KEY: str = "dev-secret-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # M-Pesa — required in production, optional in dev
    MPESA_CONSUMER_KEY: str = ""
    MPESA_CONSUMER_SECRET: str = ""
    MPESA_SHORTCODE: str = ""
    MPESA_PASSKEY: str = ""
    MPESA_CALLBACK_URL: str = "https://api.avistay.com/api/payments/mpesa/callback"
    MPESA_SECURITY_CREDENTIAL: str = ""  # RSA-encrypted initiator password from Safaricom portal
    MPESA_INITIATOR_NAME: str = ""       # B2C API operator username (NOT the shortcode)
    MPESA_BASE_URL: str = "https://api.safaricom.co.ke"  # sandbox: https://sandbox.safaricom.co.ke
    # Random secret appended to every callback URL. Safaricom does not sign callbacks,
    # so this (plus matching CheckoutRequestID + amount) is what authenticates them.
    # Generate with: python -c "import secrets; print(secrets.token_urlsafe(32))"
    MPESA_CALLBACK_SECRET: str = ""

    # Paystack — card payments (Visa/Mastercard/Apple Pay). Card checkout is
    # hidden until a key is set. Test keys (sk_test_...) work end to end.
    PAYSTACK_SECRET_KEY: str = ""
    PAYSTACK_BASE_URL: str = "https://api.paystack.co"

    # Africa's Talking SMS + WhatsApp + OTP
    AT_API_KEY: str = ""
    AT_USERNAME: str = "sandbox"
    AT_WHATSAPP_NUMBER: str = ""   # Your registered AT WhatsApp channel number e.g. +254700000000

    # Google OAuth
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    FRONTEND_URL: str = "http://localhost:5173"   # override in prod: https://avistay.com
    BACKEND_URL: str = "http://localhost:8000"    # override in prod: https://api.avistay.com

    # Third-party services
    CLAUDE_API_KEY: str = ""
    CLAUDE_MODEL: str = "claude-sonnet-5-5"   # guest chat + listing description writer
    SENDGRID_API_KEY: str = ""
    FCM_SERVER_KEY: str = ""
    CLOUDINARY_URL: str = ""
    SENTRY_DSN: str = ""

    ALLOWED_ORIGINS: list[str] = [
        "https://avistay.com",
        "https://www.avistay.com",
        # Old StayNaivasha domains — keep until they redirect to avistay.com
        "https://staynaivasha.co.ke",
        "https://www.staynaivasha.co.ke",
        "http://localhost:5173",
        # Mobile app (Capacitor) webview origins
        "capacitor://localhost",   # iOS
        "https://localhost",       # Android
    ]

    class Config:
        env_file = ".env"  # dev only. Railway uses env vars in production


settings = Settings()

# A live site (https front end) must never run on the public default secret:
# anyone could sign their own login tokens, including for admins.
_live = settings.FRONTEND_URL.startswith("https://")
if _live and (settings.JWT_SECRET_KEY == "dev-secret-change-in-production" or len(settings.JWT_SECRET_KEY) < 32):
    raise RuntimeError("Set JWT_SECRET_KEY to a random value of 32+ characters before going live "
                       "(python -c \"import secrets; print(secrets.token_urlsafe(48))\")")

if settings.MPESA_CONSUMER_KEY and len(settings.MPESA_CALLBACK_SECRET) < 32:
    raise RuntimeError("MPESA_CALLBACK_SECRET (>= 32 chars) is required when M-Pesa is enabled")
