from datetime import datetime
from pydantic import BaseModel
from app.schemas.auth import UserOut


class ChatMessageOut(BaseModel):
    id: int
    chat_id: int
    sender_id: int
    sender_name: str
    content: str
    type: str
    file_url: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class ChatOut(BaseModel):
    id: int
    is_group: bool
    created_at: datetime
    participants: list[UserOut]
    last_message: ChatMessageOut | None = None
    unread_count: int = 0

    class Config:
        from_attributes = True


class ChatCreate(BaseModel):
    participant_id: int | None = None
    participant_ids: list[int] | None = None
    is_group: bool = False
