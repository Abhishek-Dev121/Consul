"""Lightweight presence / typing / read-receipt endpoints.

Presence + typing live in an in-memory tracker (no DB writes). Read receipts use
a single small table (client_reads). All are scoped to logged-in team members —
the external client isn't an app user, so these reflect team activity.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.client import Client
from app.models.read_state import ClientRead
from app.models.user import User
from app.rbac import ensure_client_access
from app.services import presence

router = APIRouter(prefix="/api/clients", tags=["realtime"])


class TypingPayload(BaseModel):
    typing: bool = True


def _client(db: Session, client_id: int) -> Client:
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


@router.post("/{client_id}/read", status_code=204)
def mark_read(client_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Record that the current user has just viewed this client's thread."""
    ensure_client_access(user, _client(db, client_id))
    row = db.execute(
        select(ClientRead).where(ClientRead.client_id == client_id, ClientRead.user_id == user.id)
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if row:
        row.last_read_at = now
    else:
        db.add(ClientRead(client_id=client_id, user_id=user.id, last_read_at=now))
    db.commit()


@router.post("/{client_id}/typing", status_code=204)
def set_typing(client_id: int, payload: TypingPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ensure_client_access(user, _client(db, client_id))
    presence.set_typing(client_id, user.id, user.name, payload.typing)


@router.get("/{client_id}/presence")
def get_presence(client_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Who (on the team) is online and who is typing in this client's thread."""
    ensure_client_access(user, _client(db, client_id))
    return {
        "online_user_ids": sorted(presence.online_ids()),
        "typing": presence.typing_names(client_id, exclude_user_id=user.id),
    }
