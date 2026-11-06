"""`doc_chat_agent`: AI Agent hỏi đáp trực tiếp qua API key, hỗ trợ đính kèm tài liệu và tự gọi tool truy vấn DB NoteWave."""

import re
from dataclasses import dataclass, field
from functools import lru_cache

from pydantic_ai import Agent, RunContext
from sqlalchemy import func, or_
from sqlmodel import Session, col, select

from app.config import get_settings
from app.models.chat import (
    ChatAskResponse,
    ChatHistoryItem,
    ChatSourceRef,
)
from app.models.note import Note
from app.models.session import NoteSession, TranscriptSegment
from app.services.summary_agent import build_model_settings

MAX_TOTAL_CONTEXT_CHARS = 120_000
MAX_SINGLE_DOC_CHARS = 45_000
_WORD_RE = re.compile(r"\w+", re.UNICODE)

INSTRUCTIONS = """\
Bạn là trợ lý AI học thuật thông minh của NoteWave, hỗ trợ sinh viên/người học trả lời các câu hỏi của giảng viên, giải thích bài học, phân tích tài liệu và ôn tập.

Cách hoạt động:
1. Trả lời tự nhiên, trực diện, rõ ràng bằng tiếng Việt (trừ khi người dùng yêu cầu ngôn ngữ khác).
2. Trình bày bằng Markdown sạch đẹp (in đậm từ khoá quan trọng, gạch đầu dòng hoặc lập bảng khi cần so sánh). Công thức toán/lý/hoá viết bằng LaTeX trong `$...$` (inline) hoặc `$$...$$` (khối riêng).
3. Sử dụng tài liệu & công cụ (Tools):
   - Nếu trong prompt đã có mục `TÀI LIỆU ĐÍNH KÈM`, hãy ưu tiên dựa vào đó để trả lời chính xác theo bài giảng của người học. Nếu tài liệu đính kèm chưa đề cập đủ, bạn vẫn trả lời đầy đủ bằng kiến thức chuyên môn của mình và ghi chú nhẹ để người học biết.
   - Nếu người học hỏi về bài giảng, bản ghi âm, tài liệu quét hay ghi chú của họ mà chưa đính kèm sẵn (hoặc cần tìm thêm), hãy chủ động gọi các tool `search_user_documents`, `list_recent_documents`, `read_session_content`, `read_note_content` để tra cứu trong kho dữ liệu NoteWave.
   - Nếu câu hỏi là kiến thức học thuật / câu hỏi giảng viên đặt ra nói chung và không yêu cầu tra cứu tài liệu riêng, hãy trả lời trực tiếp, nhanh chóng và chuẩn xác mà không cần gọi tool.
"""


@dataclass
class ChatDeps:
    db: Session | None = None
    used_sources: dict[tuple[str, str], ChatSourceRef] = field(default_factory=dict)

    def record_source(self, source_type: str, doc_id: str, title: str, source_kind: str) -> None:
        key = (source_type, doc_id)
        if key not in self.used_sources:
            self.used_sources[key] = ChatSourceRef(
                source_type=source_type,  # type: ignore[arg-type]
                id=doc_id,
                title=title,
                source_kind=source_kind,
            )


@dataclass
class SourceDocument:
    key: str  # "S1", "N1", ...
    source_type: str = "session"  # "session" | "note"
    id: str = ""
    title: str = ""
    source_kind: str = ""  # "live" | "upload" | "ocr" | "note"
    header: str = ""
    blocks: list[str] = field(default_factory=list)


def _fmt_mmss(ms: int | None) -> str:
    if ms is None or ms < 0:
        return "00:00"
    total_sec = ms // 1000
    m, s = divmod(total_sec, 60)
    return f"{m:02d}:{s:02d}"


def build_session_source(key: str, session: NoteSession) -> SourceDocument:
    kind_label = {
        "live": "Ghi âm trực tiếp",
        "upload": "File ghi âm tải lên",
        "ocr": "Tài liệu quét (OCR)",
    }.get(session.source, "Phiên tài liệu")
    header = f"=== [{key}] {kind_label}: {session.title} (id={session.id}) ==="
    blocks: list[str] = []

    if session.summary and isinstance(session.summary, dict):
        summary_txt = (session.summary.get("summary") or "").strip()
        key_points = session.summary.get("key_points") or []
        if summary_txt:
            kp = "\n".join(f"  + {p}" for p in key_points if p)
            blocks.append(f"[Tóm tắt phiên]\n{summary_txt}" + (f"\n{kp}" if kp else ""))

    for raw in session.segments or []:
        seg = TranscriptSegment.model_validate(raw)
        text = seg.text.strip()
        if not text:
            continue
        if session.source == "ocr" or seg.page is not None:
            loc = f"Trang {seg.page or 1}"
        else:
            parts = []
            if seg.start_ms is not None:
                parts.append(_fmt_mmss(seg.start_ms))
            if seg.speaker:
                parts.append(f"Người nói {seg.speaker}" if str(seg.speaker).isdigit() else str(seg.speaker))
            loc = " · ".join(parts) if parts else "Transcript"
        blocks.append(f"[{loc}] {text}")

    return SourceDocument(
        key=key,
        source_type="session",
        id=session.id,
        title=session.title,
        source_kind=session.source,
        header=header,
        blocks=blocks,
    )


