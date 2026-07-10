"""FastAPI application entrypoint.

Mounts all API routers, serves the static HTML frontend, seeds the database on
startup, and exposes a health check.
"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
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
    messages,
    overview,
    pages,
    projects,
    realtime,
    users,
)
from app.seed import init_db

FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


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
for r in (auth, users, channels, clients, conversations, messages, projects, files, audio, ai, activities, bitrix, overview, realtime):
    app.include_router(r.router)


@app.get("/api/health", tags=["health"])
def health():
    return {"status": "ok", "app": settings.app_name}


# HTML page routes (must be registered before the static mount catch-all)
app.include_router(pages.router)

# Static assets (css/js) and direct file access
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
