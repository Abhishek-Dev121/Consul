import json
import logging
import asyncio
from typing import Dict, Set
from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import select, and_, update
import redis.asyncio as aioredis

from app.config import settings
from app.database import SessionLocal
from app.models.chat import Chat, ChatMessage, MessageStatus, chat_participants
from app.models.user import User

logger = logging.getLogger("websocket")


class ConnectionManager:
    def __init__(self):
        # user_id -> set of active WebSockets
        self.active_connections: Dict[int, Set[WebSocket]] = {}
        # chat_id -> set of active WebSockets
        self.rooms: Dict[int, Set[WebSocket]] = {}
        # WebSocket -> user_id
        self.socket_users: Dict[WebSocket, int] = {}
        # WebSocket -> chat_id currently joined
        self.socket_rooms: Dict[WebSocket, int] = {}
        
        # Redis client and pubsub task
        self.redis_client = None
        self.pubsub = None
        self.pubsub_task = None

    async def init_redis(self):
        if not settings.redis_url:
            logger.info("Redis not configured. WebSocket manager running in single-server memory mode.")
            return
        try:
            self.redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
            # Test connection
            await self.redis_client.ping()
            self.pubsub = self.redis_client.pubsub()
            await self.pubsub.subscribe("chat_broadcast")
            self.pubsub_task = asyncio.create_task(self._redis_listener())
            logger.info("Redis Pub/Sub WebSocket clustering initialized successfully.")
        except Exception as e:
            logger.warning(f"Redis initialization failed (falling back to memory mode): {str(e)}")
            self.redis_client = None
            self.pubsub = None

    async def _redis_listener(self):
        try:
            async for message in self.pubsub.listen():
                if message["type"] == "message":
                    data = json.loads(message["data"])
                    # Route local broadcast
                    await self._local_broadcast(data)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error in Redis listener: {str(e)}")

    async def _local_broadcast(self, data: dict):
        event = data.get("event")
        chat_id = data.get("chat_id")
        sender_id = data.get("sender_id")
        payload = data.get("payload")

        if not chat_id:
            return

        # Find all local WebSockets in this room
        local_sockets = self.rooms.get(chat_id, set())
        for ws in list(local_sockets):
            # Skip the sender socket if it exists on this server node for receive_message
            user_id = self.socket_users.get(ws)
            if user_id == sender_id and event == "receive_message":
                continue
            try:
                await ws.send_json({
                    "event": event,
                    "chat_id": chat_id,
                    "payload": payload
                })
            except Exception:
                await self.disconnect(ws)

    async def broadcast(self, event: str, chat_id: int, sender_id: int, payload: dict):
        broadcast_data = {
            "event": event,
            "chat_id": chat_id,
            "sender_id": sender_id,
            "payload": payload
        }
        if self.redis_client:
            # Publish to Redis channel so all server nodes receive it
            try:
                await self.redis_client.publish("chat_broadcast", json.dumps(broadcast_data))
            except Exception as e:
                logger.error(f"Failed to publish to Redis: {str(e)}")
                await self._local_broadcast(broadcast_data)
        else:
            # Fallback to local broadcast
            await self._local_broadcast(broadcast_data)

    async def connect(self, websocket: WebSocket, user_id: int):
        await websocket.accept()
        
        if user_id not in self.active_connections:
            self.active_connections[user_id] = set()
        self.active_connections[user_id].add(websocket)
        self.socket_users[websocket] = user_id

    async def disconnect(self, websocket: WebSocket):
        user_id = self.socket_users.pop(websocket, None)
        if user_id and user_id in self.active_connections:
            self.active_connections[user_id].discard(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]

        chat_id = self.socket_rooms.pop(websocket, None)
        if chat_id and chat_id in self.rooms:
            self.rooms[chat_id].discard(websocket)
            if not self.rooms[chat_id]:
                del self.rooms[chat_id]

    async def handle_message(self, user_id: int, data: dict, websocket: WebSocket):
        event = data.get("event")
        if not event:
            return

        if event == "join_chat":
            chat_id = data.get("chat_id")
            if not chat_id:
                return
            # Remove from previous room if any
            prev_chat_id = self.socket_rooms.get(websocket)
            if prev_chat_id and prev_chat_id in self.rooms:
                self.rooms[prev_chat_id].discard(websocket)
            
            # Join new room
            if chat_id not in self.rooms:
                self.rooms[chat_id] = set()
            self.rooms[chat_id].add(websocket)
            self.socket_rooms[websocket] = chat_id
            
        elif event == "send_message":
            chat_id = data.get("chat_id")
            content = data.get("content")
            msg_type = data.get("type", "text")
            file_url = data.get("file_url")
            
            if not chat_id or not content:
                return

            with SessionLocal() as db:
                # 1. Save message to database
                sender = db.get(User, user_id)
                msg = ChatMessage(
                    chat_id=chat_id,
                    sender_id=user_id,
                    content=content,
                    type=msg_type,
                    file_url=file_url
                )
                db.add(msg)
                db.flush()

                # Get chat participants to create MessageStatus for read receipts
                chat = db.get(Chat, chat_id)
                participants = chat.participants if chat else []

                for p in participants:
                    status_val = "seen" if p.id == user_id else "sent"
                    status_obj = MessageStatus(
                        message_id=msg.id,
                        user_id=p.id,
                        status=status_val
                    )
                    db.add(status_obj)
                
                db.commit()
                
                # 2. Broadcast receive_message to room
                payload = {
                    "id": msg.id,
                    "chat_id": chat_id,
                    "sender_id": user_id,
                    "sender_name": sender.name,
                    "content": content,
                    "type": msg_type,
                    "file_url": file_url,
                    "created_at": msg.created_at.isoformat()
                }
                await self.broadcast("receive_message", chat_id, user_id, payload)

        elif event == "mark_seen":
            chat_id = data.get("chat_id")
            if not chat_id:
                return
            
            with SessionLocal() as db:
                # Update all statuses for current user in this chat to 'seen'
                stmt = select(ChatMessage.id).where(ChatMessage.chat_id == chat_id)
                msg_ids = db.execute(stmt).scalars().all()
                if msg_ids:
                    db.execute(
                        update(MessageStatus)
                        .where(
                            and_(
                                MessageStatus.message_id.in_(msg_ids),
                                MessageStatus.user_id == user_id,
                                MessageStatus.status != "seen"
                            )
                        )
                        .values(status="seen")
                    )
                    db.commit()

                # Find last message ID
                last_msg_stmt = (
                    select(ChatMessage.id)
                    .where(ChatMessage.chat_id == chat_id)
                    .order_by(ChatMessage.created_at.desc())
                    .limit(1)
                )
                last_msg_id = db.execute(last_msg_stmt).scalar_one_or_none()
                
                if last_msg_id:
                    payload = {
                        "user_id": user_id,
                        "last_seen_message_id": last_msg_id
                    }
                    await self.broadcast("read_update", chat_id, user_id, payload)

        elif event in ("typing_start", "typing_stop"):
            chat_id = data.get("chat_id")
            if not chat_id:
                return
            with SessionLocal() as db:
                sender = db.get(User, user_id)
                sender_name = sender.name if sender else "Someone"
            payload = {
                "user_id": user_id,
                "user_name": sender_name
            }
            await self.broadcast(event, chat_id, user_id, payload)


manager = ConnectionManager()
