from pydantic import BaseModel, Field


class ActionItem(BaseModel):
    task: str = Field(description="Việc cần làm, viết ngắn gọn")
    owner: str | None = Field(
        default=None,
        description="Người phụ trách nếu transcript nhắc tới rõ ràng, ngược lại để null",
    )
    due: str | None = Field(
        default=None,
        description="Thời hạn nếu transcript nhắc tới, giữ nguyên cách diễn đạt gốc",
    )


class MeetingSummary(BaseModel):
    summary: str = Field(description="Tóm tắt ngắn gọn nội dung cuộc họp (3-6 câu)")
    key_points: list[str] = Field(default_factory=list, description="Các ý chính đã thảo luận")
    action_items: list[ActionItem] = Field(default_factory=list)
    decisions: list[str] = Field(default_factory=list, description="Các quyết định chính đã đưa ra")
