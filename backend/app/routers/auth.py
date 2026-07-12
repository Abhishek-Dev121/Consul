import time
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models.user import User, UserRole
from app.schemas.auth import ChangePassword, InviteAccept, InviteInfo, Token, UserOut, UserCreate
from app.services.auth_service import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

# --- Simple in-memory login throttling (per email+IP) ---
_MAX_FAILS = 6
_WINDOW = 300          # 5 minutes
_LOCKOUT = 300         # lock for 5 minutes after too many fails
_fails: dict[str, list[float]] = defaultdict(list)


def _throttle_key(email: str, request: Request) -> str:
    ip = request.client.host if request.client else "?"
    return f"{email.lower()}|{ip}"


def _check_throttle(key: str) -> None:
    now = time.time()
    recent = [t for t in _fails[key] if now - t < _WINDOW]
    _fails[key] = recent
    if len(recent) >= _MAX_FAILS and now - recent[-1] < _LOCKOUT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed attempts. Please wait a few minutes and try again.",
        )


def _record_fail(key: str) -> None:
    _fails[key].append(time.time())


@router.post("/login", response_model=Token)
def login(
    request: Request,
    form: OAuth2PasswordRequestForm = Depends(),
    remember: bool = Form(False),
    db: Session = Depends(get_db),
):
    key = _throttle_key(form.username, request)
    _check_throttle(key)
    user = db.execute(select(User).where(User.email == form.username)).scalar_one_or_none()
    if not user or not verify_password(form.password, user.password_hash):
        _record_fail(key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password"
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")
    if user.invite_token is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invite not yet accepted")
    _fails.pop(key, None)  # reset on success
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    # "Keep me signed in" must extend the token itself, not just where the browser
    # stores it — otherwise the session still expires after access_token_expire_minutes.
    expires = settings.remember_me_expire_days * 24 * 60 if remember else None
    return Token(
        access_token=create_access_token(user.id, {"role": user.role.value}, expires_minutes=expires)
    )


@router.post("/change-password")
def change_password(
    payload: ChangePassword,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    if payload.new_password == payload.current_password:
        raise HTTPException(status_code=400, detail="New password must be different")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"detail": "Password updated"}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.get("/invite/{token}", response_model=InviteInfo)
def invite_info(token: str, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.invite_token == token)).scalar_one_or_none()
    valid = bool(user)
    if user and user.invite_expires_at:
        expires = user.invite_expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        valid = expires > datetime.now(timezone.utc)
    return InviteInfo(
        name=user.name if user else "",
        email=user.email if user else "unknown@example.com",
        valid=valid,
    )


@router.post("/accept-invite", response_model=Token)
def accept_invite(payload: InviteAccept, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.invite_token == payload.token)).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Invite not found or already used")
    if user.invite_expires_at:
        expires = user.invite_expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="This invite has expired")
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    user.password_hash = hash_password(payload.password)
    user.invite_token = None
    user.invite_expires_at = None
    user.is_active = True
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    return Token(access_token=create_access_token(user.id, {"role": user.role.value}))


@router.post("/signup", response_model=UserOut, status_code=201)
def signup(payload: UserCreate, db: Session = Depends(get_db)):
    existing = db.execute(select(User).where(User.email == payload.email)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    if not payload.password:
        raise HTTPException(status_code=400, detail="Password is required")
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    user = User(
        name=payload.name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=UserRole.employee,  # Public signups default to employee
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
