from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.audio import AudioRecording
from app.models.client import Client
from app.models.conversation import Conversation
from app.models.file import FileRecord
from app.models.message import Message
from app.models.user import User
from app.rbac import ensure_can_write, ensure_client_access
from app.schemas.message import MessageCreate, MessageEdit, MessageOut
from app.services import chat_service, storage_service
from app.services.activity_service import log_activity

# WhatsApp-style: a sender can edit/delete their own message within this window.
EDIT_DELETE_WINDOW = timedelta(hours=24)

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


def _ensure_conversation(db: Session, client: Client, channel_id: int | None) -> Conversation:
    """Live-typed messages aren't tied to a pasted chat log, but AI analysis is
    keyed to a Conversation row. Reuse the client's existing one, or create a
    lightweight placeholder so analysis has something to attach to."""
    conv = db.execute(
        select(Conversation)
        .where(Conversation.client_id == client.id, Conversation.is_deleted.is_(False))
        .order_by(Conversation.created_at.asc())
    ).scalars().first()
    if conv:
        return conv
    conv = Conversation(client_id=client.id, channel_id=channel_id, title="Live chat", raw_content="")
    db.add(conv)
    db.flush()
    return conv


@router.get("/{client_id}/messages", response_model=list[MessageOut])
def list_messages(client_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    client = _client(db, client_id)
    ensure_client_access(user, client)
    messages = chat_service.list_client_messages(db, client)
    db.commit()  # persist any lazy backfill

    # "Delete for me" — drop messages this user has hidden from their own view.
    from app.models.read_state import MessageHidden
    hidden_ids = set(db.execute(
        select(MessageHidden.message_id).where(MessageHidden.user_id == user.id)
    ).scalars().all())
    if hidden_ids:
        messages = [m for m in messages if m.id not in hidden_ids]
    
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
                "created_by": f.uploaded_by,
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
                "created_by": a.uploaded_by,
            })
            
    # Sort merged list chronologically
    merged.sort(key=lambda m: (
        (m.sent_at or m.created_at) if isinstance(m, Message) else (m.get('sent_at') or m.get('created_at'))
    ))

    # WhatsApp-style read receipts: an outgoing (team) message is "read" once a
    # DIFFERENT teammate has opened this thread at/after the message was sent.
    from app.models.read_state import ClientRead
    reads = db.execute(
        select(ClientRead.user_id, ClientRead.last_read_at).where(ClientRead.client_id == client_id)
    ).all()

    def _aware(dt):
        return dt if (dt is None or dt.tzinfo) else dt.replace(tzinfo=timezone.utc)

    def _is_read(when, sender_id):
        when = _aware(when)
        if when is None:
            return False
        return any(uid != sender_id and _aware(lr) >= when for uid, lr in reads)

    for m in merged:
        if isinstance(m, Message):
            m.read = (not m.is_client) and _is_read(m.sent_at or m.created_at, m.created_by)
            m.mine = m.created_by is not None and m.created_by == user.id
            m.edited = m.edited_at is not None
            m.deleted = bool(m.is_deleted)
            if m.deleted:  # don't leak deleted content — show the placeholder
                m.body = ""
                m.attachment_type = m.attachment_url = m.attachment_name = None
        else:
            m["read"] = (not m["is_client"]) and _is_read(m.get("sent_at") or m.get("created_at"), m.get("created_by"))
            m["mine"] = m.get("created_by") is not None and m.get("created_by") == user.id
            m["edited"] = False
            m["deleted"] = False

    # Resolve quoted-reply previews from the real messages we already have.
    by_id = {m.id: m for m in merged if isinstance(m, Message)}

    def _snippet(msg) -> str:
        if getattr(msg, "is_deleted", False):
            return "Deleted message"
        if msg.body:
            return msg.body[:120]
        at = msg.attachment_type
        name = (msg.attachment_name or "").lower()
        if at == "audio":
            return "Video" if any(name.endswith(e) for e in (".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv")) else "Audio"
        if at == "file":
            return "Photo" if any(name.endswith(e) for e in (".png", ".jpg", ".jpeg", ".gif", ".webp")) else (msg.attachment_name or "Document")
        return "Message"

    for m in merged:
        rid = m.reply_to_id if isinstance(m, Message) else None
        if rid and rid in by_id:
            tgt = by_id[rid]
            if isinstance(m, Message):
                m.reply_to_sender = tgt.sender_name
                m.reply_to_text = _snippet(tgt)

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
    # Validate the reply target belongs to this same client.
    reply_to_id = None
    if payload.reply_to_id:
        tgt = db.get(Message, payload.reply_to_id)
        if tgt and tgt.client_id == client.id:
            reply_to_id = tgt.id
    conv = _ensure_conversation(db, client, channel_id)
    msg = Message(
        client_id=client.id,
        conversation_id=conv.id,
        channel_id=channel_id,
        sender_name=actor.name,
        body=payload.body.strip(),
        is_client=False,
        sent_at=datetime.now(timezone.utc),
        created_by=actor.id,
        reply_to_id=reply_to_id,
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
    msg.mine = True
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
    # Resolve the real MIME once (browsers sometimes omit it) so playback/preview works later.
    ctype = storage_service.guess_content_type(filename, upload.content_type)
    is_audio = ctype.startswith(("audio", "video")) or ext in _AUDIO_EXTS
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
                             content_type=ctype, uploaded_by=actor.id)
        db.add(rec); db.flush()
        attach_type, attach_url = "audio", f"/api/audio/{rec.id}/download"
        log_activity(db, action="audio.uploaded", actor_id=actor.id, client_id=client.id, detail={"filename": filename})
    else:
        prefix = f"{folder}/projects/{project_folder_name}" if project_id else f"{folder}/documents"
        key = storage_service.save_bytes(data, filename, prefix=prefix)
        rec = FileRecord(client_id=client.id, project_id=project_id, filename=filename, storage_key=key,
                          content_type=ctype, size=len(data), uploaded_by=actor.id)
        db.add(rec); db.flush()
        attach_type, attach_url = "file", f"/api/files/{rec.id}/download"
        log_activity(db, action="file.uploaded", actor_id=actor.id, client_id=client.id, detail={"filename": filename})

    conv = _ensure_conversation(db, client, channel_id)
    msg = Message(
        client_id=client.id, conversation_id=conv.id, channel_id=channel_id, sender_name=actor.name,
        body="", is_client=False, sent_at=datetime.now(timezone.utc), created_by=actor.id,
        attachment_type=attach_type, attachment_url=attach_url, attachment_name=filename,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    msg.mine = True
    return msg


def _own_recent_message(db: Session, client_id: int, message_id: int, actor: User) -> Message:
    """Load a real Message that belongs to the actor and is still inside the
    edit/delete window. Raises the appropriate HTTP error otherwise."""
    ensure_client_access(actor, _client(db, client_id))
    msg = db.get(Message, message_id)
    if not msg or msg.client_id != client_id:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.created_by is None or msg.created_by != actor.id:
        raise HTTPException(status_code=403, detail="You can only change your own messages")
    if msg.is_deleted:
        raise HTTPException(status_code=400, detail="This message was already deleted")
    when = msg.sent_at or msg.created_at
    if when and when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    if when and datetime.now(timezone.utc) - when > EDIT_DELETE_WINDOW:
        raise HTTPException(status_code=403, detail="The 24-hour window to edit or delete has passed")
    return msg


@router.patch("/{client_id}/messages/{message_id}", response_model=MessageOut)
def edit_message(
    client_id: int, message_id: int, payload: MessageEdit,
    db: Session = Depends(get_db), actor: User = Depends(get_current_user),
):
    """Edit the text of your own message (within 24h). Attachments can't be edited."""
    ensure_can_write(actor)
    msg = _own_recent_message(db, client_id, message_id, actor)
    if msg.attachment_type:
        raise HTTPException(status_code=400, detail="Media messages can't be edited")
    new_body = (payload.body or "").strip()
    if not new_body:
        raise HTTPException(status_code=400, detail="Message can't be empty")
    msg.body = new_body
    msg.edited_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(msg)
    msg.mine, msg.edited = True, True
    return msg


@router.delete("/{client_id}/messages/{message_id}", status_code=204)
def delete_message(
    client_id: int, message_id: int,
    db: Session = Depends(get_db), actor: User = Depends(get_current_user),
):
    """Delete-for-everyone: soft-delete your own message (within 24h). The row
    stays as a 'This message was deleted' placeholder, WhatsApp-style."""
    ensure_can_write(actor)
    msg = _own_recent_message(db, client_id, message_id, actor)
    msg.is_deleted = True
    db.commit()


@router.post("/{client_id}/messages/{message_id}/hide", status_code=204)
def hide_message(
    client_id: int, message_id: int,
    db: Session = Depends(get_db), actor: User = Depends(get_current_user),
):
    """Delete-for-me: hide a message from the current user's own view only. Any
    message can be hidden; it stays visible to everyone else."""
    from app.models.read_state import MessageHidden
    ensure_client_access(actor, _client(db, client_id))
    msg = db.get(Message, message_id)
    if not msg or msg.client_id != client_id:
        raise HTTPException(status_code=404, detail="Message not found")
    exists = db.execute(
        select(MessageHidden).where(MessageHidden.user_id == actor.id, MessageHidden.message_id == message_id)
    ).scalar_one_or_none()
    if not exists:
        db.add(MessageHidden(user_id=actor.id, message_id=message_id))
        db.commit()
