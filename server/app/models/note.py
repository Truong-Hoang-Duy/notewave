"""Ghi chú theo phương pháp Cornell: cột câu hỏi (cues) — nội dung chi tiết — dải tóm tắt tự viết.

Note là đối tượng độc lập với phiên ghi âm/OCR (không liên kết `NoteSession`). Tổ chức bằng thư mục dạng cây
(`NoteFolder.parent_id`) + tag nhiều-nhiều (`NoteTagLink`). Giống `SessionGroup`, không khai báo FK ở mức DB:
router tự dọn liên kết khi xoá thư mục / tag / note.
"""

import hashlib
import re
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field as PydanticField
from sqlalchemy import Column, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.models.common import aware, tz_column, utcnow

NoteSort = Literal["updated_desc", "created_desc", "created_asc", "title_asc", "title_desc"]

# Giao diện riêng từng note — chọn từ bộ có sẵn (không nhận mã màu tự do) để luôn đủ tương phản.
NoteTheme = Literal["paper", "white", "sepia", "mint", "sky", "dark"]
NoteFont = Literal["sans", "serif", "mono", "hand"]
NoteFontSize = Literal["sm", "md", "lg", "xl"]

MAX_CONTENT_CHARS = 1_000_000


class NoteFolder(SQLModel, table=True):
    __tablename__ = "note_folders"

    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True, max_length=32)
    name: str = Field(max_length=100)
    # None = thư mục gốc. Tên không trùng trong cùng một thư mục cha (không phân biệt hoa thường).
    parent_id: str | None = Field(default=None, max_length=32, index=True)
    created_at: datetime = Field(default_factory=utcnow, sa_column=tz_column())
    updated_at: datetime = Field(default_factory=utcnow, sa_column=tz_column())

    def touch(self) -> None:
        self.updated_at = utcnow()


class NoteTag(SQLModel, table=True):
    __tablename__ = "note_tags"

    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True, max_length=32)
    # Không trùng tên (không phân biệt hoa thường) — giống tên nhóm.
    name: str = Field(max_length=50, index=True)
    created_at: datetime = Field(default_factory=utcnow, sa_column=tz_column())


class NoteTagLink(SQLModel, table=True):
    __tablename__ = "note_tag_links"

    note_id: str = Field(primary_key=True, max_length=32)
    tag_id: str = Field(primary_key=True, max_length=32, index=True)


class NoteLink(SQLModel, table=True):
    """Liên kết `[[...]]` từ note này sang note khác. Backend tính lại toàn bộ liên kết của note nguồn mỗi lần nội dung
    được lưu (`services/note_links.py`) — bảng chỉ là chỉ mục để tra ngược (backlink) cho nhanh, nguồn sự thật vẫn là
    `content_md`. Không khai báo FK ở mức DB (giống các bảng khác): router tự dọn khi xoá note."""

    __tablename__ = "note_links"

    source_id: str = Field(primary_key=True, max_length=32)
    target_id: str = Field(primary_key=True, max_length=32, index=True)


class Note(SQLModel, table=True):
    __tablename__ = "notes"

    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True, max_length=32)
    title: str = Field(max_length=200)
    folder_id: str | None = Field(default=None, max_length=32, index=True)
    # Cột trái: danh sách câu hỏi/từ khoá, mỗi câu có thể neo vào 1 khối (id do Tiptap UniqueID sinh) của nội dung.
    cues: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSONB, nullable=False))
    # Cột phải: JSON của Tiptap (để mở lại editor) + Markdown do frontend sinh (backend dùng cho tìm kiếm/export/AI).
    content_json: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB, nullable=True))
    content_md: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    # Dải dưới: tóm tắt người học TỰ viết (tóm tắt AI nằm ở cột riêng `ai_summary`, không bao giờ ghi đè cột này).
    summary: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    # Tóm tắt do AI tạo (JSONB của `NoteAiSummary`): ý chính, khái niệm, câu hỏi ôn tập + `source_hash` của nội dung lúc
    # tạo, nhờ vậy biết bản tóm tắt đã cũ so với nội dung hiện tại mà không cần thêm cột cờ.
    ai_summary: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB, nullable=True))
    style: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB, nullable=True))
    # Gộp tiêu đề + câu hỏi + nội dung + tóm tắt thành chữ thường để tìm kiếm bằng 1 điều kiện LIKE.
    search_text: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    created_at: datetime = Field(default_factory=utcnow, sa_column=tz_column(index=True))
    updated_at: datetime = Field(default_factory=utcnow, sa_column=tz_column(index=True))

    def refresh_search_text(self) -> None:
        cue_text = "\n".join(str(c.get("text", "")) for c in self.cues)
        self.search_text = "\n".join((self.title, cue_text, self.content_md, self.summary)).lower()

    def touch(self) -> None:
        self.updated_at = utcnow()


# ---- Schemas cho API ----


class NoteCue(BaseModel):
    id: str = PydanticField(min_length=1, max_length=40)
    text: str = PydanticField(default="", max_length=1000)
    # Id khối nội dung được neo (thuộc tính `data-id` của Tiptap UniqueID); None = chưa neo.
    anchor: str | None = PydanticField(default=None, max_length=64)


