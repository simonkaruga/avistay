import os
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import NullPool

from app.core.database import Base, get_db
from app.core.security import create_access_token

TEST_DB_FILE = "/tmp/staynaivasha_test.db"
# CI should set TEST_DATABASE_URL to a throwaway Postgres DB: SQLite ignores
# row locks and accepts queries Postgres rejects, which has hidden real bugs.
TEST_DB_URL  = os.environ.get("TEST_DATABASE_URL", f"sqlite+aiosqlite:///{TEST_DB_FILE}")

_engine = create_async_engine(
    TEST_DB_URL,
    connect_args={"check_same_thread": False} if TEST_DB_URL.startswith("sqlite") else {},
    poolclass=NullPool,  # each test has its own event loop; asyncpg connections can't cross loops
)
_SessionFactory = async_sessionmaker(_engine, expire_on_commit=False)


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _setup_db():
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    await _engine.dispose()
    if os.path.exists(TEST_DB_FILE):
        os.remove(TEST_DB_FILE)


@pytest_asyncio.fixture
async def db() -> AsyncSession:
    async with _SessionFactory() as session:
        yield session


@pytest_asyncio.fixture
async def client():
    from main import app

    async def _override():
        async with _SessionFactory() as s:
            yield s

    app.dependency_overrides[get_db] = _override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# Expose for mpesa tests that need a separate session to verify state
session_factory = _SessionFactory


def auth_cookies(user_id: str, role: str = "guest") -> dict:
    token = create_access_token(user_id)
    return {"access_token": token}


@pytest_asyncio.fixture(autouse=True)
async def _fresh_rate_limits():
    """Each test starts with clean rate limits (the in-process fallback would
    otherwise carry counts from one test into the next)."""
    from app.core import deps
    deps._local_hits.clear()
    yield
