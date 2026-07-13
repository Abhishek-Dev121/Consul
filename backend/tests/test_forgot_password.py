import pytest
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from sqlalchemy import select, create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.models.user import User, UserRole, PasswordReset
from app.services.auth_service import verify_password
from app.main import app

test_engine = create_engine("sqlite:///./test_forgot.db", connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

client = TestClient(app)

def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

@pytest.fixture(autouse=True)
def setup_db():
    prev = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = _override_get_db
    Base.metadata.drop_all(bind=test_engine)
    Base.metadata.create_all(bind=test_engine)
    yield
    if prev is not None:
        app.dependency_overrides[get_db] = prev
    else:
        app.dependency_overrides.pop(get_db, None)


def test_forgot_password_flow():
    db = TestingSessionLocal()
    
    # 1. Forgot password on non-existent email returns success to prevent email enumeration
    res = client.post("/api/auth/forgot-password", json={"email": "non_existent@devexhub.com"})
    assert res.status_code == 200
    assert res.json()["status"] == "success"
    
    # 2. Create active test user
    from app.services.auth_service import hash_password
    test_user = User(
        name="Forgot Test User",
        email="forgot_test@devexhub.com",
        password_hash=hash_password("OldPassword123!"),
        role=UserRole.employee,
        is_active=True
    )
    db.add(test_user)
    db.commit()
    db.refresh(test_user)
    user_id = test_user.id
    
    # 3. Call forgot-password with registered email
    res = client.post("/api/auth/forgot-password", json={"email": "forgot_test@devexhub.com"})
    assert res.status_code == 200
    assert res.json()["status"] == "success"
    
    # Clear local cache/reset transaction block to read the newly committed record from SQLite
    db.rollback()
    
    # Check token creation in database
    reset_record = db.execute(select(PasswordReset).where(PasswordReset.user_id == user_id)).scalar_one_or_none()
    assert reset_record is not None
    assert len(reset_record.token) > 10
    expires_at = reset_record.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    assert expires_at > datetime.now(timezone.utc)
    token = reset_record.token
    
    # 4. Call reset-password with invalid token
    res = client.post("/api/auth/reset-password", json={"token": "invalid-token", "password": "NewPassword123!"})
    assert res.status_code == 400
    assert "Invalid or expired" in res.json()["detail"]
    
    # 5. Call reset-password with valid token but short password
    res = client.post("/api/auth/reset-password", json={"token": token, "password": "short"})
    assert res.status_code == 422
    
    # 6. Call reset-password with valid token and password
    res = client.post("/api/auth/reset-password", json={"token": token, "password": "NewPassword123!"})
    assert res.status_code == 200
    assert res.json()["status"] == "success"
    
    # Check that reset record is deleted
    reset_record_post = db.execute(select(PasswordReset).where(PasswordReset.user_id == user_id)).scalar_one_or_none()
    assert reset_record_post is None
    
    # Check that user password has updated
    db.refresh(test_user)
    assert verify_password("NewPassword123!", test_user.password_hash)
    assert not verify_password("OldPassword123!", test_user.password_hash)
    
    db.close()
