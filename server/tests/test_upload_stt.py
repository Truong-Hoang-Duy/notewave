from app.config import Settings
from app.dependencies import get_stt
from app.main import app
from app.services.stt import SttService, _deepgram_jobs


def test_temporary_key_deepgram_and_proxy_fallback(client, stt):
    # 1. Cấp JWT trực tiếp từ /v1/auth/grant
    res = client.post("/api/temporary-key?diarize=false")
    assert res.status_code == 200
    body = res.json()
    assert body["api_key"] == "dg_temp_abc"
    assert "wss://api.deepgram.com/v1/listen" in body["ws_url"]
    assert "diarize=false" in body["ws_url"]
    assert "language=vi" in body["ws_url"]
    assert "test-deepgram-key" not in res.text

    # 2. Khi key Default trả 403 ở /v1/auth/grant -> cấp token 1 lần qua /api/live-ws
    stt.forbid_grant = True
    res_proxy = client.post("/api/temporary-key")
    assert res_proxy.status_code == 200
    body_proxy = res_proxy.json()
    assert body_proxy["api_key"].startswith("dg_proxy_")
    assert body_proxy["ws_url"].startswith("/api/live-ws?token=dg_proxy_")
    assert "test-deepgram-key" not in res_proxy.text
    stt.forbid_grant = False

    # 3. Lỗi 500 từ Deepgram -> 502
    stt.fail_temp_key = True
    assert client.post("/api/temporary-key").status_code == 502


def test_stt_not_configured_returns_503(client):
    empty_settings = Settings(
        deepgram_api_key="",
        database_url="postgresql://x/y",
    )
    app.dependency_overrides[get_stt] = lambda: SttService(None, empty_settings)  # type: ignore[arg-type]
    assert client.post("/api/temporary-key").status_code == 503
    assert client.post("/api/upload-transcribe", files={"file": ("a.mp3", b"\x00" * 64, "audio/mpeg")}).status_code == 503


def test_upload_validation(client, stt):
    assert client.post("/api/upload-transcribe", files={"file": ("a.txt", b"x")}).status_code == 415
    assert client.post("/api/upload-transcribe", files={"file": ("a.mp3", b"")}).status_code == 422
    assert stt.calls == []


def test_deepgram_upload_poll_and_webhook_completes(client, stt):
    res = client.post("/api/upload-transcribe", files={"file": ("họp nhóm.m4a", b"\x00" * 2048, "audio/mp4")})
    assert res.status_code == 202, res.text
    sid = res.json()["session_id"]
    assert res.json()["webhook_enabled"] is True
    assert stt.last_listen_params["diarize"] == "true"
    assert stt.last_listen_params["utterances"] == "true"
    assert stt.last_listen_params["language"] == "vi"

    listed = client.get("/api/sessions").json()["items"][0]
    assert listed["status"] == "processing" and listed["title"] == "họp nhóm"

    assert client.get(f"/api/upload-transcribe/{sid}/status").json()["status"] == "processing"

    assert client.post("/api/webhooks/stt", json={"id": "tr-1", "status": "completed"}).status_code == 401

    # Chuyển job sang hoàn tất
    _deepgram_jobs.pop("tr-1", None)
    stt.job_status = "completed"
    assert (
        client.post(
            "/api/webhooks/stt",
            json={"id": "tr-1", "status": "completed"},
            headers={"Authorization": "Bearer s3cret"},
        ).status_code
        == 204
    )

    status = client.get(f"/api/upload-transcribe/{sid}/status").json()
    assert status == {"session_id": sid, "status": "completed", "error_message": None}
    detail = client.get(f"/api/sessions/{sid}").json()
    assert detail["source"] == "upload" and detail["duration_ms"] == 5000
    assert [(s["speaker"], s["text"]) for s in detail["segments"]] == [("1", "Xin chào"), ("2", "Chào bạn")]

    # Webhook lặp lại (retry) không làm hỏng dữ liệu
    assert (
        client.post(
            "/api/webhooks/stt",
            json={"id": "tr-1", "status": "completed"},
            headers={"Authorization": "Bearer s3cret"},
        ).status_code
        == 204
    )
    assert len(client.get(f"/api/sessions/{sid}").json()["segments"]) == 2


def test_failed_job_and_unknown_webhook(client, stt):
    sid = client.post("/api/upload-transcribe", files={"file": ("a.mp3", b"\x00" * 64, "audio/mpeg")}).json()["session_id"]
    _deepgram_jobs["tr-1"]["status"] = "error"
    _deepgram_jobs["tr-1"]["error_message"] = "Audio không hợp lệ"
    status = client.get(f"/api/upload-transcribe/{sid}/status").json()
    assert status["status"] == "failed" and status["error_message"] == "Audio không hợp lệ"

    headers = {"Authorization": "Bearer s3cret"}
    assert client.post("/api/webhooks/stt", json={"id": "unknown", "status": "completed"}, headers=headers).status_code == 204


def test_upload_stt_failure_does_not_create_session(client, stt):
    stt.fail_upload = True
    assert client.post("/api/upload-transcribe", files={"file": ("a.mp3", b"\x00" * 64, "audio/mpeg")}).status_code == 502
    assert client.get("/api/sessions").json()["total"] == 0


def test_delete_processing_session_cleans_stt(client, stt):
    sid = client.post("/api/upload-transcribe", files={"file": ("a.mp3", b"\x00" * 64, "audio/mpeg")}).json()["session_id"]
    assert "tr-1" in _deepgram_jobs
    assert client.delete(f"/api/sessions/{sid}").status_code == 204
    assert "tr-1" not in _deepgram_jobs


def test_upload_with_group_id(client, stt):
    group = client.post("/api/groups", json={"name": "Tuần 38"}).json()
    res = client.post("/api/upload-transcribe", files={"file": ("a.mp3", b"\x00" * 64, "audio/mpeg")}, data={"group_id": group["id"]})
    assert res.status_code == 202, res.text
    assert client.get(f"/api/sessions/{res.json()['session_id']}").json()["group"]["name"] == "Tuần 38"

    calls_before = len(stt.calls)
    res = client.post("/api/upload-transcribe", files={"file": ("a.mp3", b"\x00" * 64, "audio/mpeg")}, data={"group_id": "nope"})
    assert res.status_code == 404 and len(stt.calls) == calls_before  # không gửi file khi nhóm không tồn tại
