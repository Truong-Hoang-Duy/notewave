"""Gọi REST API của Deepgram (temporary key / live session + Upload API). Chỉ chạy ở backend."""

import re
import uuid
from datetime import datetime, timedelta
from typing import Any, BinaryIO

import httpx

from app.config import Settings
from app.models.common import utcnow
from app.models.session import TranscriptSegment
from app.services.transcript import tokens_to_segments, utterances_to_segments

# Bộ nhớ tạm cho kết quả Deepgram vừa tải lên (Deepgram xử lý đồng bộ ở /v1/listen, lưu tạm tới khi
# frontend poll /status hoặc webhook hoàn tất phiên để giữ nguyên luồng 202 -> processing -> completed).
_deepgram_jobs: dict[str, dict[str, Any]] = {}

# Khoá phiên tạm thời một lần cho WebSocket proxy (/api/live-ws) khi DEEPGRAM_API_KEY có quyền Default
# (không gọi được /v1/auth/grant nhưng kết nối được trực tiếp tới /v1/listen từ backend).
_proxy_tokens: dict[str, tuple[datetime, bool]] = {}


def build_deepgram_live_ws_url(settings: Settings, *, diarize: bool = True) -> str:
    ws_base = re.sub(r"^http", "ws", settings.deepgram_api_base_url.rstrip("/"))
    params = (
        f"model={settings.deepgram_model}"
        "&language=vi"
        "&smart_format=true"
        "&interim_results=true"
        "&endpointing=300"
        "&vad_events=true"
        f"&diarize={'true' if diarize else 'false'}"
    )
    return f"{ws_base}/v1/listen?{params}"


def issue_proxy_token(*, diarize: bool, ttl_seconds: int = 60) -> tuple[str, datetime]:
    now = utcnow()
    expired = [k for k, (exp, _) in _proxy_tokens.items() if exp <= now]
    for k in expired:
        _proxy_tokens.pop(k, None)
    token = f"dg_proxy_{uuid.uuid4().hex}"
    expires_at = now + timedelta(seconds=ttl_seconds)
    _proxy_tokens[token] = (expires_at, diarize)
    return token, expires_at


def consume_proxy_token(token: str | None) -> bool | None:
    if not token:
        return None
    entry = _proxy_tokens.pop(token, None)
    if entry is None:
        return None
    expires_at, diarize = entry
    if expires_at <= utcnow():
        return None
    return diarize


class SttError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class SttNotConfiguredError(SttError):
    pass


