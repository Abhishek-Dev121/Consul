# Granular Role-Based Permissions System

## Background

The current system uses a simple **role hierarchy** (`employee < team_lead < admin < super_admin`) with hardcoded permission checks like `ensure_can_write()` (requires `team_lead+`) and `require_role(UserRole.admin)`. There is no way for the superadmin to customize what each role can do — permissions are baked into the code.

This plan introduces a **granular, database-driven permission system** where the superadmin can assign and edit individual permissions for each role.

---

## Proposed Changes

### 1. New Database Models

---

#### [NEW] [permission.py](file:///c:/Users/Pc/Documents/Python/Communication-Agent/backend/app/models/permission.py)

A new `Permission` model and a `RolePermission` association table:

```python
# Permission — a named capability (e.g. "clients.create", "messages.send")
class Permission(Base):
    __tablename__ = "permissions"
    id:          int (PK)
    code:        str (unique, e.g. "clients.create")
    name:        str ("Create clients")
    category:    str ("Clients", "Messages", "Users", etc.)
    description: str ("Allows creating new client records")

# RolePermission — which role has which permission
class RolePermission(Base):
    __tablename__ = "role_permissions"
    id:        int (PK)
    role:      UserRole (enum)
    permission_id: int (FK → permissions.id)
    # unique constraint on (role, permission_id)
```

> [!IMPORTANT]
> `super_admin` bypasses all permission checks — they always have full access regardless of what's in `role_permissions`. This cannot be revoked.

---

### 2. Permission Codes (Seeder)

The seeder will populate the `permissions` table and assign defaults to each role. Below is the full permission matrix:

| Category | Code | Name | Super Admin | Admin | Team Lead | Employee |
|---|---|---|---|---|---|---|
| **Dashboard** | `dashboard.view` | View dashboard | ✅ | ✅ | ✅ | ✅ |
| **Clients** | `clients.view` | View clients | ✅ | ✅ | ✅ | ✅ |
| | `clients.create` | Create clients | ✅ | ✅ | ❌ | ❌ |
| | `clients.edit` | Edit clients | ✅ | ✅ | ❌ | ❌ |
| | `clients.delete` | Delete clients | ✅ | ✅ | ❌ | ❌ |
| **Conversations** | `conversations.view` | View conversations | ✅ | ✅ | ✅ | ✅ |
| | `conversations.reply` | Reply to conversations | ✅ | ✅ | ✅ | ❌ |
| | `conversations.delete` | Delete messages | ✅ | ✅ | ❌ | ❌ |
| | `conversations.clear` | Clear chat history | ✅ | ✅ | ❌ | ❌ |
| **Messages** | `messages.send` | Send messages | ✅ | ✅ | ✅ | ❌ |
| | `messages.upload` | Upload attachments | ✅ | ✅ | ✅ | ❌ |
| | `messages.edit` | Edit messages | ✅ | ✅ | ❌ | ❌ |
| **Channels** | `channels.view` | View channels | ✅ | ✅ | ✅ | ✅ |
| | `channels.manage` | Create/delete channels | ✅ | ✅ | ❌ | ❌ |
| **Projects** | `projects.view` | View projects | ✅ | ✅ | ✅ | ✅ |
| | `projects.manage` | Create/edit projects | ✅ | ✅ | ❌ | ❌ |
| **Documents** | `documents.view` | View documents | ✅ | ✅ | ✅ | ✅ |
| | `documents.upload` | Upload documents | ✅ | ✅ | ✅ | ❌ |
| | `documents.delete` | Delete documents | ✅ | ✅ | ❌ | ❌ |
| **Calls** | `calls.view` | View call recordings | ✅ | ✅ | ✅ | ✅ |
| | `calls.upload` | Upload recordings | ✅ | ✅ | ✅ | ❌ |
| | `calls.delete` | Delete recordings | ✅ | ✅ | ❌ | ❌ |
| **Reports** | `reports.view` | View reports & analytics | ✅ | ✅ | ✅ | ❌ |
| **AI** | `ai.analyze` | Run AI analysis | ✅ | ✅ | ✅ | ❌ |
| **Users** | `users.view` | View user list | ✅ | ✅ | ✅ | ❌ |
| | `users.manage` | Create/edit/delete users | ✅ | ✅ | ❌ | ❌ |
| | `users.permissions` | Edit role permissions | ✅ | ❌ | ❌ | ❌ |
| **Activity** | `activity.view` | View activity log | ✅ | ✅ | ✅ | ❌ |
| **Bitrix** | `bitrix.manage` | Manage Bitrix integration | ✅ | ✅ | ❌ | ❌ |

---

### 3. Backend Changes

---

#### [MODIFY] [seed.py](file:///c:/Users/Pc/Documents/Python/Communication-Agent/backend/app/seed.py)

Add `seed_permissions()` function that:
1. Inserts all permission records from the matrix above (idempotent — skips existing).
2. Creates default `RolePermission` rows for each role per the matrix.
3. Runs on every startup (like the existing channel seed), but only inserts **new** permissions that don't yet exist in the DB.

