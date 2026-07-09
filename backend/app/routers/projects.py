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
        
    combined = []
    for g in groups:
        gid = str(g["ID"])
        if gid in local_map:
            combined.append(local_map[gid])
        else:
            combined.append({
                "id": 0,
                "client_id": None,
                "bitrix_project_id": gid,
                "title": g["NAME"],
                "status": "closed" if g.get("CLOSED") == "Y" else "active",
                "responsible": str(g.get("OWNER_ID") or ""),
                "due_date": None,
                "deliverables": g.get("DESCRIPTION") or None,
                "synced_at": None,
                "tasks": [],
                "members": [
                    {
                        "id": 0,
                        "bitrix_user_id": str(g.get("OWNER_ID") or ""),
                        "name": "Owner (ID " + str(g.get("OWNER_ID")) + ")",
                        "work_position": "Project Owner",
                        "icon_url": None,
                        "role": "owner"
                    }
                  ]
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
