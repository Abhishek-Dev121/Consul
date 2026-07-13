"""Runtime settings (app_settings table) with typed helpers for AI configuration.

Everything falls back to the environment / built-in defaults when nothing has been
saved in the DB, so the app behaves exactly as before until an admin overrides a
value from the Integrations page.
"""
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.app_setting import AppSetting
from app.services import ai_defaults

# Setting keys
KEY_OPENAI_API_KEY = "ai.openai_api_key"
KEY_OPENAI_MODEL = "ai.openai_model"
_PROMPT_PREFIX = "ai.prompt."


def get_setting(db: Session, key: str) -> str | None:
    row = db.get(AppSetting, key)
    return row.value if row else None


def set_setting(db: Session, key: str, value: str, user_id: int | None = None) -> None:
    row = db.get(AppSetting, key)
    if row:
        row.value = value
        row.updated_by = user_id
        row.updated_at = datetime.now(timezone.utc)
    else:
        db.add(AppSetting(key=key, value=value, updated_by=user_id))


# ── AI configuration accessors (DB → env/default fallback) ──────────────────

def ai_api_key(db: Session) -> str:
    # An explicit override row (even empty) wins, so "Disconnect" — which stores an
    # empty string — truly disconnects instead of silently falling back to the env
    # key. Only when no override row exists do we use the .env value.
    override = get_setting(db, KEY_OPENAI_API_KEY)
    if override is not None:
        return override.strip()
    return (settings.openai_api_key or "").strip()


def ai_model(db: Session) -> str:
    return (get_setting(db, KEY_OPENAI_MODEL) or settings.openai_model or ai_defaults.DEFAULT_MODEL).strip()


def ai_prompt(db: Session, kind: str) -> str:
    """The system prompt for a given kind (conversation|document|audio)."""
    stored = get_setting(db, _PROMPT_PREFIX + kind)
    if stored and stored.strip():
        return stored
    return ai_defaults.DEFAULT_PROMPTS.get(kind, "")


def set_ai_prompt(db: Session, kind: str, value: str, user_id: int | None = None) -> None:
    set_setting(db, _PROMPT_PREFIX + kind, value, user_id)
