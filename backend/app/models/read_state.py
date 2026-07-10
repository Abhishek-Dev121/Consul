from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ClientRead(Base):
    """When a team member last opened a client's chat thread.

    Drives WhatsApp-style read receipts: a team-sent message shows double ticks
    once another teammate's last_read_at is at/after the message time.
    """

    __tablename__ = "client_reads"
    __table_args__ = (UniqueConstraint("client_id", "user_id", name="uq_client_read"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    last_read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class MessageHidden(Base):
    """A message hidden from a single user's view ("Delete for me"). The row
    stays visible to everyone else; only this user stops seeing it."""

    __tablename__ = "message_hidden"
    __table_args__ = (UniqueConstraint("user_id", "message_id", name="uq_message_hidden"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
