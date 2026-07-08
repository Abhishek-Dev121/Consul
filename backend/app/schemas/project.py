from datetime import datetime
from app.schemas.common import ORMModel

class TaskOut(ORMModel):
    id: int
    bitrix_task_id: str | None = None
    title: str
    status: str | None = None
    responsible: str | None = None
    due_date: datetime | None = None
    
    # New task fields
    description: str | None = None
    priority: str | None = None
    time_estimate: int | None = None
    creator_name: str | None = None
    creator_position: str | None = None
    responsible_name: str | None = None
    responsible_position: str | None = None
    auditors_json: str | None = None
    accomplices_json: str | None = None
    closed_date: datetime | None = None
    created_date: datetime | None = None

class MemberOut(ORMModel):
    id: int
    bitrix_user_id: str
    name: str
    email: str | None = None
    work_position: str | None = None
    department: str | None = None
    icon_url: str | None = None
    role: str | None = None

class ProjectOut(ORMModel):
    id: int
    client_id: int | None = None
    bitrix_project_id: str | None = None
    title: str
    status: str | None = None
    responsible: str | None = None
    due_date: datetime | None = None
    deliverables: str | None = None
    synced_at: datetime | None = None
    
    # New project group fields
    bitrix_group_name: str | None = None
    member_count: int | None = None
    owner_bitrix_id: str | None = None
    description: str | None = None
    
    tasks: list[TaskOut] = []
    members: list[MemberOut] = []
