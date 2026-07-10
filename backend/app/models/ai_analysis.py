import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, JSONColumn


class AnalysisTarget(str, enum.Enum):
    conversation = "conversation"
    audio = "audio"
    document = "document"


class AIAnalysis(Base):
    """AI-generated analysis for either a conversation or an audio recording."""

    __tablename__ = "ai_analyses"

    id: Mapped[int] = mapped_column(primary_key=True)
    target_type: Mapped[AnalysisTarget] = mapped_column(Enum(AnalysisTarget, name="analysis_target"))
    target_id: Mapped[int] = mapped_column(Integer, index=True)

    summary: Mapped[str | None] = mapped_column(Text)
    key_points: Mapped[list] = mapped_column(JSONColumn, default=list)
    pending_actions: Mapped[list] = mapped_column(JSONColumn, default=list)
    follow_ups: Mapped[list] = mapped_column(JSONColumn, default=list)
    sentiment: Mapped[str | None] = mapped_column(String(64))
    sentiment_score: Mapped[float | None] = mapped_column()
    response_metrics: Mapped[dict] = mapped_column(JSONColumn, default=dict)

    # Audio-specific
    transcript: Mapped[str | None] = mapped_column(Text)
    behavioral_assessment: Mapped[str | None] = mapped_column(Text)

    model: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
