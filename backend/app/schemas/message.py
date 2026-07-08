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
    sent_at: datetime | None
    created_at: datetime


class MessageCreate(BaseModel):
    body: str
    channel_id: int | None = None
