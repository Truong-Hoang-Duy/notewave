import hmac
import logging

from fastapi import APIRouter, Header, HTTPException, Response
from pydantic import BaseModel
from sqlmodel import select

from app.dependencies import DbDep, SettingsDep, SonioxDep
from app.models.session import NoteSession
from app.services.upload_processing import sync_upload_session

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


class SonioxWebhookPayload(BaseModel):
    id: str
    status: str


@router.post("/soniox", status_code=204)
async def soniox_webhook(
    payload: SonioxWebhookPayload,
    db: DbDep,
    soniox: SonioxDep,
    settings: SettingsDep,
    authorization: str | None = Header(default=None),
) -> Response:
    if settings.soniox_webhook_secret:
        expected = f"Bearer {settings.soniox_webhook_secret}"
        if not authorization or not hmac.compare_digest(authorization, expected):
            raise HTTPException(status_code=401, detail="Webhook không hợp lệ.")

    session = db.exec(
        select(NoteSession).where(NoteSession.soniox_transcription_id == payload.id)
    ).first()
    if session is None:
        # Có thể phiên đã bị xoá; trả 204 để Soniox không retry vô ích.
        logger.info("Webhook cho transcription không rõ: %s", payload.id)
        return Response(status_code=204)

    # Không tin trạng thái trong payload: hỏi lại Soniox để lấy kết quả chính thức.
    # Nếu lỗi, exception -> 500 -> Soniox tự retry.
    await sync_upload_session(db, soniox, session)
    return Response(status_code=204)
