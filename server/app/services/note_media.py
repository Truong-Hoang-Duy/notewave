"""Ảnh trong ghi chú: kiểm tra file, tải lên Supabase Storage, dọn ảnh không còn dùng.

Vòng đời ảnh (bảng `note_assets`):
- Tải lên -> `orphaned_at = now` (chưa nằm trong nội dung). Lần tự lưu kế tiếp có ảnh trong `content_md` -> bỏ đánh dấu.
- Người dùng xoá ảnh khỏi nội dung -> lần lưu nội dung đó đánh dấu `orphaned_at`; Hoàn tác (ảnh xuất hiện lại) trong thời
  gian chờ -> bỏ đánh dấu, ảnh còn nguyên.
- Quá `ORPHAN_GRACE` -> xoá file trên Storage + dòng trong bảng (`purge_orphan_images`, chạy mỗi lần lưu nội dung / xoá
  note — Render free không có tiến trình nền định kỳ). Ảnh vẫn đang được note KHÁC dùng (copy/dán ảnh sang note khác) thì
  không xoá mà chuyển quyền sở hữu sang note đó.
"""

import logging
import re
from datetime import timedelta
from pathlib import Path

from fastapi import HTTPException
from sqlmodel import Session, col, select

from app.models.common import utcnow
from app.models.note import Note, NoteAsset
from app.services.storage import StorageError, SupabaseStorage

logger = logging.getLogger(__name__)

# Đủ để Hoàn tác (Ctrl+Z) ngay sau khi lỡ xoá ảnh; sau đó ảnh bị xoá thật khỏi Storage.
ORPHAN_GRACE = timedelta(minutes=10)
PURGE_BATCH = 50
_IMAGE_REF = re.compile(r"/api/note-images/([0-9a-f]{32})")

# Nhận diện định dạng theo magic bytes (không tin phần mở rộng / Content-Type do trình duyệt gửi).
_SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "image/png", "png"),
    (b"\xff\xd8\xff", "image/jpeg", "jpg"),
    (b"GIF87a", "image/gif", "gif"),
    (b"GIF89a", "image/gif", "gif"),
)


def sniff_image(content: bytes) -> tuple[str, str] | None:
    """(content_type, phần mở rộng) nếu là PNG / JPEG / GIF / WebP, ngược lại None."""
    for signature, content_type, ext in _SIGNATURES:
        if content.startswith(signature):
            return content_type, ext
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp", "webp"
    return None


def validate_image(content: bytes, max_mb: int, allowed: set[str] | None = None) -> tuple[str, str]:
    if not content:
        raise HTTPException(status_code=422, detail="File rỗng.")
    if len(content) > max_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Ảnh vượt quá giới hạn {max_mb} MB.")
    sniffed = sniff_image(content)
    if sniffed is None or (allowed is not None and sniffed[0] not in allowed):
        kinds = ", ".join(sorted(t.split("/")[1].upper() for t in allowed)) if allowed else "PNG, JPEG, WebP, GIF"
        raise HTTPException(status_code=415, detail=f"Chỉ nhận ảnh {kinds}.")
    return sniffed


def referenced_image_ids(markdown: str) -> set[str]:
    return set(_IMAGE_REF.findall(markdown or ""))


async def store_note_image(db: Session, storage: SupabaseStorage, note_id: str, content: bytes, filename: str | None, max_mb: int) -> NoteAsset:
    content_type, ext = validate_image(content, max_mb)
    # Chưa nằm trong nội dung cho tới lần tự lưu kế tiếp -> tải lên mà không bao giờ chèn (đóng tab giữa chừng) cũng được dọn.
    asset = NoteAsset(note_id=note_id, storage_path="", content_type=content_type, size_bytes=len(content), orphaned_at=utcnow())
    asset.storage_path = f"notes/{note_id}/{asset.id}.{ext}"
    asset.filename = Path(filename).name[:255] if filename else None
    await storage.upload(asset.storage_path, content, content_type)
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


