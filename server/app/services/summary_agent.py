from functools import lru_cache

from pydantic_ai import Agent

from app.config import get_settings
from app.models.session import TranscriptSegment
from app.models.summary import MeetingSummary
from app.services.transcript import segments_to_plain_text

INSTRUCTIONS = """\
Bạn là trợ lý thư ký cuộc họp. Bạn nhận transcript (có thể có nhãn "Người nói N" và mốc thời gian)
và tạo bản tóm tắt có cấu trúc.

Quy tắc:
- Viết bằng cùng ngôn ngữ chiếm đa số trong transcript (thường là tiếng Việt).
- Chỉ dựa trên nội dung transcript, không bịa thêm thông tin.
- owner của action item: chỉ điền khi transcript cho biết rõ ai phụ trách (tên người hoặc "Người nói N");
  không suy đoán.
- Nếu không có quyết định hay việc cần làm nào, trả về danh sách rỗng.
- Transcript nhận dạng giọng nói có thể sai chính tả; hãy hiểu theo ngữ cảnh.
"""


@lru_cache
def get_summary_agent() -> Agent[None, MeetingSummary]:
    # defer_model_check: không khởi tạo provider (và không đòi API key) cho tới lần gọi đầu tiên.
    return Agent(
        get_settings().summary_model,
        output_type=MeetingSummary,
        instructions=INSTRUCTIONS,
        defer_model_check=True,
    )


async def summarize_transcript(
    title: str, segments: list[TranscriptSegment], part_titles: dict[str, str] | None = None
) -> MeetingSummary:
    transcript = segments_to_plain_text(segments, part_titles)
    prompt = f"Tiêu đề phiên: {title}\n\nTranscript:\n{transcript}"
    result = await get_summary_agent().run(prompt)
    return result.output
