from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.ai_analysis import AIAnalysis, AnalysisTarget
from app.models.client import Client
from app.models.conversation import Conversation
from app.models.project import Project, ProjectTask
from app.models.user import User, UserRole
from app.rbac import ensure_client_access, require_permission, require_role
from app.schemas.ai import AIAnalysisOut
from app.services import ai_service
from app.services.activity_service import log_activity
from app.services.metrics_service import compute_response_times

router = APIRouter(prefix="/api/ai", tags=["ai"])

# Bitrix numeric task-status codes → readable labels (mirrors the chat UI).
_TASK_STATUS = {"1": "New", "2": "Pending", "3": "In progress", "4": "In review",
                "5": "Complete", "6": "Deferred", "7": "Declined"}


def _project_tasks_text(db: Session, client_id: int) -> str:
    """A readable dump of a client's projects and their tasks (status, owner, due),
    used both as extra Analysis context and as the assistant's task knowledge."""
    projs = db.execute(select(Project).where(Project.client_id == client_id)).scalars().all()
    if not projs:
        return ""
    lines = []
    for p in projs:
        lines.append(f"• Project: {p.title} (status: {p.status or 'n/a'})")
        tasks = db.execute(
            select(ProjectTask).where(ProjectTask.project_id == p.id).order_by(ProjectTask.id)
        ).scalars().all()
        if not tasks:
            lines.append("   (no tasks)")
            continue
        for t in tasks:
            # closed_date is the real-time completion signal; trust it over the code.
            st = "Complete" if t.closed_date else _TASK_STATUS.get(str(t.status), t.status or "—")
            owner = t.responsible_name or t.responsible or "—"
            due = t.due_date.strftime("%Y-%m-%d") if t.due_date else "—"
            lines.append(f"   - Task: {t.title} | status: {st} | owner: {owner} | due: {due}")
    return "\n".join(lines)


def _build_client_context(db: Session, client: Client) -> str:
    """Assemble everything the assistant may reason over for ONE client: identity,
    projects + tasks, and the recent conversation transcript."""
    from app.models.message import Message

    parts = [f"CLIENT: {client.name}"]
    if client.company:
        parts.append(f"Company: {client.company}")
    parts.append(f"Status: {client.status}")

    tasks_text = _project_tasks_text(db, client.id)
    if tasks_text:
        parts.append("\nPROJECTS & TASKS:\n" + tasks_text)

    msgs = db.execute(
        select(Message)
        .where(Message.client_id == client.id, Message.is_deleted.is_(False))
        .order_by(Message.sent_at.desc(), Message.id.desc())
        .limit(150)
    ).scalars().all()
    msgs = list(reversed(msgs))
    if msgs:
        lines = []
        for m in msgs:
            who = m.sender_name or ("Client" if m.is_client else "Team")
            ts = m.sent_at or m.created_at
            tss = ts.strftime("%Y-%m-%d %H:%M") if ts else ""
            body = m.body or (f"[{m.attachment_type}: {m.attachment_name}]" if m.attachment_type else "")
            lines.append(f"[{tss}] {who}: {body}")
        parts.append("\nRECENT CONVERSATION:\n" + "\n".join(lines))

    return "\n".join(parts)


class AssistantIn(BaseModel):
    client_id: int
    question: str
    history: list[dict] = []


@router.post("/assistant")
def assistant_chat(
    payload: AssistantIn,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role(UserRole.admin)),
):
    """Ask the AI a free-form question about ONE client — its conversations,
    projects and tasks. Admin / Super Admin only."""
    client = db.get(Client, payload.client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    question = (payload.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="Please enter a question.")

    context = _build_client_context(db, client)
    try:
        answer = ai_service.chat_assistant(question, context, payload.history)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    log_activity(db, action="ai.assistant_query", actor_id=actor.id, client_id=client.id,
                 detail={"question": question[:200]})
    db.commit()
    return {"answer": answer}


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
        is_link = f.content_type == "url"
        url = f.storage_key if is_link else f"/api/files/{f.id}/download"
        if url not in existing_urls:
            sender = uname.get(f.uploaded_by, "Team Member")
            body = (f"[Shared Link: {f.filename or f.storage_key}]" if is_link
                    else f"[Shared Document: {f.filename}]")
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

    # Fold the client's projects and tasks into the material to analyse, so the
    # report covers chats AND task status/owners/deadlines — not just the thread.
    tasks_text = _project_tasks_text(db, conv.client_id)
    if tasks_text:
        transcript = (transcript or "") + "\n\nPROJECT TASKS (for context):\n" + tasks_text

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
