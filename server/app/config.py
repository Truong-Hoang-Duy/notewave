import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVER_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = SERVER_DIR.parent


class Settings(BaseSettings):
    """Cấu hình đọc từ biến môi trường (hoặc file .env ở gốc repo / thư mục server)."""

    model_config = SettingsConfigDict(
        # File sau ghi đè file trước; biến môi trường thật luôn được ưu tiên hơn file .env.
        env_file=(REPO_ROOT / ".env", SERVER_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    soniox_api_key: str = ""
    soniox_api_base_url: str = "https://api.soniox.com"
    soniox_async_model: str = "stt-async-v5"
    temporary_key_ttl_seconds: int = Field(default=60, ge=1, le=3600)

    # Luôn là connection string Postgres (Supabase): local do `supabase start` cấp,
    # production lấy ở Supabase Dashboard (Transaction pooler). Không có giá trị mặc định.
    database_url: str = ""
    allowed_origins: str = "http://localhost:5173"

    summary_model: str = "openai:gpt-5.6-luna"
    # Mức reasoning cho model OpenAI (none | low | medium | high). Trống = mặc định của model.
    summary_reasoning_effort: str = ""
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    gemini_api_key: str = ""

    # URL public của backend (vd: https://notewave-api.onrender.com). Khi có giá trị,
    # upload sẽ đăng ký webhook với Soniox; để trống thì frontend chỉ dùng polling.
    public_base_url: str = ""
    soniox_webhook_secret: str = ""

    max_upload_mb: int = Field(default=100, ge=1)

    # Mistral OCR cho luồng "Quét tài liệu" (ảnh / PDF). Key chỉ dùng ở backend.
    mistral_api_key: str = ""
    mistral_api_base_url: str = "https://api.mistral.ai"
    ocr_model: str = "mistral-ocr-latest"

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def webhook_url(self) -> str | None:
        if not self.public_base_url:
            return None
        return f"{self.public_base_url.rstrip('/')}/api/webhooks/soniox"


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
