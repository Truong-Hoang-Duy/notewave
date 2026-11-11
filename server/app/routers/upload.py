import logging
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.dependencies import DbDep, SettingsDep, SttDep, get_group_or_404, get_session_or_404
from app.models.session import NoteSession, UploadStatus
from app.services.stt import SttError, SttNotConfiguredError
from app.services.upload_processing import sync_upload_session

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/upload-transcribe", tags=["upload"])

ALLOWED_EXTENSIONS = {
    # Định dạng âm thanh (Audio)
    ".aac", ".aiff", ".aif", ".amr", ".asf", ".flac", ".m4a", ".mp3", ".ogg", ".oga", ".opus", ".wav", ".wma",
    # Định dạng video (iPhone .mov/.m4v, Windows/macOS .mp4/.mkv/.webm/.avi...)
    ".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".3gp", ".flv", ".wmv", ".mpeg", ".mpg", ".ts",
}


class UploadAccepted(BaseModel):
    session_id: str
    status: str
    webhook_enabled: bool


def _file_size(upload: UploadFile) -> int:
    if upload.size is not None:
        return upload.size
    upload.file.seek(0, 2)
    size = upload.file.tell()
    upload.file.seek(0)
    return size


@router.post("", response_model=UploadAccepted, status_code=202)
async def upload_and_transcribe(
    db: DbDep,
    stt: SttDep,
    settings: SettingsDep,
    file: UploadFile = File(...),
    title: str | None = Form(default=None, max_length=200),
    group_id: str | None = Form(default=None, max_length=32, description="Gán phiên vào nhóm ngay khi tạo (tải nhiều file)"),
) -> UploadAccepted:
    """Mỗi request = 1 file = 1 phiên. Frontend tải nhiều file bằng nhiều request song song (có giới hạn)."""
    filename = Path(file.filename or "audio").name
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"Định dạng {ext or '(không rõ)'} không được hỗ trợ. Hãy dùng: "
            + ", ".join(sorted(e.lstrip('.') for e in ALLOWED_EXTENSIONS)),
        )
    size = _file_size(file)
    if size == 0:
        raise HTTPException(status_code=422, detail="File rỗng.")
    if settings.max_upload_mb > 0 and size > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File vượt quá giới hạn {settings.max_upload_mb} MB.")
    group = get_group_or_404(db, group_id) if group_id else None

    session = NoteSession(
        title=(title or "").strip() or Path(filename).stem[:200],
        source="upload",
        status="processing",
        original_filename=filename[:255],
        group_id=group.id if group else None,
    )

    try:
        file_id = await stt.upload_file(filename, file.file, file.content_type)
        session.stt_file_id = file_id[:64]
        session.stt_transcription_id = (await stt.create_transcription(file_id, client_reference_id=session.id))[:64]
    except SttNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except SttError as exc:
        logger.warning("Upload STT thất bại: %s", exc)
        if session.stt_file_id:
            await stt.delete_file(session.stt_file_id)
        raise HTTPException(status_code=502, detail="Không gửi được file tới dịch vụ nhận dạng giọng nói. Vui lòng thử lại.") from exc
    finally:
        await file.close()

    db.add(session)
    db.commit()
    return UploadAccepted(session_id=session.id, status=session.status, webhook_enabled=settings.webhook_url is not None)


@router.get("/{session_id}/status", response_model=UploadStatus)
async def upload_status(session_id: str, db: DbDep, stt: SttDep) -> UploadStatus:
    session = get_session_or_404(db, session_id)
    if session.status == "processing":
        try:
            session = await sync_upload_session(db, stt, session)
        except SttError as exc:
            # Lỗi tạm thời khi hỏi dịch vụ STT: vẫn báo "processing" để frontend thử lại lần poll sau.
            logger.warning("Không kiểm tra được trạng thái STT cho %s: %s", session_id, exc)
    return UploadStatus(session_id=session.id, status=session.status, error_message=session.error_message)  # type: ignore[arg-type]
