from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import func, update
from sqlmodel import col, select

from app.dependencies import DbDep
from app.models.note import FolderCreate, FolderRead, FolderUpdate, Note, NoteFolder
from app.services.notes import ensure_not_descendant, ensure_unique_folder_name, get_folder_or_404

router = APIRouter(prefix="/api/note-folders", tags=["notes"])


def _count(db: DbDep, folder_id: str) -> int:
    return db.exec(select(func.count()).select_from(Note).where(Note.folder_id == folder_id)).one()


def _clean_name(name: str | None) -> str:
    name = (name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Tên thư mục không được để trống.")
    return name


@router.get("", response_model=list[FolderRead])
def list_folders(db: DbDep) -> list[FolderRead]:
    """Trả danh sách phẳng (kèm `parent_id`) — frontend tự dựng cây."""
    counts = dict(
        db.exec(
            select(Note.folder_id, func.count()).where(col(Note.folder_id).is_not(None)).group_by(Note.folder_id)
        ).all()
    )
    folders = db.exec(select(NoteFolder).order_by(func.lower(col(NoteFolder.name)))).all()
    return [FolderRead.from_db(f, counts.get(f.id, 0)) for f in folders]


@router.post("", response_model=FolderRead, status_code=201)
def create_folder(payload: FolderCreate, db: DbDep) -> FolderRead:
    name = _clean_name(payload.name)
    if payload.parent_id:
        get_folder_or_404(db, payload.parent_id)
    ensure_unique_folder_name(db, name, payload.parent_id)
    folder = NoteFolder(name=name, parent_id=payload.parent_id)
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return FolderRead.from_db(folder, 0)


@router.patch("/{folder_id}", response_model=FolderRead)
def update_folder(folder_id: str, payload: FolderUpdate, db: DbDep) -> FolderRead:
    folder = get_folder_or_404(db, folder_id)
    fields = payload.model_fields_set
    parent_id = folder.parent_id
    if "parent_id" in fields:
        parent_id = payload.parent_id
        if parent_id:
            get_folder_or_404(db, parent_id)
            ensure_not_descendant(db, folder.id, parent_id)
    name = _clean_name(payload.name) if "name" in fields else folder.name
    ensure_unique_folder_name(db, name, parent_id, exclude_id=folder.id)
    folder.name = name
    folder.parent_id = parent_id
    folder.touch()
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return FolderRead.from_db(folder, _count(db, folder_id))


@router.delete("/{folder_id}", status_code=204)
def delete_folder(folder_id: str, db: DbDep) -> Response:
    """Xoá thư mục nhưng KHÔNG xoá nội dung: note và thư mục con được chuyển lên thư mục cha (hoặc ra gốc).
    Thư mục con trùng tên với thư mục sẵn có ở cấp cha được thêm hậu tố để giữ ràng buộc tên không trùng."""
    folder = get_folder_or_404(db, folder_id)
    parent_id = folder.parent_id
    db.exec(update(Note).where(col(Note.folder_id) == folder_id).values(folder_id=parent_id))  # type: ignore[call-overload]
    siblings_stmt = select(NoteFolder.name).where(NoteFolder.id != folder_id)
    siblings_stmt = siblings_stmt.where(
        col(NoteFolder.parent_id).is_(None) if parent_id is None else NoteFolder.parent_id == parent_id
    )
    taken = {n.lower() for n in db.exec(siblings_stmt).all()}
    for child in db.exec(select(NoteFolder).where(NoteFolder.parent_id == folder_id)).all():
        name, i = child.name, 2
        while name.lower() in taken:
            name = f"{child.name} ({i})"
            i += 1
        taken.add(name.lower())
        child.name = name[:100]
        child.parent_id = parent_id
        child.touch()
        db.add(child)
    db.delete(folder)
    db.commit()
    return Response(status_code=204)
