import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models.activity import Activity
from app.models.client import Client, client_assignments
from app.models.user import User, UserRole
from app.rbac import active_super_admin_count, require_role
from app.schemas.auth import (
    BulkAction,
    CreateUserResult,
    UserCreate,
    UserDetailOut,
    UserListOut,
    UserOut,
    UserStats,
    UserUpdate,
)
from app.services.activity_service import log_activity
from app.services.auth_service import hash_password
from app.services.email_service import send_invite

router = APIRouter(prefix="/api/users", tags=["users"])

_SORTABLE = {
    "name": User.name,
    "email": User.email,
    "role": User.role,
    "created_at": User.created_at,
    "last_login_at": User.last_login_at,
}


# --------------------------------------------------------------------- helpers
def _invite_url(token: str) -> str:
    return f"{settings.app_base_url.rstrip('/')}/accept-invite?token={token}"


def _new_invite() -> tuple[str, datetime]:
    return (
        secrets.token_urlsafe(32),
        datetime.now(timezone.utc) + timedelta(hours=settings.invite_ttl_hours),
    )


def _guard_super_admin_target(actor: User, target: User) -> None:
    if target.role == UserRole.super_admin and actor.role != UserRole.super_admin:
        raise HTTPException(status_code=403, detail="Only a super admin can modify a super admin")


def _guard_last_super_admin(db: Session, target: User) -> None:
    """Block changes that would remove the last active super admin."""
    if target.role == UserRole.super_admin and active_super_admin_count(db, exclude_id=target.id) == 0:
        raise HTTPException(
            status_code=400, detail="Cannot remove or disable the last active super admin"
        )


# ------------------------------------------------------------------------ list
@router.get("", response_model=UserListOut)
def list_users(
    q: str | None = None,
    role: UserRole | None = None,
    status: str | None = Query(None, pattern="^(active|disabled|pending)$"),
    sort: str = Query("created_at"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_role(UserRole.team_lead)),
):
    stmt = select(User)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(User.name.ilike(like), User.email.ilike(like)))
    if role:
        stmt = stmt.where(User.role == role)
    if status == "active":
        stmt = stmt.where(User.is_active.is_(True), User.invite_token.is_(None))
    elif status == "disabled":
        stmt = stmt.where(User.is_active.is_(False))
    elif status == "pending":
        stmt = stmt.where(User.invite_token.isnot(None))

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    col = _SORTABLE.get(sort, User.created_at)
    stmt = stmt.order_by(col.asc() if order == "asc" else col.desc())
    items = db.execute(stmt.limit(limit).offset(offset)).scalars().all()
    return UserListOut(items=items, total=total, limit=limit, offset=offset)


@router.get("/stats", response_model=UserStats)
def user_stats(db: Session = Depends(get_db), _: User = Depends(require_role(UserRole.team_lead))):
    rows = db.execute(select(User.role, User.is_active, User.invite_token)).all()
    by_role: dict[str, int] = {r.value: 0 for r in UserRole}
    active = disabled = pending = 0
    for role, is_active, token in rows:
        by_role[role.value] += 1
        if token is not None:
            pending += 1
        elif is_active:
            active += 1
        else:
            disabled += 1
    return UserStats(total=len(rows), active=active, disabled=disabled, pending=pending, by_role=by_role)


@router.get("/{user_id}", response_model=UserDetailOut)
def get_user(user_id: int, db: Session = Depends(get_db), _: User = Depends(require_role(UserRole.team_lead))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    clients = db.execute(
        select(Client).join(client_assignments, client_assignments.c.client_id == Client.id)
        .where(client_assignments.c.user_id == user_id).order_by(Client.name)
    ).scalars().all()
    acts = db.execute(
        select(Activity).where(Activity.actor_id == user_id)
        .order_by(Activity.created_at.desc()).limit(10)
    ).scalars().all()
    detail = UserDetailOut.model_validate(user)
    detail.assigned_clients = [{"id": c.id, "name": c.name} for c in clients]
    detail.recent_activity = [
        {"action": a.action, "detail": a.detail, "created_at": a.created_at} for a in acts
    ]
    if user.created_by:
        creator = db.get(User, user.created_by)
        detail.created_by_name = creator.name if creator else None
    return detail


# ---------------------------------------------------------------------- create
@router.post("", response_model=CreateUserResult, status_code=201)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role(UserRole.admin)),
):
    if db.execute(select(User).where(User.email == payload.email)).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")
    if payload.role == UserRole.super_admin and actor.role != UserRole.super_admin:
        raise HTTPException(status_code=403, detail="Only a super admin can create super admins")

    invite_url = None
    invite_emailed = False
    if payload.send_invite:
        token, expires = _new_invite()
        user = User(
            name=payload.name, email=payload.email, role=payload.role,
            password_hash=hash_password(secrets.token_urlsafe(16)),  # unusable until accepted
            invite_token=token, invite_expires_at=expires, created_by=actor.id,
        )
        invite_url = _invite_url(token)
    else:
        if not payload.password or len(payload.password) < 8:
            raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
        user = User(
            name=payload.name, email=payload.email, role=payload.role,
            password_hash=hash_password(payload.password), created_by=actor.id,
        )

    db.add(user)
    db.flush()
    if payload.send_invite:
        invite_emailed = send_invite(user.email, user.name, invite_url)
    log_activity(db, action="user.created", actor_id=actor.id,
                 detail={"user_id": user.id, "email": user.email, "invited": payload.send_invite})
    db.commit()
    db.refresh(user)
    result = CreateUserResult.model_validate(user)
    result.invite_url = invite_url
    result.invite_emailed = invite_emailed
    return result


