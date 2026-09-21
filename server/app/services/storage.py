"""Supabase Storage qua REST (httpx) — chỉ gọi từ backend bằng secret key, KHÔNG dùng SDK ở client.

Dùng cho ảnh trong Ghi chú: bucket PRIVATE (tự tạo ở lần tải đầu tiên nếu chưa có); frontend hiển thị ảnh qua
`GET /api/note-images/{id}` -> backend chuyển hướng tới signed URL ngắn hạn.
"""

import logging
from urllib.parse import quote

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"]


class StorageError(Exception):
    pass


class StorageNotConfiguredError(StorageError):
    pass


class SupabaseStorage:
    def __init__(self, http: httpx.AsyncClient, settings: Settings):
        self._http = http
        self._settings = settings

    @property
    def configured(self) -> bool:
        return bool(self._settings.supabase_storage_url and self._settings.supabase_secret_key)

    @property
    def bucket(self) -> str:
        return self._settings.note_assets_bucket

    def _base(self) -> str:
        if not self.configured:
            raise StorageNotConfiguredError(
                "Chưa cấu hình Supabase Storage (SUPABASE_SECRET_KEY) nên chưa chèn được ảnh vào ghi chú."
            )
        return f"{self._settings.supabase_storage_url}/storage/v1"

    def _headers(self) -> dict[str, str]:
        key = self._settings.supabase_secret_key
        headers = {"apikey": key}
        # Khoá kiểu cũ (service_role, là JWT "eyJ...") gửi thêm Authorization; khoá mới "sb_secret_..." chỉ cần `apikey`
        # (gateway của Supabase từ chối Bearer không phải JWT).
        if key.startswith("eyJ"):
            headers["Authorization"] = f"Bearer {key}"
        return headers

    def _object_url(self, path: str) -> str:
        return f"{self._base()}/object/{quote(self.bucket)}/{quote(path)}"

    async def _create_bucket(self) -> None:
        response = await self._http.post(
            f"{self._base()}/bucket",
            headers=self._headers(),
            json={
                "id": self.bucket,
                "name": self.bucket,
                "public": False,
                "file_size_limit": self._settings.note_image_max_mb * 1024 * 1024,
                "allowed_mime_types": IMAGE_MIME_TYPES,
            },
        )
        # 409 / "already exists": tiến trình khác vừa tạo — coi như thành công.
        if response.status_code >= 400 and "exist" not in response.text.lower():
            raise StorageError(f"Không tạo được bucket {self.bucket}: HTTP {response.status_code} {response.text[:200]}")
        logger.info("Đã tạo bucket Supabase Storage %s (private)", self.bucket)

    async def upload(self, path: str, content: bytes, content_type: str) -> None:
        headers = {**self._headers(), "Content-Type": content_type, "x-upsert": "false"}
        try:
            response = await self._http.post(self._object_url(path), headers=headers, content=content)
            if response.status_code in (400, 404) and "bucket not found" in response.text.lower():
                await self._create_bucket()
                response = await self._http.post(self._object_url(path), headers=headers, content=content)
        except httpx.HTTPError as exc:
            raise StorageError(f"Không kết nối được Supabase Storage: {exc}") from exc
        if response.status_code >= 400:
            raise StorageError(f"Tải ảnh lên Supabase Storage lỗi: HTTP {response.status_code} {response.text[:200]}")

    async def signed_url(self, path: str, expires_in: int) -> str:
        try:
            response = await self._http.post(
                f"{self._base()}/object/sign/{quote(self.bucket)}/{quote(path)}",
                headers=self._headers(),
                json={"expiresIn": expires_in},
            )
        except httpx.HTTPError as exc:
            raise StorageError(f"Không kết nối được Supabase Storage: {exc}") from exc
        if response.status_code >= 400:
            raise StorageError(f"Không lấy được link ảnh: HTTP {response.status_code} {response.text[:200]}")
        signed = response.json().get("signedURL") or response.json().get("signedUrl")
        if not signed:
            raise StorageError("Supabase Storage không trả về signed URL.")
        # API trả đường dẫn tương đối ("/object/sign/...?token=...") tính từ /storage/v1.
        return signed if signed.startswith("http") else f"{self._base()}{signed}"

    async def delete(self, paths: list[str]) -> None:
        if not paths:
            return
        try:
            response = await self._http.request(
                "DELETE", f"{self._base()}/object/{quote(self.bucket)}", headers=self._headers(), json={"prefixes": paths}
            )
        except httpx.HTTPError as exc:
            raise StorageError(f"Không kết nối được Supabase Storage: {exc}") from exc
        if response.status_code >= 400:
            raise StorageError(f"Xoá ảnh trên Supabase Storage lỗi: HTTP {response.status_code} {response.text[:200]}")
