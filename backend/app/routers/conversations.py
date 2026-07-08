from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.client import Client
from app.models.conversation import Conversation, ConversationNote
from app.models.user import User
from app.rbac import ensure_can_write, ensure_client_access
from app.schemas.conversation import (
    ConversationCreate,
    ConversationOut,
    NoteCreate,
    NoteOut,
)
from app.schemas.message import MessageOut
from app.services.activity_service import log_activity

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


def _load(db: Session, conv_id: int) -> Conversation:
    conv = db.get(Conversation, conv_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


@router.get("", response_model=list[ConversationOut])
def list_conversations(
    client_id: int | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(Conversation).where(Conversation.is_deleted.is_(False)).order_by(Conversation.created_at.desc())
    if client_id:
        stmt = stmt.where(Conversation.client_id == client_id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            Conversation.raw_content.ilike(like) | Conversation.title.ilike(like)
        )
    convos = db.execute(stmt).scalars().all()
    # Filter by client access.
    visible = []
    for c in convos:
        client = db.get(Client, c.client_id)
        if client:
            try:
                ensure_client_access(user, client)
                visible.append(c)
            except HTTPException:
                continue
    return visible


@router.get("/{conv_id}", response_model=ConversationOut)
def get_conversation(conv_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    conv = _load(db, conv_id)
    ensure_client_access(user, db.get(Client, conv.client_id))
    return conv


@router.post("", response_model=ConversationOut, status_code=201)
def create_conversation(
    payload: ConversationCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    client = db.get(Client, payload.client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    ensure_client_access(actor, client)
    ensure_can_write(actor)
    conv = Conversation(
        client_id=payload.client_id,
        channel_id=payload.channel_id,
        title=payload.title,
        raw_content=payload.raw_content,
        assigned_to=payload.assigned_to,
        occurred_at=payload.occurred_at,
        created_by=actor.id,
    )
    db.add(conv)
    db.flush()
    log_activity(db, action="conversation.created", actor_id=actor.id, client_id=client.id,
                 detail={"conversation_id": conv.id, "title": conv.title})
    db.commit()
    db.refresh(conv)
    return conv


@router.post("/{conv_id}/notes", response_model=NoteOut, status_code=201)
def add_note(
    conv_id: int,
    payload: NoteCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    conv = _load(db, conv_id)
    ensure_client_access(actor, db.get(Client, conv.client_id))
    ensure_can_write(actor)  # team leads + admins can annotate; employees are read-only
    note = ConversationNote(conversation_id=conv_id, author_id=actor.id, body=payload.body)
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


@router.delete("/{conv_id}", status_code=204)
def delete_conversation(
    conv_id: int, db: Session = Depends(get_db), actor: User = Depends(get_current_user)
):
    conv = _load(db, conv_id)
    ensure_client_access(actor, db.get(Client, conv.client_id))
    ensure_can_write(actor)
    conv.is_deleted = True  # soft delete — keep the record, just flag it
    log_activity(db, action="conversation.deleted", actor_id=actor.id, client_id=conv.client_id,
                 detail={"conversation_id": conv.id})
    db.commit()


@router.get("/{conv_id}/messages", response_model=list[MessageOut])
def list_conversation_messages(
    conv_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conv = _load(db, conv_id)
    ensure_client_access(user, db.get(Client, conv.client_id))
    from app.models.message import Message
    return db.execute(
        select(Message).where(Message.conversation_id == conv_id).order_by(Message.sent_at.asc())
    ).scalars().all()
