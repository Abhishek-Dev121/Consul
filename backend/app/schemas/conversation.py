from datetime import datetime

from pydantic import BaseModel

from app.schemas.common import ORMModel


class NoteCreate(BaseModel):
    body: str


class NoteOut(ORMModel):
    id: int
    author_id: int | None
    body: str
    created_at: datetime


class ConversationCreate(BaseModel):
    client_id: int
    channel_id: int | None = None
    title: str | None = None
    raw_content: str
    assigned_to: int | None = None
    occurred_at: datetime | None = None


class ConversationOut(ORMModel):
    id: int
    client_id: int
    channel_id: int | None
    title: str | None
    raw_content: str
    assigned_to: int | None
    occurred_at: datetime | None
    created_at: datetime
    notes: list[NoteOut] = []
