"""Integrations / AI settings, editable at runtime by a Super Admin.

Lets the admin change the OpenAI API key, model and system prompts from the UI
without touching code or env — the values live in app_settings and ai_service
reads them on every analysis.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.app_setting import AppSetting
from app.models.user import User, UserRole
from app.rbac import require_role
from app.services import ai_defaults, settings_service
from app.services.activity_service import log_activity

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

# A curated shortlist for the dropdown; the field also accepts free text so any
# current OpenAI model id can be entered.
SUGGESTED_MODELS = [
    "gpt-4o-mini",
    "gpt-4o",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "gpt-4-turbo",
    "o3-mini",
    "o1-mini",
]

_super_admin = require_role(UserRole.super_admin)


def _mask(secret: str) -> str:
    if not secret:
        return ""
    if len(secret) <= 8:
        return "••••"
    return "••••••" + secret[-4:]


class AIPromptIn(BaseModel):
    kind: str
    value: str


class AISettingsIn(BaseModel):
    # All optional — only provided fields are updated. An empty/omitted api_key
    # leaves the stored key untouched (so the masked value isn't saved back).
    api_key: str | None = None
    model: str | None = None
    prompts: list[AIPromptIn] | None = None


def _current(db: Session) -> dict:
    key = settings_service.ai_api_key(db)
    return {
        "provider": "openai",
        "api_key_set": bool(key),
        "api_key_masked": _mask(key),
        # Full key is returned so the Super-Admin-only page can offer reveal/copy.
        # This endpoint is gated to super_admin and never exposed elsewhere.
        "api_key": key,
        "model": settings_service.ai_model(db),
        "suggested_models": SUGGESTED_MODELS,
        "prompts": [
            {
                "kind": kind,
                "label": meta["label"],
                "description": meta["description"],
                "value": settings_service.ai_prompt(db, kind),
                "default": ai_defaults.DEFAULT_PROMPTS[kind],
                "is_custom": settings_service.get_setting(db, "ai.prompt." + kind) is not None,
            }
            for kind, meta in ai_defaults.PROMPT_META.items()
        ],
    }


@router.get("/ai")
def get_ai_settings(db: Session = Depends(get_db), _: User = Depends(_super_admin)):
    return _current(db)


@router.put("/ai")
def update_ai_settings(
    payload: AISettingsIn,
    db: Session = Depends(get_db),
    actor: User = Depends(_super_admin),
):
    changed = []

    if payload.api_key is not None:
        key = payload.api_key.strip()
        # Ignore the masked placeholder so re-saving the form doesn't clobber the
        # real key with dots.
        if key and "•" not in key:
            settings_service.set_setting(db, settings_service.KEY_OPENAI_API_KEY, key, actor.id)
            changed.append("api_key")

    if payload.model is not None:
        model = payload.model.strip()
        if not model:
            raise HTTPException(status_code=400, detail="Model cannot be empty")
        settings_service.set_setting(db, settings_service.KEY_OPENAI_MODEL, model, actor.id)
        changed.append("model")

    if payload.prompts is not None:
        for p in payload.prompts:
            if p.kind not in ai_defaults.DEFAULT_PROMPTS:
                raise HTTPException(status_code=400, detail=f"Unknown prompt kind: {p.kind}")
            if not p.value.strip():
                raise HTTPException(status_code=400, detail=f'The "{p.kind}" prompt cannot be empty')
            settings_service.set_ai_prompt(db, p.kind, p.value, actor.id)
        changed.append("prompts")

    log_activity(db, action="integration.ai_updated", actor_id=actor.id, detail={"changed": changed})
    db.commit()
    return _current(db)


class ResetPromptIn(BaseModel):
    kind: str


@router.post("/ai/reset-prompt")
def reset_prompt(
    payload: ResetPromptIn,
    db: Session = Depends(get_db),
    actor: User = Depends(_super_admin),
):
    """Drop a custom prompt override so the built-in default is used again."""
    if payload.kind not in ai_defaults.DEFAULT_PROMPTS:
        raise HTTPException(status_code=400, detail="Unknown prompt kind")
    row = db.get(AppSetting, "ai.prompt." + payload.kind)
    if row:
        db.delete(row)
        db.commit()
    return _current(db)


@router.post("/ai/disconnect")
def disconnect(db: Session = Depends(get_db), actor: User = Depends(_super_admin)):
    """Disconnect OpenAI by clearing the stored key. AI analysis stays unavailable
    until a key is connected again."""
    settings_service.set_setting(db, settings_service.KEY_OPENAI_API_KEY, "", actor.id)
    log_activity(db, action="integration.ai_disconnected", actor_id=actor.id)
    db.commit()
    return _current(db)


@router.post("/ai/test")
def test_connection(db: Session = Depends(get_db), _: User = Depends(_super_admin)):
    """Verify the configured key + model with a tiny live request."""
    key = settings_service.ai_api_key(db)
    model = settings_service.ai_model(db)
    if not key:
        raise HTTPException(status_code=400, detail="No API key configured")
    try:
        from openai import OpenAI
        client = OpenAI(api_key=key)
        resp = client.chat.completions.create(
            model=model,
            max_tokens=1,
            messages=[{"role": "user", "content": "ping"}],
        )
        return {"ok": True, "model": resp.model}
    except Exception as e:  # noqa: BLE001 — surface the provider's message to the admin
        raise HTTPException(status_code=502, detail=f"Connection failed: {e}")
