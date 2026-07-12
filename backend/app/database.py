"""SQLAlchemy engine, session factory, and declarative Base."""
from collections.abc import Generator

from sqlalchemy import JSON, create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

if not settings.database_url:
    raise RuntimeError(
        "DATABASE_URL is not set. Add it to your environment or backend/.env "
        "(see .env.example). It is intentionally not hard-coded in the source."
    )

# Postgres gets real JSONB; SQLite (tests) falls back to plain JSON, which it can
# actually render. Without the variant, create_all() blows up under SQLite.
JSONColumn = JSONB().with_variant(JSON(), "sqlite")

engine = create_engine(
    settings.database_url,
    pool_size=10,
    max_overflow=20,
    pool_recycle=280,
    pool_pre_ping=True,
    future=True
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator:
    """FastAPI dependency yielding a request-scoped DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
