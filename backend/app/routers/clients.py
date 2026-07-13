from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from datetime import datetime, timezone

from app.cache import invalidate_cache
from app.database import get_db
from app.deps import get_current_user
from app.models.channel import Channel
from app.models.client import Client
from app.models.user import User, UserRole
from app.rbac import ensure_can_write, ensure_client_access, has_min_role
from app.schemas.client import ClientCreate, ClientOut, ClientUpdate
from app.services.activity_service import log_activity

router = APIRouter(prefix="/api/clients", tags=["clients"])


def _load(db: Session, client_id: int) -> Client:
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


def _resolve_assignees(db: Session, ids: list[int]) -> list[User]:
    if not ids:
        return []
    return db.execute(select(User).where(User.id.in_(ids))).scalars().all()


def _resolve_channels(db: Session, ids: list[int]) -> list[Channel]:
    if not ids:
        return []
    return db.execute(select(Channel).where(Channel.id.in_(ids))).scalars().all()


@router.get("", response_model=list[ClientOut])
def list_clients(
    channel_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from sqlalchemy.orm import selectinload
    stmt = select(Client).options(
        selectinload(Client.assignees),
        selectinload(Client.channels)
    ).order_by(Client.name)
    clients = db.execute(stmt).scalars().all()
    # Team leads / employees only see clients they're assigned to.
    if not has_min_role(user, UserRole.admin):
        clients = [c for c in clients if any(a.id == user.id for a in c.assignees)]
    # Optional filter: only contacts linked to a given channel.
    if channel_id is not None:
        clients = [c for c in clients if any(ch.id == channel_id for ch in c.channels)]
    return clients


@router.get("/{client_id}", response_model=ClientOut)
def get_client(client_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    client = _load(db, client_id)
    ensure_client_access(user, client)
    return client


@router.post("", response_model=ClientOut, status_code=201)
def create_client(
    payload: ClientCreate, db: Session = Depends(get_db), actor: User = Depends(get_current_user)
):
    ensure_can_write(actor)
    # Team leads may create but only admins+ can assign arbitrary members freely;
    # a team lead always gets added to their own client.
    client = Client(
        name=payload.name,
        company=payload.company,
        email=payload.email,
        phone=payload.phone,
        notes=payload.notes,
        status=payload.status,
        created_by=actor.id,
    )
    client.assignees = _resolve_assignees(db, payload.assignee_ids)
    # Always assign the creator (admin/super admin included) so it shows as theirs.
    if actor not in client.assignees:
        client.assignees.append(actor)
    client.channels = _resolve_channels(db, payload.channel_ids)
    db.add(client)
    db.flush()

    # Auto-create client storage folders on local disk
    from pathlib import Path
    from app.config import settings
    from app.services import storage_service
    if settings.storage_backend == "local":
        c_path = Path(settings.local_storage_dir) / storage_service.client_dir(client)
        (c_path / "documents").mkdir(parents=True, exist_ok=True)
        (c_path / "audio").mkdir(parents=True, exist_ok=True)
        (c_path / "projects").mkdir(parents=True, exist_ok=True)

    if payload.bitrix_group_id:
        from app.services import bitrix_service
        try:
            bitrix_service.sync_project_group(db, client.id, payload.bitrix_group_id)
            # Syncing pulls in real Bitrix project members as assignees; the client's
            # assignee is fixed to its creator, so re-pin it after the sync.
            client.assignees = [actor]
        except Exception:
            pass  # client is still created even if the project link fails

    log_activity(db, action="client.created", actor_id=actor.id, client_id=client.id,
                 detail={"name": client.name})
    db.commit()
    db.refresh(client)
    return client


@router.patch("/{client_id}", response_model=ClientOut)
def update_client(
    client_id: int,
    payload: ClientUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    client = _load(db, client_id)
    ensure_client_access(actor, client)
    ensure_can_write(actor)
    
    old_name = client.name
    
    for field in ("name", "company", "email", "phone", "notes", "status"):
        val = getattr(payload, field)
        if val is not None:
            setattr(client, field, val)
            
    # Only admins+ may reassign team members.
    if payload.assignee_ids is not None and has_min_role(actor, UserRole.admin):
        client.assignees = _resolve_assignees(db, payload.assignee_ids)
    if payload.channel_ids is not None:
        client.channels = _resolve_channels(db, payload.channel_ids)
        
    # Handle folder renaming if client name changed
    if payload.name is not None and payload.name.strip() and payload.name.strip() != old_name:
        from pathlib import Path
        from app.config import settings
        from app.services import storage_service
        from app.models.file import FileRecord
        from app.models.audio import AudioRecording
        
        # Build clean folder paths
        import re
        old_clean = re.sub(r"[^a-zA-Z0-9 _-]+", "", old_name).strip() or "client"
        new_clean = re.sub(r"[^a-zA-Z0-9 _-]+", "", payload.name).strip() or "client"
        
        if old_clean != new_clean:
            old_dir = f"clients/{old_clean}"
            new_dir = f"clients/{new_clean}"
            
            if settings.storage_backend == "local":
                old_path = Path(settings.local_storage_dir) / old_dir
                new_path = Path(settings.local_storage_dir) / new_dir
                if old_path.exists():
                    try:
                        old_path.rename(new_path)
                    except Exception:
                        pass
                else:
                    new_path.mkdir(parents=True, exist_ok=True)
                    (new_path / "documents").mkdir(parents=True, exist_ok=True)
                    (new_path / "audio").mkdir(parents=True, exist_ok=True)
                    (new_path / "projects").mkdir(parents=True, exist_ok=True)
                    
            # Update all storage_key references in database for this client
            files = db.execute(select(FileRecord).where(FileRecord.client_id == client.id)).scalars().all()
            for f in files:
                if f.storage_key and f.storage_key.startswith(old_dir + "/"):
                    f.storage_key = f.storage_key.replace(old_dir + "/", new_dir + "/", 1)
                    
            audios = db.execute(select(AudioRecording).where(AudioRecording.client_id == client.id)).scalars().all()
            for a in audios:
                if a.storage_key and a.storage_key.startswith(old_dir + "/"):
                    a.storage_key = a.storage_key.replace(old_dir + "/", new_dir + "/", 1)
                    
    log_activity(db, action="client.updated", actor_id=actor.id, client_id=client.id)
    db.commit()
    db.refresh(client)
    return client


@router.post("/{client_id}/archive", status_code=204)
def archive_client(client_id: int, db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    """Soft-archive: move the client (and its chat) to the Archive. Reversible via /restore."""
    client = _load(db, client_id)
    ensure_client_access(actor, client)
    ensure_can_write(actor)
    client.archived_at = datetime.now(timezone.utc)
    log_activity(db, action="client.archived", actor_id=actor.id, client_id=client.id)
    db.commit()
    invalidate_cache("clients:", "dashboard:")


@router.post("/{client_id}/restore", status_code=204)
def restore_client(client_id: int, db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    """Move an archived client back to the active list."""
    client = _load(db, client_id)
    ensure_client_access(actor, client)
    ensure_can_write(actor)
    client.archived_at = None
    log_activity(db, action="client.restored", actor_id=actor.id, client_id=client.id)
    db.commit()
    invalidate_cache("clients:", "dashboard:")


@router.delete("/{client_id}", status_code=204)
def delete_client(
    client_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    if not has_min_role(actor, UserRole.admin):
        raise HTTPException(status_code=403, detail="Only admins can delete clients")
    client = _load(db, client_id)

    # Delete local folder on disk
    from pathlib import Path
    from app.config import settings
    from app.services import storage_service
    import shutil
    
    c_dir = storage_service.client_dir(client)
    if settings.storage_backend == "local":
        c_path = Path(settings.local_storage_dir) / c_dir
        if c_path.exists():
            try:
                shutil.rmtree(c_path)
            except Exception:
                pass
                
    db.delete(client)
    db.commit()
    invalidate_cache("clients:", "dashboard:")
