from pydantic import BaseModel
from app.schemas.common import ORMModel


class PermissionOut(ORMModel):
    id: int
    code: str
    name: str
    category: str
    description: str


class RolePermissionsUpdate(BaseModel):
    permissions: list[str]  # list of permission codes to assign
