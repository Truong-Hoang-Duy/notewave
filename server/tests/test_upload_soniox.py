def test_temporary_key(client, soniox):
    res = client.post("/api/temporary-key")
    assert res.status_code == 200
    assert res.json()["api_key"] == "snx_temp_abc"
    assert "test-soniox-key" not in res.text  # không bao giờ lộ key chính

    soniox.fail_temp_key = True
    assert client.post("/api/temporary-key").status_code == 502


def test_upload_validation(client, soniox):
    assert client.post("/api/upload-transcribe", files={"file": ("a.txt", b"x")}).status_code == 415
    assert client.post("/api/upload-transcribe", files={"file": ("a.mp3", b"")}).status_code == 422
    assert soniox.calls == []


def test_upload_poll_then_webhook_completes_and_cleans_up(client, soniox):
    res = client.post("/api/upload-transcribe", files={"file": ("họp nhóm.m4a", b"\x00" * 2048, "audio/mp4")})
    assert res.status_code == 202, res.text
    sid = res.json()["session_id"]
    assert res.json()["webhook_enabled"] is True
    body = soniox.last_transcription_body
    assert body["webhook_url"] == "https://api.example.com/api/webhooks/soniox"
    assert body["webhook_auth_header_value"] == "Bearer s3cret"
    assert body["enable_speaker_diarization"] is True and body["client_reference_id"] == sid

    listed = client.get("/api/sessions").json()["items"][0]
    assert listed["status"] == "processing" and listed["title"] == "họp nhóm"

    assert client.get(f"/api/upload-transcribe/{sid}/status").json()["status"] == "processing"

    assert client.post("/api/webhooks/soniox", json={"id": "tr-1", "status": "completed"}).status_code == 401
    soniox.job_status = "completed"
    assert client.post("/api/webhooks/soniox", json={"id": "tr-1", "status": "completed"}, headers={"Authorization": "Bearer s3cret"}).status_code == 204

    status = client.get(f"/api/upload-transcribe/{sid}/status").json()
    assert status == {"session_id": sid, "status": "completed", "error_message": None}
    detail = client.get(f"/api/sessions/{sid}").json()
    assert detail["source"] == "upload" and detail["duration_ms"] == 5000
    assert [(s["speaker"], s["text"]) for s in detail["segments"]] == [("1", "Xin chào"), ("2", "Chào bạn")]
    assert "DELETE /v1/files/file-1" in soniox.calls and "DELETE /v1/transcriptions/tr-1" in soniox.calls

    # Webhook lặp lại (Soniox retry) không làm hỏng dữ liệu
    assert client.post("/api/webhooks/soniox", json={"id": "tr-1", "status": "completed"}, headers={"Authorization": "Bearer s3cret"}).status_code == 204
    assert len(client.get(f"/api/sessions/{sid}").json()["segments"]) == 2


def test_failed_job_and_unknown_webhook(client, soniox):
    sid = client.post("/api/upload-transcribe", files={"file": ("a.mp3", b"\x00" * 64, "audio/mpeg")}).json()["session_id"]
    soniox.job_status = "error"
    soniox.error_message = "Audio không hợp lệ"
    status = client.get(f"/api/upload-transcribe/{sid}/status").json()
    assert status["status"] == "failed" and status["error_message"] == "Audio không hợp lệ"

    headers = {"Authorization": "Bearer s3cret"}
    assert client.post("/api/webhooks/soniox", json={"id": "unknown", "status": "completed"}, headers=headers).status_code == 204


def test_upload_soniox_failure_does_not_create_session(client, soniox):
    soniox.fail_upload = True
    assert client.post("/api/upload-transcribe", files={"file": ("a.mp3", b"\x00" * 64, "audio/mpeg")}).status_code == 502
    assert client.get("/api/sessions").json()["total"] == 0


def test_delete_processing_session_cleans_soniox(client, soniox):
    sid = client.post("/api/upload-transcribe", files={"file": ("a.mp3", b"\x00" * 64, "audio/mpeg")}).json()["session_id"]
    assert client.delete(f"/api/sessions/{sid}").status_code == 204
    assert "DELETE /v1/transcriptions/tr-1" in soniox.calls and "DELETE /v1/files/file-1" in soniox.calls


def test_upload_with_group_id(client, soniox):
    group = client.post("/api/groups", json={"name": "Tuần 38"}).json()
    res = client.post("/api/upload-transcribe", files={"file": ("a.mp3", b"\x00" * 64, "audio/mpeg")}, data={"group_id": group["id"]})
    assert res.status_code == 202, res.text
    assert client.get(f"/api/sessions/{res.json()['session_id']}").json()["group"]["name"] == "Tuần 38"

    calls_before = len(soniox.calls)
    res = client.post("/api/upload-transcribe", files={"file": ("a.mp3", b"\x00" * 64, "audio/mpeg")}, data={"group_id": "nope"})
    assert res.status_code == 404 and len(soniox.calls) == calls_before  # không gửi file khi nhóm không tồn tại