@router.post("/{user_id}/resend-invite", response_model=CreateUserResult)
def resend_invite(user_id: int, db: Session = Depends(get_db), actor: User = Depends(require_role(UserRole.admin))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.is_pending:
        raise HTTPException(status_code=400, detail="User has already accepted their invite")
    token, expires = _new_invite()
    user.invite_token, user.invite_expires_at = token, expires
    db.flush()
    url = _invite_url(token)
    emailed = send_invite(user.email, user.name, url)
    db.commit()
    db.refresh(user)
    result = CreateUserResult.model_validate(user)
    result.invite_url = url
    result.invite_emailed = emailed
    return result


# ---------------------------------------------------------------------- update
@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_role(UserRole.admin)),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    _guard_super_admin_target(actor, user)
    if payload.role == UserRole.super_admin and actor.role != UserRole.super_admin:
        raise HTTPException(status_code=403, detail="Only a super admin can grant super admin")

    # Self-lockout protection.
    if user.id == actor.id:
        if payload.is_active is False:
            raise HTTPException(status_code=400, detail="You cannot disable your own account")
        if payload.role is not None and payload.role != actor.role:
            raise HTTPException(status_code=400, detail="You cannot change your own role")

    # Last-super-admin protection (demote or disable).
    demoting = payload.role is not None and payload.role != UserRole.super_admin
    disabling = payload.is_active is False
    if (demoting or disabling) and user.role == UserRole.super_admin:
        _guard_last_super_admin(db, user)

    if payload.email and payload.email != user.email:
        if db.execute(select(User).where(User.email == payload.email)).scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Email already registered")
        user.email = payload.email
    if payload.name is not None:
        user.name = payload.name
    if payload.password:
        if len(payload.password) < 8:
            raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
        user.password_hash = hash_password(payload.password)
        user.invite_token = None  # setting a password clears any pending invite
    if payload.role is not None:
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active
    log_activity(db, action="user.updated", actor_id=actor.id, detail={"user_id": user.id})
    db.commit()
    db.refresh(user)
    return user


# ---------------------------------------------------------------------- delete
@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int, db: Session = Depends(get_db), actor: User = Depends(require_role(UserRole.admin))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == actor.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    _guard_super_admin_target(actor, user)
    _guard_last_super_admin(db, user)
    log_activity(db, action="user.deleted", actor_id=actor.id, detail={"email": user.email})
    db.delete(user)
    db.commit()


# ------------------------------------------------------------------ bulk action
@router.post("/bulk")
def bulk_action(payload: BulkAction, db: Session = Depends(get_db), actor: User = Depends(require_role(UserRole.admin))):
    ids = [i for i in payload.user_ids if i != actor.id]  # never act on self in bulk
    users = db.execute(select(User).where(User.id.in_(ids))).scalars().all()
    affected = 0
    for user in users:
        try:
            _guard_super_admin_target(actor, user)
            if payload.action == "enable":
                user.is_active = True
            elif payload.action == "disable":
                _guard_last_super_admin(db, user)
                user.is_active = False
            elif payload.action == "set_role":
                if payload.role is None:
                    raise HTTPException(status_code=400, detail="role is required for set_role")
                if payload.role != UserRole.super_admin and user.role == UserRole.super_admin:
                    _guard_last_super_admin(db, user)
                user.role = payload.role
            elif payload.action == "delete":
                _guard_last_super_admin(db, user)
                db.delete(user)
            affected += 1
        except HTTPException:
            continue  # skip protected users, keep going
    log_activity(db, action=f"user.bulk_{payload.action}", actor_id=actor.id,
                 detail={"requested": len(payload.user_ids), "affected": affected})
    db.commit()
    return {"affected": affected, "skipped": len(payload.user_ids) - affected}
