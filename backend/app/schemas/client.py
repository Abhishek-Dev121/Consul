from datetime import datetime

from pydantic import BaseModel, EmailStr

from app.schemas.auth import UserOut
from app.schemas.channel import ChannelOut
from app.schemas.common import ORMModel


class ClientCreate(BaseModel):
    name: str
    company: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    notes: str | None = None
    status: str = "active"
    assignee_ids: list[int] = []
    channel_ids: list[int] = []


class ClientUpdate(BaseModel):
    name: str | None = None
    company: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    notes: str | None = None
    status: str | None = None
    assignee_ids: list[int] | None = None
    channel_ids: list[int] | None = None


class ClientOut(ORMModel):
    id: int
    name: str
    company: str | None
    email: EmailStr | None
    phone: str | None
    notes: str | None
    status: str
    created_at: datetime
    assignees: list[UserOut] = []
    channels: list[ChannelOut] = []
