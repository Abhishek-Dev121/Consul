import enum
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, JSONColumn


class Platform(str, enum.Enum):
    """Built-in platform keys. Channels may also use a custom key that refers to a
    PlatformType row, so `Channel.platform` is stored as a plain string rather than
    constrained to this enum."""
    whatsapp = "whatsapp"
    upwork = "upwork"
    slack = "slack"
    email = "email"
    telegram = "telegram"
    linkedin = "linkedin"
    other = "other"


BUILTIN_PLATFORMS = {p.value for p in Platform}


class PlatformType(Base):
    """A user-defined platform (e.g. "Discord", "Intercom") with its own logo, so
    channels aren't limited to the built-in set. `key` is the stable slug stored on
    channels; `logo` is a small image held inline as a data: URL."""

    __tablename__ = "platform_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(64))
    logo: Mapped[str] = mapped_column(Text)   # data: URL
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Channel(Base):
    __tablename__ = "channels"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    # Built-in key (see Platform) or a PlatformType.key for custom platforms.
    platform: Mapped[str] = mapped_column(String(64))
    config: Mapped[dict] = mapped_column(JSONColumn, default=dict)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