class NoteStyle(BaseModel):
    theme: NoteTheme | None = None
    font: NoteFont | None = None
    font_size: NoteFontSize | None = None


class FolderRef(BaseModel):
    id: str
    name: str


class TagRef(BaseModel):
    id: str
    name: str


# ---- GĐ3: tóm tắt AI + soát lỗi chính tả + liên kết giữa các ghi chú ----


def content_hash(content_md: str) -> str:
    """Vân tay của nội dung lúc tạo tóm tắt AI — đổi nội dung thì `ai_summary_outdated` tự bật, không cần cột cờ."""
    return hashlib.sha1(content_md.encode("utf-8")).hexdigest()[:16]


class NoteConcept(BaseModel):
    term: str = PydanticField(description="Thuật ngữ / khái niệm xuất hiện trong ghi chú")
    meaning: str = PydanticField(description="Giải thích ngắn gọn theo đúng cách ghi chú trình bày")


class NoteAiSummaryOutput(BaseModel):
    """Output có cấu trúc của `note_summary_agent` (LLM)."""

    summary: str = PydanticField(description="Tóm tắt bài học trong 3-5 câu")
    key_points: list[str] = PydanticField(default_factory=list, description="Các ý chính, mỗi ý một câu ngắn")
    concepts: list[NoteConcept] = PydanticField(default_factory=list, description="Khái niệm / thuật ngữ cần nhớ")
    review_questions: list[str] = PydanticField(
        default_factory=list, description="Câu hỏi ôn tập bám sát nội dung, có thể trả lời được bằng chính ghi chú"
    )


class NoteAiSummary(NoteAiSummaryOutput):
    """Bản lưu trong cột JSONB `notes.ai_summary` (và cũng là response của endpoint tạo tóm tắt)."""

    model: str
    generated_at: datetime
    source_hash: str


class ProofreadSuggestion(BaseModel):
    """Một chỗ sửa chính tả do `note_proofread_agent` đề xuất; người dùng duyệt từng mục ở frontend rồi frontend mới
    thay chữ trong editor (backend KHÔNG tự sửa nội dung vì nội dung thật nằm ở Tiptap JSON)."""

    original: str = PydanticField(description="Từ/cụm từ viết sai, chép NGUYÊN VĂN như trong ghi chú")
    corrected: str = PydanticField(description="Cách viết đúng để thay thế")
    context: str | None = PydanticField(default=None, description="Câu ngắn chứa từ đó, chép nguyên văn")
    reason: str | None = PydanticField(default=None, description="Lý do rất ngắn bằng tiếng Việt, vd 'thiếu dấu'")


class ProofreadOutput(BaseModel):
    suggestions: list[ProofreadSuggestion] = PydanticField(
        default_factory=list, description="Danh sách chỗ sửa; rỗng nếu không có lỗi nào"
    )


class ProofreadItem(ProofreadSuggestion):
    id: str
    occurrences: int = PydanticField(description="Số lần từ này xuất hiện trong nội dung (sẽ được thay ở mọi chỗ)")


class ProofreadResult(BaseModel):
    suggestions: list[ProofreadItem]
    error: str | None = None  # LLM lỗi một phần: vẫn trả các đề xuất lấy được kèm cảnh báo


class NoteLinkRef(BaseModel):
    """Một note ở đầu kia của liên kết (dùng cho cả liên kết đi ra và backlink)."""

    id: str
    title: str
    folder: FolderRef | None = None


class NoteLinks(BaseModel):
    incoming: list[NoteLinkRef]  # note khác đang trỏ tới note này (backlink)
    outgoing: list[NoteLinkRef]  # note mà nội dung note này đang trỏ tới


class NoteCreate(BaseModel):
    title: str | None = PydanticField(default=None, max_length=200)
    folder_id: str | None = None
    tag_ids: list[str] = PydanticField(default_factory=list, max_length=50)


class NoteUpdate(BaseModel):
    """PATCH từng phần (autosave chỉ gửi field đã đổi). `folder_id: null` gửi tường minh = chuyển về gốc."""

    title: str | None = PydanticField(default=None, max_length=200)
    folder_id: str | None = None
    tag_ids: list[str] | None = PydanticField(default=None, max_length=50)
    cues: list[NoteCue] | None = PydanticField(default=None, max_length=500)
    content_json: dict[str, Any] | None = None
    content_md: str | None = PydanticField(default=None, max_length=MAX_CONTENT_CHARS)
    summary: str | None = PydanticField(default=None, max_length=50_000)
    style: NoteStyle | None = None


_LINE_MARKERS = re.compile(r"^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?", re.MULTILINE)
_MARKDOWN_NOISE = re.compile(r"[#*_`>|~\\]+|!\[[^\]]*\]\([^)]*\)|-{3,}")


def _preview(note: Note) -> str:
    text = _LINE_MARKERS.sub("", note.content_md[:600])
    return " ".join(_MARKDOWN_NOISE.sub(" ", text).split())[:180]


