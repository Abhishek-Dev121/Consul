from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.activity import Activity
from app.models.client import Client
from app.models.user import User
from app.rbac import ensure_client_access
from app.schemas.ai import ActivityOut

router = APIRouter(prefix="/api/activities", tags=["activities"])


@router.get("", response_model=list[ActivityOut])
def list_activities(
    client_id: int | None = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Join the actor name in one query so the UI can show "Ravi uploaded…" rather
    # than a bare id (or "System" for everything).
    stmt = (
        select(Activity, User.name.label("actor_name"))
        .outerjoin(User, Activity.actor_id == User.id)
        .order_by(Activity.created_at.desc())
        .limit(min(limit, 200))
    )
    if client_id:
        ensure_client_access(user, db.get(Client, client_id))
        stmt = stmt.where(Activity.client_id == client_id)

    out = []
    for act, actor_name in db.execute(stmt).all():
        out.append({
            "id": act.id, "client_id": act.client_id, "actor_id": act.actor_id,
            "actor_name": actor_name, "action": act.action,
            "detail": act.detail or {}, "created_at": act.created_at,
        })
    return out
