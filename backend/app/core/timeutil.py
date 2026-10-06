from datetime import date, datetime
from zoneinfo import ZoneInfo

EAT = ZoneInfo("Africa/Nairobi")


def today_eat() -> date:
    """Business 'today' — check-in dates and refund windows are Naivasha dates, not UTC."""
    return datetime.now(EAT).date()
