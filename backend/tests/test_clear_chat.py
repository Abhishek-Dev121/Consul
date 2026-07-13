"""Clear-chat behaviour: per-client clear, Super-Admin-only clear-all, and the
guarantee that a cleared chat is not silently rebuilt from its conversation log.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models.client import Client as ClientModel
from app.models.conversation import Conversation
from app.models.user import User, UserRole
from app.services.auth_service import create_access_token, hash_password

engine = create_engine("sqlite:///./test_clear.db", connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def fresh_db():
    # Claim the override for this module's tests (test_chat.py sets its own at import).
    prev = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = _override_get_db
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    from app.seed import seed_permissions
    db = TestingSessionLocal()
    seed_permissions(db)
    db.close()
    yield
    if prev is not None:
        app.dependency_overrides[get_db] = prev


def _auth(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id, {'role': user.role.value})}"}


def _mk_user(db, email, role):
    u = User(name=email.split("@")[0], email=email, password_hash=hash_password("pw123456"), role=role)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _mk_client_with_log(db, name="Acme"):
    c = ClientModel(name=name)
    db.add(c)
    db.flush()
    # The log parser requires a leading timestamp on each line.
    db.add(Conversation(
        client_id=c.id, title="Log",
        raw_content=(
            f"10:00 {name}: Hello there\n"
            f"10:01 Me: Hi, how can I help?\n"
            f"10:02 {name}: Need a quote"
        ),
    ))
    db.commit()
    db.refresh(c)
    return c


def test_clear_chat_removes_messages_and_they_stay_gone():
    db = TestingSessionLocal()
    root = _mk_user(db, "root@t.com", UserRole.super_admin)
    admin = _mk_user(db, "admin@t.com", UserRole.admin)
    cl = _mk_client_with_log(db)
    api = TestClient(app)
    h = _auth(root)

    # The log backfills into messages on first read.
    before = api.get(f"/api/clients/{cl.id}/messages", headers=h)
    assert before.status_code == 200
    assert len(before.json()) == 3

    # Clearing a single chat is Super-Admin-only — an admin is not enough.
    assert api.delete(f"/api/clients/{cl.id}/messages", headers=_auth(admin)).status_code == 403

    cleared = api.delete(f"/api/clients/{cl.id}/messages", headers=h)
    assert cleared.status_code == 200
    assert cleared.json()["messages_deleted"] == 3

    # The conversation row still exists, so a naive backfill would resurrect the
    # three messages here. The chat_cleared_at cutoff must prevent that.
    after = api.get(f"/api/clients/{cl.id}/messages", headers=h)
    assert after.status_code == 200
    assert after.json() == []

    # And it survives a second read (nothing re-added in between).
    assert api.get(f"/api/clients/{cl.id}/messages", headers=h).json() == []


def test_new_messages_after_clear_are_visible():
    db = TestingSessionLocal()
    root = _mk_user(db, "root@t.com", UserRole.super_admin)
    cl = _mk_client_with_log(db)
    api = TestClient(app)
    h = _auth(root)

    api.get(f"/api/clients/{cl.id}/messages", headers=h)
    api.delete(f"/api/clients/{cl.id}/messages", headers=h)

    sent = api.post(f"/api/clients/{cl.id}/messages", headers=h, json={"body": "Fresh start"})
    assert sent.status_code == 201
    msgs = api.get(f"/api/clients/{cl.id}/messages", headers=h).json()
    assert [m["body"] for m in msgs] == ["Fresh start"]


def test_clear_all_chats_is_super_admin_only():
    db = TestingSessionLocal()
    admin = _mk_user(db, "admin@t.com", UserRole.admin)
    lead = _mk_user(db, "lead@t.com", UserRole.team_lead)
    root = _mk_user(db, "root@t.com", UserRole.super_admin)
    a = _mk_client_with_log(db, "Acme")
    b = _mk_client_with_log(db, "Globex")
    api = TestClient(app)

    api.get(f"/api/clients/{a.id}/messages", headers=_auth(root))
    api.get(f"/api/clients/{b.id}/messages", headers=_auth(root))

    # An admin is not enough — this is the most destructive action in the app.
    assert api.delete("/api/clients/messages/all", headers=_auth(admin)).status_code == 403
    assert api.delete("/api/clients/messages/all", headers=_auth(lead)).status_code == 403
    # Nothing was destroyed by the rejected attempts.
    assert len(api.get(f"/api/clients/{a.id}/messages", headers=_auth(root)).json()) == 3

    ok = api.delete("/api/clients/messages/all", headers=_auth(root))
    assert ok.status_code == 200
    assert ok.json() == {"clients": 2, "messages_deleted": 6}

    assert api.get(f"/api/clients/{a.id}/messages", headers=_auth(root)).json() == []
    assert api.get(f"/api/clients/{b.id}/messages", headers=_auth(root)).json() == []
