import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVER_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = SERVER_DIR.parent

SttProvider = Literal["deepgram", "gladia"]


class Settings(BaseSettings):
    """Cấu hình đọc từ biến môi trường (hoặc file .env ở gốc repo / thư mục server)."""

    model_config = SettingsConfigDict(
        # File sau ghi đè file trước; biến môi trường thật luôn được ưu tiên hơn file .env.
        env_file=(REPO_ROOT / ".env", SERVER_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Speech-to-Text: "auto" (ưu tiên Deepgram rồi tới Gladia theo key đang có), "deepgram" hoặc "gladia".
    stt_provider: str = "auto"
    deepgram_api_key: str = ""
    deepgram_api_base_url: str = "https://api.deepgram.com"
    deepgram_model: str = "nova-3"
    gladia_api_key: str = ""
    gladia_api_base_url: str = "https://api.gladia.io"
    temporary_key_ttl_seconds: int = Field(default=60, ge=1, le=3600)

    # Luôn là connection string Postgres (Supabase): local và production lấy ở Supabase Dashboard (Transaction pooler).
    database_url: str = ""
    allowed_origins: str = "http://localhost:5173"

    summary_model: str = "openai:gpt-5.6-luna"
    # Mức reasoning cho model OpenAI (none | low | medium | high). Trống = mặc định của model.
    summary_reasoning_effort: str = ""
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    gemini_api_key: str = ""

    # URL public của backend (vd: https://notewave-api.onrender.com). Khi có giá trị,
    # upload sẽ đăng ký webhook (Gladia); để trống thì frontend chỉ dùng polling.
    public_base_url: str = ""
    stt_webhook_secret: str = ""

    max_upload_mb: int = Field(default=0, ge=0, description="Dung lượng tối đa mỗi file ghi âm (MB). 0 = không giới hạn.")

    # Mistral OCR cho luồng "Quét tài liệu" (ảnh / PDF). Key chỉ dùng ở backend.
    mistral_api_key: str = ""
    mistral_api_base_url: str = "https://api.mistral.ai"
    ocr_model: str = "mistral-ocr-latest"

    # Supabase Storage cho ảnh trong Ghi chú (gọi REST từ backend). `supabase_url` trống -> suy ra từ project-ref trong
    # DATABASE_URL (user "postgres.<ref>" của Transaction pooler). Secret key (sb_secret_... hoặc service_role) CHỈ ở backend.
    supabase_url: str = ""
    supabase_secret_key: str = ""
    note_assets_bucket: str = "note-assets"
    note_image_max_mb: int = Field(default=10, ge=1, le=50)

    @property
    def active_stt_provider(self) -> SttProvider | None:
        choice = (self.stt_provider or "auto").strip().lower()
        if choice == "deepgram":
            return "deepgram" if self.deepgram_api_key else None
        if choice == "gladia":
            return "gladia" if self.gladia_api_key else None
        if self.deepgram_api_key:
            return "deepgram"
        if self.gladia_api_key:
            return "gladia"
        return None

    @property
    def available_stt_providers(self) -> list[SttProvider]:
        providers: list[SttProvider] = []
        if self.deepgram_api_key:
            providers.append("deepgram")
        if self.gladia_api_key:
            providers.append("gladia")
        return providers

    @property
    def stt_configured(self) -> bool:
        return self.active_stt_provider is not None

    @property
    def webhook_secret(self) -> str:
        return self.stt_webhook_secret

    @property
    def supabase_storage_url(self) -> str:
        if self.supabase_url:
            return self.supabase_url.rstrip("/")
        match = re.search(r"//postgres\.([a-z0-9]+)[:@]", self.database_url)
        return f"https://{match.group(1)}.supabase.co" if match else ""

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def webhook_url(self) -> str | None:
        if not self.public_base_url:
            return None
        return f"{self.public_base_url.rstrip('/')}/api/webhooks/stt"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def export_llm_provider_keys(settings: Settings) -> None:
    """PydanticAI đọc API key của provider từ os.environ, còn pydantic-settings không tự
    đưa giá trị trong file .env vào os.environ — nên chép sang (không ghi đè biến sẵn có)."""
    for name, value in (
        ("OPENAI_API_KEY", settings.openai_api_key),
        ("ANTHROPIC_API_KEY", settings.anthropic_api_key),
        ("GEMINI_API_KEY", settings.gemini_api_key),
    ):
        if value and not os.environ.get(name):
            os.environ[name] = value
