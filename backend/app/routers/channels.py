from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.channel import Channel
from app.models.user import User
from app.rbac import require_permission
from app.schemas.channel import ChannelCreate, ChannelOut
from app.services.activity_service import log_activity

router = APIRouter(prefix="/api/channels", tags=["channels"])


@router.get("", response_model=list[ChannelOut])
def list_channels(db: Session = Depends(get_db), _: User = Depends(require_permission("channels.view"))):
    return db.execute(select(Channel).order_by(Channel.name)).scalars().all()


@router.post("", response_model=ChannelOut, status_code=201)
def create_channel(
    payload: ChannelCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("channels.manage")),
):
    channel = Channel(
        name=payload.name,
        platform=payload.platform,
        config=payload.config,
        created_by=actor.id,
    )
    db.add(channel)
    log_activity(db, action="channel.created", actor_id=actor.id, detail={"name": payload.name})
    db.commit()
    db.refresh(channel)
    return channel


@router.delete("/{channel_id}", status_code=204)
def delete_channel(
    channel_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("channels.manage")),
):
    channel = db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    db.delete(channel)
    db.commit()
