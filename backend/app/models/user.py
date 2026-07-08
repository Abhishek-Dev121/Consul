import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserRole(str, enum.Enum):
    super_admin = "super_admin"
    admin = "admin"
    team_lead = "team_lead"
    employee = "employee"


# Numeric rank for hierarchy comparisons (higher = more privileged).
ROLE_RANK = {
    UserRole.employee: 1,
    UserRole.team_lead: 2,
    UserRole.admin: 3,
    UserRole.super_admin: 4,
}


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role"), default=UserRole.employee
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Invite onboarding: a pending user has an invite_token and no usable password
    # until they accept the invite and set one.
    invite_token: Mapped[str | None] = mapped_column(String(128), index=True)
    invite_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Who created this account (the admin/super admin who added them).
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    @property
    def is_pending(self) -> bool:
        return self.invite_token is not None
