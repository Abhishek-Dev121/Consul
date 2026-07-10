from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, String, Table, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Many-to-many: clients <-> assigned team members
client_assignments = Table(
    "client_assignments",
    Base.metadata,
    Column("client_id", ForeignKey("clients.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
)

# Many-to-many: clients <-> communication channels they use
client_channels = Table(
    "client_channels",
    Base.metadata,
    Column("client_id", ForeignKey("clients.id", ondelete="CASCADE"), primary_key=True),
    Column("channel_id", ForeignKey("channels.id", ondelete="CASCADE"), primary_key=True),
)


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    company: Mapped[str | None] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(64))
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="active")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # "Clear chat" marker. Messages are deleted outright, but conversation logs and
    # file/audio records survive (Documents and Calls still need them). Anything
    # created at or before this instant is therefore excluded from the chat feed,
    # and the conversation->messages backfill won't resurrect it.
    chat_cleared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    assignees = relationship("User", secondary=client_assignments, lazy="selectin")
    channels = relationship("Channel", secondary=client_channels, lazy="selectin")
