import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database import Base, get_db
from app.models.user import User, UserRole
from app.models.chat import Chat, ChatMessage, MessageStatus
from app.services.auth_service import hash_password, create_access_token

# Use an in-memory SQLite database for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db

from app.models.chat import chat_participants

# Create test tables
_TEST_TABLES = [
    User.__table__,
    Chat.__table__,
    chat_participants,
    ChatMessage.__table__,
    MessageStatus.__table__
]

for table in _TEST_TABLES:
    table.create(bind=engine, checkfirst=True)

client = TestClient(app)


@pytest.fixture(autouse=True)
def run_around_tests():
    # Clean database before and after each test
    for table in reversed(_TEST_TABLES):
        table.drop(bind=engine, checkfirst=True)
    for table in _TEST_TABLES:
        table.create(bind=engine, checkfirst=True)
    yield


def test_auth_signup_and_login():
    # Signup a new user
    signup_resp = client.post(
        "/api/auth/signup",
        json={
            "name": "Test User",
            "email": "test@devexhub.com",
            "password": "Password123!",
            "role": "employee"
        }
    )
    assert signup_resp.status_code == 201
    assert signup_resp.json()["email"] == "test@devexhub.com"

    # Login with the user
    login_resp = client.post(
        "/api/auth/login",
        data={
            "username": "test@devexhub.com",
            "password": "Password123!"
        }
    )
    assert login_resp.status_code == 200
    assert "access_token" in login_resp.json()


def test_create_and_duplicate_chats():
    # Seed users
    db = TestingSessionLocal()
    u1 = User(name="User One", email="u1@test.com", password_hash=hash_password("pw123456"), role=UserRole.employee)
    u2 = User(name="User Two", email="u2@test.com", password_hash=hash_password("pw123456"), role=UserRole.employee)
    u3 = User(name="User Three", email="u3@test.com", password_hash=hash_password("pw123456"), role=UserRole.employee)
    db.add_all([u1, u2, u3])
    db.commit()

    token1 = create_access_token(u1.id, {"role": "employee"})
    headers = {"Authorization": f"Bearer {token1}"}

    # 1. Create a 1-on-1 chat
    c1 = client.post(
        "/api/chats",
        headers=headers,
        json={"participant_id": u2.id, "is_group": False}
    )
    assert c1.status_code == 201
    c1_data = c1.json()
    assert c1_data["is_group"] is False
    assert len(c1_data["participants"]) == 2

    # 2. Try creating duplicate 1-on-1 chat (should return existing)
    c2 = client.post(
        "/api/chats",
        headers=headers,
        json={"participant_id": u2.id, "is_group": False}
    )
    assert c2.status_code == 201
    assert c2.json()["id"] == c1_data["id"]

    # 3. Create a Group chat
    c3 = client.post(
        "/api/chats",
        headers=headers,
        json={"participant_ids": [u2.id, u3.id], "is_group": True}
    )
    assert c3.status_code == 201
    c3_data = c3.json()
    assert c3_data["is_group"] is True
    assert len(c3_data["participants"]) == 3


def test_paginated_messages_and_viewers():
    db = TestingSessionLocal()
    u1 = User(name="User One", email="u1@test.com", password_hash=hash_password("pw123456"), role=UserRole.employee)
    u2 = User(name="User Two", email="u2@test.com", password_hash=hash_password("pw123456"), role=UserRole.employee)
    db.add_all([u1, u2])
    db.commit()

    # Create chat
    chat = Chat(is_group=False)
    chat.participants.append(u1)
    chat.participants.append(u2)
    db.add(chat)
    db.commit()

    # Add messages
    for i in range(15):
        msg = ChatMessage(chat_id=chat.id, sender_id=u1.id, content=f"Message {i}")
        db.add(msg)
        db.flush()
        status_obj = MessageStatus(message_id=msg.id, user_id=u2.id, status="seen")
        db.add(status_obj)
        
    db.commit()

    token1 = create_access_token(u1.id, {"role": "employee"})
    headers = {"Authorization": f"Bearer {token1}"}

    # Fetch messages with pagination limit=5
    history = client.get(
        f"/api/chats/{chat.id}/messages?limit=5&offset=0",
        headers=headers
    )
    assert history.status_code == 200
    msgs = history.json()
    assert len(msgs) == 5
    # The return is reversed (oldest first in list), so the last returned message is the newest one (Message 14)
    assert msgs[-1]["content"] == "Message 14"

    # Fetch next page
    history_next = client.get(
        f"/api/chats/{chat.id}/messages?limit=5&offset=5",
        headers=headers
    )
    assert history_next.status_code == 200
    msgs_next = history_next.json()
    assert len(msgs_next) == 5
    assert msgs_next[-1]["content"] == "Message 9"

    # Fetch viewers of Message 14
    newest_msg = db.execute(
        select(ChatMessage).where(ChatMessage.content == "Message 14")
    ).scalar_one()
    viewers_resp = client.get(
        f"/api/chats/messages/{newest_msg.id}/viewers",
        headers=headers
    )
    assert viewers_resp.status_code == 200
    viewers = viewers_resp.json()
    assert len(viewers) == 1
    assert viewers[0]["name"] == "User Two"


def test_upload_request_endpoints():
    db = TestingSessionLocal()
    u1 = User(name="User One", email="u1@test.com", password_hash=hash_password("pw123456"), role=UserRole.employee)
    db.add(u1)
    db.commit()

    token1 = create_access_token(u1.id, {"role": "employee"})
    headers = {"Authorization": f"Bearer {token1}"}

    # Request upload signature
    sig_resp = client.post(
        "/api/chats/upload/request?filename=test.png&file_type=image/png&file_size=1024",
        headers=headers
    )
    assert sig_resp.status_code == 200
    sig_data = sig_resp.json()
    assert "url" in sig_data
    assert "public_url" in sig_data
