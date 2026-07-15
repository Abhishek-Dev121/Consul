from app.schemas.common import ORMModel
from pydantic import BaseModel


class ChannelCreate(BaseModel):
    name: str
    # Built-in platform key or a custom PlatformType.key — validated in the router.
    platform: str
    config: dict = {}


class ChannelUpdate(BaseModel):
    name: str | None = None
    platform: str | None = None
    config: dict | None = None


class ChannelOut(ORMModel):
    id: int
    name: str
    platform: str
    config: dict


class PlatformTypeCreate(BaseModel):
    name: str
    logo: str   # image as a data: URL


class PlatformTypeOut(ORMModel):
    id: int
    key: str
    name: str
    logo: str
