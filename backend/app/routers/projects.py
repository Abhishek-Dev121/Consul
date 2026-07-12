from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.client import Client
from app.models.project import Project
from app.models.user import User
from app.rbac import accessible_client_ids, ensure_client_access
from app.schemas.project import ProjectOut

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=list[ProjectOut])
def list_projects(
    client_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.services import bitrix_service

    if client_id:
        client = _client(db, client_id)
        ensure_client_access(user, client)

        stmt = select(Project).where(Project.client_id == client_id)
        return db.execute(stmt).scalars().all()

    # Otherwise (global list), return all groups from Bitrix24
    stmt = select(Project).order_by(Project.created_at.desc())
    local_projects = db.execute(stmt).scalars().all()

    # Filter local projects by client accessibility using a single id set
    # (no per-project db.get(Client) round-trip). Admins see all projects whose
    # client still exists; others only their assigned clients.
    allowed = accessible_client_ids(db, user)
    if allowed is None:
        allowed = set(db.execute(select(Client.id)).scalars().all())
    visible_local = [p for p in local_projects if p.client_id in allowed]

    local_map = {p.bitrix_project_id: p for p in visible_local}
    
    try:
        groups = bitrix_service.fetch_project_groups(db)
    except Exception:
        groups = []

    # Resolve OWNER_ID -> real person. Previously every unsynced group rendered a
    # fabricated "Owner (ID 8)", which also produced nonsense avatar initials.
    directory = bitrix_service.fetch_users(db) if groups else {}

    combined = []
    for g in groups:
        gid = str(g["ID"])
        if gid in local_map:
            combined.append(local_map[gid])
        else:
            owner_id = str(g.get("OWNER_ID") or "")
            profile = directory.get(owner_id)
            members = []
            if owner_id:
                members.append({
                    "id": 0,
                    "bitrix_user_id": owner_id,
                    # Fall back to the id only when the directory really has no entry.
                    "name": profile["name"] if profile else f"User {owner_id}",
                    "work_position": (profile or {}).get("position") or "Project Owner",
                    "icon_url": (profile or {}).get("photo"),
                    "role": "owner",
                })
            combined.append({
                "id": 0,
                "client_id": None,
                "bitrix_project_id": gid,
                "title": g["NAME"],
                "status": "closed" if g.get("CLOSED") == "Y" else "active",
                "responsible": owner_id,
                "due_date": None,
                "deliverables": g.get("DESCRIPTION") or None,
                "synced_at": None,
                # This group has never been synced, so its tasks were never fetched.
                # `tasks: []` is indistinguishable from "genuinely has no tasks", so
                # the UI needs this flag to avoid rendering a misleading "0 / 0".
                "synced": False,
                "tasks": [],
                "members": members,
            })
            
    # Include local projects not returned by the groups call
    group_ids = {str(g["ID"]) for g in groups}
    for p in visible_local:
        if p.bitrix_project_id not in group_ids:
            combined.append(p)
            
    return combined


def _client(db: Session, client_id: int) -> Client:
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client