class SttService:
    def __init__(self, http: httpx.AsyncClient, settings: Settings):
        self._http = http
        self._settings = settings
        self._pending_uploads: dict[str, tuple[str, Any, str | None]] = {}

    def _headers(self) -> dict[str, str]:
        if not self._settings.deepgram_api_key:
            raise SttNotConfiguredError("DEEPGRAM_API_KEY chưa được cấu hình trên máy chủ.")
        return {"Authorization": f"Token {self._settings.deepgram_api_key}"}

    def _url(self, path: str) -> str:
        return f"{self._settings.deepgram_api_base_url.rstrip('/')}{path}"

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        headers = {**self._headers(), **(kwargs.pop("headers", None) or {})}
        try:
            response = await self._http.request(method, self._url(path), headers=headers, **kwargs)
        except httpx.HTTPError as exc:
            raise SttError(f"Không kết nối được tới Deepgram: {exc.__class__.__name__}") from exc
        if response.is_error:
            raise SttError(
                f"Deepgram trả lỗi {response.status_code}: {response.text[:300]}",
                status_code=response.status_code,
            )
        return response

    async def create_temporary_key(self, *, diarize: bool = True) -> dict[str, Any]:
        if not self._settings.deepgram_api_key:
            raise SttNotConfiguredError("DEEPGRAM_API_KEY chưa được cấu hình trên máy chủ.")
        try:
            response = await self._request(
                "POST",
                "/v1/auth/grant",
                json={"ttl_seconds": self._settings.temporary_key_ttl_seconds},
            )
        except SttError as exc:
            # Key Deepgram tạo với quyền mặc định (Default) trả 403 ở /v1/auth/grant nhưng dùng được /v1/listen:
            # cấp token 1 lần để trình duyệt nối qua WebSocket proxy /api/live-ws (không bao giờ lộ key gốc).
            if exc.status_code == 403:
                proxy_token, expires_at = issue_proxy_token(
                    diarize=diarize,
                    ttl_seconds=self._settings.temporary_key_ttl_seconds,
                )
                return {
                    "api_key": proxy_token,
                    "ws_url": f"/api/live-ws?token={proxy_token}",
                    "expires_at": expires_at,
                }
            raise
        data = response.json()
        token = data.get("access_token") or data.get("api_key") or ""
        if not token:
            raise SttError("Deepgram không trả về access_token.")
        expires_in = float(data.get("expires_in") or self._settings.temporary_key_ttl_seconds)
        expires_at = utcnow() + timedelta(seconds=expires_in)
        return {
            "api_key": token,
            "ws_url": build_deepgram_live_ws_url(self._settings, diarize=diarize),
            "expires_at": expires_at,
        }

    async def upload_file(
        self,
        filename: str,
        fileobj: BinaryIO,
        content_type: str | None,
    ) -> str:
        if not self._settings.deepgram_api_key:
            raise SttNotConfiguredError("DEEPGRAM_API_KEY chưa được cấu hình trên máy chủ.")
        # Giữ tham chiếu tới file tạm trên đĩa (SpooledTemporaryFile) để gửi ở bước create_transcription,
        # tránh nhân đôi bộ nhớ trong RAM trên Render Free (512 MB).
        upload_id = f"deepgram:{uuid.uuid4().hex[:24]}"
        self._pending_uploads[upload_id] = (filename, fileobj, content_type)
        return upload_id

    async def create_transcription(self, file_id: str, client_reference_id: str) -> str:
        pending = self._pending_uploads.pop(file_id, None)
        payload_source = pending[1] if pending else b""
        if hasattr(payload_source, "read"):
            try:
                payload_source.seek(0)
            except Exception:
                pass
            raw = payload_source.read()
        else:
            raw = payload_source
        content_type = (pending[2] if pending else None) or "application/octet-stream"
        params = {
            "model": self._settings.deepgram_model,
            "language": "vi",
            "diarize": "true",
            "smart_format": "true",
            "utterances": "true",
        }
        response = await self._request(
            "POST",
            "/v1/listen",
            params=params,
            content=raw,
            headers={"Content-Type": content_type},
            timeout=httpx.Timeout(connect=60.0, read=300.0, write=None, pool=60.0),
        )
        data = response.json()
        job_id = str(
            (data.get("metadata") or {}).get("request_id")
            or data.get("request_id")
            or data.get("id")
            or f"dg-{client_reference_id[:24]}"
        )[:64]
        _deepgram_jobs[job_id] = data
        return job_id

    async def get_transcription(self, transcription_id: str, file_id: str | None = None) -> dict[str, Any]:
        if transcription_id in _deepgram_jobs:
            cached = _deepgram_jobs[transcription_id]
            # Cho phép mock trong test đặt trạng thái "processing" hoặc "error"
            if cached.get("status") in ("processing", "queued"):
                return {"id": transcription_id, "status": "processing"}
            if cached.get("status") == "error":
                return {
                    "id": transcription_id,
                    "status": "error",
                    "error_message": cached.get("error_message") or "Deepgram không xử lý được file này.",
                }
            segments, duration_ms = _parse_deepgram_result(cached)
            return {
                "id": transcription_id,
                "status": "completed",
                "audio_duration_ms": duration_ms,
                "segments": segments,
            }
        # Trường hợp poll job Deepgram qua endpoint trạng thái
        response = await self._request("GET", f"/v1/listen/{transcription_id}")
        data = response.json()
        if data.get("status") in ("processing", "queued"):
            return {"id": transcription_id, "status": "processing"}
        if data.get("status") == "error":
            return {
                "id": transcription_id,
                "status": "error",
                "error_message": data.get("error_message") or "Deepgram không xử lý được file này.",
            }
        segments, duration_ms = _parse_deepgram_result(data)
        return {
            "id": transcription_id,
            "status": "completed",
            "audio_duration_ms": duration_ms,
            "segments": segments,
        }

    async def delete_file(self, file_id: str) -> None:
        self._pending_uploads.pop(file_id, None)

    async def delete_transcription(self, transcription_id: str, file_id: str | None = None) -> None:
        _deepgram_jobs.pop(transcription_id, None)


def _parse_deepgram_result(data: dict[str, Any]) -> tuple[list[TranscriptSegment], int | None]:
    if "tokens" in data:
        segments = tokens_to_segments(data["tokens"])
        return segments, data.get("audio_duration_ms")
    meta = data.get("metadata") or {}
    results = data.get("results") or {}
    channels = results.get("channels") or []
    detected_lang = (channels[0].get("detected_language") if channels else None) or "vi"
    utterances = results.get("utterances") or []
    if utterances:
        segments = utterances_to_segments(utterances, default_language=detected_lang)
    elif channels and channels[0].get("alternatives"):
        alt = channels[0]["alternatives"][0]
        words = alt.get("words") or []
        if words:
            segments = utterances_to_segments(words, default_language=detected_lang)
        elif (alt.get("transcript") or "").strip():
            segments = [TranscriptSegment(text=alt["transcript"].strip(), language=detected_lang)]
        else:
            segments = []
    else:
        segments = []
    dur_s = meta.get("duration")
    dur_ms = round(float(dur_s) * 1000) if dur_s is not None else data.get("audio_duration_ms")
    return segments, dur_ms
