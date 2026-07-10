"""Turn logged conversations into chat messages for the Upwork-style view.

A conversation's `raw_content` is a pasted chat log. We parse each line into a
message (speaker + text + optional timestamp). Backfill is idempotent: a
conversation is only exploded once (we skip it if it already has messages).
"""
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.client import Client
from app.models.conversation import Conversation
from app.models.message import Message
from app.services.metrics_service import _LINE_RE, _parse_ts

# Speaker names that always count as "our side" (outgoing) regardless of client.
_OUTGOING_HINTS = {"me", "agent", "support", "team", "admin", "us"}


def _name_tokens(name: str | None) -> set[str]:
    return {t for t in (name or "").lower().replace(",", " ").split() if len(t) > 1}


def _is_client_speaker(speaker: str, client_tokens: set[str]) -> bool:
    s = speaker.strip().lower()
    if s in _OUTGOING_HINTS:
        return False
    if not client_tokens:
        return True  # default unknown speakers to the client side
    return any(tok in s for tok in client_tokens)


def parse_log_to_messages(raw: str, client_name: str | None, fallback_dt: datetime | None):
    """Yield dicts: {sender_name, body, is_client, sent_at}. Lines that don't
    match the 'Speaker: text' shape are appended to the previous message."""
    tokens = _name_tokens(client_name)
    out: list[dict] = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        m = _LINE_RE.match(line)
        if not m:
            if out:
                out[-1]["body"] += "\n" + line.strip()
            continue
        ts = _parse_ts(m.group("ts"))
        if ts is not None and ts.year <= 1900 and fallback_dt is not None:
            # time-only timestamp: anchor to the conversation's date
            ts = fallback_dt.replace(hour=ts.hour, minute=ts.minute, second=ts.second)
        speaker = m.group("speaker").strip()
        out.append({
            "sender_name": speaker,
            "body": m.group("msg").strip(),
            "is_client": _is_client_speaker(speaker, tokens),
            "sent_at": ts or fallback_dt,
        })
    return out


def _aware(dt: datetime) -> datetime:
    """SQLite hands back naive datetimes; Postgres returns aware ones. Normalise
    before comparing so the clear-chat cutoff works on both."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def backfill_client_messages(db: Session, client: Client) -> None:
    """Ensure every conversation of the client has been exploded into messages."""
    conversations = db.execute(
        select(Conversation).where(Conversation.client_id == client.id)
    ).scalars().all()
    cleared_at = client.chat_cleared_at
    for conv in conversations:
        has_any = db.execute(
            select(func.count(Message.id)).where(Message.conversation_id == conv.id)
        ).scalar_one()
        if has_any:
            continue
        # A cleared chat has zero messages, which would otherwise look like a
        # never-backfilled conversation and get re-exploded on the next read.
        # Skip logs that predate the clear; newer uploads still backfill normally.
        if cleared_at is not None and _aware(conv.created_at) <= _aware(cleared_at):
            continue
        fallback = conv.occurred_at or conv.created_at
        for msg in parse_log_to_messages(conv.raw_content, client.name, fallback):
            db.add(Message(
                client_id=client.id,
                conversation_id=conv.id,
                channel_id=conv.channel_id,
                sender_name=msg["sender_name"][:120],
                body=msg["body"],
                is_client=msg["is_client"],
                sent_at=msg["sent_at"],
            ))
    db.flush()


def list_client_messages(db: Session, client: Client) -> list[Message]:
    backfill_client_messages(db, client)
    return db.execute(
        select(Message)
        .where(Message.client_id == client.id)
        .order_by(func.coalesce(Message.sent_at, Message.created_at), Message.id)
    ).scalars().all()
