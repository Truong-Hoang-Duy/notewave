from tests.helpers import seg


def create_group(client, name):
    res = client.post("/api/groups", json={"name": name})
    assert res.status_code == 201, res.text
    return res.json()


def test_group_crud_and_unique_name(client):
    g = create_group(client, "Dự Án Khách Hàng")
    assert client.post("/api/groups", json={"name": "dự án khách hàng"}).status_code == 409  # không phân biệt hoa thường, có dấu
    assert client.post("/api/groups", json={"name": "   "}).status_code == 422
    create_group(client, "Ảnh tuần")

    # Postgres (collation ICU en_US.UTF-8) sắp xếp theo bảng chữ cái: "Ả" xếp cùng "A", trước "D".
    # (SQLite/Python so theo codepoint sẽ ra thứ tự ngược lại.)
    assert [x["name"] for x in client.get("/api/groups").json()] == ["Ảnh tuần", "Dự Án Khách Hàng"]

    renamed = client.patch(f"/api/groups/{g['id']}", json={"name": "Dự án B"})
    assert renamed.json()["name"] == "Dự án B"
    assert client.patch(f"/api/groups/{g['id']}", json={"name": "ẢNH TUẦN"}).status_code == 409
    assert client.patch("/api/groups/nope", json={"name": "x"}).status_code == 404


def test_assign_filter_and_delete_group(client, make_session):
    g = create_group(client, "Lớp học")
    a, b, c = make_session("A"), make_session("B"), make_session("C")

    res = client.post("/api/sessions/assign-group", json={"session_ids": [a["id"], b["id"]], "group_id": g["id"]})
    assert res.status_code == 200 and {i["group"]["name"] for i in res.json()["items"]} == {"Lớp học"}
    assert client.get("/api/groups").json()[0]["session_count"] == 2

    assert client.get("/api/sessions", params={"group_id": g["id"]}).json()["total"] == 2
    assert client.get("/api/sessions", params={"group_id": "none"}).json()["total"] == 1
    assert client.get(f"/api/sessions/{a['id']}").json()["group"] == {"id": g["id"], "name": "Lớp học"}

    client.post("/api/sessions/assign-group", json={"session_ids": [b["id"]], "group_id": None})
    assert client.get("/api/sessions", params={"group_id": "none"}).json()["total"] == 2

    assert client.post("/api/sessions/assign-group", json={"session_ids": [c["id"], "nope"], "group_id": g["id"]}).status_code == 404
    assert client.post("/api/sessions/assign-group", json={"session_ids": [c["id"]], "group_id": "nope"}).status_code == 404

    assert client.delete(f"/api/groups/{g['id']}").status_code == 204
    assert client.get(f"/api/sessions/{a['id']}").json()["group"] is None  # phiên không bị xoá
    assert client.get("/api/groups").json() == []


def test_merge_reordered_with_offsets_and_archive(client, make_session):
    g = create_group(client, "Khoá học")
    b1 = make_session("Buổi 1", "live", [seg("1", "Mở đầu", 0, 4000), seg("2", "Dạ.", 4000, 5000)], 10000)
    b2 = make_session("Buổi 2", "upload", [seg("1", "Tiếp tục", 0, 3000), seg("2", "Kết thúc", 3000, 8000)])  # không có duration

    res = client.post("/api/sessions/merge", json={"session_ids": [b2["id"], b1["id"]], "group_id": g["id"]})
    assert res.status_code == 201, res.text
    m = res.json()
    assert m["title"] == "Buổi 2 (gộp 2 phiên)"
    assert m["source"] == "upload"  # giữ quy ước live|upload: lấy theo phiên đầu tiên
    assert m["duration_ms"] == 18000  # 8000 (end_ms cuối của Buổi 2) + 10000
    assert [(s["speaker"], s["text"], s["start_ms"], s["origin"]) for s in m["segments"]] == [
        ("1", "Tiếp tục", 0, b2["id"]),
        ("2", "Kết thúc", 3000, b2["id"]),
        ("1", "Mở đầu", 8000, b1["id"]),
        ("2", "Dạ.", 12000, b1["id"]),
    ]
    assert [(x["title"], x["offset_ms"]) for x in m["merge_sources"]] == [("Buổi 2", 0), ("Buổi 1", 8000)]
    assert m["group"]["name"] == "Khoá học"

    listed = client.get("/api/sessions").json()
    assert [i["title"] for i in listed["items"]] == ["Buổi 2 (gộp 2 phiên)"]
    assert listed["items"][0]["merged_count"] == 2
    archived = client.get("/api/sessions", params={"archived": True}).json()
    assert {i["title"] for i in archived["items"]} == {"Buổi 1", "Buổi 2"}
    assert client.get(f"/api/sessions/{b1['id']}").json()["merged_into_id"] == m["id"]
    assert client.get("/api/groups").json()[0]["session_count"] == 1  # phiên archived không được đếm

    txt = client.get(f"/api/sessions/{m['id']}/export").content.decode("utf-8-sig")
    assert "Gộp từ 2 phiên: Buổi 2; Buổi 1" in txt
    assert txt.index("--- Buổi 2 ---") < txt.index("--- Buổi 1 ---")
    assert "[00:08 · Người nói 1] Mở đầu" in txt

    restored = client.post(f"/api/sessions/{b1['id']}/restore").json()
    assert restored["archived_at"] is None and restored["merged_into_id"] is None
    assert client.get("/api/sessions").json()["total"] == 2


def test_merge_delete_originals_and_validation(client, make_session, soniox):
    a = make_session("A", segments=[seg("1", "a", 0, 1000)])
    b = make_session("B", segments=[seg("1", "b", 0, 1000)])

    assert client.post("/api/sessions/merge", json={"session_ids": [a["id"]]}).status_code == 422
    assert client.post("/api/sessions/merge", json={"session_ids": [a["id"], a["id"]]}).status_code == 422
    assert client.post("/api/sessions/merge", json={"session_ids": [a["id"], "nope"]}).status_code == 404
    assert client.post("/api/sessions/merge", json={"session_ids": [a["id"], b["id"]], "group_id": "nope"}).status_code == 404

    # Phiên đang xử lý không gộp được
    up = client.post("/api/upload-transcribe", files={"file": ("x.mp3", b"\x00" * 64, "audio/mpeg")}).json()
    assert client.post("/api/sessions/merge", json={"session_ids": [a["id"], up["session_id"]]}).status_code == 409

    res = client.post("/api/sessions/merge", json={"session_ids": [a["id"], b["id"]], "title": "Tổng hợp", "delete_originals": True})
    assert res.status_code == 201 and res.json()["title"] == "Tổng hợp"
    assert client.get(f"/api/sessions/{a['id']}").status_code == 404
    assert client.get("/api/sessions", params={"archived": True}).json()["total"] == 0
