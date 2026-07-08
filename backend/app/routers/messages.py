from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.audio import AudioRecording
from app.models.client import Client
from app.models.file import FileRecord
from app.models.message import Message
from app.models.user import User
from app.rbac import ensure_can_write, ensure_client_access
from app.schemas.message import MessageCreate, MessageOut
from app.services import chat_service, storage_service
from app.services.activity_service import log_activity

_AUDIO_EXTS = {
    ".mp3", ".wav", ".m4a", ".ogg", ".oga", ".webm", ".aac", ".flac",
    ".mp4", ".m4v", ".mov", ".avi", ".mkv"
}

router = APIRouter(prefix="/api/clients", tags=["messages"])


def _client(db: Session, client_id: int) -> Client:
    client = db.get(Client, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


@router.get("/{client_id}/messages", response_model=list[MessageOut])
def list_messages(client_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    client = _client(db, client_id)
    ensure_client_access(user, client)
    messages = chat_service.list_client_messages(db, client)
    db.commit()  # persist any lazy backfill
    
    # Load all FileRecords and AudioRecordings to merge them into the message feed
    from app.models.file import FileRecord
    from app.models.audio import AudioRecording
    from app.models.user import User
    
    uname = dict(db.execute(select(User.id, User.name)).all())
    
    files = db.execute(
        select(FileRecord).where(FileRecord.client_id == client_id)
    ).scalars().all()
    
    audios = db.execute(
        select(AudioRecording).where(AudioRecording.client_id == client_id)
    ).scalars().all()
    
    existing_urls = {m.attachment_url for m in messages if m.attachment_url}
    
    merged = list(messages)
    
    for f in files:
        url = f.storage_key if f.content_type == "url" else f"/api/files/{f.id}/download"
        if url not in existing_urls:
            sender = uname.get(f.uploaded_by, "Team Member")
            merged.append({
                "id": -f.id,
                "client_id": f.client_id,
                "conversation_id": None,
                "channel_id": None,
                "sender_name": sender,
                "body": "",
                "is_client": False,
                "attachment_type": "file",
                "attachment_url": url,
                "attachment_name": f.filename,
                "sent_at": f.created_at,
                "created_at": f.created_at,
            })
            
    for a in audios:
        url = f"/api/audio/{a.id}/download"
        if url not in existing_urls:
            sender = uname.get(a.uploaded_by, "Team Member")
            
            # Check if this audio recording is actually a video based on extension
            ext = a.filename.lower()
            is_video = any(ext.endswith(v_ext) for v_ext in [".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"])
            
            merged.append({
                "id": -100000 - a.id,
                "client_id": a.client_id,
                "conversation_id": None,
                "channel_id": None,
                "sender_name": sender,
                "body": "",
                "is_client": False,
                "attachment_type": "audio" if not is_video else "audio",  # Keep audio type for conversations UI mapping but JS checks extension
                "attachment_url": url,
                "attachment_name": a.filename,
                "sent_at": a.created_at,
                "created_at": a.created_at,
            })
            
    # Sort merged list chronologically
    merged.sort(key=lambda m: (
        (m.sent_at or m.created_at) if isinstance(m, Message) else (m.get('sent_at') or m.get('created_at'))
    ))
    
    return merged


@router.post("/{client_id}/messages", response_model=MessageOut, status_code=201)
def send_message(
    client_id: int,
    payload: MessageCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    client = _client(db, client_id)
    ensure_client_access(actor, client)
    ensure_can_write(actor)
    if not payload.body.strip():
        raise HTTPException(status_code=400, detail="Message body is required")
    channel_id = payload.channel_id
    if channel_id is None and client.channels:
        channel_id = client.channels[0].id
    msg = Message(
        client_id=client.id,
        channel_id=channel_id,
        sender_name=actor.name,
        body=payload.body.strip(),
        is_client=False,
        sent_at=datetime.now(timezone.utc),
        created_by=actor.id,
    )
    db.add(msg)
    
    # Auto-parse shared document links from message text
    import re
    from urllib.parse import urlparse
    import os
    from app.models.file import FileRecord
    from app.models.project import Project
    
    urls = re.findall(r'(https?://\S+)', payload.body)
    for url in urls:
        url_clean = url.strip().rstrip(".,;:")
        is_doc_link = False
        filename = "Shared Link"
        
        if "docs.google.com" in url_clean:
            is_doc_link = True
            if "/document/" in url_clean:
                filename = "Shared Google Doc"
            elif "/spreadsheets/" in url_clean:
                filename = "Shared Google Sheet"
            elif "/presentation/" in url_clean:
                filename = "Shared Google Slide"
            else:
                filename = "Shared Google Drive Link"
        else:
            path_lower = url_clean.lower()
            doc_exts = [".pdf", ".docx", ".doc", ".xlsx", ".xls", ".csv", ".txt", ".pptx", ".ppt", ".png", ".jpg", ".jpeg"]
            for ext in doc_exts:
                if path_lower.endswith(ext) or (ext + "?") in path_lower or (ext + "/") in path_lower:
                    is_doc_link = True
                    try:
                        parsed = urlparse(url_clean)
                        fname = os.path.basename(parsed.path)
                        if fname and any(fname.lower().endswith(e) for e in doc_exts):
                            filename = fname
                        else:
                            filename = f"Shared Document ({ext[1:].upper()})"
                    except Exception:
                        filename = f"Shared Document ({ext[1:].upper()})"
                    break
                    
        if is_doc_link:
            # Check if this link record already exists for this client
            exists = db.execute(
                select(FileRecord).where(
                    FileRecord.client_id == client.id,
                    FileRecord.storage_key == url_clean
                )
            ).scalars().first()
            if not exists:
                projects = db.execute(
                    select(Project).where(Project.client_id == client.id)
                ).scalars().all()
                project_id = projects[0].id if len(projects) == 1 else None
                
                rec = FileRecord(
                    client_id=client.id,
                    project_id=project_id,
                    filename=filename,
                    storage_key=url_clean,
                    content_type="url",
                    size=0,
                    uploaded_by=actor.id,
                )
                db.add(rec)
                db.flush()
                log_activity(db, action="file.uploaded", actor_id=actor.id, client_id=client.id,
                             detail={"filename": rec.filename, "is_link": True})
    
    log_activity(db, action="message.sent", actor_id=actor.id, client_id=client.id)
    db.commit()
    db.refresh(msg)
    return msg


@router.post("/{client_id}/messages/upload", response_model=MessageOut, status_code=201)
async def send_attachment(
    client_id: int,
    upload: UploadFile = File(...),
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    """Upload a file or audio in the chat. Stored in the client's folder, recorded
    as a File/Audio, and posted as a chat message with an attachment."""
    client = _client(db, client_id)
    ensure_client_access(actor, client)
    ensure_can_write(actor)
    data = await upload.read()
    filename = upload.filename or "attachment"
    ext = Path(filename).suffix.lower()
    is_audio = (upload.content_type or "").startswith("audio") or ext in _AUDIO_EXTS
    channel_id = client.channels[0].id if client.channels else None
    folder = storage_service.client_dir(client)

    # Auto-resolve project_id from client's linked projects
    from app.models.project import Project
    projects = db.execute(
        select(Project).where(Project.client_id == client.id)
    ).scalars().all()
    project_id = None
    project_folder_name = None
    if len(projects) == 1:
        project_id = projects[0].id
        import re
        project_folder_name = re.sub(r"[^a-zA-Z0-9 _-]+", "", projects[0].title).strip() or "project"

    if is_audio:
        prefix = f"{folder}/projects/{project_folder_name}" if project_id else f"{folder}/audio"
        key = storage_service.save_bytes(data, filename, prefix=prefix)
        rec = AudioRecording(client_id=client.id, project_id=project_id, filename=filename, storage_key=key,
                             content_type=upload.content_type, uploaded_by=actor.id)
        db.add(rec); db.flush()
        attach_type, attach_url = "audio", f"/api/audio/{rec.id}/download"
        log_activity(db, action="audio.uploaded", actor_id=actor.id, client_id=client.id, detail={"filename": filename})
    else:
        prefix = f"{folder}/projects/{project_folder_name}" if project_id else f"{folder}/documents"
        key = storage_service.save_bytes(data, filename, prefix=prefix)
        rec = FileRecord(client_id=client.id, project_id=project_id, filename=filename, storage_key=key,
                          content_type=upload.content_type, size=len(data), uploaded_by=actor.id)
        db.add(rec); db.flush()
        attach_type, attach_url = "file", f"/api/files/{rec.id}/download"
        log_activity(db, action="file.uploaded", actor_id=actor.id, client_id=client.id, detail={"filename": filename})

    msg = Message(
        client_id=client.id, channel_id=channel_id, sender_name=actor.name,
        body="", is_client=False, sent_at=datetime.now(timezone.utc), created_by=actor.id,
        attachment_type=attach_type, attachment_url=attach_url, attachment_name=filename,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg
