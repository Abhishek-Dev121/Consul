from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.ai_analysis import AIAnalysis, AnalysisTarget
from app.models.client import Client
from app.models.conversation import Conversation
from app.models.user import User
from app.rbac import ensure_client_access, require_permission
from app.schemas.ai import AIAnalysisOut
from app.services import ai_service
from app.services.activity_service import log_activity
from app.services.metrics_service import compute_response_times

router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.post("/conversations/{conv_id}/analyze", response_model=AIAnalysisOut)
def analyze_conversation(
    conv_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("ai.analyze"))
):
    conv = db.get(Conversation, conv_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    client = db.get(Client, conv.client_id)
    ensure_client_access(actor, client)

    # Fetch live messages, files, and audio recordings to build the transcript
    from app.models.message import Message
    from app.models.file import FileRecord
    from app.models.audio import AudioRecording
    
    uname = dict(db.execute(select(User.id, User.name)).all())
    
    msgs = db.execute(
        select(Message).where(Message.client_id == conv.client_id).order_by(Message.sent_at.asc(), Message.id.asc())
    ).scalars().all()
    
    files = db.execute(
        select(FileRecord).where(FileRecord.client_id == conv.client_id)
    ).scalars().all()
    
    audios = db.execute(
        select(AudioRecording).where(AudioRecording.client_id == conv.client_id)
    ).scalars().all()
    
    existing_urls = {m.attachment_url for m in msgs if m.attachment_url}
    
    # Compile all timeline events
    events = []
    
    for m in msgs:
        sender = m.sender_name or ("Client" if m.is_client else "Team")
        body = f"[Attachment: {m.attachment_name or m.attachment_type}]" if m.attachment_type else (m.body or "")
        ts = m.sent_at or m.created_at
        events.append((ts, sender, body))
        
    for f in files:
        url = f.storage_key if f.content_type == "url" else f"/api/files/{f.id}/download"
        if url not in existing_urls:
            sender = uname.get(f.uploaded_by, "Team Member")
            body = f"[Shared Document: {f.filename}]"
            events.append((f.created_at, sender, body))
            
    for a in audios:
        url = f"/api/audio/{a.id}/download"
        if url not in existing_urls:
            sender = uname.get(a.uploaded_by, "Team Member")
            body = f"[Shared Audio/Video: {a.filename}]"
            events.append((a.created_at, sender, body))
            
    # Sort chronologically by timestamp
    from datetime import datetime
    events.sort(key=lambda item: item[0] if item[0] else datetime.min)
    
    if events:
        transcript_lines = []
        for ts, sender, body in events:
            ts_str = f"[{ts.strftime('%Y-%m-%d %H:%M:%S')}] " if ts else ""
            transcript_lines.append(f"{ts_str}{sender}: {body}")
        transcript = "\n".join(transcript_lines)
    else:
        transcript = conv.raw_content

    if not transcript or not transcript.strip():
        raise HTTPException(status_code=400, detail="This conversation has no messages to analyse yet.")

    # Who and when: without this the model cannot tell which side is the client,
    # and reads relative dates ("next Friday") against the wrong calendar.
    stamps = [ts for ts, _, _ in events if ts]
    context = {
        "Client": client.name if client else None,
        "Company": client.company if client else None,
        "Conversation": conv.title or None,
        "Date range": (f"{min(stamps):%Y-%m-%d} to {max(stamps):%Y-%m-%d}" if stamps else None),
        "Messages": str(len(events)) if events else None,
    }

    try:
        analysis = ai_service.analyze_conversation(transcript, context=context)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    metrics = compute_response_times(transcript)
    row = AIAnalysis(
        target_type=AnalysisTarget.conversation,
        target_id=conv.id,
        summary=analysis.get("summary"),
        key_points=analysis.get("key_points", []),
        pending_actions=analysis.get("pending_actions", []),
        follow_ups=analysis.get("follow_ups", []),
        sentiment=analysis.get("sentiment"),
        sentiment_score=analysis.get("sentiment_score"),
        response_metrics=metrics,
        model=analysis.get("model"),
    )
    db.add(row)
    log_activity(db, action="conversation.analyzed", actor_id=actor.id, client_id=conv.client_id,
                 detail={"conversation_id": conv.id})
    db.commit()
    db.refresh(row)
    return row


@router.get("/conversations/{conv_id}/analysis", response_model=AIAnalysisOut | None)
def latest_conversation_analysis(
    conv_id: int,
    start: datetime | None = None,
    end: datetime | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("conversations.view"))
):
    """The most recent analysis for this conversation. Pass start/end (ISO) to view
    a historical report — the latest analysis generated within that window (used by
    the Daily/Weekly/Monthly filter)."""
    conv = db.get(Conversation, conv_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    ensure_client_access(user, db.get(Client, conv.client_id))
    q = select(AIAnalysis).where(
        AIAnalysis.target_type == AnalysisTarget.conversation,
        AIAnalysis.target_id == conv_id,
    )
    if start is not None:
        q = q.where(AIAnalysis.created_at >= start)
    if end is not None:
        q = q.where(AIAnalysis.created_at < end)
    return db.execute(
        q.order_by(AIAnalysis.created_at.desc()).limit(1)
    ).scalar_one_or_none()