def build_note_source(key: str, note: Note) -> SourceDocument:
    header = f"=== [{key}] Ghi chú Cornell: {note.title} (id={note.id}) ==="
    blocks: list[str] = []

    cues = [str(c.get("text", "")).strip() for c in (note.cues or []) if str(c.get("text", "")).strip()]
    if cues:
        blocks.append("[Cột câu hỏi / từ khoá Cornell]\n" + "\n".join(f"- {c}" for c in cues))

    if note.content_md and note.content_md.strip():
        paragraphs = [p.strip() for p in re.split(r"\n{2,}", note.content_md.strip()) if p.strip()]
        for idx, p in enumerate(paragraphs, start=1):
            blocks.append(f"[Nội dung · Đoạn {idx}]\n{p}")

    if note.summary and note.summary.strip():
        blocks.append(f"[Tóm tắt tự viết]\n{note.summary.strip()}")
    elif note.ai_summary and isinstance(note.ai_summary, dict):
        ai_sum = (note.ai_summary.get("summary") or "").strip()
        if ai_sum:
            blocks.append(f"[Tóm tắt AI]\n{ai_sum}")

    return SourceDocument(
        key=key,
        source_type="note",
        id=note.id,
        title=note.title,
        source_kind="note",
        header=header,
        blocks=blocks,
    )


