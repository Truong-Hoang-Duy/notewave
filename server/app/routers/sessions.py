import logging
from datetime import datetime
from typing import Literal
from urllib.parse import quote
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import func, or_
from sqlmodel import Session, col, select

from app.dependencies import DbDep, SonioxDep, get_group_or_404, get_session_or_404
from app.models.group import AssignGroupRequest, SessionGroup
from app.models.ocr import CorrectionDecision
from app.models.session import (
    MergeRequest,
    NoteSession,
    SegmentsUpdate,
    SessionCreate,
    SessionList,
    SessionListItem,
    SessionRead,
    SessionSource,
    SessionUpdate,
)
from app.models.summary import MeetingSummary
from app.services.export import build_docx, build_txt
from app.services.merge import merge_sessions
from app.services.ocr_processing import CorrectionDecisionError, decide_corrections
from app.services.summary_agent import summarize_transcript

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/sessions", tags=["sessions"])

DISPLAY_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


def _default_title(source: str) -> str:
    now = datetime.now(DISPLAY_TZ)
    prefix = {"live": "Ghi âm", "upload": "File tải lên", "ocr": "Tài liệu quét"}.get(source, "Phiên")
    return f"{prefix} {now:%d/%m/%Y %H:%M}"


def _read(db: Session, session: NoteSession) -> SessionRead:
    group = db.get(SessionGroup, session.group_id) if session.group_id else None
    return SessionRead.from_db(session, group)


def _save(db: Session, session: NoteSession) -> SessionRead:
    session.touch()
    db.add(session)
    db.commit()
    db.refresh(session)
    return _read(db, session)


@router.post("", response_model=SessionRead, status_code=201)
def create_session(payload: SessionCreate, db: DbDep) -> SessionRead:
    title = (payload.title or "").strip() or _default_title(payload.source)
    session = NoteSession(title=title, source=payload.source, status="completed", duration_ms=payload.duration_ms)
    session.set_segments(payload.segments)
    db.add(session)
    db.commit()
    db.refresh(session)
    return _read(db, session)


@router.get("", response_model=SessionList)
def list_sessions(
    db: DbDep,
    q: str | None = Query(default=None, max_length=200, description="Tìm theo tiêu đề hoặc nội dung"),
    source: SessionSource | None = None,
    group_id: str | None = Query(default=None, description='Id nhóm, hoặc "none" để lấy phiên chưa phân nhóm'),
    archived: bool = Query(default=False, description="True: chỉ lấy phiên đã lưu trữ (sau khi gộp)"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> SessionList:
    stmt = select(NoteSession)
    stmt = stmt.where(col(NoteSession.archived_at).is_not(None) if archived else col(NoteSession.archived_at).is_(None))
    if source:
        stmt = stmt.where(NoteSession.source == source)
    if group_id == "none":
        stmt = stmt.where(col(NoteSession.group_id).is_(None))
    elif group_id:
        stmt = stmt.where(NoteSession.group_id == group_id)
    if q and q.strip():
        pattern = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(col(NoteSession.title)).like(pattern),
                func.lower(col(NoteSession.transcript_text)).like(pattern),
            )
        )
    total = db.exec(select(func.count()).select_from(stmt.subquery())).one()
    rows = db.exec(stmt.order_by(col(NoteSession.created_at).desc()).offset(offset).limit(limit)).all()

    group_ids = {r.group_id for r in rows if r.group_id}
    groups = {g.id: g for g in db.exec(select(SessionGroup).where(col(SessionGroup.id).in_(group_ids))).all()} if group_ids else {}
    return SessionList(items=[SessionListItem.from_db(r, groups.get(r.group_id or "")) for r in rows], total=total)


@router.post("/merge", response_model=SessionRead, status_code=201)
def merge(payload: MergeRequest, db: DbDep) -> SessionRead:
    """Gộp nhiều phiên (theo đúng thứ tự `session_ids`) thành một phiên mới."""
    if len(set(payload.session_ids)) != len(payload.session_ids):
        raise HTTPException(status_code=422, detail="Danh sách phiên cần gộp bị trùng.")
    ordered = [get_session_or_404(db, sid) for sid in payload.session_ids]
    not_ready = [s.title for s in ordered if s.status != "completed"]
    if not_ready:
        raise HTTPException(status_code=409, detail=f"Chỉ gộp được phiên đã có transcript hoàn chỉnh: {', '.join(not_ready)}.")
    if payload.group_id:
        get_group_or_404(db, payload.group_id)
    merged = merge_sessions(
        db,
        ordered,
        title=payload.title,
        group_id=payload.group_id,
        delete_originals=payload.delete_originals,
    )
    return _read(db, merged)


@router.post("/assign-group", response_model=SessionList)
def assign_group(payload: AssignGroupRequest, db: DbDep) -> SessionList:
    """Gán (hoặc gỡ khi `group_id` = null) nhiều phiên vào một nhóm."""
    group = get_group_or_404(db, payload.group_id) if payload.group_id else None
    sessions = db.exec(select(NoteSession).where(col(NoteSession.id).in_(payload.session_ids))).all()
    if len(sessions) != len(set(payload.session_ids)):
        raise HTTPException(status_code=404, detail="Có phiên không tồn tại hoặc đã bị xoá.")
    for s in sessions:
        s.group_id = group.id if group else None
        s.touch()
        db.add(s)
    db.commit()
    for s in sessions:
        db.refresh(s)
    return SessionList(items=[SessionListItem.from_db(s, group) for s in sessions], total=len(sessions))


