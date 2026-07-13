from datetime import datetime

from pydantic import BaseModel

from app.schemas.common import ORMModel


class MessageOut(ORMModel):
    id: int
    client_id: int
    conversation_id: int | None
    channel_id: int | None
    sender_name: str
    body: str
    is_client: bool
    attachment_type: str | None = None
    attachment_url: str | None = None
    attachment_name: str | None = None
    attachment_size: int | None = None   # bytes – used by the download badge
    sent_at: datetime | None
    created_at: datetime
    read: bool = False    # WhatsApp-style: a teammate has seen this outgoing message
    mine: bool = False    # sent by the current user (can edit/delete within 24h)
    edited: bool = False
    deleted: bool = False  # "deleted for everyone" — show a placeholder
    reply_to_id: int | None = None
    reply_to_sender: str | None = None   # quoted-reply preview
    reply_to_text: str | None = None


class MessageCreate(BaseModel):
    body: str
    channel_id: int | None = None
    reply_to_id: int | None = None


class MessageEdit(BaseModel):
    body: str
