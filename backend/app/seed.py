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
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS chat_cleared_at TIMESTAMPTZ",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ",
    "ALTER TABLE files ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ",
    "ALTER TABLE audio_recordings ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ",
    # Custom platform types: relax the channels.platform enum to a plain string so
    # it can hold a PlatformType.key alongside the built-ins. Idempotent — running
    # it when the column is already VARCHAR is a harmless no-op.
    "ALTER TABLE channels ALTER COLUMN platform TYPE VARCHAR(64) USING platform::text",
]


def _apply_column_patches() -> None:
    if not _COLUMN_PATCHES:
        return
    with engine.begin() as conn:
        # Join all alter statements with a semicolon to execute them in a single batch round-trip
        conn.execute(text(";\n".join(_COLUMN_PATCHES)))


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
                Channel(name="Main WhatsApp", platform=Platform.whatsapp.value, config={}),
                Channel(name="Primary Upwork", platform=Platform.upwork.value, config={}),
                Channel(name="Support Email", platform=Platform.email.value, config={}),
                Channel(name="Slack Client Portal", platform=Platform.slack.value, config={}),
                Channel(name="Telegram Support", platform=Platform.telegram.value, config={}),
            ])
            db.commit()

        # Seed default permissions
        seed_permissions(db)


ALL_PERMISSIONS = [
    ("dashboard.view", "View Dashboard", "Dashboard", "Access the main overview dashboard", [UserRole.super_admin, UserRole.admin, UserRole.team_lead, UserRole.employee]),
    ("clients.view", "View Clients", "Clients", "View list of clients and details", [UserRole.super_admin, UserRole.admin, UserRole.team_lead, UserRole.employee]),
    ("clients.create", "Create Clients", "Clients", "Add new clients to the system", [UserRole.super_admin, UserRole.admin]),
    ("clients.edit", "Edit Clients", "Clients", "Edit existing client details", [UserRole.super_admin, UserRole.admin]),
    ("clients.delete", "Delete Clients", "Clients", "Archive or delete client records", [UserRole.super_admin, UserRole.admin]),
    ("conversations.view", "View Conversations", "Conversations", "Access client chat threads", [UserRole.super_admin, UserRole.admin, UserRole.team_lead, UserRole.employee]),
    ("conversations.reply", "Reply to Conversations", "Conversations", "Send manual messages in chat threads", [UserRole.super_admin, UserRole.admin, UserRole.team_lead]),
    ("conversations.delete", "Delete Messages", "Conversations", "Delete specific messages from chats", [UserRole.super_admin, UserRole.admin]),
    ("conversations.clear", "Clear Chat History", "Conversations", "Clear messages inside a conversation", [UserRole.super_admin, UserRole.admin]),
    ("conversations.clear_all", "Clear All Chats History", "Conversations", "Wipe every message in every conversation", [UserRole.super_admin]),
    ("messages.send", "Send Messages", "Messages", "Trigger message sending", [UserRole.super_admin, UserRole.admin, UserRole.team_lead]),
    ("messages.upload", "Upload Attachments", "Messages", "Upload files as attachments in chats", [UserRole.super_admin, UserRole.admin, UserRole.team_lead]),
    ("messages.edit", "Edit Messages", "Messages", "Edit already sent messages", [UserRole.super_admin, UserRole.admin]),
    ("channels.view", "View Channels", "Channels", "View platform integration channels", [UserRole.super_admin, UserRole.admin, UserRole.team_lead, UserRole.employee]),
    ("channels.manage", "Manage Channels", "Channels", "Create or delete integration channels", [UserRole.super_admin, UserRole.admin]),
    ("projects.view", "View Projects", "Projects", "View projects and project details", [UserRole.super_admin, UserRole.admin, UserRole.team_lead, UserRole.employee]),
    ("projects.manage", "Manage Projects", "Projects", "Create, edit, or delete projects", [UserRole.super_admin, UserRole.admin]),
    ("documents.view", "View Documents", "Documents", "Access and download uploaded documents", [UserRole.super_admin, UserRole.admin, UserRole.team_lead, UserRole.employee]),
    ("documents.upload", "Upload Documents", "Documents", "Upload client or project documents", [UserRole.super_admin, UserRole.admin, UserRole.team_lead]),
    ("documents.delete", "Delete Documents", "Documents", "Remove/archive documents", [UserRole.super_admin, UserRole.admin]),
    ("calls.view", "View Call Recordings", "Calls", "Listen to call recordings", [UserRole.super_admin, UserRole.admin, UserRole.team_lead, UserRole.employee]),
    ("calls.upload", "Upload Recordings", "Calls", "Upload audio calls", [UserRole.super_admin, UserRole.admin, UserRole.team_lead]),
    ("calls.delete", "Delete Recordings", "Calls", "Delete audio call records", [UserRole.super_admin, UserRole.admin]),
    ("reports.view", "View Reports", "Reports", "View analytics reports and overview stats", [UserRole.super_admin, UserRole.admin, UserRole.team_lead]),
    ("ai.analyze", "Run AI Analysis", "AI", "Trigger AI analytics on chats and calls", [UserRole.super_admin, UserRole.admin, UserRole.team_lead]),
    ("users.view", "View Users", "Users", "View list of team members", [UserRole.super_admin, UserRole.admin, UserRole.team_lead]),
    ("users.manage", "Manage Users", "Users", "Add, edit, enable/disable, or delete users", [UserRole.super_admin, UserRole.admin]),
    ("users.permissions", "Edit Permissions", "Users", "Edit role permissions in matrix", [UserRole.super_admin]),
    ("activity.view", "View Activity Log", "Activity", "Access system audit/activity logs", [UserRole.super_admin, UserRole.admin, UserRole.team_lead]),
    ("bitrix.manage", "Manage Bitrix", "Bitrix", "Manage Bitrix24 portal connection settings", [UserRole.super_admin, UserRole.admin]),
    ("integrations.manage", "Manage Integrations", "Integrations", "Manage third-party integrations and app settings", [UserRole.super_admin]),
]


def seed_permissions(db: SessionLocal) -> None:
    from app.models.permission import Permission, RolePermission
    from app.cache import invalidate_cache

    # 1. Seed Permission table
    db_permissions = {p.code: p for p in db.execute(select(Permission)).scalars().all()}
    for code, name, cat, desc, _ in ALL_PERMISSIONS:
        if code not in db_permissions:
            p = Permission(code=code, name=name, category=cat, description=desc)
            db.add(p)
    db.flush()

    # Get fresh dict of permissions with IDs
    db_permissions = {p.code: p for p in db.execute(select(Permission)).scalars().all()}

    # 2. Seed default RolePermissions mapping
    existing_mapping = db.execute(select(RolePermission.role, RolePermission.permission_id)).all()
    existing_set = {(role, perm_id) for role, perm_id in existing_mapping}

    for code, _, _, _, roles in ALL_PERMISSIONS:
        perm = db_permissions[code]
        for role in roles:
            if (role, perm.id) not in existing_set:
                db.add(RolePermission(role=role, permission_id=perm.id))

    db.commit()
    invalidate_cache("role_permissions:")


def sync_permissions(db: SessionLocal) -> None:
    """Wipe existing RolePermission mappings and restore default mappings (used by reset endpoint)."""
    from app.models.permission import RolePermission
    from app.cache import invalidate_cache

    db.execute(text("DELETE FROM role_permissions"))
    db.flush()
    seed_permissions(db)


