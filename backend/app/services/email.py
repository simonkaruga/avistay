"""SendGrid email notifications. Silently skips if SENDGRID_API_KEY not set."""
from app.core.config import settings


async def send_email(to: str, subject: str, html: str) -> None:
    if not settings.SENDGRID_API_KEY or not to or "@" not in to:
        print(f"[EMAIL] To: {to} | Subject: {subject}")
        return
    import httpx
    async with httpx.AsyncClient() as client:
        r = await client.post(
            "https://api.sendgrid.com/v3/mail/send",
            headers={"Authorization": f"Bearer {settings.SENDGRID_API_KEY}", "Content-Type": "application/json"},
            json={
                "personalizations": [{"to": [{"email": to}]}],
                "from": {"email": "noreply@naivastay.com", "name": "NaivaStay"},
                "subject": subject,
                "content": [{"type": "text/html", "value": html}],
            },
        )
        if r.status_code >= 400:
            print(f"[EMAIL ERROR] {r.status_code} {r.text}")


def booking_confirmed_html(guest_name: str, property_title: str, check_in: str, check_out: str, total: int, checkin_code: str) -> str:
    return f"""
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#1e4a22">Booking Confirmed ✓</h2>
      <p>Hi {guest_name or 'there'},</p>
      <p>Your booking at <strong>{property_title}</strong> is confirmed.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:8px 0;color:#666">Check-in</td><td style="font-weight:bold">{check_in}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Check-out</td><td style="font-weight:bold">{check_out}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Total paid</td><td style="font-weight:bold">KES {total:,}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Check-in code</td><td style="font-weight:bold;font-size:24px;letter-spacing:4px;color:#1e4a22">{checkin_code}</td></tr>
      </table>
      <p style="color:#666;font-size:13px">Show this code to the owner on arrival. Your funds are held in escrow and released only after check-in.</p>
      <p style="color:#999;font-size:12px">NaivaStay · Beautiful stays. Better experiences.</p>
    </div>"""


def booking_cancelled_html(guest_name: str, property_title: str, refund_amount: int) -> str:
    refund_text = f"A refund of KES {refund_amount:,} will be processed within 3 to 5 business days." if refund_amount > 0 else "No refund applies based on the cancellation policy."
    return f"""
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#dc2626">Booking Cancelled</h2>
      <p>Hi {guest_name or 'there'},</p>
      <p>Your booking at <strong>{property_title}</strong> has been cancelled.</p>
      <p>{refund_text}</p>
      <p style="color:#999;font-size:12px">NaivaStay · Beautiful stays. Better experiences.</p>
    </div>"""


def owner_new_booking_html(owner_name: str, property_title: str, check_in: str, check_out: str, total: int) -> str:
    return f"""
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#1e4a22">New Booking! 🎉</h2>
      <p>Hi {owner_name or 'there'},</p>
      <p>You have a new booking for <strong>{property_title}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:8px 0;color:#666">Check-in</td><td style="font-weight:bold">{check_in}</td></tr>
        <tr><td style="padding:8px 0;color:#666">Check-out</td><td style="font-weight:bold">{check_out}</td></tr>
        <tr><td style="padding:8px 0;color:#666">You'll earn</td><td style="font-weight:bold;color:#1e4a22">KES {total:,}</td></tr>
      </table>
      <p style="color:#666;font-size:13px">Log in to your owner dashboard to view full details.</p>
      <p style="color:#999;font-size:12px">NaivaStay · Beautiful stays. Better experiences.</p>
    </div>"""


def application_approved_html(name: str) -> str:
    return f"""
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#1e4a22">Application Approved ✓</h2>
      <p>Hi {name},</p>
      <p>Great news! Your NaivaStay property owner application has been <strong>approved</strong>.</p>
      <p>You can now log in with your phone number and start listing your property.</p>
      <a href="https://naivastay.com/owner" style="display:inline-block;background:#1e4a22;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:8px">Go to Owner Dashboard</a>
      <p style="color:#999;font-size:12px;margin-top:16px">NaivaStay · Beautiful stays. Better experiences.</p>
    </div>"""
