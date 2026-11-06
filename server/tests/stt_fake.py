"""Deepgram & Gladia giả lập bằng httpx.MockTransport — test không bao giờ gọi API thật."""

import json

import httpx
import pytest

from app.config import Settings, get_settings
from app.dependencies import get_stt
from app.main import app
from app.services.stt import SttService, _deepgram_jobs


class FakeStt:
    def __init__(self, provider: str = "gladia"):
        self.provider = provider
        self.calls: list[str] = []
        self.job_status = "processing"
        self.error_message = None
        self.fail_upload = False
        self.fail_temp_key = False
        self.last_transcription_body: dict | None = None
        self.last_listen_params: dict[str, str] | None = None
        self.utterances = [
            {"text": "Xin", "transcript": "Xin", "speaker": 0, "start": 0.0, "end": 0.3, "language": "vi"},
            {"text": "chào", "transcript": "chào", "speaker": 0, "start": 0.3, "end": 0.6, "language": "vi"},
            {"text": "Chào", "transcript": "Chào", "speaker": 1, "start": 0.9, "end": 1.2, "language": "vi"},
            {"text": "bạn", "transcript": "bạn", "speaker": 1, "start": 1.2, "end": 1.5, "language": "vi"},
        ]

    def make_settings(self) -> Settings:
        base = get_settings()
        return base.model_copy(
            update={
                "stt_provider": self.provider,
                "deepgram_api_key": "test-deepgram-key",
                "gladia_api_key": "test-gladia-key",
            }
        )

    def handler(self, request: httpx.Request) -> httpx.Response:
        path, method = request.url.path, request.method
        self.calls.append(f"{method} {path}")

        # --- Deepgram endpoints ---
        if path == "/v1/auth/grant" and method == "POST":
            assert request.headers["authorization"] == "Token test-deepgram-key"
            if self.fail_temp_key:
                return httpx.Response(500, json={"error": "boom"})
            return httpx.Response(200, json={"access_token": "dg_temp_abc", "expires_in": 60})

        if path == "/v1/listen" and method == "POST":
            assert request.headers["authorization"] == "Token test-deepgram-key"
            self.last_listen_params = dict(request.url.params)
            if self.fail_upload:
                return httpx.Response(500, json={"error": "boom"})
            payload: dict = {
                "metadata": {"request_id": "tr-1", "duration": 5.0},
                "results": {
                    "channels": [{"detected_language": "vi", "alternatives": [{"transcript": "Xin chào Chào bạn"}]}],
                    "utterances": self.utterances,
                },
            }
            if self.job_status in ("processing", "queued", "error"):
                payload["status"] = self.job_status
                payload["error_message"] = self.error_message
            return httpx.Response(200, json=payload)

        # --- Gladia v2 endpoints ---
        if path == "/v2/live" and method == "POST":
            assert request.headers["x-gladia-key"] == "test-gladia-key"
            if self.fail_temp_key:
                return httpx.Response(500, json={"error": "boom"})
            return httpx.Response(
                201,
                json={"id": "gladia-live-1", "url": "wss://api.gladia.io/v2/live?token=gladia_temp_abc"},
            )

        if path == "/v2/upload" and method == "POST":
            assert request.headers["x-gladia-key"] == "test-gladia-key"
            if self.fail_upload:
                return httpx.Response(500, json={"error": "boom"})
            return httpx.Response(201, json={"audio_url": "https://api.gladia.io/file/file-1"})

        if path == "/v2/pre-recorded" and method == "POST":
            assert request.headers["x-gladia-key"] == "test-gladia-key"
            self.last_transcription_body = json.loads(request.content)
            return httpx.Response(201, json={"id": "tr-1", "result_url": "https://api.gladia.io/v2/pre-recorded/tr-1"})

        if path == "/v2/pre-recorded/tr-1" and method == "GET":
            assert request.headers["x-gladia-key"] == "test-gladia-key"
            gladia_status = "done" if self.job_status == "completed" else self.job_status
            return httpx.Response(
                200,
                json={
                    "id": "tr-1",
                    "status": gladia_status,
                    "error_message": self.error_message,
                    "result": {
                        "metadata": {"audio_duration": 5.0},
                        "transcription": {"language": "vi", "utterances": self.utterances},
                    },
                },
            )

        if path.startswith("/v2/pre-recorded/") and method == "DELETE":
            assert request.headers["x-gladia-key"] == "test-gladia-key"
            return httpx.Response(204)

        return httpx.Response(404)


@pytest.fixture
def stt():
    _deepgram_jobs.clear()
    fake = FakeStt(provider="gladia")
    http = httpx.AsyncClient(transport=httpx.MockTransport(fake.handler))
    app.dependency_overrides[get_stt] = lambda: SttService(http, fake.make_settings())
    yield fake
    _deepgram_jobs.clear()
    app.dependency_overrides.pop(get_stt, None)

