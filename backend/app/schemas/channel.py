from app.models.channel import Platform
from app.schemas.common import ORMModel
from pydantic import BaseModel


class ChannelCreate(BaseModel):
    name: str
    platform: Platform
    config: dict = {}


class ChannelOut(ORMModel):
    id: int
    name: str
    platform: Platform
    config: dict