class NoteListItem(BaseModel):
    id: str
    title: str
    folder: FolderRef | None
    tags: list[TagRef]
    preview: str
    cue_count: int
    has_summary: bool
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_db(cls, n: Note, folder: NoteFolder | None, tags: list[NoteTag]) -> "NoteListItem":
        return cls(
            id=n.id,
            title=n.title,
            folder=FolderRef(id=folder.id, name=folder.name) if folder else None,
            tags=[TagRef(id=t.id, name=t.name) for t in tags],
            preview=_preview(n),
            cue_count=sum(1 for c in n.cues if str(c.get("text", "")).strip()),
            has_summary=bool(n.summary.strip()),
            created_at=aware(n.created_at),
            updated_at=aware(n.updated_at),
        )


class NoteRead(BaseModel):
    id: str
    title: str
    folder: FolderRef | None
    tags: list[TagRef]
    cues: list[NoteCue]
    content_json: dict[str, Any] | None
    content_md: str
    summary: str
    ai_summary: NoteAiSummary | None
    # Nội dung đã đổi sau lần tạo tóm tắt AI gần nhất -> UI mời tạo lại (không bao giờ tự gọi LLM).
    ai_summary_outdated: bool
    style: NoteStyle
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_db(cls, n: Note, folder: NoteFolder | None, tags: list[NoteTag]) -> "NoteRead":
        ai_summary = NoteAiSummary.model_validate(n.ai_summary) if n.ai_summary else None
        return cls(
            id=n.id,
            title=n.title,
            folder=FolderRef(id=folder.id, name=folder.name) if folder else None,
            tags=[TagRef(id=t.id, name=t.name) for t in tags],
            cues=[NoteCue.model_validate(c) for c in n.cues],
            content_json=n.content_json,
            content_md=n.content_md,
            summary=n.summary,
            ai_summary=ai_summary,
            ai_summary_outdated=bool(ai_summary and ai_summary.source_hash != content_hash(n.content_md)),
            style=NoteStyle.model_validate(n.style or {}),
            created_at=aware(n.created_at),
            updated_at=aware(n.updated_at),
        )


class NoteList(BaseModel):
    items: list[NoteListItem]
    total: int


class FolderCreate(BaseModel):
    name: str = PydanticField(min_length=1, max_length=100)
    parent_id: str | None = None


class FolderUpdate(BaseModel):
    """Đổi tên và/hoặc chuyển sang thư mục cha khác (`parent_id: null` tường minh = đưa ra gốc)."""

    name: str | None = PydanticField(default=None, min_length=1, max_length=100)
    parent_id: str | None = None


class FolderRead(BaseModel):
    id: str
    name: str
    parent_id: str | None
    note_count: int  # chỉ tính note nằm TRỰC TIẾP trong thư mục
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_db(cls, f: NoteFolder, note_count: int) -> "FolderRead":
        return cls(
            id=f.id,
            name=f.name,
            parent_id=f.parent_id,
            note_count=note_count,
            created_at=aware(f.created_at),
            updated_at=aware(f.updated_at),
        )


class TagCreate(BaseModel):
    name: str = PydanticField(min_length=1, max_length=50)


class TagRead(BaseModel):
    id: str
    name: str
    note_count: int


# ---- Ảnh trong ghi chú (Supabase Storage) + nhận diện công thức vẽ tay ----


class NoteAsset(SQLModel, table=True):
    """Ảnh đã tải lên cho một note. File nằm ở Supabase Storage (bucket private) tại `storage_path`; nội dung note tham
    chiếu qua URL ổn định `/api/note-images/{id}` (không lưu signed URL vì hết hạn). Xoá note -> xoá ảnh."""

    __tablename__ = "note_assets"

    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True, max_length=32)
    note_id: str = Field(max_length=32, index=True)
    storage_path: str = Field(max_length=300)
    content_type: str = Field(max_length=50)
    size_bytes: int
    filename: str | None = Field(default=None, max_length=255)
    # Thời điểm ảnh không còn nằm trong nội dung note nào (bị xoá khỏi nội dung / tải lên nhưng chưa chèn). Quá thời gian
    # chờ (services/note_media.py::ORPHAN_GRACE) mới xoá thật khỏi Storage — để Hoàn tác (Ctrl+Z) vẫn khôi phục được ảnh.
    orphaned_at: datetime | None = Field(default=None, sa_column=tz_column(nullable=True, index=True))
    created_at: datetime = Field(default_factory=utcnow, sa_column=tz_column())


def note_image_url(asset_id: str) -> str:
    return f"/api/note-images/{asset_id}"


class NoteImageRead(BaseModel):
    id: str
    url: str  # đường dẫn tương đối tới backend, frontend tự ghép VITE_API_BASE_URL
    filename: str | None
    content_type: str
    size_bytes: int


class FormulaOcrResult(BaseModel):
    latex: str  # LaTeX trần (đã bỏ $$ / \[ \]) — người dùng xem trước + sửa trước khi chèn
    raw_markdown: str  # kết quả gốc của Mistral OCR
    multiple: bool  # nhận ra nhiều hơn 1 công thức (có thể OCR bịa thêm) -> UI cảnh báo
