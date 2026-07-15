"""Aggregate read endpoints for the Dashboard and Clients views.

Everything is role-scoped: admins+ see all clients, team leads / employees only
their assigned clients.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import and_, func, or_, select
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
from app.models.message import Message
from app.models.project import Project, ProjectTask
from app.models.read_state import ClientRead
from app.models.user import User, UserRole
from app.rbac import has_min_role, require_permission

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


def _accessible_client_meta(db: Session, user: User):
    """Lightweight (id, name, company) rows for the accessible clients — a single
    column query with NO relationship (assignees/channels) selectin loads. Use
    this for aggregate pages that only need ids/names, to save round-trips on the
    remote database."""
    stmt = select(Client.id, Client.name, Client.company)
    if not has_min_role(user, UserRole.admin):
        stmt = stmt.join(Client.assignees).where(User.id == user.id)
    return db.execute(stmt.order_by(Client.name)).all()


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
def dashboard_overview(db: Session = Depends(get_db), user: User = Depends(require_permission("dashboard.view"))):
    cache_key = f"dashboard:{user.id}"
    cached = ttl_cache.get(cache_key)
    if cached is not None:
        return cached
    clients = _accessible_client_meta(db, user)
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
    # Count all projects, and pull only the top-6 columns for display — avoids
    # loading every Project entity (which selectin-loads all their tasks +
    # members: 2 extra round-trips the dashboard never uses).
    projects_total = db.execute(
        select(func.count(Project.id)).where(Project.client_id.in_(cids))
    ).scalar_one()
    project_rows = db.execute(
        select(Project.id, Project.bitrix_project_id, Project.title, Project.client_id,
               Project.status, Project.due_date)
        .where(Project.client_id.in_(cids)).order_by(Project.created_at.desc()).limit(6)
    ).all()

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
        key = (plat or "other")
        vol[key] = vol.get(key, 0) + 1

    # attention: negative first, then most recent
    attention = []
    for c in convos:
        s = conv_sent.get(c.id, "neu")
        plat = conv_platform.get(c.id)
        attention.append({
            "id": c.id, "client_id": c.client_id, "client": cname.get(c.client_id, "—"),
            "title": c.title or "Untitled",
            "platform": (plat or "other"),
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
        pids = [p.id for p in project_rows]
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
    for p in project_rows:
        total, done = task_counts.get(p.id, (0, 0))
        progress = round(done / total * 100) if total else 0
        projects.append({
            "id": p.id, "bitrix_id": p.bitrix_project_id, "title": p.title,
            "client": cname.get(p.client_id, "—"), "status": p.status or "—",
            "progress": progress, "tasks": f"{done} / {total}",
            "due": p.due_date.isoformat() if p.due_date else None,
        })

    # Drill-down for the sentiment panel. Built from `conv_sent`, the same map the
    # tally is counted from, so each bucket matches its headline number exactly.
    # No extra queries: every value here is already in memory.
    sentiment_conversations: dict[str, list[dict]] = {"pos": [], "neu": [], "neg": []}
    for c in convos:
        s = conv_sent.get(c.id)
        if s is None:
            continue  # never analyzed -> not counted in the tally either
        plat = conv_platform.get(c.id)
        sentiment_conversations[s].append({
            "id": c.id,
            "client_id": c.client_id,
            "client": cname.get(c.client_id, "—"),
            "title": c.title or "Untitled",
            "platform": (plat or "other"),
            "time": c.created_at.isoformat() if c.created_at else None,
        })

    result = {
        "kpis": {
            "clients": len(clients),
            "conversations": len(convos),
            "calls": audio_count,
            "projects": projects_total,
            "at_risk": at_risk,
        },
        "sentiment": tally,
        "sentiment_conversations": sentiment_conversations,
        "channel_volume": [{"platform": k, "count": v} for k, v in sorted(vol.items(), key=lambda x: -x[1])],
        "attention": attention,
        "recent_activity": recent,
        "projects_in_flight": projects,
    }
    ttl_cache.set(cache_key, result, ttl=30)
    return result


@router.get("/overview/clients")
def clients_overview(archived: bool = False, db: Session = Depends(get_db), user: User = Depends(require_permission("clients.view"))):
    cache_key = f"clients:{user.id}:{archived}"
    cached = ttl_cache.get(cache_key)
    if cached is not None:
        return cached
    from sqlalchemy import literal, union_all
    clients = _accessible_clients(db, user)
    cids = [c.id for c in clients] or [-1]

    # Archived is a first-class property of the client, so it works even for
    # clients that have no conversations at all.
    clients = [c for c in clients if (c.archived_at is not None) == archived]
    cids = set(c.id for c in clients)

    # Single pass over the visible clients' conversations: drives the per-client
    # chat count AND the sentiment lookup in one round-trip.
    conv_rows = db.execute(
        select(Conversation.id, Conversation.client_id, Conversation.is_deleted)
        .where(Conversation.client_id.in_(list(cids) or [-1]))
    ).all()
    chats: dict[int, int] = {}
    conv_to_client: dict[int, int] = {}
    for conv_id, clid, deleted in conv_rows:
        if deleted:
            continue
        chats[clid] = chats.get(clid, 0) + 1
        conv_to_client[clid] = conv_id

    # calls + projects + docs counts in a single UNION round-trip.
    id_list = list(cids) or [-1]
    counts_q = union_all(
        select(literal("calls").label("kind"), AudioRecording.client_id.label("cid"),
               func.count(AudioRecording.id).label("n"))
            .where(AudioRecording.client_id.in_(id_list)).group_by(AudioRecording.client_id),
        select(literal("projects"), Project.client_id, func.count(Project.id))
            .where(Project.client_id.in_(id_list)).group_by(Project.client_id),
        select(literal("docs"), FileRecord.client_id, func.count(FileRecord.id))
            .where(FileRecord.client_id.in_(id_list)).group_by(FileRecord.client_id),
    )
    calls: dict[int, int] = {}
    projects: dict[int, int] = {}
    docs: dict[int, int] = {}
    bucket = {"calls": calls, "projects": projects, "docs": docs}
    for kind, clid, n in db.execute(counts_q).all():
        bucket[kind][clid] = n

    sent = _sentiment_by_client(db, conv_to_client)

    def _aware(dt):
        if dt is None:
            return None
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

    # Last activity (for ordering) + per-user unread count, computed as ONE grouped
    # aggregate on the database (≈one row per client) instead of pulling every
    # message into Python. The old approach transferred the whole message table
    # each request and got slower as chats accumulated (14k+ rows); this stays flat.
    ts_col = func.coalesce(Message.sent_at, Message.created_at)
    lr = (
        select(ClientRead.client_id, ClientRead.last_read_at)
        .where(ClientRead.user_id == user.id)
        .subquery()
    )
    agg_rows = db.execute(
        select(
            Message.client_id,
            func.max(ts_col).label("last_ts"),
            # Unread = messages from someone else (incl. system, never the viewer),
            # newer than the last time the viewer opened the thread.
            func.count().filter(
                and_(
                    Message.created_by.is_distinct_from(user.id),
                    or_(lr.c.last_read_at.is_(None), ts_col > lr.c.last_read_at),
                )
            ).label("unread"),
        )
        .select_from(Message)
        .join(Client, Client.id == Message.client_id)
        .outerjoin(lr, lr.c.client_id == Message.client_id)
        .where(
            Message.client_id.in_(list(cids) or [-1]),
            Message.is_deleted.is_(False),
            # "Clear chat" excludes anything at/before the marker from activity/unread.
            or_(Client.chat_cleared_at.is_(None), ts_col > Client.chat_cleared_at),
        )
        .group_by(Message.client_id)
    ).all()

    last_activity: dict[int, datetime] = {}
    unread_count: dict[int, int] = {}
    for clid, last_ts, unread in agg_rows:
        last_activity[clid] = _aware(last_ts)
        if unread:
            unread_count[clid] = int(unread)

    rows = []
    for c in clients:
        la = last_activity.get(c.id)
        ca = _aware(c.created_at)
        rows.append((la, ca, {
            "id": c.id, "name": c.name, "company": c.company, "status": c.status,
            "email": c.email, "phone": c.phone,
            "channels": [{"id": ch.id, "name": ch.name, "platform": ch.platform} for ch in c.channels],
            "owner": c.assignees[0].name if c.assignees else None,
            "sentiment": _norm_sent(sent.get(c.id)),
            "since": c.created_at.isoformat() if c.created_at else None,
            "last_activity": la.isoformat() if la else None,
            "unread_count": unread_count.get(c.id, 0),
            "counts": {
                "chats": chats.get(c.id, 0), "calls": calls.get(c.id, 0),
                "projects": projects.get(c.id, 0), "docs": docs.get(c.id, 0),
            },
        }))
    # Order by recency, newest first. A client's recency is its last message
    # activity, or — when it has no messages yet (e.g. a just-created client) —
    # its creation time. This keeps WhatsApp-style ordering for active chats
    # while surfacing brand-new clients at the top instead of sinking them to
    # the bottom. (Messages can only post-date creation, so last_activity, when
    # present, is always >= created_at.)
    _EPOCH = datetime.min.replace(tzinfo=timezone.utc)
    rows.sort(key=lambda r: r[0] or r[1] or _EPOCH, reverse=True)
    out = [r[2] for r in rows]
    # Short TTL: this list drives WhatsApp-style live ordering + unread badges, so
    # it must stay fresh. API-driven sends bust the cache immediately; this bound
    # keeps inbound messages that arrive via other paths (e.g. Bitrix sync) from
    # lagging more than a few seconds behind the client's poll.
    ttl_cache.set(cache_key, out, ttl=5)
    return out


@router.get("/reports/overview")
def reports_overview(db: Session = Depends(get_db), user: User = Depends(require_permission("reports.view"))):
    cache_key = f"reports:{user.id}"
    cached = ttl_cache.get(cache_key)
    if cached is not None:
        return cached
    clients = _accessible_client_meta(db, user)
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

    res = {
        "kpis": {"chats_week": chats_week, "calls_week": calls_week,
                 "avg_response_seconds": avg_resp, "analyzed": len(conv_sent)},
        "weeks": weeks, "team": team, "engagement": engagement,
    }
    ttl_cache.set(cache_key, res, ttl=30)
    return res


@router.get("/overview/documents")
def documents_overview(db: Session = Depends(get_db), user: User = Depends(require_permission("documents.view"))):

    cache_key = f"documents:{user.id}"
    cached = ttl_cache.get(cache_key)
    if cached is not None:
        return cached
    clients = _accessible_client_meta(db, user)
    cids = [c.id for c in clients] or [-1]
    cname = {c.id: c.name for c in clients}

    # One join pulls file rows + uploader name + project title (was 3 queries).
    rows = db.execute(
        select(FileRecord, User.name.label("by"), Project.title.label("proj"))
        .outerjoin(User, FileRecord.uploaded_by == User.id)
        .outerjoin(Project, FileRecord.project_id == Project.id)
        .where(FileRecord.client_id.in_(cids), FileRecord.archived_at.is_(None))
        .order_by(FileRecord.created_at.desc())
    ).all()

    from app.models.ai_analysis import AIAnalysis, AnalysisTarget
    fids = [r[0].id for r in rows] or [-1]
    analyses = db.execute(
        select(AIAnalysis).where(
            AIAnalysis.target_type == AnalysisTarget.document,
            AIAnalysis.target_id.in_(fids)
        )
    ).scalars().all()
    analysis_map = {a.target_id: {
        "id": a.id, "summary": a.summary, "key_points": a.key_points,
        "pending_actions": a.pending_actions, "follow_ups": a.follow_ups,
        "sentiment": a.sentiment, "sentiment_score": a.sentiment_score, "model": a.model,
    } for a in analyses}

    result = [{
        "id": f.id, "filename": f.filename, "content_type": f.content_type, "size": f.size,
        "client": cname.get(f.client_id, "—"), "client_id": f.client_id,
        "project_id": f.project_id, "project_title": proj or "—",
        "by": by or "—",
        "created_at": f.created_at.isoformat() if f.created_at else None,
        "analysis": analysis_map.get(f.id),
    } for f, by, proj in rows]
    ttl_cache.set(cache_key, result, ttl=30)
    return result


@router.get("/overview/calls")
def calls_overview(db: Session = Depends(get_db), user: User = Depends(require_permission("calls.view"))):

    cache_key = f"calls:{user.id}"
    cached = ttl_cache.get(cache_key)
    if cached is not None:
        return cached
    clients = _accessible_client_meta(db, user)
    cids = [c.id for c in clients] or [-1]
    cname = {c.id: c.name for c in clients}

    # One join pulls audio rows + uploader name + project title (was 3 queries).
    rows_j = db.execute(
        select(AudioRecording, User.name.label("by"), Project.title.label("proj"))
        .outerjoin(User, AudioRecording.uploaded_by == User.id)
        .outerjoin(Project, AudioRecording.project_id == Project.id)
        .where(AudioRecording.client_id.in_(cids), AudioRecording.archived_at.is_(None))
        .order_by(AudioRecording.created_at.desc())
    ).all()
    rows = [r[0] for r in rows_j]
    by_of = {r[0].id: r.by for r in rows_j}
    proj_of = {r[0].id: r.proj for r in rows_j}
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
            "project_id": r.project_id, "project_title": proj_of.get(r.id) or "—",
            "by": by_of.get(r.id) or "—",
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "analysis": None if not a else {
                "summary": a.summary, "key_points": a.key_points, "pending_actions": a.pending_actions,
                # follow_ups also carries the model's open questions — the UI renders it.
                "follow_ups": a.follow_ups,
                "sentiment": _norm_sent(a.sentiment), "behavioral_assessment": a.behavioral_assessment,
            },
        })
    ttl_cache.set(cache_key, out, ttl=30)
    return out
