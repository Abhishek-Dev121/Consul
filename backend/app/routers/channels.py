import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.channel import BUILTIN_PLATFORMS, Channel, PlatformType
from app.models.user import User, UserRole
from app.rbac import require_role
from app.schemas.channel import (
    ChannelCreate,
    ChannelOut,
    PlatformTypeCreate,
    PlatformTypeOut,
)
from app.services.activity_service import log_activity

router = APIRouter(prefix="/api/channels", tags=["channels"])

# Data-URL logos are held inline in the DB, so keep them small (~350 KB of base64).
_MAX_LOGO_CHARS = 350_000


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return slug[:48] or "platform"


@router.get("/platform-types", response_model=list[PlatformTypeOut])
def list_platform_types(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.execute(select(PlatformType).order_by(PlatformType.name)).scalars().all()


@router.post("/platform-types", response_model=PlatformTypeOut, status_code=201)
def create_platform_type(
    payload: PlatformTypeCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role(UserRole.admin)),
):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Platform name is required")

    logo = (payload.logo or "").strip()
    if not logo:
        raise HTTPException(status_code=400, detail="A logo is required to create a platform type")
    if not logo.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="Logo must be an image")
    if len(logo) > _MAX_LOGO_CHARS:
        raise HTTPException(status_code=400, detail="Logo is too large. Please use an image under ~250 KB.")

    key = _slugify(name)
    # A custom key must not collide with a built-in or an existing custom type.
    if key in BUILTIN_PLATFORMS or db.execute(
        select(PlatformType).where(PlatformType.key == key)
    ).scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f'A platform type named "{name}" already exists')

    pt = PlatformType(key=key, name=name, logo=logo, created_by=actor.id)
    db.add(pt)
    log_activity(db, action="platform_type.created", actor_id=actor.id, detail={"name": name})
    db.commit()
    db.refresh(pt)
    return pt


@router.get("", response_model=list[ChannelOut])
def list_channels(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.execute(select(Channel).order_by(Channel.name)).scalars().all()


@router.post("", response_model=ChannelOut, status_code=201)
def create_channel(
    payload: ChannelCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role(UserRole.admin)),
):
    platform = (payload.platform or "").strip()
    # Must be a built-in platform or a previously-created custom type.
    if platform not in BUILTIN_PLATFORMS and not db.execute(
        select(PlatformType).where(PlatformType.key == platform)
    ).scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Unknown platform type")

    channel = Channel(
        name=payload.name,
        platform=platform,
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
    actor: User = Depends(require_role(UserRole.admin)),
):
    channel = db.get(Channel, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    db.delete(channel)
    db.commit()
