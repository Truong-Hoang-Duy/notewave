from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import delete, func
from sqlmodel import col, select

from app.dependencies import DbDep
from app.models.note import Note, NoteCreate, NoteList, NoteRead, NoteSort, NoteTagLink, NoteUpdate
from app.services.notes import get_folder_or_404, get_note_or_404, list_items, read_note, set_note_tags

router = APIRouter(prefix="/api/notes", tags=["notes"])

DISPLAY_TZ = ZoneInfo("Asia/Ho_Chi_Minh")

# ORDER BY ở DB để đúng với phân trang; luôn kèm created_at làm tiêu chí phụ cho thứ tự ổn định.
_SORTS = {
    "updated_desc": lambda: (col(Note.updated_at).desc(), col(Note.created_at).desc()),
    "created_desc": lambda: (col(Note.created_at).desc(),),
    "created_asc": lambda: (col(Note.created_at).asc(),),
    "title_asc": lambda: (func.lower(col(Note.title)).asc(), col(Note.created_at).desc()),
    "title_desc": lambda: (func.lower(col(Note.title)).desc(), col(Note.created_at).desc()),
}


def _default_title() -> str:
    return f"Ghi chú {datetime.now(DISPLAY_TZ):%d/%m/%Y %H:%M}"


@router.post("", response_model=NoteRead, status_code=201)
def create_note(payload: NoteCreate, db: DbDep) -> NoteRead:
    if payload.folder_id:
        get_folder_or_404(db, payload.folder_id)
    note = Note(title=(payload.title or "").strip() or _default_title(), folder_id=payload.folder_id)
    note.refresh_search_text()
    db.add(note)
    db.flush()
    set_note_tags(db, note.id, payload.tag_ids)
    db.commit()
    db.refresh(note)
    return read_note(db, note)


@router.get("", response_model=NoteList)
def list_notes(
    db: DbDep,
    q: str | None = Query(default=None, max_length=200, description="Tìm theo tiêu đề, câu hỏi, nội dung, tóm tắt"),
    folder_id: str | None = Query(default=None, description='Id thư mục (chỉ note nằm trực tiếp), hoặc "none" = gốc'),
    tag_id: str | None = Query(default=None, description="Chỉ lấy note có tag này"),
    sort: NoteSort = Query(default="updated_desc"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> NoteList:
    stmt = select(Note)
    if folder_id == "none":
        stmt = stmt.where(col(Note.folder_id).is_(None))
    elif folder_id:
        stmt = stmt.where(Note.folder_id == folder_id)
    if tag_id:
        stmt = stmt.where(col(Note.id).in_(select(NoteTagLink.note_id).where(NoteTagLink.tag_id == tag_id)))
    if q and q.strip():
        stmt = stmt.where(col(Note.search_text).like(f"%{q.strip().lower()}%"))
    total = db.exec(select(func.count()).select_from(stmt.subquery())).one()
    rows = list(db.exec(stmt.order_by(*_SORTS[sort]()).offset(offset).limit(limit)).all())
    return NoteList(items=list_items(db, rows), total=total)


@router.get("/{note_id}", response_model=NoteRead)
def get_note(note_id: str, db: DbDep) -> NoteRead:
    return read_note(db, get_note_or_404(db, note_id))


@router.patch("/{note_id}", response_model=NoteRead)
def update_note(note_id: str, payload: NoteUpdate, db: DbDep) -> NoteRead:
    """Cập nhật từng phần — autosave chỉ gửi field đã đổi. Ghi đè theo kiểu last-write-wins (không kiểm tra phiên
    bản): mở cùng một note ở 2 nơi thì bản lưu sau thắng."""
    note = get_note_or_404(db, note_id)
    fields = payload.model_fields_set
    if "title" in fields:
        title = (payload.title or "").strip()
        if not title:
            raise HTTPException(status_code=422, detail="Tiêu đề không được để trống.")
        note.title = title
    if "folder_id" in fields:
        if payload.folder_id:
            get_folder_or_404(db, payload.folder_id)
        note.folder_id = payload.folder_id
    if "cues" in fields and payload.cues is not None:
        note.cues = [c.model_dump() for c in payload.cues]
    if "content_json" in fields:
        note.content_json = payload.content_json
    if "content_md" in fields and payload.content_md is not None:
        note.content_md = payload.content_md
    if "summary" in fields and payload.summary is not None:
        note.summary = payload.summary
    if "style" in fields:
        note.style = payload.style.model_dump(exclude_none=True) if payload.style else None
    if "tag_ids" in fields and payload.tag_ids is not None:
        set_note_tags(db, note.id, payload.tag_ids)
    note.refresh_search_text()
    note.touch()
    db.add(note)
    db.commit()
    db.refresh(note)
    return read_note(db, note)


@router.delete("/{note_id}", status_code=204)
def delete_note(note_id: str, db: DbDep) -> Response:
    note = get_note_or_404(db, note_id)
    db.exec(delete(NoteTagLink).where(col(NoteTagLink.note_id) == note_id))  # type: ignore[call-overload]
    db.delete(note)
    db.commit()
    return Response(status_code=204)
