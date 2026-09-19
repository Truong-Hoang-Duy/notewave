import logging
import os
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.config import export_llm_provider_keys, get_settings
from app.db import check_database, describe_database, init_db
from app.routers import groups, note_folders, notes, ocr, sessions, tags, temporary_key, upload, webhooks

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
settings = get_settings()
os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")


@asynccontextmanager
async def lifespan(app: FastAPI):
    export_llm_provider_keys(settings)
    logging.getLogger("app").info("Database: %s", describe_database())
    init_db()
    async with (
        httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as http,
        # Mistral OCR: PDF nhiều trang có thể xử lý vài phút (SDK còn đặt timeout riêng cho từng request).
        httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=30.0)) as ocr_http,
    ):
        app.state.http = http
        app.state.ocr_http = ocr_http
        yield


app = FastAPI(title="NoteWave API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

app.include_router(temporary_key.router)
app.include_router(sessions.router)
app.include_router(groups.router)
app.include_router(upload.router)
app.include_router(ocr.router)
app.include_router(webhooks.router)
app.include_router(notes.router)
app.include_router(note_folders.router)
app.include_router(tags.router)


class HealthResponse(BaseModel):
    status: str  # "ok" | "degraded" (backend chạy nhưng không kết nối được DB)
    database: str  # "ok" | "error"
    database_error: str | None = None  # tên loại lỗi, không kèm chi tiết connection string
    soniox_configured: bool
    ocr_configured: bool
    webhook_enabled: bool


@app.get("/api/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    # Luôn trả 200 (kể cả khi DB lỗi): Render dùng endpoint này làm healthCheckPath, restart backend
    # không giúp gì khi Supabase tạm dừng project — xem field `database` để biết trạng thái DB.
    db_error = check_database()
    return HealthResponse(
        status="ok" if db_error is None else "degraded",
        database="ok" if db_error is None else "error",
        database_error=db_error,
        soniox_configured=bool(settings.soniox_api_key),
        ocr_configured=bool(settings.mistral_api_key),
        webhook_enabled=settings.webhook_url is not None,
    )
