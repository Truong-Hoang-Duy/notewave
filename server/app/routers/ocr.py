import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.dependencies import DbDep, OcrDep, get_session_or_404
from app.models.session import NoteSession, UploadStatus
from app.services import ocr as ocr_limits
from app.services.ocr import OcrValidationError, validate_ocr_file
from app.services.ocr_processing import OcrUpload, expire_if_orphaned, process_ocr_session

router = APIRouter(prefix="/api/ocr-extract", tags=["ocr"])


class OcrAccepted(BaseModel):
    session_id: str
    status: str
    pages: int
    files: int


def _default_title(filenames: list[str]) -> str:
    stem = Path(filenames[0]).stem[:180] or "Tài liệu quét"
    return stem if len(filenames) == 1 else f"{stem} (+{len(filenames) - 1} file)"


def _save_upload(upload: UploadFile, target: Path) -> None:
    upload.file.seek(0)
    with target.open("wb") as out:
        shutil.copyfileobj(upload.file, out, length=1024 * 1024)


@router.post("", response_model=OcrAccepted, status_code=202)
async def ocr_extract(
    db: DbDep,
    ocr: OcrDep,
    background_tasks: BackgroundTasks,
    files: list[UploadFile] | None = File(default=None, description="Nhiều ảnh/PDF, gộp thành 1 tài liệu theo đúng thứ tự gửi"),
    file: UploadFile | None = File(default=None, description="Một file (tương thích cách gửi cũ)"),
    title: str | None = Form(default=None, max_length=200),
) -> OcrAccepted:
    """Nhận 1 hoặc nhiều ảnh/PDF, tạo MỘT phiên `source="ocr"` ở trạng thái `processing` rồi OCR + rà soát ở nền.
    Nhiều file được nối thành 1 tài liệu theo thứ tự gửi, trang đánh số liên tục."""
    uploads = [u for u in ([file] if file else []) + (files or []) if u is not None]
    # File được chép ra thư mục tạm trên đĩa (không giữ cả lô trong RAM); job nền xoá thư mục khi xong.
    workdir = Path(tempfile.mkdtemp(prefix="notewave-ocr-"))
    handed_off = False
    try:
        if not uploads:
            raise OcrValidationError("Chưa chọn file nào.")
        if len(uploads) > ocr_limits.MAX_OCR_FILES:
            raise OcrValidationError(f"Chỉ được tải tối đa {ocr_limits.MAX_OCR_FILES} file mỗi lần.")

        sources: list[OcrUpload] = []
        total_bytes = 0
        total_pages = 0
        for index, upload in enumerate(uploads):
            filename = Path(upload.filename or f"tai-lieu-{index + 1}").name
            label = f"“{filename}”: " if len(uploads) > 1 else ""
            # Chặn file quá lớn trước khi chép ra đĩa.
            if upload.size is not None and upload.size > ocr_limits.MAX_OCR_FILE_MB * 1024 * 1024:
                raise OcrValidationError(
                    f"{label}File vượt quá giới hạn {ocr_limits.MAX_OCR_FILE_MB} MB của dịch vụ OCR.", status_code=413
                )
            path = workdir / f"{index:03d}{Path(filename).suffix.lower()}"
            await run_in_threadpool(_save_upload, upload, path)
            total_bytes += path.stat().st_size
            if total_bytes > ocr_limits.MAX_OCR_BATCH_MB * 1024 * 1024:
                raise OcrValidationError(f"Tổng dung lượng vượt giới hạn {ocr_limits.MAX_OCR_BATCH_MB} MB mỗi lần tải.", status_code=413)
            try:
                total_pages += await run_in_threadpool(validate_ocr_file, filename, path)
            except OcrValidationError as exc:
                raise OcrValidationError(f"{label}{exc}", status_code=exc.status_code) from exc
            if total_pages > ocr_limits.MAX_OCR_PAGES:
                raise OcrValidationError(f"Tổng số trang vượt giới hạn {ocr_limits.MAX_OCR_PAGES} trang của một tài liệu.")
            sources.append(OcrUpload(filename=filename, path=path, content_type=upload.content_type))

        if not ocr.configured:
            raise HTTPException(status_code=503, detail="Chưa cấu hình MISTRAL_API_KEY cho tính năng quét tài liệu.")

        names = [s.filename for s in sources]
        session = NoteSession(
            title=(title or "").strip() or _default_title(names),
            source="ocr",
            status="processing",
            original_filename=", ".join(names)[:255],
        )
        db.add(session)
        db.commit()
        background_tasks.add_task(process_ocr_session, session.id, sources, workdir, ocr)
        handed_off = True
        return OcrAccepted(session_id=session.id, status=session.status, pages=total_pages, files=len(sources))
    except OcrValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    finally:
        for upload in uploads:
            await upload.close()
        if not handed_off:
            shutil.rmtree(workdir, ignore_errors=True)


@router.get("/{session_id}/status", response_model=UploadStatus)
def ocr_status(session_id: str, db: DbDep) -> UploadStatus:
    session = expire_if_orphaned(db, get_session_or_404(db, session_id))
    return UploadStatus(session_id=session.id, status=session.status, error_message=session.error_message)  # type: ignore[arg-type]
