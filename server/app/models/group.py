import uuid
from datetime import datetime

from pydantic import BaseModel, Field as PydanticField
from sqlmodel import Field, SQLModel

from app.models.common import aware, tz_column, utcnow


class SessionGroup(SQLModel, table=True):
    """Nhóm tài liệu (dự án, tuần, khách hàng...). Mỗi phiên thuộc tối đa 1 nhóm."""

    __tablename__ = "session_groups"

    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True, max_length=32)
    name: str = Field(max_length=100, index=True)
    created_at: datetime = Field(default_factory=utcnow, sa_column=tz_column())
    updated_at: datetime = Field(default_factory=utcnow, sa_column=tz_column())

    def touch(self) -> None:
        self.updated_at = utcnow()


class GroupCreate(BaseModel):
    name: str = PydanticField(min_length=1, max_length=100)


class GroupUpdate(BaseModel):
    name: str = PydanticField(min_length=1, max_length=100)


class GroupRef(BaseModel):
    id: str
    name: str


class GroupRead(BaseModel):
    id: str
    name: str
    session_count: int
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_db(cls, g: SessionGroup, session_count: int) -> "GroupRead":
        return cls(
            id=g.id,
            name=g.name,
            session_count=session_count,
            created_at=aware(g.created_at),
            updated_at=aware(g.updated_at),
        )


class AssignGroupRequest(BaseModel):
    session_ids: list[str] = PydanticField(min_length=1, max_length=500)
    # null = gỡ các phiên khỏi nhóm hiện tại
    group_id: str | None
