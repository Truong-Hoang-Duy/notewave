"""`ocr_review_agent`: rà soát từ/cụm từ TIẾNG ANH bị OCR nhận sai hoặc viết tay sai chính tả.

Thiết kế: LLM chỉ trả danh sách chỗ sửa (`OcrReviewOutput`), backend tự áp dụng để tạo `corrected_text`.
- Rẻ: không bắt LLM sinh lại toàn bộ tài liệu.
- An toàn: phần tiếng Việt không thể bị viết lại ngoài ý muốn; mỗi chỗ sửa gắn số trang để accept/reject riêng.
- Tài liệu dài được chia thành nhiều phần theo trang, rà soát song song có giới hạn.
Model dùng chung `SUMMARY_MODEL` (+ `SUMMARY_REASONING_EFFORT`) với summary_agent.
"""

import asyncio
import logging
import re
import unicodedata
from functools import lru_cache

from pydantic_ai import Agent

from app.config import get_settings
from app.models.ocr import OcrPage, OcrReviewOutput, OcrReviewResult, ProposedCorrection
from app.services.summary_agent import build_model_settings

logger = logging.getLogger(__name__)

# Mỗi lần gọi LLM rà soát tối đa chừng này ký tự Markdown (trang dài hơn vẫn đi nguyên trang).
CHUNK_CHAR_BUDGET = 40_000
MAX_CONCURRENT_CHUNKS = 4

INSTRUCTIONS = """\
Bạn là người hiệu đính văn bản được trích xuất bằng OCR từ ảnh chụp/PDF: thường là ghi chú viết tay
bằng tiếng Việt có chèn từ, tên riêng hoặc thuật ngữ chuyên ngành TIẾNG ANH. Chữ viết tay xấu hoặc người viết
sai chính tả khiến các từ tiếng Anh này bị nhận sai (vd "meeting" thành "meetting", "deadline" thành "dead1ine",
"Kubernetes" thành "Kubernetis").

Nhiệm vụ: CHỈ tìm các từ/cụm từ tiếng Anh bị sai và đề xuất cách viết đúng, dựa vào ngữ cảnh tiếng Việt xung quanh.

Quy tắc bắt buộc:
- KHÔNG sửa, diễn giải, dịch hay chuẩn hoá phần tiếng Việt (kể cả khi tiếng Việt có lỗi chính tả).
- KHÔNG thêm/bớt ý, không đổi định dạng Markdown, không sửa số liệu, ngày tháng.
- Chỉ đề xuất khi khá chắc chắn từ đó là tiếng Anh bị sai; từ tiếng Anh đã đúng thì bỏ qua. Không đổi hoa/thường
  nếu không sai.
- `original` phải chép NGUYÊN VĂN (đúng từng ký tự) như xuất hiện trong trang; ưu tiên đơn vị nhỏ nhất bao trọn lỗi
  (một từ, hoặc cụm từ nếu lỗi nằm ở nhiều từ liền nhau). Các mục không được chồng lấn nhau.
- `corrected` chỉ gồm từ tiếng Anh đúng (không kèm giải thích).
- `page` là số trang theo nhãn "=== Trang N ===" chứa từ đó. Cùng một lỗi lặp lại nhiều lần trong một trang chỉ ghi
  một mục (sẽ được sửa ở mọi vị trí trong trang).
- `context`: câu/đoạn ngắn (tối đa ~15 từ) chứa từ đó, chép nguyên văn.
- Nếu không có gì cần sửa, trả về danh sách rỗng.
"""

# `corrected` chỉ được chứa ký tự Latin cơ bản / số / dấu câu (từ tiếng Anh) — chặn trường hợp LLM "sửa" sang tiếng Việt.
_ENGLISH_ONLY = re.compile(r"^[\x20-\x7E]+$")
# Chữ cái chỉ có trong tiếng Việt (ă â đ ê ô ơ ư và nguyên âm mang dấu thanh ở khối Latin Extended Additional).
_VIETNAMESE_LETTERS = re.compile(r"[ăâđêôơưĂÂĐÊÔƠƯẠ-ỹ]")


def _strip_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text.replace("đ", "d").replace("Đ", "D"))
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def _looks_like_vietnamese_edit(original: str, corrected: str) -> bool:
    """Chặn đề xuất đụng vào tiếng Việt: từ gốc mang chữ cái riêng của tiếng Việt, hoặc chỉ là bỏ dấu ("là" -> "la")."""
    return bool(_VIETNAMESE_LETTERS.search(unicodedata.normalize("NFC", original))) or _strip_accents(original) == corrected


@lru_cache
def get_ocr_review_agent() -> Agent[None, OcrReviewOutput]:
    settings = get_settings()
    return Agent(
        settings.summary_model,
        output_type=OcrReviewOutput,
        instructions=INSTRUCTIONS,
        model_settings=build_model_settings(settings),
        retries=2,
        defer_model_check=True,
    )


def _word_pattern(original: str) -> re.Pattern[str]:
    # Chỉ khớp nguyên từ: không thay "API" bên trong "APIs" hay "rapid".
    return re.compile(rf"(?<!\w){re.escape(original)}(?!\w)")


# Công thức LaTeX do Mistral OCR trả ($$...$$, \[...\], \(...\), $...$) — không bao giờ sửa chữ bên trong: `\sin`, `\lim`,
# tên biến... là lệnh / ký hiệu LaTeX, không phải lỗi chính tả (render bằng KaTeX ở OcrDocumentView).
_MATH_SPAN = re.compile(r"\$\$.+?\$\$|\\\[.+?\\\]|\\\(.+?\\\)|(?<![\\$])\$(?!\s)[^$\n]+?(?<!\s)\$(?![$\d])", re.DOTALL)