@router.get("/{session_id}", response_model=SessionRead)
def get_session(session_id: str, db: DbDep) -> SessionRead:
    return _read(db, get_session_or_404(db, session_id))


@router.patch("/{session_id}", response_model=SessionRead)
def update_session(session_id: str, payload: SessionUpdate, db: DbDep) -> SessionRead:
    session = get_session_or_404(db, session_id)
    session.title = payload.title.strip()
    return _save(db, session)


@router.put("/{session_id}/segments", response_model=SessionRead)
def replace_segments(session_id: str, payload: SegmentsUpdate, db: DbDep) -> SessionRead:
    """Lưu transcript đã chỉnh sửa (sửa text / xoá đoạn). Thay toàn bộ danh sách segment."""
    session = get_session_or_404(db, session_id)
    if session.status != "completed":
        raise HTTPException(status_code=409, detail="Chỉ chỉnh sửa được phiên đã có transcript hoàn chỉnh.")
    cleaned = [seg.model_copy(update={"text": seg.text.strip()}) for seg in payload.segments if seg.text.strip()]
    before = session.segments
    session.set_segments(cleaned)
    if session.segments != before and session.summary is not None:
        # Không tự tóm tắt lại (tốn API call); chỉ đánh dấu để UI gợi ý "Tạo lại".
        session.summary_outdated = True
    return _save(db, session)


@router.post("/{session_id}/ocr-corrections", response_model=SessionRead)
def decide_ocr_corrections(session_id: str, payload: CorrectionDecision, db: DbDep) -> SessionRead:
    """Chấp nhận / bỏ qua các đề xuất sửa từ tiếng Anh của phiên quét tài liệu (track changes)."""
    session = get_session_or_404(db, session_id)
    if session.status != "completed":
        raise HTTPException(status_code=409, detail="Tài liệu chưa xử lý xong.")
    try:
        decide_corrections(session, payload)
    except CorrectionDecisionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _save(db, session)


@router.post("/{session_id}/restore", response_model=SessionRead)
def restore_session(session_id: str, db: DbDep) -> SessionRead:
    """Khôi phục phiên đã lưu trữ (sau khi gộp) về danh sách chính."""
    session = get_session_or_404(db, session_id)
    session.archived_at = None
    session.merged_into_id = None
    return _save(db, session)


@router.delete("/{session_id}", status_code=204)
async def delete_session(session_id: str, db: DbDep, soniox: SonioxDep) -> Response:
    session = get_session_or_404(db, session_id)
    file_id, transcription_id = session.soniox_file_id, session.soniox_transcription_id
    was_processing = session.status == "processing"
    db.delete(session)
    db.commit()
    if was_processing:
        # Phiên bị xoá khi Soniox còn đang xử lý: dọn luôn file/job để không tốn hạn mức lưu trữ.
        if transcription_id:
            await soniox.delete_transcription(transcription_id)
        if file_id:
            await soniox.delete_file(file_id)
    return Response(status_code=204)


@router.post("/{session_id}/summarize", response_model=MeetingSummary)
async def summarize_session(session_id: str, db: DbDep) -> MeetingSummary:
    session = get_session_or_404(db, session_id)
    if session.status != "completed":
        raise HTTPException(status_code=409, detail="Phiên này chưa có transcript hoàn chỉnh để tóm tắt.")
    read = SessionRead.from_db(session)
    if not read.segments:
        raise HTTPException(status_code=422, detail="Nội dung trống, không có gì để tóm tắt.")
    try:
        part_titles = {m.id: m.title for m in read.merge_sources}
        summary = await summarize_transcript(read.title, read.segments, part_titles, source=read.source)
    except Exception as exc:  # Lỗi provider LLM rất đa dạng (thiếu key, quota, timeout...)
        logger.exception("Tóm tắt thất bại cho session %s", session_id)
        raise HTTPException(
            status_code=502,
            detail="Không tạo được bản tóm tắt. Kiểm tra cấu hình SUMMARY_MODEL / API key của LLM.",
        ) from exc
    session.summary = summary.model_dump()
    session.summary_outdated = False
    session.touch()
    db.add(session)
    db.commit()
    return summary


@router.get("/{session_id}/export")
def export_session(
    session_id: str,
    db: DbDep,
    format: Literal["txt", "docx"] = Query(default="txt"),
) -> Response:
    # Luôn đọc segments hiện tại trong DB -> bản đã chỉnh sửa (nếu có).
    read = _read(db, get_session_or_404(db, session_id))
    if format == "docx":
        content = build_docx(read)
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        content = build_txt(read)
        media_type = "text/plain; charset=utf-8"
    filename = f"{read.title}.{format}"
    ascii_fallback = f"notewave-{read.id[:8]}.{format}"
    disposition = f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{quote(filename)}"
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": disposition})
