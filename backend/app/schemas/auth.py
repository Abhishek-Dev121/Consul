from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr

from app.models.user import UserRole
from app.schemas.common import ORMModel


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(ORMModel):
    id: int
    name: str
    email: EmailStr
    role: UserRole
    is_active: bool
    created_at: datetime | None = None
    last_login_at: datetime | None = None
    # Sourced from the model's `is_pending` property (never exposes the raw token).
    is_pending: bool = False


class UserCreate(BaseModel):
    name: str
    email: EmailStr
    role: UserRole = UserRole.employee
    # When send_invite is True, password is ignored and the user is created in a
    # pending state with an invite link instead.
    password: str | None = None
    send_invite: bool = False


class UserUpdate(BaseModel):
    name: str | None = None
    email: EmailStr | None = None
    password: str | None = None
    role: UserRole | None = None
    is_active: bool | None = None


class UserListOut(BaseModel):
    items: list[UserOut]
    total: int
    limit: int
    offset: int


class UserStats(BaseModel):
    total: int
    active: int
    disabled: int
    pending: int
    by_role: dict[str, int]


class CreateUserResult(UserOut):
    # Present only when the user was created via invite, so the admin can copy it.
    invite_url: str | None = None
    invite_emailed: bool = False


class BulkAction(BaseModel):
    user_ids: list[int]
    action: Literal["enable", "disable", "delete", "set_role"]
    role: UserRole | None = None


class InviteInfo(BaseModel):
    name: str
    email: EmailStr
    valid: bool


class InviteAccept(BaseModel):
    token: str
    password: str


class ChangePassword(BaseModel):
    current_password: str
    new_password: str


class ClientBrief(BaseModel):
    id: int
    name: str


class ActivityBrief(BaseModel):
    action: str
    detail: dict
    created_at: datetime


class UserDetailOut(UserOut):
    created_by_name: str | None = None
    assigned_clients: list[ClientBrief] = []
    recent_activity: list[ActivityBrief] = []
