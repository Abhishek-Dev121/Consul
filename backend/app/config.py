"""Application configuration loaded from environment variables.

Uses pydantic-settings so every secret/URL is documented in one place and can be
overridden via a local `.env` file (see `.env.example`).
"""
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve the repo-root .env by absolute path so config loads whether the app is
# started from the repo root or from backend/. Real environment variables (e.g.
# those injected by docker-compose) still take precedence over the file.
_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE), env_file_encoding="utf-8", extra="ignore"
    )

    @model_validator(mode="before")
    @classmethod
    def map_email_env_to_smtp(cls, data: dict) -> dict:
        if isinstance(data, dict):
            # Check for EMAIL_HOST
            email_host = data.get("EMAIL_HOST") or data.get("email_host")
            if email_host and not (data.get("smtp_host") or data.get("SMTP_HOST")):
                data["smtp_host"] = email_host
                
            email_port = data.get("EMAIL_PORT") or data.get("email_port")
            if email_port and not (data.get("smtp_port") or data.get("SMTP_PORT")):
                try:
                    data["smtp_port"] = int(email_port)
                except ValueError:
                    pass
                    
            email_user = data.get("EMAIL_HOST_USER") or data.get("email_host_user")
            if email_user:
                if not (data.get("smtp_user") or data.get("SMTP_USER")):
                    data["smtp_user"] = email_user
                if not (data.get("smtp_from") or data.get("SMTP_FROM") or data.get("smtp_from") == "no-reply@devexhub.com"):
                    data["smtp_from"] = email_user
                    
            email_pass = data.get("EMAIL_HOST_PASSWORD") or data.get("email_host_password")
            if email_pass and not (data.get("smtp_password") or data.get("SMTP_PASSWORD")):
                data["smtp_password"] = email_pass
                
            email_tls = data.get("EMAIL_USE_TLS") or data.get("email_use_tls")
            if email_tls is not None and not (data.get("smtp_tls") or data.get("SMTP_TLS")):
                if isinstance(email_tls, str):
                    data["smtp_tls"] = email_tls.lower() in ("true", "1", "yes")
                else:
                    data["smtp_tls"] = bool(email_tls)
        return data

    # --- Core ---
    app_name: str = "Bitrix24 Local App"
    environment: Literal["development", "production"] = "development"
    secret_key: str = "change-me-in-production"
    access_token_expire_minutes: int = 60 * 12
    # "Keep me signed in" issues a longer-lived token. Without this the checkbox
    # only chose where the token was stored, so a remembered session still died
    # after 12 hours.
    remember_me_expire_days: int = 30

    # No default: the connection string (with credentials) must come from the
    # environment / .env, never be hard-coded here. Empty -> fail fast at startup
    # (see app/database.py) instead of silently using a baked-in database.
    database_url: str = ""
    redis_url: str = "redis://localhost:6379/0"
    # Seconds between DB keep-alive pings (prevents serverless-Postgres cold starts).
    # Set to 0 to disable (e.g. to conserve Neon free-tier compute hours).
    db_keepalive_seconds: int = 240
    # Enable SQLAlchemy pool pre-ping (runs SELECT 1 on checkout) to resist drops.
    db_pool_pre_ping: bool = True

    # --- Initial super admin (seeded on first run) ---
    first_superadmin_email: str = "admin@devexhub.com"
    first_superadmin_password: str = "ChangeMe123!"
    first_superadmin_name: str = "Super Admin"

    # --- OpenAI ---
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    # --- Deepgram ---
    deepgram_api_key: str = ""

    # --- Storage (S3 or local disk fallback) ---
    storage_backend: Literal["local", "s3"] = "local"
    local_storage_dir: str = "./storage"
    s3_bucket: str = ""
    s3_region: str = "us-east-1"
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""

    # --- Bitrix24 ---
    bitrix_portal_url: str = ""  # e.g. https://your-portal.bitrix24.com
    bitrix_client_id: str = ""
    bitrix_client_secret: str = ""
    bitrix_redirect_uri: str = "http://localhost:8000/api/bitrix/callback"
    bitrix_webhook_url: str = ""

    # --- App URL + email (for user invites) ---
    app_base_url: str = "http://localhost:8000"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "no-reply@devexhub.com"
    smtp_tls: bool = True
    invite_ttl_hours: int = 72


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
