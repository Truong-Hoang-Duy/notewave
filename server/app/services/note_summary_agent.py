"""`note_summary_agent`: tóm tắt AI cho ghi chú Cornell (GĐ3).

Khác `summary_agent` (tóm tắt cuộc họp): đây là ghi chú học tập, nên output hướng tới việc ôn bài — ý chính, khái niệm
cần nhớ và câu hỏi ôn tập (người học có thể thêm thẳng vào cột câu hỏi). Kết quả lưu ở cột riêng `notes.ai_summary`,
KHÔNG bao giờ ghi đè phần tóm tắt người học tự viết. Model dùng chung `SUMMARY_MODEL` (+ `SUMMARY_REASONING_EFFORT`).
"""

from functools import lru_cache

from pydantic_ai import Agent

from app.config import get_settings
from app.models.note import NoteAiSummaryOutput
from app.services.summary_agent import build_model_settings

# Ghi chú rất dài: chỉ gửi phần đầu (đủ cho mọi ghi chú học tập thực tế) để không tạo request khổng lồ.
MAX_PROMPT_CHARS = 120_000

INSTRUCTIONS = """\
Bạn là trợ giảng giúp người học ôn lại ghi chú của chính họ (ghi chú theo phương pháp Cornell, viết bằng Markdown).

Quy tắc:
- Viết bằng cùng ngôn ngữ của ghi chú (thường là tiếng Việt).
- CHỈ dựa trên nội dung ghi chú, không bổ sung kiến thức ngoài, không bịa ví dụ, không suy diễn.
- `summary`: 3-5 câu nêu ghi chú này nói về cái gì và kết luận chính.
- `key_points`: các ý chính, mỗi ý một câu ngắn, theo đúng thứ tự trình bày trong ghi chú. Không lặp lại ý.
- `concepts`: thuật ngữ / định nghĩa / công thức quan trọng xuất hiện trong ghi chú, kèm giải thích ngắn đúng như ghi
  chú trình bày. Công thức toán giữ nguyên LaTeX. Không có thuật ngữ nào đáng ghi thì trả danh sách rỗng.
- `review_questions`: câu hỏi ôn tập bám sát nội dung, PHẢI trả lời được bằng chính ghi chú này. Viết dạng câu hỏi
  ngắn gọn (tối đa ~15 từ), ưu tiên hỏi "vì sao", "khác nhau thế nào", "khi nào dùng" thay vì hỏi lại nguyên văn.
- Bỏ qua phần ghi chú lộn xộn / gạch đầu dòng chưa hoàn chỉnh nếu không hiểu chắc chắn ý.
- Ghi chú quá ngắn hoặc không có nội dung học thuật: vẫn tóm tắt trung thực, các danh sách có thể rỗng.
"""


@lru_cache
def get_note_summary_agent() -> Agent[None, NoteAiSummaryOutput]:
    settings = get_settings()
    return Agent(
        settings.summary_model,
        output_type=NoteAiSummaryOutput,
        instructions=INSTRUCTIONS,
        model_settings=build_model_settings(settings),
        retries=2,
        defer_model_check=True,
    )


def build_prompt(title: str, content_md: str, cues: list[str] | None = None) -> str:
    content = content_md[:MAX_PROMPT_CHARS]
    if len(content_md) > MAX_PROMPT_CHARS:
        content += "\n\n[… ghi chú còn tiếp, phần sau không gửi kèm …]"
    parts = [f"Tiêu đề ghi chú: {title}"]
    questions = [c.strip() for c in (cues or []) if c.strip()]
    if questions:
        # Cột câu hỏi Cornell cho biết người học quan tâm điều gì -> bám theo khi chọn ý chính / câu hỏi ôn tập.
        parts.append("Câu hỏi / từ khoá người học đã ghi ở cột trái:\n" + "\n".join(f"- {q}" for q in questions))
    parts.append(f"Nội dung ghi chú (Markdown):\n{content}")
    return "\n\n".join(parts)


async def summarize_note(title: str, content_md: str, cues: list[str] | None = None) -> NoteAiSummaryOutput:
    result = await get_note_summary_agent().run(build_prompt(title, content_md, cues))
    return result.output