def sync_note_images(db: Session, note: Note) -> None:
    """Sau khi nội dung note đổi: đánh dấu ảnh của note không còn trong nội dung; bỏ đánh dấu mọi ảnh (của note này hoặc
    note khác) đang được nội dung tham chiếu (Hoàn tác, dán ảnh copy từ note khác). Không commit."""
    refs = referenced_image_ids(note.content_md)
    now = utcnow()
    for asset in db.exec(select(NoteAsset).where(NoteAsset.note_id == note.id)).all():
        if asset.id in refs:
            refs.discard(asset.id)
            if asset.orphaned_at is not None:
                asset.orphaned_at = None
                db.add(asset)
        elif asset.orphaned_at is None:
            asset.orphaned_at = now
            db.add(asset)
    if refs:  # ảnh của note khác được dán vào note này
        for asset in db.exec(select(NoteAsset).where(col(NoteAsset.id).in_(refs), col(NoteAsset.orphaned_at).is_not(None))).all():
            asset.orphaned_at = None
            db.add(asset)


def _other_note_using(db: Session, asset_id: str, exclude_note_id: str | None = None) -> str | None:
    """Id một note (khác `exclude_note_id`) có nội dung đang chứa ảnh này, hoặc None. `search_text` chứa `content_md`."""
    stmt = select(Note.id).where(col(Note.search_text).contains(f"/api/note-images/{asset_id}"))
    if exclude_note_id:
        stmt = stmt.where(Note.id != exclude_note_id)
    return db.exec(stmt.limit(1)).first()


async def _delete_assets(db: Session, storage: SupabaseStorage, assets: list[NoteAsset]) -> int:
    """Xoá file trên Storage rồi xoá dòng. Storage lỗi -> giữ nguyên dòng (lần dọn sau thử lại). Trả số ảnh đã xoá."""
    if not assets:
        return 0
    if not storage.configured:
        # Chưa / tạm mất cấu hình Storage: KHÔNG xoá dòng (sẽ mất dấu file trên Storage) — giữ để lần dọn sau xoá cả file.
        logger.warning("Bỏ qua dọn %d ảnh vì chưa cấu hình Supabase Storage", len(assets))
        return 0
    try:
        await storage.delete([a.storage_path for a in assets])
    except StorageError as exc:
        logger.warning("Không xoá được %d ảnh trên Storage, sẽ thử lại lần dọn sau: %s", len(assets), exc)
        return 0
    for asset in assets:
        db.delete(asset)
    return len(assets)


async def purge_orphan_images(db: Session, storage: SupabaseStorage) -> int:
    """Xoá thật các ảnh đã bị đánh dấu quá `ORPHAN_GRACE` (tối đa PURGE_BATCH ảnh mỗi lần). Commit. Trả số ảnh đã xoá."""
    due = db.exec(
        select(NoteAsset).where(col(NoteAsset.orphaned_at) < utcnow() - ORPHAN_GRACE).order_by(col(NoteAsset.orphaned_at)).limit(PURGE_BATCH)
    ).all()
    to_delete = []
    for asset in due:
        owner = _other_note_using(db, asset.id)
        if owner:  # vẫn đang được dùng ở đâu đó (vd. note khác) -> giữ, chuyển quyền sở hữu
            asset.note_id = owner
            asset.orphaned_at = None
            db.add(asset)
        else:
            to_delete.append(asset)
    deleted = await _delete_assets(db, storage, to_delete)
    db.commit()
    if deleted:
        logger.info("Đã xoá %d ảnh không còn dùng khỏi Storage", deleted)
    return deleted


async def delete_note_images(db: Session, storage: SupabaseStorage, note_id: str) -> None:
    """Note sắp bị xoá: ảnh còn được note khác dùng thì chuyển sang note đó, còn lại xoá ngay. Không commit."""
    to_delete = []
    for asset in db.exec(select(NoteAsset).where(NoteAsset.note_id == note_id)).all():
        owner = _other_note_using(db, asset.id, exclude_note_id=note_id)
        if owner:
            asset.note_id = owner
            asset.orphaned_at = None
            db.add(asset)
        else:
            to_delete.append(asset)
    if await _delete_assets(db, storage, to_delete) < len(to_delete):
        # Storage lỗi: vẫn cho xoá note; dòng ảnh được đánh dấu để lần dọn sau thử xoá lại file.
        for asset in to_delete:
            asset.orphaned_at = utcnow() - ORPHAN_GRACE
            db.add(asset)