def _matches_outside_math(pattern: re.Pattern[str], text: str) -> list[re.Match[str]]:
    spans = [m.span() for m in _MATH_SPAN.finditer(text)]
    return [m for m in pattern.finditer(text) if not any(m.start() < end and m.end() > start for start, end in spans)]


def apply_correction(text: str, original: str, corrected: str) -> tuple[str, int]:
    """Thay mọi lần xuất hiện NGUYÊN TỪ `original` (ngoài công thức) bằng `corrected`. Trả (text mới, số chỗ đã thay)."""
    if not original:
        return text, 0
    matches = _matches_outside_math(_word_pattern(original), text)
    for m in reversed(matches):
        text = text[: m.start()] + corrected + text[m.end() :]
    return text, len(matches)


def page_label(page: int) -> str:
    return f"=== Trang {page} ==="


def chunk_pages(pages: list[OcrPage], budget: int = CHUNK_CHAR_BUDGET) -> list[list[OcrPage]]:
    chunks: list[list[OcrPage]] = []
    current: list[OcrPage] = []
    size = 0
    for page in pages:
        length = len(page.markdown)
        if current and size + length > budget:
            chunks.append(current)
            current, size = [], 0
        current.append(page)
        size += length
    if current:
        chunks.append(current)
    return chunks


def pages_to_prompt(pages: list[OcrPage]) -> str:
    return "\n\n".join(f"{page_label(p.page)}\n{p.markdown}" for p in pages)


def normalize_corrections(pages: list[OcrPage], proposed: list[ProposedCorrection]) -> list[ProposedCorrection]:
    """Lọc đề xuất của LLM: đúng trang, `original` có thật trong trang, `corrected` khác và chỉ là chữ Latin cơ bản,
    không trùng lặp."""
    by_page = {p.page: p.markdown for p in pages}
    seen: set[tuple[int, str]] = set()
    result: list[ProposedCorrection] = []
    for c in proposed:
        original, corrected = c.original.strip(), c.corrected.strip()
        text = by_page.get(c.page)
        if text is None or not original or not corrected or original == corrected:
            continue
        if not _ENGLISH_ONLY.match(corrected) or _looks_like_vietnamese_edit(original, corrected):
            continue
        if (c.page, original) in seen:
            continue
        if not _matches_outside_math(_word_pattern(original), text):
            continue  # không có thật, hoặc chỉ nằm trong công thức LaTeX
        seen.add((c.page, original))
        context = (c.context or "").strip() or None
        result.append(ProposedCorrection(page=c.page, original=original, corrected=corrected, context=context))
    return result


def apply_all(pages: list[OcrPage], corrections: list[ProposedCorrection]) -> tuple[list[OcrPage], list[ProposedCorrection]]:
    """Áp dụng lần lượt mọi đề xuất lên bản gốc -> bản đã rà soát. Đề xuất không còn khớp (bị đề xuất trước che mất)
    thì bỏ, để danh sách corrections luôn nhất quán với `reviewed_pages`."""
    texts = {p.page: p.markdown for p in pages}
    kept: list[ProposedCorrection] = []
    for c in corrections:
        new_text, count = apply_correction(texts[c.page], c.original, c.corrected)
        if count:
            texts[c.page] = new_text
            kept.append(c)
    return [OcrPage(page=p.page, markdown=texts[p.page]) for p in pages], kept


async def _review_chunk(pages: list[OcrPage], semaphore: asyncio.Semaphore) -> list[ProposedCorrection]:
    async with semaphore:
        result = await get_ocr_review_agent().run(
            "Rà soát các từ tiếng Anh trong nội dung OCR sau:\n\n" + pages_to_prompt(pages)
        )
    return result.output.corrections


async def review_ocr_pages(pages: list[OcrPage]) -> OcrReviewResult:
    """Chạy agent trên toàn bộ tài liệu. Lỗi LLM không ném ra ngoài: trả `error` và giữ các phần đã rà soát được
    (phiên OCR vẫn completed, UI hiện cảnh báo)."""
    non_empty = [p for p in pages if p.markdown.strip()]
    proposed: list[ProposedCorrection] = []
    error: str | None = None
    if non_empty:
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_CHUNKS)
        chunks = chunk_pages(non_empty)
        results = await asyncio.gather(*(_review_chunk(c, semaphore) for c in chunks), return_exceptions=True)
        failed = 0
        for chunk_result in results:
            if isinstance(chunk_result, BaseException):
                failed += 1
                logger.warning("Rà soát OCR bằng LLM thất bại: %r", chunk_result)
            else:
                proposed.extend(chunk_result)
        if failed:
            error = (
                "Chưa rà soát được từ tiếng Anh cho tài liệu này."
                if failed == len(chunks)
                else f"Chưa rà soát được {failed}/{len(chunks)} phần của tài liệu."
            )

    corrections = normalize_corrections(pages, proposed)
    corrected_pages, corrections = apply_all(pages, corrections)
    return OcrReviewResult(
        corrected_text=pages_to_plain(corrected_pages),
        corrected_pages=corrected_pages,
        corrections=corrections,
        error=error,
    )


def pages_to_plain(pages: list[OcrPage]) -> str:
    return "\n\n".join(p.markdown for p in pages if p.markdown)
