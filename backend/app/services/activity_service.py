"""Helper to record activity-log entries."""
from sqlalchemy.orm import Session

from app.models.activity import Activity


def log_activity(
    db: Session,
    *,
    action: str,
    actor_id: int | None = None,
    client_id: int | None = None,
    detail: dict | None = None,
) -> Activity:
    entry = Activity(
        action=action,
        actor_id=actor_id,
        client_id=client_id,
        detail=detail or {},
    )
    db.add(entry)
    db.flush()
    return entry
