from datetime import datetime

from tests.helpers import seg


def test_create_with_default_title_and_unicode_roundtrip(client, make_session):
    res = client.post(
        "/api/sessions",
        json={"source": "live", "segments": [seg("1", "Xin chào mọi người — “trích dẫn” 😀", 0, 3000)], "duration_ms": 3500},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["title"].startswith("Ghi âm ")
    assert body["segments"][0]["text"] == "Xin chào mọi người — “trích dẫn” 😀"
    assert body["summary_outdated"] is False and body["group"] is None

    fetched = client.get(f"/api/sessions/{body['id']}").json()
    assert fetched["segments"] == body["segments"]
    created = datetime.fromisoformat(fetched["created_at"])
    assert created.tzinfo is not None and created.utcoffset().total_seconds() == 0


def test_list_order_filters_and_vietnamese_search(client, make_session):
    make_session("BÁO CÁO Quý", "upload", [seg(None, "Đây là NỘI DUNG chính", 0, 1000)])
    make_session("Họp tuần", "live", [seg("1", "Đề xuất tăng ngân sách", 0, 1000)])
    make_session("Khác", "live", [seg("1", "abc", 0, 1000)])

    items = client.get("/api/sessions").json()
    assert items["total"] == 3
    assert [i["title"] for i in items["items"]] == ["Khác", "Họp tuần", "BÁO CÁO Quý"]  # mới nhất trước

    def total(**params):
        return client.get("/api/sessions", params=params).json()["total"]

    assert total(q="báo cáo") == 1
    assert total(q="nội dung") == 1  # tìm trong transcript, không phân biệt hoa thường có dấu
    assert total(q="ĐỀ XUẤT") == 1
    assert total(q="xyz") == 0
    assert total(q="100%") == 0
    assert total(source="upload") == 1
    assert total(source="live", q="abc") == 1


def test_list_item_fields(client, make_session):
    make_session("A", "live", [seg("1", "x", 0, 1), seg("2", "y", 1, 2), seg("1", "z", 2, 3)], duration_ms=3)
    item = client.get("/api/sessions").json()["items"][0]
    assert item["speaker_count"] == 2
    assert item["preview"] == "x\ny\nz"
    assert item["has_summary"] is False and item["merged_count"] == 0 and item["archived_at"] is None


def test_rename_and_delete(client, make_session):
    s = make_session("Cũ")
    res = client.patch(f"/api/sessions/{s['id']}", json={"title": "  Tên mới  "})
    assert res.json()["title"] == "Tên mới"
    assert client.patch(f"/api/sessions/{s['id']}", json={"title": ""}).status_code == 422
    assert client.delete(f"/api/sessions/{s['id']}").status_code == 204
    assert client.get(f"/api/sessions/{s['id']}").status_code == 404
    assert client.delete(f"/api/sessions/{s['id']}").status_code == 404


def test_export_txt_and_docx(client, make_session):
    s = make_session("Họp dự án", "live", [seg("1", "Xin chào", 0, 3000), seg("2", "Tôi gửi báo cáo", 3200, 6000)], 6500)
    txt = client.get(f"/api/sessions/{s['id']}/export", params={"format": "txt"})
    assert txt.status_code == 200
    assert "filename*=UTF-8''H%E1%BB%8Dp" in txt.headers["content-disposition"]
    content = txt.content.decode("utf-8-sig")
    assert "[00:00 · Người nói 1] Xin chào" in content
    assert "[00:03 · Người nói 2] Tôi gửi báo cáo" in content

    docx = client.get(f"/api/sessions/{s['id']}/export", params={"format": "docx"})
    assert docx.status_code == 200 and docx.content[:2] == b"PK"
    assert client.get(f"/api/sessions/{s['id']}/export", params={"format": "pdf"}).status_code == 422


def test_summarize(client, make_session, monkeypatch):
    from app.models.summary import MeetingSummary
    from app.routers import sessions as sessions_router

    async def fake_summarize(title, segments, part_titles=None, source="live"):
        return MeetingSummary(summary=f"Tóm tắt {title}", action_items=[{"task": "Gửi báo cáo", "owner": "Người nói 2"}])

    monkeypatch.setattr(sessions_router, "summarize_transcript", fake_summarize)
    s = make_session("Họp", segments=[seg("1", "Nội dung", 0, 1000)])
    res = client.post(f"/api/sessions/{s['id']}/summarize")
    assert res.status_code == 200
    assert res.json()["action_items"][0]["owner"] == "Người nói 2"
    detail = client.get(f"/api/sessions/{s['id']}").json()
    assert detail["summary"]["summary"] == "Tóm tắt Họp"

    empty = make_session("Trống")
    assert client.post(f"/api/sessions/{empty['id']}/summarize").status_code == 422


def test_summarize_llm_failure_returns_502(client, make_session, monkeypatch):
    from app.routers import sessions as sessions_router

    async def boom(*args, **kwargs):
        raise RuntimeError("provider down")

    monkeypatch.setattr(sessions_router, "summarize_transcript", boom)
    s = make_session("Họp", segments=[seg("1", "Nội dung", 0, 1000)])
    assert client.post(f"/api/sessions/{s['id']}/summarize").status_code == 502


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["soniox_configured"] is True and body["webhook_enabled"] is True
    assert body["ocr_configured"] is True
    assert body["database"] == "ok" and body["database_error"] is None


def test_health_reports_database_error(client, monkeypatch):
    import app.main as main

    monkeypatch.setattr(main, "check_database", lambda: "OperationalError")
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "degraded" and body["database"] == "error"
    assert body["database_error"] == "OperationalError"


def test_list_sort_options(client, make_session):
    from app import db as app_db
    from app.models.session import NoteSession
    from sqlmodel import Session

    older = make_session("zebra", "live", [seg("1", "a", 0, 1000)], duration_ms=5000)
    middle = make_session("Ảnh tuần", "upload", [seg(None, "b", 0, 1000)], duration_ms=60000)
    newest = make_session("bản ghi", "live", [seg("1", "c", 0, 1000)])  # không có thời lượng

    titles = lambda **params: [i["title"] for i in client.get("/api/sessions", params=params).json()["items"]]

    assert titles() == ["bản ghi", "Ảnh tuần", "zebra"]  # mặc định: mới nhất trước
    assert titles(sort="created_desc") == ["bản ghi", "Ảnh tuần", "zebra"]
    assert titles(sort="created_asc") == ["zebra", "Ảnh tuần", "bản ghi"]
    # Sắp xếp theo tên không phân biệt hoa/thường, theo bảng chữ cái tiếng Việt (collation của Postgres)
    assert titles(sort="title_asc") == ["Ảnh tuần", "bản ghi", "zebra"]
    assert titles(sort="title_desc") == ["zebra", "bản ghi", "Ảnh tuần"]
    # Thời lượng: phiên không có thời lượng (vd. quét tài liệu) luôn xếp cuối
    assert titles(sort="duration_desc") == ["Ảnh tuần", "zebra", "bản ghi"]
    assert titles(sort="duration_asc") == ["zebra", "Ảnh tuần", "bản ghi"]

    # Sửa phiên cũ nhất -> nó lên đầu khi sắp theo lần sửa gần nhất
    client.patch(f"/api/sessions/{older['id']}", json={"title": "zebra (đã sửa)"})
    assert titles(sort="updated_desc")[0] == "zebra (đã sửa)"

    assert titles(sort="title_asc", source="live") == ["bản ghi", "zebra (đã sửa)"]  # kết hợp bộ lọc
    assert client.get("/api/sessions", params={"sort": "khong-co"}).status_code == 422

    # Phân trang giữ đúng thứ tự đã sắp
    page = client.get("/api/sessions", params={"sort": "title_asc", "limit": 2}).json()
    assert [i["title"] for i in page["items"]] == ["Ảnh tuần", "bản ghi"] and page["total"] == 3
    page2 = client.get("/api/sessions", params={"sort": "title_asc", "limit": 2, "offset": 2}).json()
    assert [i["title"] for i in page2["items"]] == ["zebra (đã sửa)"]
    assert middle["id"] and newest["id"]

    with Session(app_db.engine) as db:
        assert db.get(NoteSession, older["id"]).title == "zebra (đã sửa)"
