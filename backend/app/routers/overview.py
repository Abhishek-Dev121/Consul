"""Aggregate read endpoints for the Dashboard and Clients views.

Everything is role-scoped: admins+ see all clients, team leads / employees only
their assigned clients.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.cache import ttl_cache

from app.database import get_db
from app.deps import get_current_user
from app.models.activity import Activity
from app.models.ai_analysis import AIAnalysis, AnalysisTarget
from app.models.audio import AudioRecording
from app.models.channel import Channel
from app.models.client import Client
from app.models.conversation import Conversation
from app.models.file import FileRecord
from app.models.project import Project, ProjectTask
from app.models.user import User, UserRole
from app.rbac import has_min_role

router = APIRouter(prefix="/api", tags=["overview"])

_DONE_TOKENS = {"done", "completed", "complete", "closed", "won", "5"}


def _accessible_clients(db: Session, user: User) -> list[Client]:
    if has_min_role(user, UserRole.admin):
        return db.execute(select(Client).order_by(Client.name)).scalars().all()
    return db.execute(
        select(Client)
        .join(Client.assignees)
        .where(User.id == user.id)
        .order_by(Client.name)
    ).scalars().all()


def _sentiment_by_client(db: Session, conv_to_client: dict[int, int]) -> dict[int, str]:
    """Latest conversation-analysis sentiment per client."""
    out: dict[int, str] = {}
    if not conv_to_client:
        return out
    rows = db.execute(
        select(AIAnalysis.target_id, AIAnalysis.sentiment)
        .where(AIAnalysis.target_type == AnalysisTarget.conversation,
               AIAnalysis.target_id.in_(conv_to_client.keys()))
        .order_by(AIAnalysis.created_at.asc())
    ).all()
    for conv_id, sentiment in rows:  # later rows overwrite -> latest wins
        if sentiment:
            out[conv_to_client[conv_id]] = sentiment
    return out


def _norm_sent(s: str | None) -> str:
    if not s:
        return "neu"
    s = s.lower()
    if "pos" in s:
        return "pos"
    if "neg" in s:
        return "neg"
    return "neu"


@router.get("/dashboard/overview")
def dashboard_overview(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    cache_key = f"dashboard:{user.id}"
    cached = ttl_cache.get(cache_key)
    if cached is not None:
        return cached
    clients = _accessible_clients(db, user)
    cids = [c.id for c in clients]
    cname = {c.id: c.name for c in clients}
    if not cids:
        cids = [-1]

    # Combine Conversation and Channel fetch in one join query
    convos_with_channels = db.execute(
        select(Conversation, Channel.platform)
        .outerjoin(Channel, Conversation.channel_id == Channel.id)
        .where(Conversation.client_id.in_(cids), Conversation.is_deleted.is_(False))
        .order_by(Conversation.created_at.desc())
    ).all()
    convos = []
    conv_platform = {}
    for c, plat in convos_with_channels:
        convos.append(c)
        conv_platform[c.id] = plat

    conv_to_client = {c.id: c.client_id for c in convos}
    audio_count = db.execute(
        select(func.count(AudioRecording.id)).where(AudioRecording.client_id.in_(cids))
    ).scalar_one()
    project_rows = db.execute(
        select(Project).where(Project.client_id.in_(cids)).order_by(Project.created_at.desc())
    ).scalars().all()

    # Query AIAnalysis once instead of twice
    conv_sent_rows = db.execute(
        select(AIAnalysis.target_id, AIAnalysis.sentiment)
        .where(AIAnalysis.target_type == AnalysisTarget.conversation,
               AIAnalysis.target_id.in_(list(conv_to_client) or [-1]))
        .order_by(AIAnalysis.created_at.asc())
    ).all()
    
    conv_sent = {}
    sent_by_client = {}
    for cid_, s in conv_sent_rows:
        if s:
            ns = _norm_sent(s)
            conv_sent[cid_] = ns
            sent_by_client[conv_to_client[cid_]] = s

    tally = {"pos": 0, "neu": 0, "neg": 0}
    for s in conv_sent.values():
        tally[s] += 1

    # channel volume (conversations per platform) using pre-joined platform data
    vol: dict[str, int] = {}
    for c in convos:
        plat = conv_platform.get(c.id)
        key = plat.value if plat else "other"
        vol[key] = vol.get(key, 0) + 1

    # attention: negative first, then most recent
    attention = []
    for c in convos:
        s = conv_sent.get(c.id, "neu")
        plat = conv_platform.get(c.id)
        attention.append({
            "id": c.id, "client_id": c.client_id, "client": cname.get(c.client_id, "—"),
            "title": c.title or "Untitled",
            "platform": plat.value if plat else "other",
            "sentiment": s, "time": c.created_at.isoformat() if c.created_at else None,
        })
    # Only surface conversations that actually need attention: negative sentiment
    # or not-yet-analyzed (neutral default). Positive, handled chats drop out.
    attention = [a for a in attention if a["sentiment"] != "pos"]
    attention.sort(key=lambda x: 0 if x["sentiment"] == "neg" else 1)
    attention = attention[:6]

    at_risk = len({cid_ for cid_, s in sent_by_client.items() if _norm_sent(s) == "neg"})

    # recent activity (joined with User to avoid querying all users)
    acts_with_users = db.execute(
        select(Activity, User.name)
        .outerjoin(User, Activity.actor_id == User.id)
        .order_by(Activity.created_at.desc())
        .limit(7)
    ).all()
    recent = [{
        "actor": name or "System",
        "action": a.action, "detail": a.detail,
        "client": cname.get(a.client_id) if a.client_id else None,
        "time": a.created_at.isoformat() if a.created_at else None,
    } for a, name in acts_with_users]

    # projects in flight (using single grouped query instead of fetching all ProjectTasks)
    task_counts = {}
    if project_rows:
        pids = [p.id for p in project_rows[:6]]
        from sqlalchemy import case
        task_stats = db.execute(
            select(
                ProjectTask.project_id,
                func.count(ProjectTask.id).label("total"),
                func.sum(case((func.lower(ProjectTask.status).in_(_DONE_TOKENS), 1), else_=0)).label("done")
            )
            .where(ProjectTask.project_id.in_(pids))
            .group_by(ProjectTask.project_id)
        ).all()
        task_counts = {row.project_id: (row.total, row.done or 0) for row in task_stats}

    projects = []
    for p in project_rows[:6]:
        total, done = task_counts.get(p.id, (0, 0))
        progress = round(done / total * 100) if total else 0
        projects.append({
            "id": p.id, "bitrix_id": p.bitrix_project_id, "title": p.title,
            "client": cname.get(p.client_id, "—"), "status": p.status or "—",
            "progress": progress, "tasks": f"{done} / {total}",
            "due": p.due_date.isoformat() if p.due_date else None,
        })

    return {
        "kpis": {
            "clients": len(clients),
            "conversations": len(convos),
            "calls": audio_count,
            "projects": len(project_rows),
            "at_risk": at_risk,
        },
        "sentiment": tally,
        "channel_volume": [{"platform": k, "count": v} for k, v in sorted(vol.items(), key=lambda x: -x[1])],
        "attention": attention,
        "recent_activity": recent,
        "projects_in_flight": projects,
    }
    ttl_cache.set(cache_key, result, ttl=30)
    return result


@router.get("/overview/clients")
def clients_overview(archived: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    cache_key = f"clients:{user.id}:{archived}"
    cached = ttl_cache.get(cache_key)
    if cached is not None:
        return cached
    clients = _accessible_clients(db, user)
    cids = [c.id for c in clients] or [-1]

    def _counts(model):
        rows = db.execute(
            select(model.client_id, func.count(model.id)).where(model.client_id.in_(cids))
            .group_by(model.client_id)
        ).all()
        return {cid_: n for cid_, n in rows}

    # A client is "archived" once it has conversations and none of them are active
    # (i.e. every conversation was soft-deleted via the Archive action).
    conv_state = db.execute(
        select(Conversation.client_id, Conversation.is_deleted).where(Conversation.client_id.in_(cids))
    ).all()
    total_convs: dict[int, int] = {}
    active_convs: dict[int, int] = {}
    for cid_, deleted in conv_state:
        total_convs[cid_] = total_convs.get(cid_, 0) + 1
        if not deleted:
            active_convs[cid_] = active_convs.get(cid_, 0) + 1

    def _is_archived(cid_: int) -> bool:
        return total_convs.get(cid_, 0) > 0 and active_convs.get(cid_, 0) == 0

    clients = [c for c in clients if _is_archived(c.id) == archived]
    cids = [c.id for c in clients] or [-1]

    chats = {cid_: n for cid_, n in db.execute(
        select(Conversation.client_id, func.count(Conversation.id))
        .where(Conversation.client_id.in_(cids), Conversation.is_deleted.is_(archived))
        .group_by(Conversation.client_id)).all()}
    calls = _counts(AudioRecording)
    projects = _counts(Project)
    docs = _counts(FileRecord)

    convos = db.execute(
        select(Conversation.id, Conversation.client_id).where(Conversation.client_id.in_(cids), Conversation.is_deleted.is_(archived))
    ).all()
    conv_to_client = {cid_: clid for cid_, clid in convos}
    sent = _sentiment_by_client(db, conv_to_client)

    out = []
    for c in clients:
        out.append({
            "id": c.id, "name": c.name, "company": c.company, "status": c.status,
            "email": c.email, "phone": c.phone,
            "channels": [{"id": ch.id, "name": ch.name, "platform": ch.platform.value} for ch in c.channels],
            "owner": c.assignees[0].name if c.assignees else None,
            "sentiment": _norm_sent(sent.get(c.id)),
            "since": c.created_at.isoformat() if c.created_at else None,
            "counts": {
                "chats": chats.get(c.id, 0), "calls": calls.get(c.id, 0),
                "projects": projects.get(c.id, 0), "docs": docs.get(c.id, 0),
            },
        })
    ttl_cache.set(cache_key, out, ttl=30)
    return out


@router.get("/reports/overview")
def reports_overview(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    clients = _accessible_clients(db, user)
    cids = [c.id for c in clients] or [-1]
    cname = {c.id: c.name for c in clients}
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)

    convos = db.execute(
        select(Conversation.id, Conversation.client_id, Conversation.created_at)
        .where(Conversation.client_id.in_(cids), Conversation.is_deleted.is_(False))
    ).all()
    conv_to_client = {cid_: clid for cid_, clid, _ in convos}
    conv_sent_rows = db.execute(
        select(AIAnalysis.target_id, AIAnalysis.sentiment)
        .where(AIAnalysis.target_type == AnalysisTarget.conversation,
               AIAnalysis.target_id.in_(list(conv_to_client) or [-1]))
        .order_by(AIAnalysis.created_at.asc())
    ).all()
    conv_sent = {cid_: _norm_sent(s) for cid_, s in conv_sent_rows}

    # Extract client sentiment from the already loaded conversation sentiments
    client_sent = {}
    for conv_id, sentiment in conv_sent_rows:
        if sentiment:
            client_sent[conv_to_client[conv_id]] = sentiment

    def _aware(dt):
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

    chats_week = sum(1 for _, _, ts in convos if ts and _aware(ts) >= week_ago)
    calls_week = db.execute(
        select(func.count(AudioRecording.id))
        .where(AudioRecording.client_id.in_(cids), AudioRecording.created_at >= week_ago)
    ).scalar_one()

    # avg response from analyses metrics
    secs = []
    for a in db.execute(select(AIAnalysis.response_metrics).where(AIAnalysis.response_metrics.isnot(None))).scalars().all():
        if isinstance(a, dict) and a.get("available") and a.get("avg_response_seconds"):
            secs.append(a["avg_response_seconds"])
    avg_resp = round(sum(secs) / len(secs)) if secs else None

    # weekly volume by sentiment (last 5 weeks)
    weeks = []
    for w in range(4, -1, -1):
        start = now - timedelta(days=now.weekday()) - timedelta(weeks=w)
        start = start.replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=7)
        tally = {"pos": 0, "neu": 0, "neg": 0}
        for cid_, _, ts in convos:
            if ts and start <= _aware(ts) < end:
                tally[conv_sent.get(cid_, "neu")] += 1
        weeks.append({"label": start.strftime("Wk %V"), **tally})

    # team productivity (activity per actor, joined with User)
    rows = db.execute(
        select(User.name, func.count(Activity.id))
        .join(User, Activity.actor_id == User.id)
        .group_by(User.name)
        .order_by(func.count(Activity.id).desc())
        .limit(6)
    ).all()
    team = [{"name": name, "actions": n} for name, n in rows]

    # client engagement
    chat_counts = dict(db.execute(
        select(Conversation.client_id, func.count(Conversation.id)).where(Conversation.client_id.in_(cids), Conversation.is_deleted.is_(False))
        .group_by(Conversation.client_id)).all())
    call_counts = dict(db.execute(
        select(AudioRecording.client_id, func.count(AudioRecording.id)).where(AudioRecording.client_id.in_(cids))
        .group_by(AudioRecording.client_id)).all())
    
    engagement = [{
        "client": cname.get(c.id, "—"), "company": c.company,
        "chats": chat_counts.get(c.id, 0), "calls": call_counts.get(c.id, 0),
        "sentiment": _norm_sent(client_sent.get(c.id)),
    } for c in clients]
    engagement.sort(key=lambda x: -x["chats"])

    return {
        "kpis": {"chats_week": chats_week, "calls_week": calls_week,
                 "avg_response_seconds": avg_resp, "analyzed": len(conv_sent)},
        "weeks": weeks, "team": team, "engagement": engagement,
    }


@router.get("/overview/documents")
def documents_overview(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    cache_key = f"documents:{user.id}"
    cached = ttl_cache.get(cache_key)
    if cached is not None:
        return cached
    clients = _accessible_clients(db, user)
    cids = [c.id for c in clients] or [-1]
    cname = {c.id: c.name for c in clients}
    uname = dict(db.execute(select(User.id, User.name)).all())
    from app.models.project import Project
    pname = {p.id: p.title for p in db.execute(select(Project.id, Project.title)).all()}
    
    rows = db.execute(
        select(FileRecord).where(FileRecord.client_id.in_(cids)).order_by(FileRecord.created_at.desc())
    ).scalars().all()
    
    # Query AI analyses for these documents
    from app.models.ai_analysis import AIAnalysis, AnalysisTarget
    fids = [f.id for f in rows] or [-1]
    analyses = db.execute(
        select(AIAnalysis).where(
            AIAnalysis.target_type == AnalysisTarget.document,
            AIAnalysis.target_id.in_(fids)
        )
    ).scalars().all()
    analysis_map = {a.target_id: {
        "id": a.id,
        "summary": a.summary,
        "key_points": a.key_points,
        "pending_actions": a.pending_actions,
        "follow_ups": a.follow_ups,
        "sentiment": a.sentiment,
        "sentiment_score": a.sentiment_score,
        "model": a.model,
    } for a in analyses}
    
    result = [{
        "id": f.id, "filename": f.filename, "content_type": f.content_type, "size": f.size,
        "client": cname.get(f.client_id, "—"), "client_id": f.client_id,
        "project_id": f.project_id, "project_title": pname.get(f.project_id, "—"),
        "by": uname.get(f.uploaded_by, "—"),
        "created_at": f.created_at.isoformat() if f.created_at else None,
        "analysis": analysis_map.get(f.id),
    } for f in rows]
    ttl_cache.set(cache_key, result, ttl=30)
    return result


@router.get("/overview/calls")
def calls_overview(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    cache_key = f"calls:{user.id}"
    cached = ttl_cache.get(cache_key)
    if cached is not None:
        return cached
    clients = _accessible_clients(db, user)
    cids = [c.id for c in clients] or [-1]
    cname = {c.id: c.name for c in clients}
    uname = dict(db.execute(select(User.id, User.name)).all())
    from app.models.project import Project
    pname = {p.id: p.title for p in db.execute(select(Project.id, Project.title)).all()}
    
    rows = db.execute(
        select(AudioRecording).where(AudioRecording.client_id.in_(cids))
        .order_by(AudioRecording.created_at.desc())
    ).scalars().all()
    # latest analysis per audio
    analyses = {}
    if rows:
        for a in db.execute(
            select(AIAnalysis).where(AIAnalysis.target_type == AnalysisTarget.audio,
                                     AIAnalysis.target_id.in_([r.id for r in rows]))
            .order_by(AIAnalysis.created_at.asc())
        ).scalars().all():
            analyses[a.target_id] = a
    out = []
    for r in rows:
        a = analyses.get(r.id)
        out.append({
            "id": r.id, "filename": r.filename, "duration": r.duration,
            "client": cname.get(r.client_id, "—"), "client_id": r.client_id,
            "project_id": r.project_id, "project_title": pname.get(r.project_id, "—"),
            "by": uname.get(r.uploaded_by, "—"),
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "analysis": None if not a else {
                "summary": a.summary, "key_points": a.key_points, "pending_actions": a.pending_actions,
                "sentiment": _norm_sent(a.sentiment), "behavioral_assessment": a.behavioral_assessment,
            },
        })
    ttl_cache.set(cache_key, out, ttl=30)
    return out
