"""Application configuration loaded from environment variables.

Uses pydantic-settings so every secret/URL is documented in one place and can be
overridden via a local `.env` file (see `.env.example`).
"""
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve the repo-root .env by absolute path so config loads whether the app is
# started from the repo root or from backend/. Real environment variables (e.g.
# those injected by docker-compose) still take precedence over the file.
_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE), env_file_encoding="utf-8", extra="ignore"
    )

    # --- Core ---
    app_name: str = "Bitrix24 Local App"
    environment: Literal["development", "production"] = "development"
    secret_key: str = "change-me-in-production"
    access_token_expire_minutes: int = 60 * 12

    database_url: str = "postgresql+psycopg2://neondb_owner:npg_xL3dj5gmAnsI@ep-super-heart-at950jsl.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require"
    redis_url: str = "redis://localhost:6379/0"
    # Seconds between DB keep-alive pings (prevents serverless-Postgres cold starts).
    # Set to 0 to disable (e.g. to conserve Neon free-tier compute hours).
    db_keepalive_seconds: int = 240

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
