import io

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.ai_analysis import AIAnalysis, AnalysisTarget
from app.models.audio import AudioRecording
from app.models.client import Client
from app.models.user import User
from app.rbac import ensure_can_write, ensure_client_access
from app.schemas.ai import AIAnalysisOut
from app.schemas.file import AudioOut
from app.services import ai_service, deepgram_service, storage_service
from app.services.activity_service import log_activity

router = APIRouter(prefix="/api/audio", tags=["audio"])


@router.get("", response_model=list[AudioOut])
def list_audio(client_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ensure_client_access(user, _client(db, client_id))
    from app.models.project import Project
    stmt = (
        select(AudioRecording, Project.title.label("project_title"))
        .outerjoin(Project, AudioRecording.project_id == Project.id)
        .where(AudioRecording.client_id == client_id)
        .order_by(AudioRecording.created_at.desc())
    )
    results = db.execute(stmt).all()
    out = []
    for r in results:
        record = r[0]
        record.project_title = r.project_title
        out.append(record)
    return out


@router.post("", response_model=AudioOut, status_code=201)
async def upload_audio(
    client_id: int = Form(...),
    project_id: int | None = Form(None),
    upload: UploadFile = File(...),
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    client = _client(db, client_id)
    ensure_client_access(actor, client)
    ensure_can_write(actor)
    
    from app.models.project import Project
    if project_id is None:
        projects = db.execute(
            select(Project).where(Project.client_id == client_id)
        ).scalars().all()
        if len(projects) == 1:
            project_id = projects[0].id

    # Resolve folder path
    c_dir = storage_service.client_dir(client)
    prefix = f"{c_dir}/audio"
    if project_id:
        proj = db.get(Project, project_id)
        if proj:
            import re
            clean_title = re.sub(r"[^a-zA-Z0-9 _-]+", "", proj.title).strip() or "project"
            prefix = f"{c_dir}/projects/{clean_title}"

    data = await upload.read()
    key = storage_service.save_bytes(data, upload.filename or "audio", prefix=prefix)
    
    rec = AudioRecording(
        client_id=client_id,
        project_id=project_id,
        filename=upload.filename or "audio",
        storage_key=key,
        content_type=upload.content_type,
        uploaded_by=actor.id,
    )
    db.add(rec)
    db.flush()
    log_activity(db, action="audio.uploaded", actor_id=actor.id, client_id=client_id,
                 detail={"filename": rec.filename})
    db.commit()
    db.refresh(rec)
    return rec


@router.get("/{audio_id}/download")
def download_audio(audio_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rec = db.get(AudioRecording, audio_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Audio not found")
    ensure_client_access(user, _client(db, rec.client_id))
    data = storage_service.read_bytes(rec.storage_key)
    return StreamingResponse(
        io.BytesIO(data),
        media_type=rec.content_type or "audio/mpeg",
        headers={"Content-Disposition": f'inline; filename="{rec.filename}"'},
    )


@router.post("/{audio_id}/analyze", response_model=AIAnalysisOut)
def analyze_audio(audio_id: int, db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    rec = db.get(AudioRecording, audio_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Audio not found")
    ensure_client_access(actor, _client(db, rec.client_id))
    ensure_can_write(actor)

    audio_bytes = storage_service.read_bytes(rec.storage_key)
    try:
        tr = deepgram_service.transcribe(audio_bytes, rec.content_type)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    if tr.get("duration") is not None:
        rec.duration = tr["duration"]

    transcript = tr.get("transcript", "")
    try:
        analysis = ai_service.analyze_transcript(transcript) if transcript else {}
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    row = AIAnalysis(
        target_type=AnalysisTarget.audio,
        target_id=rec.id,
        transcript=transcript,
        summary=analysis.get("summary"),
        key_points=analysis.get("key_points", []),
        pending_actions=analysis.get("pending_actions", []),
        follow_ups=analysis.get("follow_ups", []),
        sentiment=analysis.get("sentiment"),
        sentiment_score=analysis.get("sentiment_score"),
        behavioral_assessment=analysis.get("behavioral_assessment"),
        model=analysis.get("model"),
    )
    db.add(row)
    log_activity(db, action="audio.analyzed", actor_id=actor.id, client_id=rec.client_id,
                 detail={"audio_id": rec.id})
    db.commit()
    db.refresh(row)
    return row


@router.get("/{audio_id}/analysis", response_model=AIAnalysisOut | None)
def latest_audio_analysis(audio_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rec = db.get(AudioRecording, audio_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Audio not found")
    ensure_client_access(user, _client(db, rec.client_id))
    return db.execute(
        select(AIAnalysis).where(
            AIAnalysis.target_type == AnalysisTarget.audio, AIAnalysis.target_id == audio_id
        ).order_by(AIAnalysis.created_at.desc()).limit(1)
    ).scalar_one_or_none()


def _client(db: Session, client_id: int) -> Client:
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client