def assemble_context(sources: list[SourceDocument], question: str, max_chars: int = MAX_TOTAL_CONTEXT_CHARS) -> str:
    """Ghép nội dung các tài liệu đính kèm. Nếu vượt `max_chars` thì ưu tiên đoạn khớp từ khoá câu hỏi."""
    if not sources:
        return ""
    full_parts = []
    for src in sources:
        body = "\n\n".join(src.blocks)
        full_parts.append(f"{src.header}\n{body}")
    full_text = "\n\n".join(full_parts)
    if len(full_text) <= max_chars:
        return full_text

    keywords = {w.lower() for w in _WORD_RE.findall(question) if len(w) >= 2}
    per_source_budget = max(4_000, max_chars // max(1, len(sources)))
    trimmed_parts: list[str] = []

    for src in sources:
        if not src.blocks:
            continue
        scored: list[tuple[int, int, str]] = []
        for idx, blk in enumerate(src.blocks):
            words = {w.lower() for w in _WORD_RE.findall(blk)}
            overlap = len(keywords & words)
            bonus = 100 if idx == 0 else 0
            scored.append((overlap + bonus, idx, blk))

        scored.sort(key=lambda item: (-item[0], item[1]))
        chosen_indices: list[int] = []
        used = len(src.header) + 2
        for _, idx, blk in scored:
            if used + len(blk) + 2 > per_source_budget and chosen_indices:
                continue
            chosen_indices.append(idx)
            used += len(blk) + 2

        chosen_indices.sort()
        selected_blocks = [src.blocks[i] for i in chosen_indices]
        trimmed_parts.append(f"{src.header}\n" + "\n\n".join(selected_blocks))

    return "\n\n".join(trimmed_parts)[:max_chars]


@lru_cache
def get_doc_chat_agent() -> Agent[ChatDeps, str]:
    settings = get_settings()
    agent: Agent[ChatDeps, str] = Agent(
        settings.summary_model,
        deps_type=ChatDeps,
        output_type=str,
        instructions=INSTRUCTIONS,
        model_settings=build_model_settings(settings),
        retries=2,
        defer_model_check=True,
    )

    @agent.tool
    def list_recent_documents(ctx: RunContext[ChatDeps]) -> str:
        """Liệt kê các phiên bài giảng/tài liệu quét và ghi chú Cornell gần nhất của người dùng trong NoteWave."""
        db = ctx.deps.db
        if db is None:
            return "Không có kết nối cơ sở dữ liệu."
        sessions = db.exec(
            select(NoteSession)
            .where(col(NoteSession.archived_at).is_(None), NoteSession.status == "completed")
            .order_by(col(NoteSession.created_at).desc())
            .limit(15)
        ).all()
        notes = db.exec(select(Note).order_by(col(Note.updated_at).desc()).limit(15)).all()

        lines: list[str] = []
        if sessions:
            lines.append("Các phiên ghi âm / tài liệu quét gần đây:")
            for s in sessions:
                preview = (s.transcript_text or "")[:140].replace("\n", " ")
                lines.append(f"- [session id={s.id}] ({s.source}) {s.title}: {preview}")
        if notes:
            lines.append("\nCác ghi chú Cornell gần đây:")
            for n in notes:
                preview = (n.content_md or "")[:140].replace("\n", " ")
                lines.append(f"- [note id={n.id}] {n.title}: {preview}")
        return "\n".join(lines) if lines else "Kho tài liệu hiện đang trống."

    @agent.tool
    def search_user_documents(ctx: RunContext[ChatDeps], query: str) -> str:
        """Tìm kiếm phiên bài giảng/tài liệu quét hoặc ghi chú Cornell trong NoteWave theo từ khoá `query`."""
        db = ctx.deps.db
        q = (query or "").strip().lower()
        if db is None or not q:
            return "Không có kết quả."
        pattern = f"%{q}%"
        sessions = db.exec(
            select(NoteSession)
            .where(
                col(NoteSession.archived_at).is_(None),
                NoteSession.status == "completed",
                or_(
                    func.lower(col(NoteSession.title)).like(pattern),
                    func.lower(col(NoteSession.transcript_text)).like(pattern),
                ),
            )
            .order_by(col(NoteSession.created_at).desc())
            .limit(8)
        ).all()
        notes = db.exec(
            select(Note)
            .where(func.lower(col(Note.search_text)).like(pattern))
            .order_by(col(Note.updated_at).desc())
            .limit(8)
        ).all()

        lines: list[str] = []
        for s in sessions:
            snippet = (s.transcript_text or "")[:200].replace("\n", " ")
            lines.append(f"- [session id={s.id}] ({s.source}) {s.title} — {snippet}")
        for n in notes:
            snippet = (n.content_md or "")[:200].replace("\n", " ")
            lines.append(f"- [note id={n.id}] {n.title} — {snippet}")
        if not lines:
            return f"Không tìm thấy tài liệu hay ghi chú nào khớp với '{query}'."
        return "Kết quả tìm kiếm (dùng read_session_content hoặc read_note_content với id tương ứng để đọc chi tiết):\n" + "\n".join(lines)

    @agent.tool
    def read_session_content(ctx: RunContext[ChatDeps], session_id: str) -> str:
        """Đọc toàn bộ nội dung của một phiên ghi âm hoặc tài liệu quét theo `session_id`."""
        db = ctx.deps.db
        if db is None:
            return "Không đọc được phiên."
        s = db.get(NoteSession, session_id.strip())
        if s is None or s.status != "completed":
            return f"Không tìm thấy phiên hoàn tất với id={session_id}."
        ctx.deps.record_source("session", s.id, s.title, s.source)
        src = build_session_source("S", s)
        body = "\n\n".join(src.blocks)[:MAX_SINGLE_DOC_CHARS]
        return f"{src.header}\n{body}"

    @agent.tool
    def read_note_content(ctx: RunContext[ChatDeps], note_id: str) -> str:
        """Đọc toàn bộ nội dung của một ghi chú Cornell theo `note_id`."""
        db = ctx.deps.db
        if db is None:
            return "Không đọc được ghi chú."
        n = db.get(Note, note_id.strip())
        if n is None:
            return f"Không tìm thấy ghi chú với id={note_id}."
        ctx.deps.record_source("note", n.id, n.title, "note")
        src = build_note_source("N", n)
        body = "\n\n".join(src.blocks)[:MAX_SINGLE_DOC_CHARS]
        return f"{src.header}\n{body}"

    return agent


def build_chat_prompt(
    question: str,
    sources: list[SourceDocument],
    history: list[ChatHistoryItem],
) -> str:
    parts: list[str] = []
    if sources:
        context_text = assemble_context(sources, question)
        parts.append(
            f"TÀI LIỆU ĐÍNH KÈM ({len(sources)} nguồn do người học chọn):\n{context_text}"
        )
    if history:
        hist_lines = []
        for h in history[-12:]:
            speaker = "Người học" if h.role == "user" else "AI"
            hist_lines.append(f"{speaker}: {h.content.strip()}")
        parts.append("LỊCH SỬ HỘI THOẠI TRƯỚC ĐÓ:\n" + "\n\n".join(hist_lines))

    parts.append(f"CÂU HỎI / YÊU CẦU HIỆN TẠI:\n{question.strip()}")
    return "\n\n---\n\n".join(parts)


async def ask_documents(
    question: str,
    sources: list[SourceDocument] | None = None,
    history: list[ChatHistoryItem] | None = None,
    db: Session | None = None,
) -> ChatAskResponse:
    attached = sources or []
    deps = ChatDeps(db=db)
    for src in attached:
        deps.record_source(src.source_type, src.id, src.title, src.source_kind)

    prompt = build_chat_prompt(question, attached, history or [])
    result = await get_doc_chat_agent().run(prompt, deps=deps)
    settings = get_settings()

    return ChatAskResponse(
        answer_md=(result.output or "").strip(),
        used_sources=list(deps.used_sources.values()),
        model=settings.summary_model,
    )
