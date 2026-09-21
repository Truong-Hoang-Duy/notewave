"""`note_proofread_agent`: soát lỗi chính tả / lỗi gõ cho nội dung ghi chú (GĐ3).

Theo đúng mẫu `ocr_review_agent` (LLM chỉ trả DANH SÁCH chỗ sửa, không viết lại tài liệu) nhưng khác hai điểm:
- Soát cả tiếng Việt lẫn tiếng Anh (quyết định của người dùng 2026-09-21): ghi chú tự gõ hay sai dấu, thiếu dấu,
  gõ nhầm phím — đó mới là lỗi phổ biến nhất.
- Backend KHÔNG tự áp dụng: nội dung thật nằm trong Tiptap JSON ở frontend, nên frontend mới là nơi thay chữ sau khi
  người dùng duyệt từng mục (xem `client/src/lib/noteProofread.js`).

Chỉ chạy khi người dùng bấm nút (không chạy mỗi lần tự lưu). Model dùng chung `SUMMARY_MODEL`.
"""

import asyncio
import logging
import re
import uuid
from functools import lru_cache

from pydantic_ai import Agent

from app.config import get_settings
from app.models.note import ProofreadItem, ProofreadOutput, ProofreadResult, ProofreadSuggestion
from app.services.summary_agent import build_model_settings

logger = logging.getLogger(__name__)

CHUNK_CHAR_BUDGET = 20_000
MAX_CONCURRENT_CHUNKS = 4
MAX_SUGGESTIONS = 200
MAX_TERM_CHARS = 120

INSTRUCTIONS = """\
Bạn là người soát lỗi chính tả cho ghi chú học tập viết bằng Markdown, chủ yếu tiếng Việt có xen thuật ngữ tiếng Anh.

Nhiệm vụ: CHỈ tìm lỗi chính tả và lỗi gõ phím, đề xuất cách viết đúng.

Được sửa:
- Tiếng Việt: thiếu dấu thanh / sai dấu ("nghia" -> "nghĩa", "hoc" -> "học", "sử lý" -> "xử lý"), sai phụ âm đầu/cuối
  thường gặp ("ngĩ" -> "nghĩ"), gõ dính hoặc thiếu chữ do lỗi bàn phím ("đạoham" -> "đạo hàm").
- Tiếng Anh: từ / thuật ngữ / tên riêng viết sai ("meetting" -> "meeting", "Kubernetis" -> "Kubernetes").
- Viết hoa sai ở tên riêng khi chắc chắn ("hà nội" -> "Hà Nội").

KHÔNG được làm:
- KHÔNG viết lại câu, không đổi cách diễn đạt, không thêm/bớt ý, không dịch, không chuẩn hoá văn phong.
- KHÔNG sửa số liệu, ngày tháng, công thức toán, ký hiệu LaTeX, mã nguồn, đường dẫn/URL, tên file.
- KHÔNG đụng vào từ viết tắt hoặc cách ghi tắt cố ý của người học (vd "kn", "vd", "dt") — chỉ bỏ qua.
- KHÔNG sửa dấu câu, khoảng trắng, xuống dòng hay ký hiệu Markdown (#, -, *, >, |).
- Không chắc chắn thì BỎ QUA. Thà bỏ sót còn hơn sửa sai ý người học.

Quy tắc cho từng mục:
- `original`: chép NGUYÊN VĂN (đúng từng ký tự) như trong ghi chú, lấy đơn vị nhỏ nhất bao trọn lỗi (một từ, hoặc cụm
  từ nếu lỗi nằm ở nhiều từ liền nhau). Các mục không chồng lấn nhau. Cùng một lỗi lặp lại chỉ ghi MỘT mục
  (sẽ được thay ở mọi vị trí trong ghi chú).
- `corrected`: chỉ là cách viết đúng của chính từ/cụm đó, không kèm giải thích.
- `context`: câu ngắn (tối đa ~15 từ) chứa từ đó, chép nguyên văn.
- `reason`: lý do rất ngắn bằng tiếng Việt, vd "thiếu dấu", "sai chính tả", "tên riêng viết hoa".
- Không có lỗi nào thì trả về danh sách rỗng.
"""

# Vùng không bao giờ được đụng tới: khối code, code trong dòng, công thức LaTeX, đích của link/ảnh (kể cả
# `[[Tiêu đề]](/notes/<id>)` của liên kết giữa các ghi chú) và URL trần.
_PROTECTED = re.compile(
    r"```.*?```|~~~.*?~~~|`[^`\n]+`|\$\$.+?\$\$|(?<![\\$])\$(?!\s)[^$\n]+?(?<!\s)\$(?![$\d])|\]\([^)\n]*\)|https?://\S+",
    re.DOTALL,
)
# `corrected` không được mang ký tự cấu trúc Markdown / LaTeX (chặn LLM "sửa" thành đoạn văn bản khác kiểu).
_FORBIDDEN_IN_CORRECTED = re.compile(r"[`$|\[\]<>\\\n\r]")


