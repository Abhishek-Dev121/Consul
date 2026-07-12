from datetime import datetime

from app.schemas.common import ORMModel
from app.schemas.ai import AIAnalysisOut


class FileOut(ORMModel):
    id: int
    client_id: int
    project_id: int | None = None
    project_title: str | None = None
    filename: str
    content_type: str | None
    size: int | None
    created_at: datetime
    archived_at: datetime | None = None
    analysis: AIAnalysisOut | None = None


class AudioOut(ORMModel):
    id: int
    client_id: int
    project_id: int | None = None
    project_title: str | None = None
    filename: str
    content_type: str | None
    duration: float | None
    created_at: datetime
    archived_at: datetime | None = None
