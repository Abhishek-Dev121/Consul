import json
import time
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy import select, func, and_
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.user import User, UserRole
from app.models.chat import Chat, ChatMessage, MessageStatus, chat_participants
from app.schemas.chat import ChatOut, ChatMessageOut, ChatCreate
from app.schemas.auth import UserOut
from app.config import settings
from app.services.ai_service import _client

router = APIRouter(prefix="/api/chats", tags=["chats"])


@router.get("", response_model=list[ChatOut])
def get_chats(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # Find all chats where user is a participant
    chats_stmt = (
        select(Chat)
        .join(Chat.participants)
        .where(User.id == user.id)
        .order_by(Chat.created_at.desc())
    )
    chats = db.execute(chats_stmt).scalars().all()

    results = []
    for chat in chats:
        # Get last message
        last_msg_stmt = (
            select(ChatMessage)
            .where(ChatMessage.chat_id == chat.id)
            .order_by(ChatMessage.created_at.desc())
            .limit(1)
        )
        last_msg = db.execute(last_msg_stmt).scalar_one_or_none()

        last_msg_out = None
        if last_msg:
            last_msg_out = ChatMessageOut(
                id=last_msg.id,
                chat_id=last_msg.chat_id,
                sender_id=last_msg.sender_id,
                sender_name=last_msg.sender.name,
                content=last_msg.content,
                type=last_msg.type,
                file_url=last_msg.file_url,
                created_at=last_msg.created_at,
            )

        # Count unread messages (status != 'seen' for the current user)
        unread_count = db.execute(
            select(func.count(MessageStatus.id))
            .join(ChatMessage, MessageStatus.message_id == ChatMessage.id)
            .where(
                ChatMessage.chat_id == chat.id,
                MessageStatus.user_id == user.id,
                MessageStatus.status != "seen"
            )
        ).scalar_one()

        participants_out = [
            UserOut(
                id=p.id,
                name=p.name,
                email=p.email,
                role=p.role,
                is_active=p.is_active,
                created_at=p.created_at,
                last_login_at=p.last_login_at,
                is_pending=p.is_pending,
            )
            for p in chat.participants
        ]

        results.append(
            ChatOut(
                id=chat.id,
                is_group=chat.is_group,
                created_at=chat.created_at,
                participants=participants_out,
                last_message=last_msg_out,
                unread_count=unread_count,
            )
        )
    return results


@router.get("/{chat_id}/messages", response_model=list[ChatMessageOut])
def get_chat_messages(
    chat_id: int,
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Verify participant membership
    member = db.execute(
        select(chat_participants)
        .where(
            and_(
                chat_participants.c.chat_id == chat_id,
                chat_participants.c.user_id == user.id
            )
        )
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="You are not a participant of this chat")

    msgs_stmt = (
        select(ChatMessage)
        .where(ChatMessage.chat_id == chat_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    msgs = db.execute(msgs_stmt).scalars().all()

    # Return oldest first in the response
    return [
        ChatMessageOut(
            id=m.id,
            chat_id=m.chat_id,
            sender_id=m.sender_id,
            sender_name=m.sender.name,
            content=m.content,
            type=m.type,
            file_url=m.file_url,
            created_at=m.created_at,
        )
        for m in reversed(msgs)
    ]


@router.post("", response_model=ChatOut, status_code=201)
def create_chat(
    payload: ChatCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not payload.is_group:
        if not payload.participant_id:
            raise HTTPException(status_code=400, detail="participant_id is required for 1-on-1 chats")
        
        # Check if 1-on-1 already exists
        # Find chats where BOTH user.id and participant_id are members and is_group is False
        stmt = (
            select(Chat)
            .where(Chat.is_group.is_(False))
            .join(Chat.participants)
            .where(User.id.in_([user.id, payload.participant_id]))
            .group_by(Chat.id)
            .having(func.count(User.id) == 2)
        )
        existing_chat = db.execute(stmt).scalar_one_or_none()
        if existing_chat:
            # Format and return the existing chat
            participants_out = [
                UserOut(
                    id=p.id,
                    name=p.name,
                    email=p.email,
                    role=p.role,
                    is_active=p.is_active,
                    created_at=p.created_at,
                    last_login_at=p.last_login_at,
                    is_pending=p.is_pending,
                )
                for p in existing_chat.participants
            ]
            return ChatOut(
                id=existing_chat.id,
                is_group=existing_chat.is_group,
                created_at=existing_chat.created_at,
                participants=participants_out,
                last_message=None,
                unread_count=0,
            )

        # Create new 1-on-1 chat
        chat = Chat(is_group=False)
        target = db.get(User, payload.participant_id)
        if not target:
            raise HTTPException(status_code=404, detail="Participant not found")
        chat.participants.append(user)
        chat.participants.append(target)
        db.add(chat)
        db.commit()
        db.refresh(chat)
    else:
        # Group chat
        if not payload.participant_ids:
            raise HTTPException(status_code=400, detail="participant_ids array is required for group chats")
        chat = Chat(is_group=True)
        chat.participants.append(user)
        for pid in payload.participant_ids:
            target = db.get(User, pid)
            if target:
                chat.participants.append(target)
        db.add(chat)
        db.commit()
        db.refresh(chat)

    participants_out = [
        UserOut(
            id=p.id,
            name=p.name,
            email=p.email,
            role=p.role,
            is_active=p.is_active,
            created_at=p.created_at,
            last_login_at=p.last_login_at,
            is_pending=p.is_pending,
        )
        for p in chat.participants
    ]
    return ChatOut(
        id=chat.id,
        is_group=chat.is_group,
        created_at=chat.created_at,
        participants=participants_out,
        last_message=None,
        unread_count=0,
    )


@router.post("/upload/request")
def request_upload(
    filename: str,
    file_type: str,
    file_size: int,
    user: User = Depends(get_current_user),
):
    # Enforce maximum size (e.g. 50MB)
    if file_size > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 50MB)")

    if settings.storage_backend == "s3":
        from app.services.storage_service import _s3_client
        s3 = _s3_client()
        key = f"chats/uploads/{int(time.time())}_{filename}"
        try:
            response = s3.generate_presigned_post(
                Bucket=settings.s3_bucket,
                Key=key,
                Fields={"Content-Type": file_type},
                Conditions=[{"Content-Type": file_type}],
                ExpiresIn=3600
            )
            return {
                "url": response["url"],
                "fields": response["fields"],
                "public_url": f"https://{settings.s3_bucket}.s3.amazonaws.com/{key}"
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to generate upload signature: {str(e)}")
    else:
        # Local storage fallback
        key = f"{int(time.time())}_{filename}"
        return {
            "url": "/api/chats/upload-local",
            "fields": {
                "key": key,
                "filename": filename,
                "content_type": file_type
            },
            "public_url": f"/chat-uploads/{key}"
        }


@router.post("/upload-local")
async def upload_local_file(
    key: str = Form(...),
    upload: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    if settings.storage_backend != "local":
        raise HTTPException(status_code=400, detail="Local uploads not enabled")
    
    upload_dir = Path("./storage/chat_uploads")
    upload_dir.mkdir(parents=True, exist_ok=True)
    
    dest_path = upload_dir / key
    try:
        content = await upload.read()
        dest_path.write_bytes(content)
        return {"status": "ok", "url": f"/chat-uploads/{key}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write file locally: {str(e)}")


@router.get("/messages/{message_id}/viewers")
def get_message_viewers(
    message_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Verify participant has access to the chat containing this message
    msg = db.get(ChatMessage, message_id)
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
        
    member = db.execute(
        select(chat_participants)
        .where(
            and_(
                chat_participants.c.chat_id == msg.chat_id,
                chat_participants.c.user_id == user.id
            )
        )
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="You are not a participant of this chat")

    viewers_stmt = (
        select(User)
        .join(MessageStatus, MessageStatus.user_id == User.id)
        .where(
            and_(
                MessageStatus.message_id == message_id,
                MessageStatus.status == "seen"
            )
        )
    )
    viewers = db.execute(viewers_stmt).scalars().all()

    return [
        UserOut(
            id=v.id,
            name=v.name,
            email=v.email,
            role=v.role,
            is_active=v.is_active,
            created_at=v.created_at,
            last_login_at=v.last_login_at,
            is_pending=v.is_pending,
        )
        for v in viewers
    ]


@router.post("/{chat_id}/analyze")
def analyze_chat(
    chat_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Verify user is a member of the chat
    member = db.execute(
        select(chat_participants)
        .where(
            and_(
                chat_participants.c.chat_id == chat_id,
                chat_participants.c.user_id == user.id
            )
        )
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="You are not a participant of this chat")

    # Fetch last 100 messages
    msgs_stmt = (
        select(ChatMessage)
        .where(ChatMessage.chat_id == chat_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(100)
    )
    msgs = db.execute(msgs_stmt).scalars().all()
    if not msgs:
        return {"summary": "No messages in this conversation yet.", "overallSentiment": "neutral", "keyTopics": []}

    formatted_msgs = [
        {
            "sender": m.sender.name,
            "content": m.content,
            "type": m.type,
            "created_at": m.created_at.isoformat()
        }
        for m in reversed(msgs)
    ]
    messages_json = json.dumps(formatted_msgs)

    try:
        client = _client()
        resp = client.chat.completions.create(
            model=settings.openai_model,
            response_format={"type": "json_object"},
            temperature=0.2,
            messages=[
                {
                    "role": "system", 
                    "content": "You are a professional assistant analyzing a team chat conversation. Analyze the conversation. Return ONLY a valid JSON object with keys: summary (string), overallSentiment (positive/neutral/negative), and keyTopics (array of strings)."
                },
                {"role": "user", "content": f"Analyze this conversation:\n\n{messages_json}"}
            ]
        )
        return json.loads(resp.choices[0].message.content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")
