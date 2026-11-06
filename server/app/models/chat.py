"""Models cho luồng Chat AI Agent (hỏi đáp tự do + tự truy vấn tài liệu/ghi chú bằng tools)."""

from typing import Literal

from pydantic import BaseModel, Field


class ChatHistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=12_000)


class ChatAskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=8_000)
    session_ids: list[str] = Field(default_factory=list, max_length=30)
    note_ids: list[str] = Field(default_factory=list, max_length=30)
    history: list[ChatHistoryItem] = Field(default_factory=list, max_length=30)


class ChatSourceRef(BaseModel):
    source_type: Literal["session", "note"]
    id: str
    title: str
    source_kind: str  # "live" | "upload" | "ocr" | "note"


class ChatAskResponse(BaseModel):
    answer_md: str
    used_sources: list[ChatSourceRef] = Field(default_factory=list)
    model: str
