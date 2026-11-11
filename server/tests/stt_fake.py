"""Deepgram giả lập bằng httpx.MockTransport — test không bao giờ gọi API thật."""

import httpx
import pytest

from app.config import Settings, get_settings
from app.dependencies import get_stt
from app.main import app
from app.services.stt import SttService, _deepgram_jobs


class FakeStt:
    def __init__(self):
        self.calls: list[str] = []
        self.job_status = "processing"
        self.error_message = None
        self.fail_upload = False
        self.fail_temp_key = False
        self.forbid_grant = False
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
                "deepgram_api_key": "test-deepgram-key",
            }
        )

    def handler(self, request: httpx.Request) -> httpx.Response:
        path, method = request.url.path, request.method
        self.calls.append(f"{method} {path}")

        if path == "/v1/auth/grant" and method == "POST":
            assert request.headers["authorization"] == "Token test-deepgram-key"
            if self.forbid_grant:
                return httpx.Response(403, json={"err_code": "FORBIDDEN"})
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

        if path == "/v1/listen/tr-1" and method == "GET":
            assert request.headers["authorization"] == "Token test-deepgram-key"
            payload = {
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

        return httpx.Response(404)


@pytest.fixture
def stt():
    _deepgram_jobs.clear()
    fake = FakeStt()
    http = httpx.AsyncClient(transport=httpx.MockTransport(fake.handler))
    app.dependency_overrides[get_stt] = lambda: SttService(http, fake.make_settings())
    yield fake
    _deepgram_jobs.clear()
    app.dependency_overrides.pop(get_stt, None)
