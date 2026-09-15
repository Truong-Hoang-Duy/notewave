from sqlmodel import Session

from app.db import engine
from app.models.session import NoteSession
from tests.helpers import seg


def _set_summary(session_id: str) -> None:
    with Session(engine) as db:
        s = db.get(NoteSession, session_id)
        s.summary = {"summary": "cũ", "key_points": [], "action_items": [], "decisions": []}
        db.add(s)
        db.commit()


def test_edit_segments_marks_summary_outdated(client, make_session):
    s = make_session("Buổi 4", segments=[seg("1", "Hôm nay học lập kế hoạch", 0, 4000), seg("2", "Biết.", 4000, 4500), seg("1", "Bài tập", 5000, 9000)])
    _set_summary(s["id"])

    segments = client.get(f"/api/sessions/{s['id']}").json()["segments"]
    edited = [dict(segments[0], text="  Hôm nay học lập kế hoạch tuần  "), dict(segments[1], text="   "), segments[2]]
    res = client.put(f"/api/sessions/{s['id']}/segments", json={"segments": edited})
    assert res.status_code == 200
    body = res.json()
    assert [x["text"] for x in body["segments"]] == ["Hôm nay học lập kế hoạch tuần", "Bài tập"]  # trim + bỏ đoạn rỗng
    assert body["summary_outdated"] is True

    # Tìm kiếm và export dùng bản đã sửa
    assert client.get("/api/sessions", params={"q": "biết."}).json()["total"] == 0
    assert client.get("/api/sessions", params={"q": "kế hoạch tuần"}).json()["total"] == 1
    txt = client.get(f"/api/sessions/{s['id']}/export").content.decode("utf-8-sig")
    assert "Biết." not in txt and "Hôm nay học lập kế hoạch tuần" in txt


def test_unchanged_or_no_summary_does_not_flag(client, make_session):
    s = make_session("A", segments=[seg("1", "x", 0, 1)])
    segments = client.get(f"/api/sessions/{s['id']}").json()["segments"]
    assert client.put(f"/api/sessions/{s['id']}/segments", json={"segments": segments[:0]}).json()["summary_outdated"] is False

    t = make_session("B", segments=[seg("1", "y", 0, 1)])
    _set_summary(t["id"])
    same = client.get(f"/api/sessions/{t['id']}").json()["segments"]
    assert client.put(f"/api/sessions/{t['id']}/segments", json={"segments": same}).json()["summary_outdated"] is False


def test_summarize_clears_outdated_flag(client, make_session, monkeypatch):
    from app.models.summary import MeetingSummary
    from app.routers import sessions as sessions_router

    async def fake(*args, **kwargs):
        return MeetingSummary(summary="mới")

    monkeypatch.setattr(sessions_router, "summarize_transcript", fake)
    s = make_session("A", segments=[seg("1", "x", 0, 1), seg("1", "y", 1, 2)])
    _set_summary(s["id"])
    client.put(f"/api/sessions/{s['id']}/segments", json={"segments": [seg("1", "x", 0, 1)]})
    client.post(f"/api/sessions/{s['id']}/summarize")
    body = client.get(f"/api/sessions/{s['id']}").json()
    assert body["summary"]["summary"] == "mới" and body["summary_outdated"] is False


def test_cannot_edit_processing_session(client, soniox):
    up = client.post("/api/upload-transcribe", files={"file": ("x.wav", b"\x00" * 64, "audio/wav")}).json()
    assert client.put(f"/api/sessions/{up['session_id']}/segments", json={"segments": []}).status_code == 409
    assert client.put("/api/sessions/nope/segments", json={"segments": []}).status_code == 404
