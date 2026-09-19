"""Logic dùng chung của ghi chú: nạp thư mục/tag kèm note, gán tag, kiểm tra cây thư mục."""

from collections import defaultdict

from fastapi import HTTPException
from sqlalchemy import delete, func
from sqlmodel import Session, col, select

from app.models.note import Note, NoteFolder, NoteListItem, NoteRead, NoteTag, NoteTagLink


def get_note_or_404(db: Session, note_id: str) -> Note:
    note = db.get(Note, note_id)
    if note is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy ghi chú.")
    return note


def get_folder_or_404(db: Session, folder_id: str) -> NoteFolder:
    folder = db.get(NoteFolder, folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy thư mục.")
    return folder


def get_tag_or_404(db: Session, tag_id: str) -> NoteTag:
    tag = db.get(NoteTag, tag_id)
    if tag is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy tag.")
    return tag


def tags_by_note(db: Session, note_ids: list[str]) -> dict[str, list[NoteTag]]:
    if not note_ids:
        return {}
    rows = db.exec(
        select(NoteTagLink.note_id, NoteTag)
        .join(NoteTag, col(NoteTag.id) == col(NoteTagLink.tag_id))
        .where(col(NoteTagLink.note_id).in_(note_ids))
        .order_by(func.lower(col(NoteTag.name)))
    ).all()
    result: dict[str, list[NoteTag]] = defaultdict(list)
    for note_id, tag in rows:
        result[note_id].append(tag)
    return result


def folders_by_id(db: Session, folder_ids: set[str]) -> dict[str, NoteFolder]:
    if not folder_ids:
        return {}
    return {f.id: f for f in db.exec(select(NoteFolder).where(col(NoteFolder.id).in_(folder_ids))).all()}


def read_note(db: Session, note: Note) -> NoteRead:
    folder = db.get(NoteFolder, note.folder_id) if note.folder_id else None
    return NoteRead.from_db(note, folder, tags_by_note(db, [note.id]).get(note.id, []))


def list_items(db: Session, notes: list[Note]) -> list[NoteListItem]:
    folders = folders_by_id(db, {n.folder_id for n in notes if n.folder_id})
    tags = tags_by_note(db, [n.id for n in notes])
    return [NoteListItem.from_db(n, folders.get(n.folder_id or ""), tags.get(n.id, [])) for n in notes]


def set_note_tags(db: Session, note_id: str, tag_ids: list[str]) -> None:
    """Thay toàn bộ tag của note (bỏ trùng, giữ thứ tự). Tag không tồn tại -> 404."""
    unique = list(dict.fromkeys(tag_ids))
    if unique:
        found = set(db.exec(select(NoteTag.id).where(col(NoteTag.id).in_(unique))).all())
        if len(found) != len(unique):
            raise HTTPException(status_code=404, detail="Có tag không tồn tại hoặc đã bị xoá.")
    db.exec(delete(NoteTagLink).where(col(NoteTagLink.note_id) == note_id))  # type: ignore[call-overload]
    for tag_id in unique:
        db.add(NoteTagLink(note_id=note_id, tag_id=tag_id))


def ensure_unique_folder_name(db: Session, name: str, parent_id: str | None, exclude_id: str | None = None) -> None:
    stmt = select(NoteFolder).where(func.lower(col(NoteFolder.name)) == name.lower())
    stmt = stmt.where(col(NoteFolder.parent_id).is_(None) if parent_id is None else NoteFolder.parent_id == parent_id)
    if exclude_id:
        stmt = stmt.where(NoteFolder.id != exclude_id)
    if db.exec(stmt).first():
        raise HTTPException(status_code=409, detail=f"Thư mục này đã có thư mục con tên “{name}”.")


def ensure_not_descendant(db: Session, folder_id: str, new_parent_id: str) -> None:
    """Chặn chuyển thư mục vào chính nó hoặc vào thư mục con/cháu của nó (tạo vòng lặp)."""
    parents = dict(db.exec(select(NoteFolder.id, NoteFolder.parent_id)).all())
    current: str | None = new_parent_id
    seen: set[str] = set()
    while current and current not in seen:
        if current == folder_id:
            raise HTTPException(status_code=422, detail="Không thể chuyển thư mục vào chính nó hoặc thư mục con của nó.")
        seen.add(current)
        current = parents.get(current)
