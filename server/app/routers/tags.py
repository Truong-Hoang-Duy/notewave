from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import delete, func
from sqlmodel import col, select

from app.dependencies import DbDep
from app.models.note import NoteTag, NoteTagLink, TagCreate, TagRead
from app.services.notes import get_tag_or_404

router = APIRouter(prefix="/api/tags", tags=["notes"])


def _clean_name(db: DbDep, name: str, exclude_id: str | None = None) -> str:
    # Tag là một nhãn ngắn: gộp khoảng trắng liên tiếp, bỏ dấu # nếu người dùng gõ kèm.
    name = " ".join(name.strip().lstrip("#").split())
    if not name:
        raise HTTPException(status_code=422, detail="Tên tag không được để trống.")
    stmt = select(NoteTag).where(func.lower(col(NoteTag.name)) == name.lower())
    if exclude_id:
        stmt = stmt.where(NoteTag.id != exclude_id)
    if db.exec(stmt).first():
        raise HTTPException(status_code=409, detail=f"Đã có tag “{name}”.")
    return name


def _count(db: DbDep, tag_id: str) -> int:
    return db.exec(select(func.count()).select_from(NoteTagLink).where(NoteTagLink.tag_id == tag_id)).one()


@router.get("", response_model=list[TagRead])
def list_tags(db: DbDep) -> list[TagRead]:
    counts = dict(db.exec(select(NoteTagLink.tag_id, func.count()).group_by(NoteTagLink.tag_id)).all())
    tags = db.exec(select(NoteTag).order_by(func.lower(col(NoteTag.name)))).all()
    return [TagRead(id=t.id, name=t.name, note_count=counts.get(t.id, 0)) for t in tags]


@router.post("", response_model=TagRead, status_code=201)
def create_tag(payload: TagCreate, db: DbDep) -> TagRead:
    tag = NoteTag(name=_clean_name(db, payload.name))
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return TagRead(id=tag.id, name=tag.name, note_count=0)


@router.patch("/{tag_id}", response_model=TagRead)
def rename_tag(tag_id: str, payload: TagCreate, db: DbDep) -> TagRead:
    tag = get_tag_or_404(db, tag_id)
    tag.name = _clean_name(db, payload.name, exclude_id=tag_id)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return TagRead(id=tag.id, name=tag.name, note_count=_count(db, tag_id))


@router.delete("/{tag_id}", status_code=204)
def delete_tag(tag_id: str, db: DbDep) -> Response:
    """Xoá tag và gỡ tag khỏi mọi note (note không bị xoá)."""
    tag = get_tag_or_404(db, tag_id)
    db.exec(delete(NoteTagLink).where(col(NoteTagLink.tag_id) == tag_id))  # type: ignore[call-overload]
    db.delete(tag)
    db.commit()
    return Response(status_code=204)
