"""Soniox giả lập bằng httpx.MockTransport — test không bao giờ gọi API thật."""

import json

import httpx
import pytest

from app.config import get_settings
from app.dependencies import get_soniox
from app.main import app
from app.services.soniox import SonioxService


class FakeSoniox:
    def __init__(self):
        self.calls: list[str] = []
        self.job_status = "processing"
        self.error_message = None
        self.fail_upload = False
        self.fail_temp_key = False
        self.last_transcription_body: dict | None = None
        self.tokens = [
            {"text": "Xin", "speaker": "1", "start_ms": 0, "end_ms": 300},
            {"text": " chào", "speaker": "1", "start_ms": 300, "end_ms": 600},
            {"text": "Chào", "speaker": "2", "start_ms": 900, "end_ms": 1200},
            {"text": " bạn", "speaker": "2", "start_ms": 1200, "end_ms": 1500},
        ]

    def handler(self, request: httpx.Request) -> httpx.Response:
        path, method = request.url.path, request.method
        self.calls.append(f"{method} {path}")
        assert request.headers["authorization"] == "Bearer test-soniox-key"
        if path == "/v1/auth/temporary-api-key":
            if self.fail_temp_key:
                return httpx.Response(500, json={"error": "boom"})
            return httpx.Response(201, json={"api_key": "snx_temp_abc", "expires_at": "2026-09-15T10:00:00Z"})
        if path == "/v1/files" and method == "POST":
            if self.fail_upload:
                return httpx.Response(500, json={"error": "boom"})
            return httpx.Response(201, json={"id": "file-1"})
        if path == "/v1/transcriptions" and method == "POST":
            self.last_transcription_body = json.loads(request.content)
            return httpx.Response(201, json={"id": "tr-1"})
        if path == "/v1/transcriptions/tr-1" and method == "GET":
            return httpx.Response(
                200,
                json={"id": "tr-1", "status": self.job_status, "audio_duration_ms": 5000, "error_message": self.error_message},
            )
        if path == "/v1/transcriptions/tr-1/transcript":
            return httpx.Response(200, json={"id": "tr-1", "tokens": self.tokens})
        if method == "DELETE":
            return httpx.Response(204)
        return httpx.Response(404)


@pytest.fixture
def soniox():
    fake = FakeSoniox()
    http = httpx.AsyncClient(transport=httpx.MockTransport(fake.handler))
    app.dependency_overrides[get_soniox] = lambda: SonioxService(http, get_settings())
    yield fake
    app.dependency_overrides.pop(get_soniox, None)
