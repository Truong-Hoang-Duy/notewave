"""Mistral OCR (`mistral-ocr-latest`) cho luồng "Quét tài liệu".

Backend chưa có storage file public nên KHÔNG dùng URL public của file người dùng:
1. Upload file lên Mistral Files API (`purpose="ocr"`) bằng SDK — gửi multipart, không phình 33% như base64.
2. Lấy signed URL ngắn hạn của chính file đó (URL do Mistral cấp) và gọi `ocr.process` với `document_url`
   (PDF) hoặc `image_url` (ảnh) — đúng cách tài liệu Mistral hướng dẫn cho file tự upload.
3. Luôn xoá file trên Mistral sau khi xong (kể cả khi lỗi).
"""

import io
import logging
import re
from dataclasses import dataclass
from pathlib import Path

import httpx
from mistralai.client import Mistral
from mistralai.client.errors import MistralError
from pypdf import PdfReader
from pypdf.errors import PdfReadError

from app.config import Settings
from app.models.ocr import OcrPage

logger = logging.getLogger(__name__)

# Giới hạn của Mistral OCR API (mỗi file gửi thành 1 document riêng).
MAX_OCR_FILE_MB = 50
MAX_OCR_PAGES = 1000  # cũng là tổng số trang tối đa của 1 phiên gộp nhiều file
# Giới hạn của NoteWave cho 1 lần tải nhiều file (file tạm nằm trên đĩa Render free, xử lý lần lượt).
MAX_OCR_FILES = 20
MAX_OCR_BATCH_MB = 200

PDF_EXTENSIONS = {".pdf"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".bmp", ".tif", ".tiff"}
ALLOWED_OCR_EXTENSIONS = PDF_EXTENSIONS | IMAGE_EXTENSIONS

# Không yêu cầu Mistral trả ảnh (include_image_base64=False) nên các tham chiếu ảnh kiểu
# `![img-0.jpeg](img-0.jpeg)` trong Markdown không hiển thị được — bỏ đi.
_IMAGE_REF = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_EXTRA_BLANK_LINES = re.compile(r"\n{3,}")


class OcrError(Exception):
    pass


class OcrNotConfiguredError(OcrError):
    pass


class OcrValidationError(OcrError):
    """File không hợp lệ để OCR — thông điệp hiển thị thẳng cho người dùng (HTTP 4xx)."""

    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class OcrResult:
    model: str
    pages: list[OcrPage]
    pages_processed: int


def count_pdf_pages(source: bytes | Path) -> int:
    try:
        reader = PdfReader(io.BytesIO(source) if isinstance(source, bytes) else source)
        if reader.is_encrypted and not reader.decrypt(""):
            raise OcrValidationError("PDF đang được đặt mật khẩu. Hãy gỡ mật khẩu rồi tải lại.")
        return len(reader.pages)
    except OcrValidationError:
        raise
    except (PdfReadError, ValueError, KeyError, TypeError, OSError) as exc:
        raise OcrValidationError("Không đọc được file PDF (file hỏng hoặc không phải PDF).") from exc
    except Exception as exc:  # noqa: BLE001 - pypdf ném nhiều loại lỗi khác nhau với PDF hỏng/đặc biệt
        if "crypt" in type(exc).__name__.lower() or "decrypt" in str(exc).lower():
            raise OcrValidationError("PDF đang được đặt mật khẩu. Hãy gỡ mật khẩu rồi tải lại.") from exc
        raise OcrValidationError("Không đọc được file PDF (file hỏng hoặc không phải PDF).") from exc


def validate_ocr_file(filename: str, source: bytes | Path) -> int:
    """Kiểm tra định dạng, dung lượng, số trang theo giới hạn Mistral OCR. `source`: nội dung file hoặc đường dẫn
    file tạm. Trả về số trang (ảnh = 1)."""
    ext = Path(filename).suffix.lower()
    size = len(source) if isinstance(source, bytes) else source.stat().st_size
    if ext not in ALLOWED_OCR_EXTENSIONS:
        raise OcrValidationError(
            f"Định dạng {ext or '(không rõ)'} không được hỗ trợ. Hãy dùng PDF hoặc ảnh: "
            + ", ".join(sorted(e.lstrip(".") for e in IMAGE_EXTENSIONS)),
            status_code=415,
        )
    if not size:
        raise OcrValidationError("File rỗng.")
    if size > MAX_OCR_FILE_MB * 1024 * 1024:
        raise OcrValidationError(f"File vượt quá giới hạn {MAX_OCR_FILE_MB} MB của dịch vụ OCR.", status_code=413)
    if ext not in PDF_EXTENSIONS:
        return 1
    pages = count_pdf_pages(source)
    if pages == 0:
        raise OcrValidationError("File PDF không có trang nào.")
    if pages > MAX_OCR_PAGES:
        raise OcrValidationError(f"PDF có {pages} trang, vượt giới hạn {MAX_OCR_PAGES} trang của dịch vụ OCR.")
    return pages


def clean_page_markdown(markdown: str) -> str:
    return _EXTRA_BLANK_LINES.sub("\n\n", _IMAGE_REF.sub("", markdown or "")).strip()


class OcrService:
    def __init__(self, settings: Settings, async_client: httpx.AsyncClient | None = None):
        self._settings = settings
        self._async_client = async_client

    @property
    def configured(self) -> bool:
        return bool(self._settings.mistral_api_key)

    def _client(self) -> Mistral:
        if not self.configured:
            raise OcrNotConfiguredError("Chưa cấu hình MISTRAL_API_KEY cho tính năng quét tài liệu.")
        return Mistral(
            api_key=self._settings.mistral_api_key,
            server_url=self._settings.mistral_api_base_url,
            async_client=self._async_client,
            # PDF nhiều trang có thể mất vài phút.
            timeout_ms=10 * 60 * 1000,
        )

    async def extract(self, filename: str, content: bytes, content_type: str | None) -> OcrResult:
        client = self._client()
        is_pdf = Path(filename).suffix.lower() in PDF_EXTENSIONS
        file_id: str | None = None
        try:
            uploaded = await client.files.upload_async(
                file={
                    "file_name": filename,
                    "content": content,
                    "content_type": content_type or ("application/pdf" if is_pdf else "application/octet-stream"),
                },
                purpose="ocr",
            )
            file_id = uploaded.id
            signed = await client.files.get_signed_url_async(file_id=file_id, expiry=1)
            document = (
                {"type": "document_url", "document_url": signed.url, "document_name": filename}
                if is_pdf
                else {"type": "image_url", "image_url": signed.url}
            )
            response = await client.ocr.process_async(
                model=self._settings.ocr_model,
                document=document,
                include_image_base64=False,
            )
        except (MistralError, httpx.HTTPError) as exc:
            raise OcrError(f"Mistral OCR lỗi: {exc}") from exc
        finally:
            if file_id:
                try:
                    await client.files.delete_async(file_id=file_id)
                except (MistralError, httpx.HTTPError):
                    logger.warning("Không xoá được file %s trên Mistral", file_id)

        pages = [
            OcrPage(page=i + 1, markdown=clean_page_markdown(p.markdown))
            for i, p in enumerate(sorted(response.pages, key=lambda p: p.index))
        ]
        usage = response.usage_info
        return OcrResult(
            model=response.model or self._settings.ocr_model,
            pages=pages,
            pages_processed=(usage.pages_processed if usage else None) or len(pages),
        )
