"""In-process WebSocket hub for pushing chat events to connected clients.

Deliberately additive: the frontend keeps polling as a fallback, and `notify()`
is wrapped so a broadcast failure can never break the message write that
triggered it. Single-process only — a multi-worker deployment would need an
external bus (e.g. Redis pub/sub); we log-and-ignore in that case rather than
break anything.
"""
import asyncio
import json
import logging

from fastapi import WebSocket

log = logging.getLogger("ws")


class WSManager:
    def __init__(self) -> None:
        self._conns: set[WebSocket] = set()
        self.loop: asyncio.AbstractEventLoop | None = None   # set at app startup

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._conns.add(ws)

    def remove(self, ws: WebSocket) -> None:
        self._conns.discard(ws)

    async def _broadcast(self, payload: str) -> None:
        for ws in list(self._conns):
            try:
                await ws.send_text(payload)
            except Exception:  # noqa: BLE001 — a dead socket shouldn't affect the rest
                self._conns.discard(ws)

    @property
    def has_clients(self) -> bool:
        return bool(self._conns)


manager = WSManager()


def notify(event: dict) -> None:
    """Schedule a broadcast from sync request code (endpoints run in a threadpool).
    Never raises — the caller is a DB write that must succeed regardless."""
    try:
        if manager.loop is None or not manager.has_clients:
            return
        payload = json.dumps(event)
        asyncio.run_coroutine_threadsafe(manager._broadcast(payload), manager.loop)
    except Exception:  # noqa: BLE001
        log.debug("ws notify failed", exc_info=True)
