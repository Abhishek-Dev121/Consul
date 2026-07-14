from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Message(Base):
    """A single chat message for the Upwork-style conversation view.

    Messages are either parsed from a logged conversation's raw text (backfilled
    on demand) or composed directly in the chat composer. `is_client` drives
    bubble alignment: True = incoming (left), False = our team (right).
    """

    __tablename__ = "messages"
    __table_args__ = (
        # Serves the chat feed (filter by client, order by time) and the
        # per-conversation reads without a full scan.
        Index("ix_messages_client_sent", "client_id", "sent_at"),
        Index("ix_messages_conv_created", "conversation_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    conversation_id: Mapped[int | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    channel_id: Mapped[int | None] = mapped_column(ForeignKey("channels.id", ondelete="SET NULL"))
    sender_name: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(Text)
    is_client: Mapped[bool] = mapped_column(Boolean, default=True)
    # Optional attachment (file or audio) sent in the chat.
    attachment_type: Mapped[str | None] = mapped_column(String(16))   # 'file' | 'audio'
    attachment_url: Mapped[str | None] = mapped_column(String(512))
    attachment_name: Mapped[str | None] = mapped_column(String(512))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    bitrix_message_id: Mapped[str | None] = mapped_column(String(64), index=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # WhatsApp-style edit / delete-for-everyone (sender-only, time-limited).
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    # Quoted reply: points at the message this one is replying to.
    reply_to_id: Mapped[int | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), index=True
    )
