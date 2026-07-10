"""In-memory presence + typing tracker.

Kept out of the database on purpose: presence and typing are ephemeral, high-churn
signals and the app's database is remote (~280ms/query), so writing them per request
would be prohibitively slow. This is process-local — with multiple workers each has
its own view, which is acceptable for a best-effort "who's online / typing" indicator.
"""
import time

ONLINE_WINDOW = 60      # seconds since last activity to still count as "online"
TYPING_TTL = 6          # seconds a "typing" flag stays live without a refresh

_seen: dict[int, float] = {}                    # user_id -> last-activity epoch
_typing: dict[int, dict[int, tuple]] = {}       # client_id -> {user_id: (name, expires_epoch)}


def touch(user_id: int) -> None:
    """Record that a user just made an authenticated request."""
    _seen[user_id] = time.time()


def online_ids() -> set[int]:
    now = time.time()
    return {uid for uid, ts in _seen.items() if now - ts < ONLINE_WINDOW}


def is_online(user_id: int) -> bool:
    return time.time() - _seen.get(user_id, 0) < ONLINE_WINDOW


def set_typing(client_id: int, user_id: int, name: str, typing: bool) -> None:
    bucket = _typing.setdefault(client_id, {})
    if typing:
        bucket[user_id] = (name, time.time() + TYPING_TTL)
    else:
        bucket.pop(user_id, None)


def typing_names(client_id: int, exclude_user_id: int | None = None) -> list[str]:
    now = time.time()
    bucket = _typing.get(client_id, {})
    out = []
    for uid, (name, exp) in list(bucket.items()):
        if exp <= now:
            bucket.pop(uid, None)
            continue
        if uid != exclude_user_id:
            out.append(name)
    return out
