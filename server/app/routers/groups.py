from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import func, update
from sqlmodel import col, select

from app.dependencies import DbDep, get_group_or_404
from app.models.group import GroupCreate, GroupRead, GroupUpdate, SessionGroup
from app.models.session import NoteSession

router = APIRouter(prefix="/api/groups", tags=["groups"])


def _ensure_unique_name(db: DbDep, name: str, exclude_id: str | None = None) -> None:
    stmt = select(SessionGroup).where(func.lower(col(SessionGroup.name)) == name.lower())
    if exclude_id:
        stmt = stmt.where(SessionGroup.id != exclude_id)
    if db.exec(stmt).first():
        raise HTTPException(status_code=409, detail=f"Đã có nhóm tên “{name}”.")


def _count(db: DbDep, group_id: str) -> int:
    return db.exec(
        select(func.count())
        .select_from(NoteSession)
        .where(NoteSession.group_id == group_id, col(NoteSession.archived_at).is_(None))
    ).one()


@router.get("", response_model=list[GroupRead])
def list_groups(db: DbDep) -> list[GroupRead]:
    counts = dict(
        db.exec(
            select(NoteSession.group_id, func.count())
            .where(col(NoteSession.group_id).is_not(None), col(NoteSession.archived_at).is_(None))
            .group_by(NoteSession.group_id)
        ).all()
    )
    groups = db.exec(select(SessionGroup).order_by(func.lower(col(SessionGroup.name)))).all()
    return [GroupRead.from_db(g, counts.get(g.id, 0)) for g in groups]


@router.post("", response_model=GroupRead, status_code=201)
def create_group(payload: GroupCreate, db: DbDep) -> GroupRead:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Tên nhóm không được để trống.")
    _ensure_unique_name(db, name)
    group = SessionGroup(name=name)
    db.add(group)
    db.commit()
    db.refresh(group)
    return GroupRead.from_db(group, 0)


@router.patch("/{group_id}", response_model=GroupRead)
def rename_group(group_id: str, payload: GroupUpdate, db: DbDep) -> GroupRead:
    group = get_group_or_404(db, group_id)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Tên nhóm không được để trống.")
    _ensure_unique_name(db, name, exclude_id=group_id)
    group.name = name
    group.touch()
    db.add(group)
    db.commit()
    db.refresh(group)
    return GroupRead.from_db(group, _count(db, group_id))


@router.delete("/{group_id}", status_code=204)
def delete_group(group_id: str, db: DbDep) -> Response:
    """Xoá nhóm; các phiên trong nhóm KHÔNG bị xoá mà chuyển về "Chưa phân nhóm"."""
    group = get_group_or_404(db, group_id)
    db.exec(update(NoteSession).where(col(NoteSession.group_id) == group_id).values(group_id=None))  # type: ignore[call-overload]
    db.delete(group)
    db.commit()
    return Response(status_code=204)
