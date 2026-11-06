import asyncio
from datetime import datetime
from typing import Literal

import websockets
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.config import SttProvider, get_settings
from app.dependencies import SttDep
from app.services.stt import (
    SttError,
    SttNotConfiguredError,
    build_deepgram_live_ws_url,
    consume_proxy_token,
)

router = APIRouter(prefix="/api", tags=["realtime"])


class TemporaryKeyResponse(BaseModel):
    provider: Literal["deepgram", "gladia"]
    api_key: str
    ws_url: str
    expires_at: datetime


@router.post("/temporary-key", response_model=TemporaryKeyResponse)
async def create_temporary_key(
    stt: SttDep,
    diarize: bool = Query(default=True, description="Bật phân biệt người nói cho phiên live"),
    provider: SttProvider | None = Query(default=None, description="Chọn dịch vụ STT: deepgram hoặc gladia"),
) -> TemporaryKeyResponse:
    """Cấp khoá/URL phiên tạm thời ngắn hạn cho trình duyệt kết nối WebSocket (Deepgram hoặc Gladia).

    Không bao giờ trả API key gốc về client.
    """
    try:
        data = await stt.create_temporary_key(diarize=diarize, provider=provider)
    except SttNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except SttError as exc:
        raise HTTPException(status_code=502, detail="Không tạo được phiên kết nối trực tiếp tới dịch vụ nhận dạng giọng nói.") from exc
    return TemporaryKeyResponse(
        provider=data["provider"],
        api_key=data["api_key"],
        ws_url=data["ws_url"],
        expires_at=data["expires_at"],
    )


@router.websocket("/live-ws")
async def deepgram_live_proxy(websocket: WebSocket, token: str = Query(default="")):
    """WebSocket proxy tới Deepgram (/v1/listen, language=vi) dùng token 1 lần — giữ kín DEEPGRAM_API_KEY ở backend."""
    diarize = consume_proxy_token(token)
    settings = get_settings()
    if diarize is None or not settings.deepgram_api_key:
        await websocket.close(code=4001)
        return

    await websocket.accept()
    upstream_url = build_deepgram_live_ws_url(settings, diarize=diarize)
    headers = {"Authorization": f"Token {settings.deepgram_api_key}"}

    try:
        async with websockets.connect(upstream_url, additional_headers=headers) as upstream:
            async def client_to_upstream():
                try:
                    while True:
                        msg = await websocket.receive()
                        if msg.get("type") == "websocket.disconnect":
                            break
                        if msg.get("bytes") is not None:
                            await upstream.send(msg["bytes"])
                        elif msg.get("text") is not None:
                            await upstream.send(msg["text"])
                except WebSocketDisconnect:
                    pass
                finally:
                    try:
                        await upstream.send('{"type":"CloseStream"}')
                    except Exception:
                        pass

            async def upstream_to_client():
                async for message in upstream:
                    if isinstance(message, bytes):
                        await websocket.send_bytes(message)
                    else:
                        await websocket.send_text(message)

            t1 = asyncio.create_task(client_to_upstream())
            t2 = asyncio.create_task(upstream_to_client())
            done, pending = await asyncio.wait({t1, t2}, return_when=asyncio.FIRST_COMPLETED)
            for p in pending:
                p.cancel()
    except Exception:
        pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
