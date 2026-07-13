import enum
from sqlalchemy import Enum, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.user import UserRole


class Permission(Base):
    __tablename__ = "permissions"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    category: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(String(255))


class RolePermission(Base):
    __tablename__ = "role_permissions"

    id: Mapped[int] = mapped_column(primary_key=True)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role"))
    permission_id: Mapped[int] = mapped_column(ForeignKey("permissions.id", ondelete="CASCADE"))

    permission: Mapped[Permission] = relationship("Permission")

    __table_args__ = (
        UniqueConstraint("role", "permission_id", name="uq_role_permission"),
    )
