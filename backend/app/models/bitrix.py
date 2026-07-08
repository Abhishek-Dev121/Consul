from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class BitrixToken(Base):
    """Stores the OAuth tokens for the Bitrix24 local app (single-row table)."""

    __tablename__ = "bitrix_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    portal_domain: Mapped[str | None] = mapped_column(String(255))
    access_token: Mapped[str] = mapped_column(Text)
    refresh_token: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[int | None] = mapped_column(Integer)  # epoch seconds
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