def word_pattern(original: str) -> re.Pattern[str]:
    """Chỉ khớp nguyên từ/cụm từ (không thay "hoc" nằm trong "hocsinh")."""
    return re.compile(rf"(?<!\w){re.escape(original)}(?!\w)")


def matches_outside_protected(pattern: re.Pattern[str], text: str) -> list[re.Match[str]]:
    spans = [m.span() for m in _PROTECTED.finditer(text)]
    return [m for m in pattern.finditer(text) if not any(m.start() < end and m.end() > start for start, end in spans)]


def chunk_markdown(content: str, budget: int = CHUNK_CHAR_BUDGET) -> list[str]:
    """Chia nội dung theo đoạn (dòng trống) để mỗi lần gọi LLM không quá dài; đoạn dài hơn budget vẫn đi nguyên đoạn."""
    chunks: list[str] = []
    current: list[str] = []
    size = 0
    for block in content.split("\n\n"):
        if current and size + len(block) > budget:
            chunks.append("\n\n".join(current))
            current, size = [], 0
        current.append(block)
        size += len(block) + 2
    if current:
        chunks.append("\n\n".join(current))
    return [c for c in chunks if c.strip()]


@lru_cache
def get_note_proofread_agent() -> Agent[None, ProofreadOutput]:
    settings = get_settings()
    return Agent(
        settings.summary_model,
        output_type=ProofreadOutput,
        instructions=INSTRUCTIONS,
        model_settings=build_model_settings(settings),
        retries=2,
        defer_model_check=True,
    )


def normalize_suggestions(content: str, proposed: list[ProofreadSuggestion]) -> list[ProofreadItem]:
    """Lọc đề xuất của LLM: `original` phải có thật trong nội dung (ngoài code/công thức/URL), `corrected` khác và
    không chứa ký tự cấu trúc, không trùng lặp. Kèm số lần xuất hiện để UI cho biết sẽ thay bao nhiêu chỗ."""
    seen: set[str] = set()
    result: list[ProofreadItem] = []
    for s in proposed:
        original, corrected = s.original.strip(), s.corrected.strip()
        if not original or not corrected or original == corrected or original in seen:
            continue
        if len(original) > MAX_TERM_CHARS or len(corrected) > MAX_TERM_CHARS:
            continue
        if "\n" in original or _FORBIDDEN_IN_CORRECTED.search(corrected):
            continue
        if not re.search(r"\w", original):  # chỉ dấu câu / khoảng trắng
            continue
        occurrences = len(matches_outside_protected(word_pattern(original), content))
        if not occurrences:
            continue  # không có thật, hoặc chỉ nằm trong code / công thức / URL
        seen.add(original)
        result.append(
            ProofreadItem(
                id=uuid.uuid4().hex[:12],
                original=original,
                corrected=corrected,
                context=(s.context or "").strip() or None,
                reason=(s.reason or "").strip() or None,
                occurrences=occurrences,
            )
        )
        if len(result) >= MAX_SUGGESTIONS:
            break
    return result


async def _proofread_chunk(chunk: str, semaphore: asyncio.Semaphore) -> list[ProofreadSuggestion]:
    async with semaphore:
        result = await get_note_proofread_agent().run("Soát lỗi chính tả cho ghi chú sau:\n\n" + chunk)
    return result.output.suggestions


async def proofread_note(content_md: str) -> ProofreadResult:
    """Soát toàn bộ nội dung. Lỗi LLM không ném ra ngoài: trả các đề xuất lấy được kèm `error` để UI cảnh báo."""
    chunks = chunk_markdown(content_md, CHUNK_CHAR_BUDGET)
    if not chunks:
        return ProofreadResult(suggestions=[])
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_CHUNKS)
    results = await asyncio.gather(*(_proofread_chunk(c, semaphore) for c in chunks), return_exceptions=True)
    proposed: list[ProofreadSuggestion] = []
    failed = 0
    for chunk_result in results:
        if isinstance(chunk_result, BaseException):
            failed += 1
            logger.warning("Soát lỗi ghi chú bằng LLM thất bại: %r", chunk_result)
        else:
            proposed.extend(chunk_result)
    error = None
    if failed:
        error = (
            "Chưa soát được lỗi chính tả cho ghi chú này."
            if failed == len(chunks)
            else f"Chưa soát được {failed}/{len(chunks)} phần của ghi chú."
        )
    return ProofreadResult(suggestions=normalize_suggestions(content_md, proposed), error=error)
