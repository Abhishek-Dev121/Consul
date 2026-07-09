"""Serve the static HTML pages from the frontend directory."""
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, RedirectResponse

router = APIRouter(tags=["pages"])

FRONTEND_DIR = Path(__file__).resolve().parents[3] / "frontend"

_PAGES = {
    "/login": "login.html",
    "/dashboard": "dashboard.html",
    "/clients": "clients.html",
    "/client": "client_detail.html",
    "/conversations": "conversations.html",
    "/channels": "channels.html",
    "/channel": "channel_detail.html",
    "/chat": "chat.html",
    "/projects": "projects.html",
    "/calls": "calls.html",
    "/documents": "documents.html",
    "/reports": "reports.html",
    "/activity": "activity.html",
    "/users": "users.html",
    "/bitrix": "bitrix.html",
    "/accept-invite": "invite.html",
    "/team-chat": "chat_page.html",
}


@router.get("/")
def root():
    return RedirectResponse(url="/dashboard")


def _make_page(filename: str):
    def _serve():
        return FileResponse(FRONTEND_DIR / filename)
    return _serve


for path, fname in _PAGES.items():
    router.add_api_route(path, _make_page(fname), methods=["GET"], include_in_schema=False)
