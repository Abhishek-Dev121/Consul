"""Webhook intake endpoints.

Lets an external automation (e.g. a Make.com scenario driven by a Bitrix24
webhook) create a client and assign its channel in a single call, without a
user login. Authentication is a shared secret in the `X-Api-Key` header
(settings.intake_api_key) — there is no JWT and no per-user permission check,
so keep the key private and scoped to this purpose.
"""
import hmac

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.channel import BUILTIN_PLATFORMS, Channel
from app.models.client import Client
from app.schemas.client import ClientOut
from app.services.activity_service import log_activity

router = APIRouter(prefix="/api/intake", tags=["intake"])


class ClientIntake(BaseModel):
    client_name: str
    # The channel the client came from (e.g. "Upwork"). Optional: if omitted the
    # client is created without a channel.
    source: str | None = None

    @field_validator("client_name")
    @classmethod
    def _name_required(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("client_name is required")
        return v


def _require_api_key(x_api_key: str | None) -> None:
    expected = (settings.intake_api_key or "").strip()
    if not expected:
        # No key configured -> the endpoint stays closed rather than accepting
        # anonymous writes.
        raise HTTPException(status_code=503, detail="Intake API is not configured")
    if not x_api_key or not hmac.compare_digest(x_api_key.strip(), expected):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


def _resolve_or_create_channel(db: Session, source: str | None) -> Channel | None:
    """Find a channel whose name matches `source` (case-insensitively), or create
    one. A known platform name (e.g. "Upwork") is stored under its built-in
    platform key; anything else falls back to the generic "other" platform."""
    source = (source or "").strip()
    if not source:
        return None
    existing = db.execute(
        select(Channel).where(func.lower(Channel.name) == source.lower())
    ).scalars().first()
    if existing:
        return existing
    platform = source.lower() if source.lower() in BUILTIN_PLATFORMS else "other"
    channel = Channel(name=source, platform=platform)
    db.add(channel)
    db.flush()
    return channel


@router.post("/client", response_model=ClientOut, status_code=201)
def intake_client(
    payload: ClientIntake,
    db: Session = Depends(get_db),
    x_api_key: str | None = Header(default=None, alias="X-Api-Key"),
):
    """Create a client from a webhook and assign a channel resolved from `source`.

    Auth: `X-Api-Key: <settings.intake_api_key>`. Returns the created client
    (with its assigned channel). A new client is created on every call.
    """
    _require_api_key(x_api_key)

    channel = _resolve_or_create_channel(db, payload.source)

    client = Client(name=payload.client_name)
    if channel is not None:
        client.channels = [channel]
    db.add(client)
    db.flush()

    log_activity(
        db,
        action="client.created",
        client_id=client.id,
        detail={"name": client.name, "source": payload.source, "via": "intake"},
    )
    db.commit()
    db.refresh(client)
    return client
