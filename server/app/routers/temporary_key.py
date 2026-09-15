from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.dependencies import SonioxDep
from app.services.soniox import SonioxError, SonioxNotConfiguredError

router = APIRouter(prefix="/api", tags=["realtime"])


class TemporaryKeyResponse(BaseModel):
    api_key: str
    expires_at: datetime


@router.post("/temporary-key", response_model=TemporaryKeyResponse)
async def create_temporary_key(soniox: SonioxDep) -> TemporaryKeyResponse:
    """Cấp Temporary API Key ngắn hạn cho trình duyệt kết nối WebSocket Soniox.

    Không bao giờ trả SONIOX_API_KEY chính về client.
    """
    try:
        data = await soniox.create_temporary_key()
    except SonioxNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except SonioxError as exc:
        raise HTTPException(status_code=502, detail="Không tạo được khoá tạm thời từ Soniox.") from exc
    return TemporaryKeyResponse(api_key=data["api_key"], expires_at=data["expires_at"])
