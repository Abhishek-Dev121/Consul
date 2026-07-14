import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models.permission import Permission, RolePermission
from app.models.user import User, UserRole
from app.services.auth_service import create_access_token, hash_password
from app.seed import seed_permissions

engine = create_engine("sqlite:///./test_perms.db", connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def fresh_db():
    prev = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = _override_get_db
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    seed_permissions(db)
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


def test_permission_seeding():
    db = TestingSessionLocal()
    perms = db.query(Permission).all()
    # There should be exactly 31 permissions defined
    assert len(perms) == 31
    
    # Verify dashboard.view exists
    dash = db.query(Permission).filter(Permission.code == "dashboard.view").first()
    assert dash is not None
    assert dash.category == "Dashboard"
    
    # Check default mappings
    mappings = db.query(RolePermission).filter(RolePermission.permission_id == dash.id).all()
    # Defaults should include super_admin, admin, team_lead, employee
    roles = {m.role for m in mappings}
    assert UserRole.employee in roles
    assert UserRole.super_admin in roles


def test_rbac_endpoint_enforcement_and_dynamic_modification():
    db = TestingSessionLocal()
    emp = _mk_user(db, "emp@t.com", UserRole.employee)
    super_admin = _mk_user(db, "root@t.com", UserRole.super_admin)
    api = TestClient(app)
    
    # 1. Employee tries to create a client (should be blocked by default)
    payload = {
        "name": "Acme Corp",
        "company": "Acme",
        "email": "acme@example.com",
        "phone": "123456",
        "notes": "",
        "status": "lead",
        "assignee_ids": [],
        "channel_ids": [],
        "bitrix_group_id": None
    }
    res = api.post("/api/clients", headers=_auth(emp), json=payload)
    assert res.status_code == 403
    assert "Missing required permission: clients.create" in res.json()["detail"]
    
    # 2. Super admin gets list of permissions
    res_perms = api.get("/api/permissions", headers=_auth(super_admin))
    assert res_perms.status_code == 200
    data = res_perms.json()
    assert "permissions" in data
    assert "roles" in data
    
    # 3. Super admin updates employee permissions to grant "clients.create"
    current_employee_perms = data["roles"]["employee"]
    assert "clients.create" not in current_employee_perms
    
    new_employee_perms = current_employee_perms + ["clients.create"]
    update_res = api.put("/api/permissions/roles/employee", headers=_auth(super_admin), json={"permissions": new_employee_perms})
    assert update_res.status_code == 200
    
    # 4. Employee tries again to create a client (should now succeed!)
    res_ok = api.post("/api/clients", headers=_auth(emp), json=payload)
    assert res_ok.status_code == 201
    assert res_ok.json()["name"] == "Acme Corp"
    
    # 5. Super admin resets permissions to defaults
    reset_res = api.post("/api/permissions/reset", headers=_auth(super_admin))
    assert reset_res.status_code == 200
    
    # 6. Employee tries to create another client (should be blocked again!)
    res_blocked = api.post("/api/clients", headers=_auth(emp), json=payload)
    assert res_blocked.status_code == 403
