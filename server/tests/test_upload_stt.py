from app.config import Settings
from app.dependencies import get_stt
from app.main import app
from app.services.stt import SttService, _deepgram_jobs


def test_temporary_key_gladia_and_deepgram(client, stt):
    # 1. Gladia (mặc định của fixture hoặc chọn tường minh ?provider=gladia)
    res = client.post("/api/temporary-key?provider=gladia")
    assert res.status_code == 200
    body = res.json()
    assert body["provider"] == "gladia"
    assert body["api_key"] == "gladia_temp_abc"
    assert body["ws_url"] == "wss://api.gladia.io/v2/live?token=gladia_temp_abc"
    assert "test-gladia-key" not in res.text

    # 2. Deepgram (chọn tường minh ?provider=deepgram ngay cả khi mặc định đang là gladia)
    res_dg = client.post("/api/temporary-key?diarize=false&provider=deepgram")
    assert res_dg.status_code == 200
    body_dg = res_dg.json()
    assert body_dg["provider"] == "deepgram"
    assert body_dg["api_key"] == "dg_temp_abc"
    assert "wss://api.deepgram.com/v1/listen" in body_dg["ws_url"]
    assert "diarize=false" in body_dg["ws_url"]
    assert "test-deepgram-key" not in res_dg.text

    stt.fail_temp_key = True
    assert client.post("/api/temporary-key").status_code == 502


def test_stt_not_configured_returns_503(client):
    empty_settings = Settings(
        stt_provider="auto",
        deepgram_api_key="",
        gladia_api_key="",
        database_url="postgresql://x/y",
    )
    app.dependency_overrides[get_stt] = lambda: SttService(None, empty_settings)  # type: ignore[arg-type]
    assert client.post("/api/temporary-key").status_code == 503
    assert client.post("/api/upload-transcribe", files={"file": ("a.mp3", b"\x00" * 64, "audio/mpeg")}).status_code == 503


def test_upload_validation(client, stt):
    assert client.post("/api/upload-transcribe", files={"file": ("a.txt", b"x")}).status_code == 415
    assert client.post("/api/upload-transcribe", files={"file": ("a.mp3", b"")}).status_code == 422
    assert stt.calls == []


def test_gladia_upload_poll_then_webhook_completes_and_cleans_up(client, stt):
    stt.provider = "gladia"
    res = client.post("/api/upload-transcribe", files={"file": ("họp nhóm.m4a", b"\x00" * 2048, "audio/mp4")})
    assert res.status_code == 202, res.text
    sid = res.json()["session_id"]
    assert res.json()["webhook_enabled"] is True
    body = stt.last_transcription_body
    assert body["callback"] is True
    assert body["callback_config"]["url"] == "https://api.example.com/api/webhooks/stt"
    assert body["diarization"] is True and body["custom_metadata"]["client_reference_id"] == sid

    listed = client.get("/api/sessions").json()["items"][0]
    assert listed["status"] == "processing" and listed["title"] == "họp nhóm"

    assert client.get(f"/api/upload-transcribe/{sid}/status").json()["status"] == "processing"

    assert client.post("/api/webhooks/stt", json={"id": "tr-1", "status": "completed"}).status_code == 401
    stt.job_status = "completed"
    # Định dạng webhook Gladia (event + payload.id)
    assert (
        client.post(
            "/api/webhooks/stt",
            json={"event": "transcription.success", "payload": {"id": "tr-1"}},
            headers={"Authorization": "Bearer s3cret"},
        ).status_code
        == 204
    )

    status = client.get(f"/api/upload-transcribe/{sid}/status").json()
    assert status == {"session_id": sid, "status": "completed", "error_message": None}
    detail = client.get(f"/api/sessions/{sid}").json()
    assert detail["source"] == "upload" and detail["duration_ms"] == 5000
    assert [(s["speaker"], s["text"]) for s in detail["segments"]] == [("1", "Xin chào"), ("2", "Chào bạn")]
    assert "DELETE /v2/pre-recorded/tr-1" in stt.calls

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


def test_deepgram_upload_and_poll_completes(client, stt):
    stt.job_status = "completed"
    res = client.post(
        "/api/upload-transcribe",
        files={"file": ("phỏng vấn.mp3", b"\x00" * 1024, "audio/mpeg")},
        data={"provider": "deepgram"},
    )
    assert res.status_code == 202, res.text
    sid = res.json()["session_id"]
    assert stt.last_listen_params["diarize"] == "true"
    assert stt.last_listen_params["utterances"] == "true"

    status = client.get(f"/api/upload-transcribe/{sid}/status").json()
    assert status == {"session_id": sid, "status": "completed", "error_message": None}
    detail = client.get(f"/api/sessions/{sid}").json()
    assert detail["duration_ms"] == 5000
    assert [(s["speaker"], s["text"]) for s in detail["segments"]] == [("1", "Xin chào"), ("2", "Chào bạn")]
    assert "tr-1" not in _deepgram_jobs


def test_failed_job_and_unknown_webhook(client, stt):
    sid = client.post("/api/upload-transcribe", files={"file": ("a.mp3", b"\x00" * 64, "audio/mpeg")}).json()["session_id"]
    stt.job_status = "error"
    stt.error_message = "Audio không hợp lệ"
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
    assert client.delete(f"/api/sessions/{sid}").status_code == 204
    assert "DELETE /v2/pre-recorded/tr-1" in stt.calls


def test_upload_with_group_id(client, stt):
    group = client.post("/api/groups", json={"name": "Tuần 38"}).json()
    res = client.post("/api/upload-transcribe", files={"file": ("a.mp3", b"\x00" * 64, "audio/mpeg")}, data={"group_id": group["id"]})
    assert res.status_code == 202, res.text
    assert client.get(f"/api/sessions/{res.json()['session_id']}").json()["group"]["name"] == "Tuần 38"

    calls_before = len(stt.calls)
    res = client.post("/api/upload-transcribe", files={"file": ("a.mp3", b"\x00" * 64, "audio/mpeg")}, data={"group_id": "nope"})
    assert res.status_code == 404 and len(stt.calls) == calls_before  # không gửi file khi nhóm không tồn tại