#### [MODIFY] [rbac.py](file:///c:/Users/Pc/Documents/Python/Communication-Agent/backend/app/rbac.py)

Add a new `has_permission(db, user, permission_code)` function:
- If `user.role == super_admin` → always `True`
- Otherwise, queries `RolePermission` for a match on `(user.role, permission_code)`
- Returns `bool`

Add `require_permission(permission_code)` FastAPI dependency factory (like `require_role` but permission-based).

Refactor existing `ensure_can_write()` to use `has_permission(db, user, "messages.send")` instead of `has_min_role(user, team_lead)`.

#### [NEW] [permissions.py router](file:///c:/Users/Pc/Documents/Python/Communication-Agent/backend/app/routers/permissions.py)

New API endpoints (super_admin only):

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/permissions` | List all permissions with their current role assignments |
| `GET` | `/api/permissions/roles/{role}` | Get permissions for a specific role |
| `PUT` | `/api/permissions/roles/{role}` | Set/update permissions for a role (accepts array of permission codes) |
| `POST` | `/api/permissions/reset` | Reset all role permissions to factory defaults |

#### [MODIFY] [All routers](file:///c:/Users/Pc/Documents/Python/Communication-Agent/backend/app/routers)

Replace hardcoded `require_role()` / `ensure_can_write()` calls with the new `require_permission()` dependency in each router. For example:

```diff
# In files.py
- actor: User = Depends(require_role(UserRole.admin))
+ actor: User = Depends(require_permission("documents.upload"))
```

#### [NEW] [permission schema](file:///c:/Users/Pc/Documents/Python/Communication-Agent/backend/app/schemas/permission.py)

```python
class PermissionOut(ORMModel):
    id: int
    code: str
    name: str
    category: str
    description: str

class RolePermissionsOut(BaseModel):
    role: str
    permissions: list[str]  # list of permission codes

class RolePermissionsUpdate(BaseModel):
    permissions: list[str]  # list of permission codes to assign

class PermissionMatrixOut(BaseModel):
    permissions: list[PermissionOut]
    roles: dict[str, list[str]]  # role → [permission_codes]
```

---

### 4. Frontend Changes

---

#### [MODIFY] [layout.js](file:///c:/Users/Pc/Documents/Python/Communication-Agent/frontend/js/layout.js)

- The `/api/auth/me` response will include a `permissions: [...]` array of permission codes.
- Replace hardcoded `canWrite()` / `isAdmin()` with a new `hasPerm(code)` function that checks `CURRENT_USER.permissions.includes(code)`.
- Filter the sidebar `NAV` items based on the user's actual permissions instead of `min` role thresholds.

#### [MODIFY] [users.js](file:///c:/Users/Pc/Documents/Python/Communication-Agent/frontend/js/users.js)

- Add a **"Permissions" tab/section** visible only to super_admins.
- Display an interactive permission matrix (like the existing static one in `renderRolesBlock()` but with toggleable checkboxes).
- Each toggle calls `PUT /api/permissions/roles/{role}` to save.
- Add a "Reset to defaults" button that calls `POST /api/permissions/reset`.

#### [MODIFY] [UserOut schema](file:///c:/Users/Pc/Documents/Python/Communication-Agent/backend/app/schemas/auth.py)

Add `permissions: list[str] = []` to `UserOut` so the frontend receives the user's active permission codes on login / `/api/auth/me`.

#### [MODIFY] [auth.py router](file:///c:/Users/Pc/Documents/Python/Communication-Agent/backend/app/routers/auth.py)

The `/api/auth/me` endpoint will query the user's role permissions and include them in the response.

---

### 5. Database Migration

---

#### [MODIFY] [seed.py](file:///c:/Users/Pc/Documents/Python/Communication-Agent/backend/app/seed.py)

Add column patches:
```sql
-- New tables are created by Base.metadata.create_all()
-- No ALTER patches needed since permissions and role_permissions are new tables
```

---

## Open Questions

> [!IMPORTANT]
> **Should permissions be cached?** Each API request currently makes 1 DB query for the user. Adding permission checks would add 1 more query per request. Should we cache permissions in Redis or in-memory (TTL ~60s) to avoid this overhead?

> [!IMPORTANT]
> **Should the permission matrix UI be on the existing Users & Roles page or a separate page?** The current plan puts it on the Users & Roles page as a new section/tab visible only to super admins.

---

## Verification Plan

### Automated Tests
- Verify the seeder creates all permissions and default role assignments correctly.
- Run `py_compile` on all modified backend files.
- Start the FastAPI server and verify no import/startup errors.

### Manual Verification
- Log in as super_admin → navigate to Users & Roles → verify the permission matrix appears with toggleable checkboxes.
- Toggle a permission for a role (e.g. remove `messages.send` from `team_lead`) → log in as a team_lead → verify that sending messages is blocked.
- Reset permissions to defaults → verify all roles regain their factory permissions.
- Verify `super_admin` always bypasses permission checks regardless of the database state.
