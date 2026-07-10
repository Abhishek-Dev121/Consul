from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, Table, Column, Index, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


# Association table for many-to-many relationship between Chats and Users
chat_participants = Table(
    "chat_participants",
    Base.metadata,
    Column("chat_id", Integer, ForeignKey("chats.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
)

# Additional index on user_id for faster lookups of all chats a user belongs to
Index("ix_chat_participants_user_id", chat_participants.c.user_id)


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[int] = mapped_column(primary_key=True)
    is_group: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Many-to-many relationship to users
    participants = relationship("User", secondary=chat_participants, backref="chats")
    messages = relationship("ChatMessage", back_populates="chat", cascade="all, delete-orphan")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    chat_id: Mapped[int] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"), index=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    content: Mapped[str] = mapped_column(Text)
    type: Mapped[str] = mapped_column(String(16), default="text")  # 'text' | 'image' | 'video' | 'audio'
    file_url: Mapped[str | None] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    chat = relationship("Chat", back_populates="messages")
    sender = relationship("User")

    # Composite index for paginated message fetches ordered by creation date
    __table_args__ = (
        Index("ix_chat_messages_chat_id_created_at", "chat_id", "created_at"),
    )


class MessageStatus(Base):
    __tablename__ = "chat_message_statuses"

    id: Mapped[int] = mapped_column(primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("chat_messages.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="sent")  # 'sent' | 'delivered' | 'seen'
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    message = relationship("ChatMessage")
    user = relationship("User")

    # Composite indexes for read-receipt and unread count lookups
    __table_args__ = (
        Index("ix_message_statuses_message_id_user_id", "message_id", "user_id"),
        Index("ix_message_statuses_user_id_status", "user_id", "status"),
    )
