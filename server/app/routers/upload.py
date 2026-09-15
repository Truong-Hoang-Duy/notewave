import logging
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.dependencies import DbDep, SettingsDep, SonioxDep, get_session_or_404
from app.models.session import NoteSession, UploadStatus
from app.services.soniox import SonioxError, SonioxNotConfiguredError
from app.services.upload_processing import sync_upload_session

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/upload-transcribe", tags=["upload"])

ALLOWED_EXTENSIONS = {
    ".aac", ".aiff", ".aif", ".amr", ".asf", ".flac", ".m4a", ".mp3", ".mp4", ".ogg", ".oga", ".opus", ".wav", ".webm",
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
    soniox: SonioxDep,
    settings: SettingsDep,
    file: UploadFile = File(...),
    title: str | None = Form(default=None, max_length=200),
) -> UploadAccepted:
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
    if size > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File vượt quá giới hạn {settings.max_upload_mb} MB.")

    session = NoteSession(
        title=(title or "").strip() or Path(filename).stem[:200],
        source="upload",
        status="processing",
        original_filename=filename[:255],
    )

    try:
        file_id = await soniox.upload_file(filename, file.file, file.content_type)
        session.soniox_file_id = file_id
        session.soniox_transcription_id = await soniox.create_transcription(file_id, client_reference_id=session.id)
    except SonioxNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except SonioxError as exc:
        logger.warning("Upload Soniox thất bại: %s", exc)
        if session.soniox_file_id:
            await soniox.delete_file(session.soniox_file_id)
        raise HTTPException(status_code=502, detail="Không gửi được file tới Soniox. Vui lòng thử lại.") from exc
    finally:
        await file.close()

    db.add(session)
    db.commit()
    return UploadAccepted(session_id=session.id, status=session.status, webhook_enabled=settings.webhook_url is not None)


@router.get("/{session_id}/status", response_model=UploadStatus)
async def upload_status(session_id: str, db: DbDep, soniox: SonioxDep) -> UploadStatus:
    session = get_session_or_404(db, session_id)
    if session.status == "processing":
        try:
            session = await sync_upload_session(db, soniox, session)
        except SonioxError as exc:
            # Lỗi tạm thời khi hỏi Soniox: vẫn báo "processing" để frontend thử lại lần poll sau.
            logger.warning("Không kiểm tra được trạng thái Soniox cho %s: %s", session_id, exc)
    return UploadStatus(session_id=session.id, status=session.status, error_message=session.error_message)  # type: ignore[arg-type]
