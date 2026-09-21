"""Liên kết `[[...]]` giữa các ghi chú (GĐ3).

Frontend lưu liên kết trong Markdown dưới dạng `[[Tiêu đề]](/notes/<id>)` — tiêu đề chỉ để đọc, ID mới là thứ xác định
note đích (đổi tên note đích không làm gãy liên kết). Mỗi lần nội dung được lưu, backend tính lại toàn bộ liên kết đi ra
của note nguồn vào bảng `note_links`; bảng này chỉ là chỉ mục để tra ngược (backlink) cho nhanh.
"""

import re

from sqlalchemy import delete
from sqlmodel import Session, col, select

from app.models.note import FolderRef, Note, NoteLink, NoteLinkRef, NoteLinks
from app.services.notes import folders_by_id

# `[[Tiêu đề]](/notes/<id>)` — tiêu đề không chứa "]" hay xuống dòng, id là uuid hex 32 ký tự.
NOTE_LINK_RE = re.compile(r"\[\[([^\]\n]*)\]\]\(/notes/([0-9a-f]{32})\)")


def parse_note_links(markdown: str) -> list[str]:
    """Id các note được nhắc tới trong nội dung, bỏ trùng, giữ thứ tự xuất hiện."""
    return list(dict.fromkeys(m.group(2) for m in NOTE_LINK_RE.finditer(markdown or "")))


def sync_note_links(db: Session, note: Note) -> None:
    """Tính lại liên kết đi ra của `note` theo nội dung hiện tại. Bỏ liên kết tới chính nó và tới note không còn tồn
    tại (vd. note đích đã bị xoá) — nội dung vẫn giữ nguyên chữ, chỉ chỉ mục là không có dòng. Không commit."""
    targets = [t for t in parse_note_links(note.content_md) if t != note.id]
    existing = set(db.exec(select(Note.id).where(col(Note.id).in_(targets))).all()) if targets else set()
    db.exec(delete(NoteLink).where(col(NoteLink.source_id) == note.id))  # type: ignore[call-overload]
    for target_id in targets:
        if target_id in existing:
            db.add(NoteLink(source_id=note.id, target_id=target_id))


def delete_links_of(db: Session, note_id: str) -> None:
    """Note bị xoá: bỏ cả liên kết đi ra lẫn backlink trỏ tới nó. Không commit."""
    db.exec(delete(NoteLink).where((col(NoteLink.source_id) == note_id) | (col(NoteLink.target_id) == note_id)))  # type: ignore[call-overload]


def _refs(db: Session, notes: list[Note]) -> list[NoteLinkRef]:
    folders = folders_by_id(db, {n.folder_id for n in notes if n.folder_id})
    refs = []
    for n in notes:
        folder = folders.get(n.folder_id or "")
        refs.append(NoteLinkRef(id=n.id, title=n.title, folder=FolderRef(id=folder.id, name=folder.name) if folder else None))
    return refs


def get_links(db: Session, note_id: str) -> NoteLinks:
    incoming = db.exec(
        select(Note).where(col(Note.id).in_(select(NoteLink.source_id).where(NoteLink.target_id == note_id))).order_by(col(Note.updated_at).desc())
    ).all()
    outgoing = db.exec(
        select(Note).where(col(Note.id).in_(select(NoteLink.target_id).where(NoteLink.source_id == note_id))).order_by(col(Note.updated_at).desc())
    ).all()
    return NoteLinks(incoming=_refs(db, list(incoming)), outgoing=_refs(db, list(outgoing)))
