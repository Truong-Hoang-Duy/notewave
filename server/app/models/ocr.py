"""Dữ liệu của luồng "Quét tài liệu" (Mistral OCR + rà soát từ tiếng Anh bằng LLM).

Nội dung CHỐT của phiên OCR vẫn nằm ở `NoteSession.segments` (mỗi segment = 1 trang, có `page`), nhờ vậy
tìm kiếm, tóm tắt, xuất file, chỉnh sửa và gộp phiên dùng lại nguyên hạ tầng transcript. Cột JSONB
`NoteSession.ocr` (model `OcrData`) lưu thêm bản OCR gốc, bản đã rà soát và danh sách đề xuất sửa.
"""

from typing import Literal

from pydantic import BaseModel, Field

CorrectionStatus = Literal["pending", "accepted", "rejected", "unavailable"]


class OcrPage(BaseModel):
    page: int = Field(ge=1, description="Số trang, bắt đầu từ 1")
    markdown: str


class ProposedCorrection(BaseModel):
    """Một chỗ sửa do `ocr_review_agent` đề xuất (output có cấu trúc của LLM)."""

    page: int = Field(ge=1, description="Số trang chứa từ cần sửa (theo nhãn '=== Trang N ===')")
    original: str = Field(description="Từ/cụm từ tiếng Anh sai, chép NGUYÊN VĂN như trong trang")
    corrected: str = Field(description="Từ/cụm từ tiếng Anh đúng đề xuất thay thế")
    context: str | None = Field(default=None, description="Câu/đoạn ngắn chứa từ đó, chép nguyên văn")


class OcrReviewOutput(BaseModel):
    corrections: list[ProposedCorrection] = Field(
        default_factory=list, description="Danh sách chỗ sửa; rỗng nếu không có từ tiếng Anh nào cần sửa"
    )


class OcrReviewResult(BaseModel):
    """Kết quả bước rà soát: `corrected_text` do backend ghép bằng cách áp dụng mọi `corrections`
    lên bản OCR gốc (LLM chỉ trả danh sách chỗ sửa, không viết lại tài liệu)."""

    corrected_text: str
    corrected_pages: list[OcrPage]
    corrections: list[ProposedCorrection]
    error: str | None = None


class OcrCorrection(ProposedCorrection):
    id: str
    status: CorrectionStatus = "pending"


class OcrSourceFile(BaseModel):
    """Một file người dùng tải lên trong phiên quét tài liệu (nhiều ảnh/PDF được gộp thành 1 tài liệu theo thứ tự).
    Trang của file đánh số liên tục trong phiên: từ `first_page` tới `first_page + page_count - 1`."""

    filename: str
    first_page: int | None = None  # None khi file lỗi / không có trang
    page_count: int = 0
    error: str | None = None  # file OCR thất bại (các file khác vẫn được giữ)


class OcrData(BaseModel):
    """Lưu trong cột JSONB `note_sessions.ocr`."""

    model: str
    pages_processed: int = 0
    files: list[OcrSourceFile] = Field(default_factory=list)
    raw_pages: list[OcrPage] = Field(default_factory=list)  # bản OCR gốc, không bao giờ bị ghi đè
    reviewed_pages: list[OcrPage] = Field(default_factory=list)  # bản gốc + mọi đề xuất sửa của LLM
    corrections: list[OcrCorrection] = Field(default_factory=list)
    review_error: str | None = None


class OcrInfo(BaseModel):
    """Phần OCR trả về client trong `SessionRead` (không kèm raw/reviewed pages để response gọn)."""

    model: str
    pages_processed: int
    files: list[OcrSourceFile]
    corrections: list[OcrCorrection]
    review_error: str | None


class CorrectionDecision(BaseModel):
    accept: list[str] = Field(default_factory=list, max_length=5000)
    reject: list[str] = Field(default_factory=list, max_length=5000)
