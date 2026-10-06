"""
Operator commands.

    python -m app.cli make-superadmin <phone or email>
    python -m app.cli list-admins

The person must have signed in to Avistay at least once (so their account
exists). Making someone a super admin also makes them an admin.
"""
import asyncio
import sys

from sqlalchemy import or_, select

from app.core import database
from app.models.models import User


def _phone_variants(raw: str) -> list[str]:
    p = raw.strip().replace(" ", "")
    digits = p.lstrip("+")
    if digits.startswith("0") and len(digits) == 10:
        local = digits[1:]
    elif digits.startswith("254"):
        local = digits[3:]
    else:
        return [p]
    return list({p, f"0{local}", f"254{local}", f"+254{local}"})


async def make_superadmin(who: str) -> int:
    async with database.AsyncSessionLocal() as db:
        cond = User.email == who.strip().lower() if "@" in who else User.phone.in_(_phone_variants(who))
        user = (await db.execute(select(User).where(cond, User.deleted_at.is_(None)))).scalar_one_or_none()
        if not user:
            print(f"No account found for {who}. Ask them to sign in to Avistay once, then run this again.")
            return 1
        user.role, user.is_superadmin = "admin", True
        from app.core.audit_log import log_event
        await log_event(db, "superadmin_granted", user.id, None, {"via": "cli"})
        print(f"{user.name or user.phone or user.email} is now a super admin.")
        return 0


async def list_admins() -> int:
    async with database.AsyncSessionLocal() as db:
        rows = (await db.execute(select(User).where(or_(User.role == "admin", User.is_superadmin == True)))).scalars().all()
        for u in rows:
            print(f"{'SUPER ' if u.is_superadmin else 'admin '} {u.name or '-':<25} {u.phone or '-':<15} {u.email or '-'}")
        if not rows:
            print("No admins yet. Run: python -m app.cli make-superadmin <phone or email>")
        return 0


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == "make-superadmin":
        return asyncio.run(make_superadmin(argv[1]))
    if argv == ["list-admins"]:
        return asyncio.run(list_admins())
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
