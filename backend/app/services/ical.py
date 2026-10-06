import asyncio
import ipaddress
import socket
from datetime import date
from urllib.parse import urlparse

import httpx
from icalendar import Calendar, Event

MAX_ICAL_BYTES = 2 * 1024 * 1024   # real calendars are a few KB


class UnsafeUrl(ValueError):
    pass


async def check_public_https_url(url: str) -> None:
    """Hosts paste these URLs and our server fetches them, so only allow public
    https addresses. Otherwise a 'calendar' could point at the server's own
    network (cloud metadata, Redis, internal services): SSRF."""
    u = urlparse(url)
    if u.scheme != "https" or not u.hostname or u.username or u.password:
        raise UnsafeUrl("Use the https:// calendar link from Airbnb, Booking.com or VRBO")
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(u.hostname, u.port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise UnsafeUrl("That calendar address doesn't exist")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global or ip.is_multicast:
            raise UnsafeUrl("That calendar address isn't allowed")


async def parse_remote_ical(url: str) -> list[tuple[date, date]]:
    """Fetch and parse an Airbnb/Booking.com iCal URL, return blocked date ranges."""
    await check_public_https_url(url)
    # No redirects (a public URL could bounce to an internal one), and a size cap.
    async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            chunks, size = [], 0
            async for chunk in resp.aiter_bytes():
                size += len(chunk)
                if size > MAX_ICAL_BYTES:
                    raise UnsafeUrl("That calendar file is too large")
                chunks.append(chunk)
    cal = Calendar.from_ical(b"".join(chunks))
    blocked: list[tuple[date, date]] = []
    for component in cal.walk():
        if component.name == "VEVENT":
            dtstart = component.get("DTSTART")
            dtend = component.get("DTEND")
            if dtstart and dtend:
                start = dtstart.dt if hasattr(dtstart.dt, "date") else dtstart.dt
                end = dtend.dt if hasattr(dtend.dt, "date") else dtend.dt
                blocked.append((start if isinstance(start, date) else start.date(), end if isinstance(end, date) else end.date()))
    return blocked


def generate_ical(property_uuid: str, bookings: list[dict]) -> bytes:
    """Generate iCal feed for a property — owner pastes into Airbnb."""
    cal = Calendar()
    cal.add("prodid", "-//Avistay//EN")
    cal.add("version", "2.0")

    for b in bookings:
        event = Event()
        event.add("uid", f"{b['id']}@avistay.com")
        event.add("dtstart", b["check_in"])
        event.add("dtend", b["check_out"])
        event.add("summary", "Booked on Avistay")
        cal.add_component(event)

    return cal.to_ical()
