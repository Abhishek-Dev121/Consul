from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.permission import Permission, RolePermission
from app.models.user import User, UserRole
from app.rbac import require_permission
from app.schemas.permission import PermissionOut, RolePermissionsUpdate
from app.seed import sync_permissions
from app.cache import invalidate_cache

router = APIRouter(prefix="/api/permissions", tags=["permissions"])


@router.get("")
def get_permissions(
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("users.permissions"))
):
    perms = db.execute(select(Permission).order_by(Permission.category, Permission.code)).scalars().all()
    mappings = db.execute(select(RolePermission.role, RolePermission.permission_id)).all()
    
    role_perms = {role.value: [] for role in UserRole}
    perm_by_id = {p.id: p.code for p in perms}
    for role, perm_id in mappings:
        if perm_id in perm_by_id:
            role_perms[role.value].append(perm_by_id[perm_id])
            
    return {
        "permissions": [PermissionOut.model_validate(p) for p in perms],
        "roles": role_perms
    }


@router.put("/roles/{role}")
def update_role_permissions(
    role: UserRole,
    payload: RolePermissionsUpdate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("users.permissions"))
):
    # Retrieve matching permissions
    perms = db.execute(select(Permission).where(Permission.code.in_(payload.permissions))).scalars().all()
    perm_ids = [p.id for p in perms]
    
    # Delete existing
    db.execute(delete(RolePermission).where(RolePermission.role == role))
    db.flush()
    
    # Insert new mappings
    for pid in perm_ids:
        db.add(RolePermission(role=role, permission_id=pid))
    db.commit()
    
    # Invalidate cache
    invalidate_cache(f"role_permissions:{role.value}")
    return {"status": "success"}


@router.post("/reset")
def reset_permissions(
    db: Session = Depends(get_db),
    actor: User = Depends(require_permission("users.permissions"))
):
    sync_permissions(db)
    return {"status": "success"}
