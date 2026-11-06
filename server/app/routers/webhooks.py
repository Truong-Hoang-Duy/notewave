import hmac
import logging
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Response
from pydantic import BaseModel
from sqlmodel import select

from app.dependencies import DbDep, SettingsDep, SttDep
from app.models.session import NoteSession
from app.services.upload_processing import sync_upload_session

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


class SttWebhookPayload(BaseModel):
    id: str | None = None
    status: str | None = None
    event: str | None = None
    payload: dict[str, Any] | None = None

    @property
    def transcription_id(self) -> str:
        if self.id:
            return self.id
        if self.payload and isinstance(self.payload.get("id"), str):
            return self.payload["id"]
        return ""


@router.post("/stt", status_code=204)
async def stt_webhook(
    payload: SttWebhookPayload,
    db: DbDep,
    stt: SttDep,
    settings: SettingsDep,
    authorization: str | None = Header(default=None),
) -> Response:
    secret = settings.webhook_secret
    if secret:
        expected = f"Bearer {secret}"
        if not authorization or not hmac.compare_digest(authorization, expected):
            raise HTTPException(status_code=401, detail="Webhook không hợp lệ.")

    transcription_id = payload.transcription_id
    if not transcription_id:
        raise HTTPException(status_code=422, detail="Thiếu id của phiên xử lý.")

    session = db.exec(
        select(NoteSession).where(NoteSession.stt_transcription_id == transcription_id)
    ).first()
    if session is None:
        # Có thể phiên đã bị xoá; trả 204 để dịch vụ không retry vô ích.
        logger.info("Webhook cho transcription không rõ: %s", transcription_id)
        return Response(status_code=204)

    await sync_upload_session(db, stt, session)
    return Response(status_code=204)
