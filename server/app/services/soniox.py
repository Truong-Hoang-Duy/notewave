"""Gọi REST API của Soniox (temporary key + Async API). Chỉ chạy ở backend."""

from typing import Any, BinaryIO

import httpx

from app.config import Settings


class SonioxError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class SonioxNotConfiguredError(SonioxError):
    pass


class SonioxService:
    def __init__(self, http: httpx.AsyncClient, settings: Settings):
        self._http = http
        self._settings = settings

    def _headers(self) -> dict[str, str]:
        if not self._settings.soniox_api_key:
            raise SonioxNotConfiguredError("SONIOX_API_KEY chưa được cấu hình trên máy chủ.")
        return {"Authorization": f"Bearer {self._settings.soniox_api_key}"}

    def _url(self, path: str) -> str:
        return f"{self._settings.soniox_api_base_url.rstrip('/')}{path}"

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        try:
            response = await self._http.request(method, self._url(path), headers=self._headers(), **kwargs)
        except httpx.HTTPError as exc:
            raise SonioxError(f"Không kết nối được tới Soniox: {exc.__class__.__name__}") from exc
        if response.is_error:
            raise SonioxError(
                f"Soniox trả lỗi {response.status_code}: {response.text[:300]}",
                status_code=response.status_code,
            )
        return response

    async def create_temporary_key(self) -> dict[str, Any]:
        response = await self._request(
            "POST",
            "/v1/auth/temporary-api-key",
            json={
                "usage_type": "transcribe_websocket",
                "expires_in_seconds": self._settings.temporary_key_ttl_seconds,
            },
        )
        return response.json()

    async def upload_file(self, filename: str, fileobj: BinaryIO, content_type: str | None) -> str:
        response = await self._request(
            "POST",
            "/v1/files",
            files={"file": (filename, fileobj, content_type or "application/octet-stream")},
            timeout=httpx.Timeout(30.0, write=600.0, read=120.0),
        )
        return response.json()["id"]

    async def create_transcription(self, file_id: str, client_reference_id: str) -> str:
        body: dict[str, Any] = {
            "model": self._settings.soniox_async_model,
            "file_id": file_id,
            "enable_speaker_diarization": True,
            "enable_language_identification": True,
            "language_hints": ["vi", "en"],
            "client_reference_id": client_reference_id,
        }
        if self._settings.webhook_url:
            body["webhook_url"] = self._settings.webhook_url
            if self._settings.soniox_webhook_secret:
                body["webhook_auth_header_name"] = "Authorization"
                body["webhook_auth_header_value"] = f"Bearer {self._settings.soniox_webhook_secret}"
        response = await self._request("POST", "/v1/transcriptions", json=body)
        return response.json()["id"]

    async def get_transcription(self, transcription_id: str) -> dict[str, Any]:
        response = await self._request("GET", f"/v1/transcriptions/{transcription_id}")
        return response.json()

    async def get_transcript(self, transcription_id: str) -> dict[str, Any]:
        response = await self._request(
            "GET", f"/v1/transcriptions/{transcription_id}/transcript", timeout=120.0
        )
        return response.json()

    async def delete_file(self, file_id: str) -> None:
        await self._delete_quietly(f"/v1/files/{file_id}")

    async def delete_transcription(self, transcription_id: str) -> None:
        await self._delete_quietly(f"/v1/transcriptions/{transcription_id}")

    async def _delete_quietly(self, path: str) -> None:
        # Dọn dẹp là best-effort: 404 (đã xoá trước đó) hay lỗi mạng không được làm hỏng luồng chính.
        try:
            await self._request("DELETE", path)
        except SonioxError:
            pass
