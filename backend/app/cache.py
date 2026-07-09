"""
Simple in-memory TTL cache for expensive overview responses.

Usage:
    from app.cache import ttl_cache, invalidate_cache

    # Store a result for 30 seconds
    ttl_cache.set("clients_overview:user_1", data, ttl=30)

    # Retrieve (returns None if expired/missing)
    cached = ttl_cache.get("clients_overview:user_1")

    # Invalidate all cache keys matching a prefix
    invalidate_cache("clients_overview")
"""
import time
import threading
from typing import Any

_lock = threading.Lock()
_store: dict[str, tuple[Any, float]] = {}   # key -> (value, expires_at)


class _TTLCache:
    def get(self, key: str) -> Any | None:
        with _lock:
            entry = _store.get(key)
            if entry is None:
                return None
            value, expires_at = entry
            if time.monotonic() > expires_at:
                del _store[key]
                return None
            return value

    def set(self, key: str, value: Any, ttl: int = 30) -> None:
        with _lock:
            _store[key] = (value, time.monotonic() + ttl)

    def delete(self, key: str) -> None:
        with _lock:
            _store.pop(key, None)

    def clear_prefix(self, prefix: str) -> None:
        """Remove all keys that start with `prefix`."""
        with _lock:
            to_del = [k for k in _store if k.startswith(prefix)]
            for k in to_del:
                del _store[k]


ttl_cache = _TTLCache()


def invalidate_cache(*prefixes: str) -> None:
    """Call after write operations so the next read fetches fresh data."""
    for p in prefixes:
        ttl_cache.clear_prefix(p)
