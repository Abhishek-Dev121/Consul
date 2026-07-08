"""Role hierarchy and permission helpers.

Roles, from least to most privileged:
    employee < team_lead < admin < super_admin

`require_role(min_role)` returns a FastAPI dependency that rejects users below the
threshold. Resource-level ownership (e.g. a team lead only sees assigned clients) is
enforced in the routers using `is_assigned_to_client`.
"""
from fastapi import Depends, HTTPException, status

from app.deps import get_current_user
from app.models.client import Client
from app.models.user import ROLE_RANK, User, UserRole


def has_min_role(user: User, min_role: UserRole) -> bool:
    return ROLE_RANK[user.role] >= ROLE_RANK[min_role]


def require_role(min_role: UserRole):
    """Dependency factory: 403 unless the current user meets `min_role`."""

    def _checker(user: User = Depends(get_current_user)) -> User:
        if not has_min_role(user, min_role):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires {min_role.value} role or higher",
            )
        return user

    return _checker


def is_assigned_to_client(user: User, client: Client) -> bool:
    """Admins+ can touch any client; team_lead/employee only assigned ones."""
    if has_min_role(user, UserRole.admin):
        return True
    return any(a.id == user.id for a in client.assignees)


def ensure_client_access(user: User, client: Client) -> None:
    if not is_assigned_to_client(user, client):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not assigned to this client"
        )


def active_super_admin_count(db, exclude_id: int | None = None) -> int:
    """Number of active, non-pending super admins (for lockout protection)."""
    from sqlalchemy import func, select

    stmt = select(func.count(User.id)).where(
        User.role == UserRole.super_admin,
        User.is_active.is_(True),
        User.invite_token.is_(None),
    )
    if exclude_id is not None:
        stmt = stmt.where(User.id != exclude_id)
    return db.execute(stmt).scalar_one()


def ensure_can_write(user: User) -> None:
    """Employees are read-only. Team leads and above can write."""
    if not has_min_role(user, UserRole.team_lead):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Read-only role cannot modify data"
        )
