from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Project(Base):
    """A Bitrix24 project/deal mirrored locally and linked to a client."""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    bitrix_project_id: Mapped[str | None] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(512))
    status: Mapped[str | None] = mapped_column(String(64))
    responsible: Mapped[str | None] = mapped_column(String(255))
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deliverables: Mapped[str | None] = mapped_column(Text)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # New fields for Project Group organization
    bitrix_group_name: Mapped[str | None] = mapped_column(String(255))
    member_count: Mapped[int | None] = mapped_column(Integer)
    owner_bitrix_id: Mapped[str | None] = mapped_column(String(64))
    description: Mapped[str | None] = mapped_column(Text)

    tasks = relationship(
        "ProjectTask", cascade="all, delete-orphan", lazy="selectin", order_by="ProjectTask.id"
    )
    members = relationship(
        "ProjectMember", cascade="all, delete-orphan", lazy="selectin", order_by="ProjectMember.id"
    )


class ProjectTask(Base):
    __tablename__ = "project_tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    bitrix_task_id: Mapped[str | None] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(512))
    status: Mapped[str | None] = mapped_column(String(64))
    responsible: Mapped[str | None] = mapped_column(String(255))
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # New rich fields for tasks
    description: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[str | None] = mapped_column(String(16))
    time_estimate: Mapped[int | None] = mapped_column(Integer)
    creator_name: Mapped[str | None] = mapped_column(String(255))
    creator_position: Mapped[str | None] = mapped_column(String(255))
    responsible_name: Mapped[str | None] = mapped_column(String(255))
    responsible_position: Mapped[str | None] = mapped_column(String(255))
    auditors_json: Mapped[str | None] = mapped_column(Text)
    accomplices_json: Mapped[str | None] = mapped_column(Text)
    closed_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ProjectMember(Base):
    """A team member from a Bitrix24 project group."""
    __tablename__ = "project_members"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    bitrix_user_id: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(255))
    work_position: Mapped[str | None] = mapped_column(String(255))
    icon_url: Mapped[str | None] = mapped_column(String(512))
    role: Mapped[str | None] = mapped_column(String(64))  # "owner", "moderator", "member"
    email: Mapped[str | None] = mapped_column(String(255))
    department: Mapped[str | None] = mapped_column(String(255))
