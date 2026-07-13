import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, Request
from fastapi.responses import RedirectResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.cache import invalidate_cache
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
def list_files(
    client_id: int,
    archived: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_client_access(user, _client(db, client_id))
    from app.models.project import Project
    stmt = (
        select(FileRecord, Project.title.label("project_title"))
        .outerjoin(Project, FileRecord.project_id == Project.id)
        .where(FileRecord.client_id == client_id)
        # Archived items only surface in the Archive view.
        .where(FileRecord.archived_at.isnot(None) if archived else FileRecord.archived_at.is_(None))
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
    # Overviews are TTL-cached per user; without this a new document stays
    # invisible for up to 30s and its folder won't rise to the top.
    invalidate_cache("documents:", "dashboard:")
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
    invalidate_cache("documents:", "dashboard:")
    return rec


@router.get("/{file_id}/download")
def download_file(file_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rec = db.get(FileRecord, file_id)
    if not rec:
        raise HTTPException(status_code=404, detail="File not found")
    ensure_client_access(user, _client(db, rec.client_id))
    # A "url" record is an external link, not an uploaded file — send the browser there.
    if rec.content_type == "url":
        return RedirectResponse(rec.storage_key)
    try:
        data = storage_service.read_bytes(rec.storage_key)
    except storage_service.StoredFileMissing:
        raise HTTPException(
            status_code=404,
            detail="This file is no longer available on the server.",
        )
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


@router.post("/{file_id}/archive", status_code=204)
def archive_file(file_id: int, db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    """Soft-delete: move the file to the Archive. Reversible via /restore."""
    rec = db.get(FileRecord, file_id)
    if not rec:
        raise HTTPException(status_code=404, detail="File not found")
    ensure_client_access(actor, _client(db, rec.client_id))
    ensure_can_write(actor)
    rec.archived_at = datetime.now(timezone.utc)
    db.commit()
    invalidate_cache("documents:", "dashboard:")


@router.post("/{file_id}/restore", status_code=204)
def restore_file(file_id: int, db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    """Move an archived file back to the active list."""
    rec = db.get(FileRecord, file_id)
    if not rec:
        raise HTTPException(status_code=404, detail="File not found")
    ensure_client_access(actor, _client(db, rec.client_id))
    ensure_can_write(actor)
    rec.archived_at = None
    db.commit()
    invalidate_cache("documents:", "dashboard:")


@router.delete("/{file_id}", status_code=204)
def delete_file(file_id: int, db: Session = Depends(get_db), actor: User = Depends(get_current_user)):
    """Permanent delete: removes the DB row and the file on disk."""
    rec = db.get(FileRecord, file_id)
    if not rec:
        raise HTTPException(status_code=404, detail="File not found")
    ensure_client_access(actor, _client(db, rec.client_id))
    ensure_can_write(actor)
    # Remove the bytes too (not for external links, which have no local file).
    if rec.content_type != "url":
        try:
            import os
            path = storage_service.local_path(rec.storage_key)
            if path and os.path.exists(path):
                os.remove(path)
        except OSError:
            pass  # missing/locked file must not block deleting the row
    db.delete(rec)
    db.commit()
    invalidate_cache("documents:", "dashboard:")


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
        try:
            file_bytes = storage_service.read_bytes(rec.storage_key)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="File not found in storage. Please upload the file again.")
        from app.services.document_parser_service import extract_text
        text = extract_text(file_bytes, rec.filename, rec.content_type)
        
    if not text or not text.strip():
        raise HTTPException(status_code=400, detail="Could not extract any text from this file/link for analysis.")
        
    # 2. Run OpenAI analysis. This is a document, not a conversation — using the
    # conversation prompt made the model describe a spec as if it were a chat.
    from app.services import ai_service
    from app.models.project import Project

    project = db.get(Project, rec.project_id) if rec.project_id else None
    try:
        analysis_dict = ai_service.analyze_document(text, context={
            "Client": client.name if client else None,
            "Project": project.title if project else None,
            "Document": rec.filename,
            "Type": "web link" if rec.content_type == "url" else (rec.content_type or "file"),
        })
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    
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
    invalidate_cache("documents:", "dashboard:")   # the overview embeds this analysis
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
