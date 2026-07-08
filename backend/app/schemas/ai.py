from datetime import datetime

from app.models.ai_analysis import AnalysisTarget
from app.schemas.common import ORMModel


class AIAnalysisOut(ORMModel):
    id: int
    target_type: AnalysisTarget
    target_id: int
    summary: str | None
    key_points: list = []
    pending_actions: list = []
    follow_ups: list = []
    sentiment: str | None
    sentiment_score: float | None
    response_metrics: dict = {}
    transcript: str | None
    behavioral_assessment: str | None
    model: str | None
    created_at: datetime


class ActivityOut(ORMModel):
    id: int
    client_id: int | None
    actor_id: int | None
    action: str
    detail: dict = {}
    created_at: datetime
