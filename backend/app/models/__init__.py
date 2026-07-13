"""Import all models so Alembic + SQLAlchemy see them on the Base metadata."""
from app.models.user import User, UserRole  # noqa: F401
from app.models.channel import Channel, PlatformType  # noqa: F401
from app.models.client import (  # noqa: F401
    Client,
    client_assignments,
    client_channels,
)
from app.models.conversation import Conversation, ConversationNote  # noqa: F401
from app.models.message import Message  # noqa: F401
from app.models.project import Project, ProjectTask, ProjectMember  # noqa: F401
from app.models.file import FileRecord  # noqa: F401
from app.models.audio import AudioRecording  # noqa: F401
from app.models.activity import Activity  # noqa: F401
from app.models.ai_analysis import AIAnalysis  # noqa: F401
from app.models.bitrix import BitrixToken  # noqa: F401
from app.models.read_state import ClientRead, MessageHidden  # noqa: F401
from app.models.app_setting import AppSetting  # noqa: F401
