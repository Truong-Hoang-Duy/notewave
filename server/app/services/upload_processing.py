"""Hoàn tất một phiên upload khi dịch vụ STT (Deepgram / Gladia) báo xong — dùng chung cho polling và webhook."""

import logging

from sqlmodel import Session

from app.models.session import NoteSession
from app.services.stt import SttError, SttService

logger = logging.getLogger(__name__)


async def _cleanup(stt: SttService, session: NoteSession) -> None:
    if session.stt_file_id:
        await stt.delete_file(session.stt_file_id)
    if session.stt_transcription_id:
        await stt.delete_transcription(session.stt_transcription_id, file_id=session.stt_file_id)


async def sync_upload_session(db: Session, stt: SttService, session: NoteSession) -> NoteSession:
    """Kiểm tra trạng thái job STT; nếu đã xong thì lưu transcript, đổi trạng thái và dọn file.

    An toàn khi gọi lặp lại (polling và webhook có thể chạy chồng nhau).
    """
    if session.status != "processing" or not session.stt_transcription_id:
        return session

    job = await stt.get_transcription(session.stt_transcription_id, file_id=session.stt_file_id)
    job_status = job.get("status")

    if job_status == "completed":
        segments = job.get("segments") or []
        db.refresh(session)
        if session.status != "processing":
            return session  # Một request khác đã hoàn tất trước.
        session.set_segments(segments)
        session.duration_ms = job.get("audio_duration_ms") or _last_end_ms(session)
        session.status = "completed"
        session.error_message = None
    elif job_status == "error":
        session.status = "failed"
        session.error_message = job.get("error_message") or "Không xử lý được file ghi âm này."
    else:
        return session  # queued / processing

    session.touch()
    db.add(session)
    db.commit()
    db.refresh(session)

    try:
        await _cleanup(stt, session)
    except SttError:
        logger.warning("Không dọn được tài nguyên STT cho session %s", session.id)
    return session


def _last_end_ms(session: NoteSession) -> int | None:
    for seg in reversed(session.segments):
        if seg.get("end_ms") is not None:
            return seg["end_ms"]
    return None
