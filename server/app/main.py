import logging
import os
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.config import export_llm_provider_keys, get_settings
from app.db import describe_database, init_db
from app.routers import groups, sessions, temporary_key, upload, webhooks

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
settings = get_settings()
os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")


@asynccontextmanager
async def lifespan(app: FastAPI):
    export_llm_provider_keys(settings)
    logging.getLogger("app").info("Database: %s", describe_database())
    init_db()
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as http:
        app.state.http = http
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
app.include_router(webhooks.router)


class HealthResponse(BaseModel):
    status: str
    soniox_configured: bool
    webhook_enabled: bool


@app.get("/api/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        soniox_configured=bool(settings.soniox_api_key),
        webhook_enabled=settings.webhook_url is not None,
    )
