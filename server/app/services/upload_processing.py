"""Hoàn tất một phiên upload khi Soniox báo xong — dùng chung cho polling và webhook."""

import logging

from sqlmodel import Session

from app.models.session import NoteSession
from app.services.soniox import SonioxError, SonioxService
from app.services.transcript import tokens_to_segments

logger = logging.getLogger(__name__)


async def _cleanup(soniox: SonioxService, session: NoteSession) -> None:
    if session.soniox_file_id:
        await soniox.delete_file(session.soniox_file_id)
    if session.soniox_transcription_id:
        await soniox.delete_transcription(session.soniox_transcription_id)


async def sync_upload_session(db: Session, soniox: SonioxService, session: NoteSession) -> NoteSession:
    """Hỏi Soniox trạng thái job; nếu đã xong thì lưu transcript, đổi trạng thái và dọn file.

    An toàn khi gọi lặp lại (polling và webhook có thể chạy chồng nhau).
    """
    if session.status != "processing" or not session.soniox_transcription_id:
        return session

    job = await soniox.get_transcription(session.soniox_transcription_id)
    job_status = job.get("status")

    if job_status == "completed":
        data = await soniox.get_transcript(session.soniox_transcription_id)
        db.refresh(session)
        if session.status != "processing":
            return session  # Một request khác đã hoàn tất trước.
        session.set_segments(tokens_to_segments(data.get("tokens", [])))
        session.duration_ms = job.get("audio_duration_ms") or _last_end_ms(session)
        session.status = "completed"
        session.error_message = None
    elif job_status == "error":
        session.status = "failed"
        session.error_message = job.get("error_message") or "Soniox không xử lý được file này."
    else:
        return session  # queued / processing

    session.touch()
    db.add(session)
    db.commit()
    db.refresh(session)

    try:
        await _cleanup(soniox, session)
    except SonioxError:
        logger.warning("Không dọn được file Soniox cho session %s", session.id)
    return session


def _last_end_ms(session: NoteSession) -> int | None:
    for seg in reversed(session.segments):
        if seg.get("end_ms") is not None:
            return seg["end_ms"]
    return None
