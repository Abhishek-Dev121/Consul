from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy import select
from pydantic import BaseModel

from app.database import get_db
from app.deps import get_current_user
from app.models.client import Client
from app.models.project import Project
from app.models.user import User, UserRole
from app.rbac import require_role
from app.services import bitrix_service
from app.services.activity_service import log_activity

router = APIRouter(prefix="/api/bitrix", tags=["bitrix"])


class LinkProjectPayload(BaseModel):
    client_id: int
    bitrix_group_id: str


@router.get("/status")
def status(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    from app.config import settings
    is_conn = bitrix_service.is_connected(db)
    method = "webhook" if settings.bitrix_webhook_url else "oauth" if is_conn else None
    return {
        "connected": is_conn,
        "method": method,
        "webhook_url": settings.bitrix_webhook_url or None
    }


@router.get("/connect")
def connect(_: User = Depends(require_role(UserRole.admin))):
    """Return the Bitrix24 OAuth authorize URL for the admin to open."""
    return {"authorize_url": bitrix_service.authorize_url()}


@router.get("/callback")
def callback(code: str = Query(...), db: Session = Depends(get_db)):
    """OAuth redirect target. Bitrix calls this with ?code=... after install/auth."""
    try:
        bitrix_service.exchange_code(db, code)
        db.commit()
    except Exception as e:  # noqa: BLE001 - surface any OAuth failure to the browser
        return HTMLResponse(f"<h3>Bitrix connection failed</h3><pre>{e}</pre>", status_code=400)
    return HTMLResponse(
        "<h3>Bitrix24 connected successfully.</h3>"
        "<p>You can close this window and return to the dashboard.</p>"
    )


@router.get("/groups")
def list_groups(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Fetch all project groups from Bitrix24."""
    try:
        groups = bitrix_service.fetch_project_groups(db)
        return [{"id": g["ID"], "name": g["NAME"], "member_count": g.get("NUMBER_OF_MEMBERS")} for g in groups]
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Bitrix communication failed: {e}")


@router.post("/sync")
def sync_client_groups(
    client_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role(UserRole.team_lead)),
):
    """Sync all linked project groups for a given client."""
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    # Find all projects linked to this client
    stmt = select(Project).where(Project.client_id == client_id)
    projects = db.execute(stmt).scalars().all()
    
    count = 0
    for p in projects:
        try:
            bitrix_service.sync_project_group(db, client_id, p.bitrix_project_id)
            count += 1
        except Exception:
            continue
            
    log_activity(db, action="bitrix.synced", actor_id=actor.id, client_id=client_id,
                 detail={"projects_count": count})
    db.commit()
    return {"synced_projects": count}


@router.post("/link-project")
def link_project(
    payload: LinkProjectPayload,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role(UserRole.team_lead)),
):
    """Link a Bitrix24 project group to a client and trigger initial sync."""
    client = db.get(Client, payload.client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    try:
        proj = bitrix_service.sync_project_group(db, payload.client_id, payload.bitrix_group_id)
        log_activity(db, action="bitrix.synced", actor_id=actor.id, client_id=payload.client_id,
                     detail={"group_id": payload.bitrix_group_id, "group_name": proj.title})
        db.commit()
        return {"status": "linked", "project_id": proj.id, "title": proj.title}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.delete("/link-project/{project_id}")
def unlink_project(
    project_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role(UserRole.team_lead)),
):
    """Unlink a project group from a client."""
    proj = db.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    client_id = proj.client_id
    db.delete(proj)
    log_activity(db, action="client.updated", actor_id=actor.id, client_id=client_id,
                 detail={"message": "Unlinked Bitrix24 project group"})
    db.commit()
    return {"status": "unlinked"}


@router.post("/sync-project/{project_id}")
def sync_project(
    project_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role(UserRole.team_lead)),
):
    """Manually trigger a sync for a specific project group."""
    proj = db.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        bitrix_service.sync_project_group(db, proj.client_id, proj.bitrix_project_id)
        log_activity(db, action="bitrix.synced", actor_id=actor.id, client_id=proj.client_id,
                     detail={"group_id": proj.bitrix_project_id, "group_name": proj.title})
        db.commit()
        return {"status": "synced"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/events")
async def webhook_events(request: Request, db: Session = Depends(get_db)):
    """Receives outbound events from Bitrix24 for real-time task creation / updates."""
    try:
        form = await request.form()
    except Exception:
        return {"status": "ignored"}

    event = form.get("event")
    if not event:
        return {"status": "ignored"}

    event = event.upper()
    task_id = None
    group_id = None

    if "TASK" in event:
        task_id = form.get("data[FIELDS_AFTER][ID]") or form.get("data[id]")
    elif "SONETGROUP" in event:
        group_id = form.get("data[GROUP_ID]") or form.get("data[id]")

    # Resolve task group if we received a task event
    if task_id:
        try:
            res = bitrix_service.call_api(db, "tasks.task.list", {"filter": {"ID": task_id}, "select": ["GROUP_ID"]})
            tasks = (res.get("result") or {}).get("tasks", []) if isinstance(res.get("result"), dict) else []
            if tasks:
                group_id = tasks[0].get("groupId") or tasks[0].get("GROUP_ID")
        except Exception:
            pass

    if group_id:
        # Find all local projects referencing this group
        stmt = select(Project).where(Project.bitrix_project_id == str(group_id))
        projects = db.execute(stmt).scalars().all()
        for p in projects:
            try:
                bitrix_service.sync_project_group(db, p.client_id, p.bitrix_project_id)
            except Exception:
                continue
        db.commit()

    return {"status": "processed"}
