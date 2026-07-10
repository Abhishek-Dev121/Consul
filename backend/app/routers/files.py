import io

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.client import Client
from app.models.file import FileRecord
from app.models.user import User
from app.rbac import ensure_can_write, ensure_client_access
from app.schemas.file import FileOut
from app.schemas.ai import AIAnalysisOut
from app.services import storage_service
from app.services.activity_service import log_activity

router = APIRouter(prefix="/api/files", tags=["files"])


@router.get("", response_model=list[FileOut])
def list_files(client_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    ensure_client_access(user, _client(db, client_id))
    from app.models.project import Project
    stmt = (
        select(FileRecord, Project.title.label("project_title"))
        .outerjoin(Project, FileRecord.project_id == Project.id)
        .where(FileRecord.client_id == client_id)
        .order_by(FileRecord.created_at.desc())
    )
    results = db.execute(stmt).all()
    out = []
    
    # Query AI analyses for these documents
    from app.models.ai_analysis import AIAnalysis, AnalysisTarget
    fids = [r[0].id for r in results] or [-1]
    analyses = db.execute(
        select(AIAnalysis).where(
            AIAnalysis.target_type == AnalysisTarget.document,
            AIAnalysis.target_id.in_(fids)
        )
    ).scalars().all()
    analysis_map = {a.target_id: a for a in analyses}
    
    for r in results:
        record = r[0]
        record.project_title = r.project_title
        record.analysis = analysis_map.get(record.id)
        out.append(record)
    return out


@router.post("", response_model=FileOut, status_code=201)
async def upload_file(
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
    prefix = f"{c_dir}/documents"
    if project_id:
        proj = db.get(Project, project_id)
        if proj:
            import re
            clean_title = re.sub(r"[^a-zA-Z0-9 _-]+", "", proj.title).strip() or "project"
            prefix = f"{c_dir}/projects/{clean_title}"

    data = await upload.read()
    key = storage_service.save_bytes(data, upload.filename or "file", prefix=prefix)
    
    rec = FileRecord(
        client_id=client_id,
        project_id=project_id,
        filename=upload.filename or "file",
        storage_key=key,
        content_type=upload.content_type,
        size=len(data),
        uploaded_by=actor.id,
    )
    db.add(rec)
    db.flush()
    log_activity(db, action="file.uploaded", actor_id=actor.id, client_id=client_id,
                 detail={"filename": rec.filename})
    db.commit()
    db.refresh(rec)
    return rec


@router.post("/link", response_model=FileOut, status_code=201)
def add_document_link(
    client_id: int = Form(...),
    project_id: int | None = Form(None),
    url: str = Form(...),
    title: str = Form(...),
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

    url = url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Invalid link URL. Must start with http:// or https://")
        
    rec = FileRecord(
        client_id=client_id,
        project_id=project_id,
        filename=title.strip() or "Online Document",
        storage_key=url,
        content_type="url",
        size=0,
        uploaded_by=actor.id,
    )
    db.add(rec)
    db.flush()
    log_activity(db, action="file.uploaded", actor_id=actor.id, client_id=client_id,
                 detail={"filename": rec.filename, "is_link": True})
    db.commit()
    db.refresh(rec)
    return rec


@router.get("/{file_id}/download")
def download_file(file_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rec = db.get(FileRecord, file_id)
    if not rec:
        raise HTTPException(status_code=404, detail="File not found")
    ensure_client_access(user, _client(db, rec.client_id))
    data = storage_service.read_bytes(rec.storage_key)
    ctype = storage_service.guess_content_type(rec.filename, rec.content_type)
    # Preview inline for media/pdf/text (by resolved MIME or extension), else download.
    ext = rec.filename.lower()
    is_inline = ctype.startswith(("image/", "video/", "audio/")) or ctype in ("application/pdf", "text/plain") \
        or any(ext.endswith(e) for e in [
            ".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv",
            ".mp3", ".wav", ".m4a", ".ogg",
            ".png", ".jpg", ".jpeg", ".gif", ".webp",
            ".pdf", ".txt"
        ])
    return storage_service.range_response(request, data, ctype, rec.filename, inline=is_inline)


@router.delete("/{file_id}", status_code=204)
def delete_file(file_id: int, db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    rec = db.get(FileRecord, file_id)
    if not rec:
        raise HTTPException(status_code=404, detail="File not found")
    ensure_client_access(actor, _client(db, rec.client_id))
    ensure_can_write(actor)
    db.delete(rec)
    db.commit()


def _client(db: Session, client_id: int) -> Client:
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


@router.post("/{file_id}/analyze", response_model=AIAnalysisOut)
def analyze_file(
    file_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    rec = db.get(FileRecord, file_id)
    if not rec:
        raise HTTPException(status_code=404, detail="File not found")
        
    client = db.get(Client, rec.client_id)
    ensure_client_access(actor, client)
    ensure_can_write(actor)
    
    # 1. Extract text
    if rec.content_type == "url":
        from app.services.document_parser_service import extract_url_text
        text = extract_url_text(rec.storage_key)
    else:
        file_bytes = storage_service.read_bytes(rec.storage_key)
        from app.services.document_parser_service import extract_text
        text = extract_text(file_bytes, rec.filename, rec.content_type)
        
    if not text or not text.strip():
        raise HTTPException(status_code=400, detail="Could not extract any text from this file/link for analysis.")
        
    # 2. Run OpenAI analysis
    from app.services import ai_service
    analysis_dict = ai_service.analyze_conversation(text)
    
    # 3. Create or update AIAnalysis record
    from app.models.ai_analysis import AIAnalysis, AnalysisTarget
    analysis = db.execute(
        select(AIAnalysis).where(
            AIAnalysis.target_type == AnalysisTarget.document,
            AIAnalysis.target_id == file_id
        )
    ).scalar_one_or_none()
    
    if not analysis:
        analysis = AIAnalysis(
            target_type=AnalysisTarget.document,
            target_id=file_id
        )
        db.add(analysis)
        
    analysis.summary = analysis_dict.get("summary")
    analysis.key_points = analysis_dict.get("key_points") or []
    analysis.pending_actions = analysis_dict.get("pending_actions") or []
    analysis.follow_ups = analysis_dict.get("follow_ups") or []
    analysis.sentiment = analysis_dict.get("sentiment")
    analysis.sentiment_score = analysis_dict.get("sentiment_score")
    analysis.model = analysis_dict.get("model")
    analysis.transcript = text[:5000] # preview
    
    db.flush()
    log_activity(db, action="document.analyzed", actor_id=actor.id, client_id=rec.client_id,
                 detail={"filename": rec.filename})
    db.commit()
    db.refresh(analysis)
    return analysis


@router.get("/{file_id}/analysis", response_model=AIAnalysisOut)
def get_file_analysis(
    file_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    rec = db.get(FileRecord, file_id)
    if not rec:
        raise HTTPException(status_code=404, detail="File not found")
    ensure_client_access(actor, db.get(Client, rec.client_id))
    
    from app.models.ai_analysis import AIAnalysis, AnalysisTarget
    analysis = db.execute(
        select(AIAnalysis).where(
            AIAnalysis.target_type == AnalysisTarget.document,
            AIAnalysis.target_id == file_id
        )
    ).scalar_one_or_none()
    
    if not analysis:
        raise HTTPException(status_code=404, detail="No analysis found for this file.")
    return analysis
