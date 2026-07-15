"""FastAPI application entrypoint.

Mounts all API routers, serves the static HTML frontend, seeds the database on
startup, and exposes a health check.
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.config import settings
from app.database import engine

_log = logging.getLogger("uvicorn.error")


async def _db_keepalive():
    """Ping the database every few minutes so a serverless Postgres (e.g. Neon)
    doesn't auto-suspend its compute. Without this, the first request after an
    idle period pays a multi-second cold-start ('the page gets stuck')."""
    interval = settings.db_keepalive_seconds
    while True:
        await asyncio.sleep(interval)
        try:
            await asyncio.to_thread(_ping_db)
        except Exception as e:  # noqa: BLE001 — keep the loop alive
            _log.warning("DB keepalive ping failed: %s", e)


def _ping_db():
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
from app.routers import (
    activities,
    ai,
    audio,
    auth,
    bitrix,
    channels,
    clients,
    conversations,
    files,
    integrations,
    intake,
    messages,
    overview,
    pages,
    projects,
    realtime,
    users,
    permissions,
)
from app.seed import init_db

FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # Capture the running loop so sync endpoints can schedule WebSocket broadcasts.
    import asyncio
    from app.services.ws_manager import manager as _ws_manager
    _ws_manager.loop = asyncio.get_running_loop()
    # Warm-up: prime the connection pool immediately so the first user request
    # doesn't pay the serverless-Postgres cold-start penalty.
    try:
        _ping_db()
    except Exception:  # noqa: BLE001 — startup must not fail on a cold DB
        pass

    # Single configurable keep-alive (see settings.db_keepalive_seconds).
    task = asyncio.create_task(_db_keepalive()) if settings.db_keepalive_seconds > 0 else None
    try:
        yield
    finally:
        if task:
            task.cancel()


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def no_cache(request, call_next):
    """Force browsers to revalidate static assets/pages so UI updates show up
    immediately instead of serving a stale cached CSS/JS bundle."""
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/static") or not path.startswith("/api"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# API routers
for r in (auth, users, permissions, channels, clients, conversations, messages, projects, files, audio, ai, activities, bitrix, overview, realtime, integrations, intake):
    app.include_router(r.router)


@app.get("/api/health", tags=["health"])
def health():
    return {"status": "ok", "app": settings.app_name}


@app.websocket("/api/ws")
async def ws_events(websocket: WebSocket):
    """Push channel for live chat updates. Auth via ?token=<jwt>. The server only
    sends (message/list-change events); the client isn't expected to send. If this
    fails or isn't supported by the proxy, the frontend falls back to polling."""
    from fastapi import WebSocketDisconnect
    from app.services.auth_service import decode_access_token
    from app.services.ws_manager import manager as ws_manager

    token = websocket.query_params.get("token")
    payload = decode_access_token(token) if token else None
    if not payload or "sub" not in payload:
        await websocket.close(code=1008)   # policy violation
        return
    await ws_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()   # keeps the socket open; detects disconnect
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        pass
    finally:
        ws_manager.remove(websocket)


# HTML page routes (must be registered before the static mount catch-all)
app.include_router(pages.router)

# Static assets (css/js) and direct file access
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
