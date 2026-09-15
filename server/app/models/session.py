import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field as PydanticField
from sqlalchemy import Column, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.models.common import aware, tz_column, utcnow
from app.models.group import GroupRef, SessionGroup
from app.models.summary import MeetingSummary

SessionSource = Literal["live", "upload"]
SessionStatus = Literal["processing", "completed", "failed"]


class TranscriptSegment(BaseModel):
    """Một đoạn transcript liên tục của cùng một người nói."""

    speaker: str | None = None
    text: str
    start_ms: int | None = None
    end_ms: int | None = None
    language: str | None = None
    # Id phiên gốc của đoạn này (chỉ có ở phiên được gộp) — UI dùng để vẽ đường phân cách.
    origin: str | None = None


class MergeSource(BaseModel):
    """Thông tin phiên gốc đã được gộp vào một phiên (lưu dạng snapshot, vẫn đúng khi bản gốc bị xoá)."""

    id: str
    title: str
    source: SessionSource
    created_at: datetime
    duration_ms: int | None = None
    offset_ms: int = 0


class NoteSession(SQLModel, table=True):
    __tablename__ = "note_sessions"

    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True, max_length=32)
    title: str = Field(max_length=200)
    source: str = Field(max_length=10, index=True)
    status: str = Field(default="completed", max_length=12)
    segments: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSONB, nullable=False))
    # Bản text phẳng của transcript, dùng cho tìm kiếm.
    transcript_text: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    duration_ms: int | None = None
    summary: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB, nullable=True))
    # True khi transcript bị chỉnh sửa sau lần tóm tắt gần nhất.
    summary_outdated: bool = Field(default=False)
    error_message: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    original_filename: str | None = Field(default=None, max_length=255)
    soniox_file_id: str | None = Field(default=None, max_length=64)
    soniox_transcription_id: str | None = Field(default=None, max_length=64, index=True)
    # Không khai báo ForeignKey ở mức DB để thêm cột được bằng ALTER TABLE trên DB cũ;
    # khi xoá nhóm, router tự gỡ group_id của các phiên.
    group_id: str | None = Field(default=None, max_length=32, index=True)
    merge_sources: list[dict[str, Any]] | None = Field(default=None, sa_column=Column(JSONB, nullable=True))
    archived_at: datetime | None = Field(default=None, sa_column=tz_column(nullable=True, index=True))
    merged_into_id: str | None = Field(default=None, max_length=32)
    created_at: datetime = Field(default_factory=utcnow, sa_column=tz_column(index=True))
    updated_at: datetime = Field(default_factory=utcnow, sa_column=tz_column())

    def set_segments(self, segments: list[TranscriptSegment]) -> None:
        self.segments = [s.model_dump(exclude_none=True) for s in segments]
        self.transcript_text = "\n".join(s.text.strip() for s in segments if s.text.strip())

    def touch(self) -> None:
        self.updated_at = utcnow()


def _group_ref(group: SessionGroup | None) -> GroupRef | None:
    return GroupRef(id=group.id, name=group.name) if group else None


# ---- Schemas cho API ----


class SessionCreate(BaseModel):
    title: str | None = PydanticField(default=None, max_length=200)
    source: SessionSource = "live"
    segments: list[TranscriptSegment] = PydanticField(default_factory=list)
    duration_ms: int | None = PydanticField(default=None, ge=0)


class SessionUpdate(BaseModel):
    title: str = PydanticField(min_length=1, max_length=200)


class SegmentsUpdate(BaseModel):
    segments: list[TranscriptSegment]


class MergeRequest(BaseModel):
    # Thứ tự trong danh sách chính là thứ tự nối transcript.
    session_ids: list[str] = PydanticField(min_length=2, max_length=50)
    title: str | None = PydanticField(default=None, max_length=200)
    group_id: str | None = None
    # False: lưu trữ (archive) bản gốc, có thể khôi phục. True: xoá vĩnh viễn bản gốc.
    delete_originals: bool = False


class SessionListItem(BaseModel):
    id: str
    title: str
    source: SessionSource
    status: SessionStatus
    duration_ms: int | None
    preview: str
    speaker_count: int
    has_summary: bool
    original_filename: str | None
    group: GroupRef | None
    merged_count: int
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_db(cls, s: NoteSession, group: SessionGroup | None = None) -> "SessionListItem":
        speakers = {seg.get("speaker") for seg in s.segments if seg.get("speaker")}
        return cls(
            id=s.id,
            title=s.title,
            source=s.source,  # type: ignore[arg-type]
            status=s.status,  # type: ignore[arg-type]
            duration_ms=s.duration_ms,
            preview=s.transcript_text[:180],
            speaker_count=len(speakers),
            has_summary=s.summary is not None,
            original_filename=s.original_filename,
            group=_group_ref(group),
            merged_count=len(s.merge_sources or []),
            archived_at=aware(s.archived_at),
            created_at=aware(s.created_at),
            updated_at=aware(s.updated_at),
        )


class SessionRead(BaseModel):
    id: str
    title: str
    source: SessionSource
    status: SessionStatus
    segments: list[TranscriptSegment]
    duration_ms: int | None
    summary: MeetingSummary | None
    summary_outdated: bool
    error_message: str | None
    original_filename: str | None
    group: GroupRef | None
    merge_sources: list[MergeSource]
    archived_at: datetime | None
    merged_into_id: str | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_db(cls, s: NoteSession, group: SessionGroup | None = None) -> "SessionRead":
        return cls(
            id=s.id,
            title=s.title,
            source=s.source,  # type: ignore[arg-type]
            status=s.status,  # type: ignore[arg-type]
            segments=[TranscriptSegment.model_validate(seg) for seg in s.segments],
            duration_ms=s.duration_ms,
            summary=MeetingSummary.model_validate(s.summary) if s.summary else None,
            summary_outdated=bool(s.summary_outdated) and s.summary is not None,
            error_message=s.error_message,
            original_filename=s.original_filename,
            group=_group_ref(group),
            merge_sources=[MergeSource.model_validate(m) for m in (s.merge_sources or [])],
            archived_at=aware(s.archived_at),
            merged_into_id=s.merged_into_id,
            created_at=aware(s.created_at),
            updated_at=aware(s.updated_at),
        )


class SessionList(BaseModel):
    items: list[SessionListItem]
    total: int


class UploadStatus(BaseModel):
    session_id: str
    status: SessionStatus
    error_message: str | None = None
