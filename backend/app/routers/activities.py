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
    stmt = select(Activity).order_by(Activity.created_at.desc()).limit(min(limit, 200))
    if client_id:
        ensure_client_access(user, db.get(Client, client_id))
        stmt = select(Activity).where(Activity.client_id == client_id).order_by(
            Activity.created_at.desc()
        ).limit(min(limit, 200))
    return db.execute(stmt).scalars().all()
