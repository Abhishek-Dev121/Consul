"""Create DB tables, apply lightweight column migrations, and seed the initial
super admin (all idempotent).

Local dev intentionally avoids Alembic, so when we add columns to an existing
table we patch them in here with `ADD COLUMN IF NOT EXISTS` (Postgres).
"""
from sqlalchemy import select, text

from app.config import settings
from app.database import Base, SessionLocal, engine
from app.models.user import User, UserRole
from app.services.auth_service import hash_password

# Columns added after the initial release. Each runs only if missing.
_COLUMN_PATCHES = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token VARCHAR(128)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by INTEGER",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_type VARCHAR(16)",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_url VARCHAR(512)",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(512)",
    "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS bitrix_group_name VARCHAR(255)",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS member_count INTEGER",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_bitrix_id VARCHAR(64)",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT",
    "ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS description TEXT",
    "ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS priority VARCHAR(16)",
    "ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS time_estimate INTEGER",
    "ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS creator_name VARCHAR(255)",
    "ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS creator_position VARCHAR(255)",
    "ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS responsible_name VARCHAR(255)",
    "ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS responsible_position VARCHAR(255)",
    "ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS auditors_json TEXT",
    "ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS accomplices_json TEXT",
    "ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS closed_date TIMESTAMPTZ",
    "ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS created_date TIMESTAMPTZ",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS bitrix_message_id VARCHAR(64)",
    "ALTER TABLE project_members ADD COLUMN IF NOT EXISTS email VARCHAR(255)",
    "ALTER TABLE project_members ADD COLUMN IF NOT EXISTS department VARCHAR(255)",
    "ALTER TABLE audio_recordings ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL",
    "ALTER TABLE files ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL",
]


def _apply_column_patches() -> None:
    with engine.begin() as conn:
        for stmt in _COLUMN_PATCHES:
            conn.execute(text(stmt))


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _apply_column_patches()
    with SessionLocal() as db:
        existing = db.execute(
            select(User).where(User.email == settings.first_superadmin_email)
        ).scalar_one_or_none()
        if existing is None:
            db.add(
                User(
                    name=settings.first_superadmin_name,
                    email=settings.first_superadmin_email,
                    password_hash=hash_password(settings.first_superadmin_password),
                    role=UserRole.super_admin,
                )
            )
            db.commit()

        # Seed default channels if none exist
        from app.models.channel import Channel, Platform
        existing_channels = db.execute(select(Channel)).first()
        if existing_channels is None:
            db.add_all([
                Channel(name="Main WhatsApp", platform=Platform.whatsapp, config={}),
                Channel(name="Primary Upwork", platform=Platform.upwork, config={}),
                Channel(name="Support Email", platform=Platform.email, config={}),
                Channel(name="Slack Client Portal", platform=Platform.slack, config={}),
                Channel(name="Telegram Support", platform=Platform.telegram, config={}),
            ])
            db.commit()

