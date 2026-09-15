from functools import lru_cache

from pydantic_ai import Agent
from pydantic_ai.settings import ModelSettings

from app.config import Settings, get_settings
from app.models.session import TranscriptSegment
from app.models.summary import MeetingSummary
from app.services.transcript import segments_to_plain_text

INSTRUCTIONS = """\
Bạn là trợ lý thư ký cuộc họp. Bạn nhận transcript (có thể có nhãn "Người nói N" và mốc thời gian)
và tạo bản tóm tắt có cấu trúc.

Quy tắc:
- Viết bằng cùng ngôn ngữ chiếm đa số trong transcript (thường là tiếng Việt).
- Chỉ dựa trên nội dung transcript, không bịa thêm thông tin.
- Transcript nhận dạng giọng nói có thể sai chính tả; hãy hiểu theo ngữ cảnh. Bỏ qua câu đệm
  ("Dạ.", "Biết rồi.", "Ok.") khi không mang thông tin.
- Người nói có thể được gọi tên trong transcript (vd: "Anh Minh cập nhật giúp..." rồi Người nói 2 trả lời).
  Khi suy ra chắc chắn được tên, ghi dạng "Tên (Người nói N)"; nếu chỉ biết nhãn thì ghi "Người nói N".
- action_items: mỗi việc chỉ xuất hiện một lần — gộp các câu nhắc lại cùng một việc thành một mục,
  giữ chi tiết cụ thể nhất (ví dụ độ dài file cần test, người cần báo lại).
  owner: chỉ điền khi transcript cho biết rõ ai phụ trách, không suy đoán.
  due: chỉ điền khi có mốc thời hạn cụ thể (vd "trước thứ Sáu", "ngày 22/9"), giữ nguyên cách diễn đạt gốc;
  thời lượng ước tính kiểu "cần thêm hai ngày" không phải thời hạn.
- decisions: chỉ ghi điều đã được chốt/đồng ý, không ghi đề xuất chưa được chấp nhận.
- Nếu không có quyết định hay việc cần làm nào, trả về danh sách rỗng.
"""


def build_model_settings(settings: Settings) -> ModelSettings | None:
    """Tuỳ chỉnh theo provider. `SUMMARY_REASONING_EFFORT` để trống = dùng mặc định của model
    (gpt-5.6-luna mặc định bật reasoning — cho bản tóm tắt chính xác hơn mức `low` khi đo thử)."""
    effort = settings.summary_reasoning_effort.strip().lower()
    if effort and settings.summary_model.startswith("openai"):
        return {"openai_reasoning_effort": effort}  # type: ignore[typeddict-unknown-key]
    return None


@lru_cache
def get_summary_agent() -> Agent[None, MeetingSummary]:
    settings = get_settings()
    # defer_model_check: không khởi tạo provider (và không đòi API key) cho tới lần gọi đầu tiên.
    return Agent(
        settings.summary_model,
        output_type=MeetingSummary,
        instructions=INSTRUCTIONS,
        model_settings=build_model_settings(settings),
        retries=2,
        defer_model_check=True,
    )


async def summarize_transcript(
    title: str, segments: list[TranscriptSegment], part_titles: dict[str, str] | None = None
) -> MeetingSummary:
    transcript = segments_to_plain_text(segments, part_titles)
    prompt = f"Tiêu đề phiên: {title}\n\nTranscript:\n{transcript}"
    result = await get_summary_agent().run(prompt)
    return result.output
