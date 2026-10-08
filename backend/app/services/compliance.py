"""
What a listing needs before it can go live (Kenyan rules), in one place so the
admin approve buttons, the host wizard and the dashboards agree.
"""
from app.models.models import Property, User


def missing_for_live(prop: Property, owner: User | None) -> list[str]:
    missing = []
    if not owner or not owner.kra_pin:
        missing.append("the host's KRA PIN")
    if not prop.tra_licence_no:
        missing.append("the Tourism Regulatory Authority (TRA) licence number")
    return missing


def go_live_error(prop: Property, owner: User | None) -> str | None:
    missing = missing_for_live(prop, owner)
    return f"Can't go live yet: add {' and '.join(missing)}." if missing else None
