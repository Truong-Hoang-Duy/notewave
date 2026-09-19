"""Ghi chú Cornell: CRUD note, autosave PATCH từng phần, tìm kiếm/lọc/sắp xếp, thư mục dạng cây, tag."""

import pytest


@pytest.fixture
def make_note(client):
    def _make(title="Ghi chú thử", **extra):
        res = client.post("/api/notes", json={"title": title, **extra})
        assert res.status_code == 201, res.text
        return res.json()

    return _make


@pytest.fixture
def make_folder(client):
    def _make(name, parent_id=None):
        res = client.post("/api/note-folders", json={"name": name, "parent_id": parent_id})
        assert res.status_code == 201, res.text
        return res.json()

    return _make


@pytest.fixture
def make_tag(client):
    def _make(name):
        res = client.post("/api/tags", json={"name": name})
        assert res.status_code == 201, res.text
        return res.json()

    return _make


def _titles(res):
    assert res.status_code == 200, res.text
    return [i["title"] for i in res.json()["items"]]


# ---- Note CRUD ----


def test_create_note_defaults(client):
    res = client.post("/api/notes", json={})
    assert res.status_code == 201
    note = res.json()
    assert note["title"].startswith("Ghi chú ")
    assert note["cues"] == [] and note["content_md"] == "" and note["summary"] == ""
    assert note["content_json"] is None
    assert note["folder"] is None and note["tags"] == []
    assert note["style"] == {"theme": None, "font": None, "font_size": None}


def test_create_note_with_folder_and_tags(client, make_folder, make_tag):
    folder = make_folder("Giải tích")
    tag = make_tag("đạo hàm")
    note = client.post("/api/notes", json={"title": "Bài 1", "folder_id": folder["id"], "tag_ids": [tag["id"], tag["id"]]}).json()
    assert note["folder"] == {"id": folder["id"], "name": "Giải tích"}
    assert note["tags"] == [{"id": tag["id"], "name": "đạo hàm"}]


def test_create_note_unknown_folder_or_tag(client):
    assert client.post("/api/notes", json={"folder_id": "nope"}).status_code == 404
    assert client.post("/api/notes", json={"tag_ids": ["nope"]}).status_code == 404


def test_patch_only_sent_fields(client, make_note):
    note = make_note("Bài giảng", summary=None)
    content_json = {"type": "doc", "content": [{"type": "paragraph", "attrs": {"id": "b1"}, "content": [{"type": "text", "text": "Đạo hàm"}]}]}
    res = client.patch(
        f"/api/notes/{note['id']}",
        json={
            "cues": [{"id": "c1", "text": "Đạo hàm là gì?", "anchor": "b1"}, {"id": "c2", "text": ""}],
            "content_json": content_json,
            "content_md": "Đạo hàm",
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["title"] == "Bài giảng"
    assert body["cues"] == [{"id": "c1", "text": "Đạo hàm là gì?", "anchor": "b1"}, {"id": "c2", "text": "", "anchor": None}]
    assert body["content_json"] == content_json
    assert body["updated_at"] > note["updated_at"]

    # PATCH chỉ summary không làm mất nội dung đã lưu.
    body = client.patch(f"/api/notes/{note['id']}", json={"summary": "Tự tóm tắt"}).json()
    assert body["summary"] == "Tự tóm tắt"
    assert body["content_md"] == "Đạo hàm" and len(body["cues"]) == 2

    # Danh sách: đếm câu hỏi có nội dung, có tóm tắt, preview bỏ ký hiệu Markdown.
    client.patch(f"/api/notes/{note['id']}", json={"content_md": "# Tiêu đề\n\n- [ ] **việc** cần làm"})
    item = client.get("/api/notes").json()["items"][0]
    assert item["cue_count"] == 1 and item["has_summary"] is True
    assert item["preview"] == "Tiêu đề việc cần làm"


def test_patch_title_and_style_validation(client, make_note):
    note = make_note()
    assert client.patch(f"/api/notes/{note['id']}", json={"title": "   "}).status_code == 422
    assert client.patch(f"/api/notes/{note['id']}", json={"style": {"theme": "neon"}}).status_code == 422
    body = client.patch(f"/api/notes/{note['id']}", json={"title": "  Mới ", "style": {"theme": "sepia", "font_size": "lg"}}).json()
    assert body["title"] == "Mới"
    assert body["style"] == {"theme": "sepia", "font": None, "font_size": "lg"}
    body = client.patch(f"/api/notes/{note['id']}", json={"style": None}).json()
    assert body["style"] == {"theme": None, "font": None, "font_size": None}


def test_patch_folder_and_tags(client, make_note, make_folder, make_tag):
    folder = make_folder("Vật lý")
    a, b = make_tag("a"), make_tag("b")
    note = make_note(folder_id=folder["id"], tag_ids=[a["id"]])
    body = client.patch(f"/api/notes/{note['id']}", json={"tag_ids": [b["id"]]}).json()
    assert [t["name"] for t in body["tags"]] == ["b"]
    assert body["folder"]["id"] == folder["id"]  # không gửi folder_id -> giữ nguyên
    body = client.patch(f"/api/notes/{note['id']}", json={"folder_id": None}).json()
    assert body["folder"] is None
    assert client.patch(f"/api/notes/{note['id']}", json={"folder_id": "nope"}).status_code == 404
    assert client.patch(f"/api/notes/{note['id']}", json={"tag_ids": ["nope"]}).status_code == 404


def test_get_and_delete_note(client, make_note, make_tag):
    tag = make_tag("x")
    note = make_note(tag_ids=[tag["id"]])
    assert client.get(f"/api/notes/{note['id']}").json()["id"] == note["id"]
    assert client.delete(f"/api/notes/{note['id']}").status_code == 204
    assert client.get(f"/api/notes/{note['id']}").status_code == 404
    assert client.delete(f"/api/notes/{note['id']}").status_code == 404
    assert client.get("/api/tags").json()[0]["note_count"] == 0


# ---- Danh sách: tìm kiếm / lọc / sắp xếp ----


def test_search_covers_title_cues_content_summary(client, make_note):
    a = make_note("Tích phân")
    b = make_note("Bài 2")
    c = make_note("Bài 3")
    d = make_note("Bài 4")
    client.patch(f"/api/notes/{b['id']}", json={"cues": [{"id": "1", "text": "Định lý LAGRANGE?"}]})
    client.patch(f"/api/notes/{c['id']}", json={"content_md": "Chuỗi Taylor của hàm lagrange"})
    client.patch(f"/api/notes/{d['id']}", json={"summary": "Ôn Lagrange trước thi"})
    assert sorted(_titles(client.get("/api/notes", params={"q": "lagrange"}))) == ["Bài 2", "Bài 3", "Bài 4"]
    assert _titles(client.get("/api/notes", params={"q": "TÍCH"})) == [a["title"]]
    assert client.get("/api/notes", params={"q": "không có"}).json() == {"items": [], "total": 0}


def test_filter_by_folder_and_tag(client, make_note, make_folder, make_tag):
    parent = make_folder("Toán")
    child = make_folder("Đại số", parent["id"])
    tag = make_tag("thi")
    make_note("Gốc")
    make_note("Trong Toán", folder_id=parent["id"], tag_ids=[tag["id"]])
    make_note("Trong Đại số", folder_id=child["id"], tag_ids=[tag["id"]])
    # folder_id chỉ lấy note nằm TRỰC TIẾP trong thư mục.
    assert _titles(client.get("/api/notes", params={"folder_id": parent["id"]})) == ["Trong Toán"]
    assert _titles(client.get("/api/notes", params={"folder_id": "none"})) == ["Gốc"]
    assert sorted(_titles(client.get("/api/notes", params={"tag_id": tag["id"]}))) == ["Trong Toán", "Trong Đại số"]
    assert _titles(client.get("/api/notes", params={"tag_id": tag["id"], "folder_id": child["id"]})) == ["Trong Đại số"]


def test_sort_and_pagination(client, make_note):
    b = make_note("banana")
    make_note("Apple")
    make_note("cherry")
    assert _titles(client.get("/api/notes", params={"sort": "title_asc"})) == ["Apple", "banana", "cherry"]
    assert _titles(client.get("/api/notes", params={"sort": "title_desc"})) == ["cherry", "banana", "Apple"]
    assert _titles(client.get("/api/notes", params={"sort": "created_asc"})) == ["banana", "Apple", "cherry"]
    # Mặc định updated_desc: note vừa sửa lên đầu.
    client.patch(f"/api/notes/{b['id']}", json={"summary": "x"})
    assert _titles(client.get("/api/notes"))[0] == "banana"
    page = client.get("/api/notes", params={"sort": "title_asc", "limit": 2, "offset": 1}).json()
    assert page["total"] == 3 and [i["title"] for i in page["items"]] == ["banana", "cherry"]
    assert client.get("/api/notes", params={"sort": "bogus"}).status_code == 422


# ---- Thư mục dạng cây ----


def test_folder_tree_and_unique_names(client, make_folder, make_note):
    root = make_folder("Học kỳ 1")
    child = make_folder("Giải tích", root["id"])
    # Trùng tên trong cùng thư mục cha (không phân biệt hoa thường) -> 409; khác cha thì được.
    assert client.post("/api/note-folders", json={"name": "giải TÍCH", "parent_id": root["id"]}).status_code == 409
    make_folder("Giải tích")
    assert client.post("/api/note-folders", json={"name": "  "}).status_code == 422
    assert client.post("/api/note-folders", json={"name": "x", "parent_id": "nope"}).status_code == 404
    make_note(folder_id=child["id"])
    folders = {f["id"]: f for f in client.get("/api/note-folders").json()}
    assert folders[child["id"]]["parent_id"] == root["id"]
    assert folders[child["id"]]["note_count"] == 1 and folders[root["id"]]["note_count"] == 0


def test_folder_rename_and_move(client, make_folder):
    a = make_folder("A")
    b = make_folder("B", a["id"])
    c = make_folder("C", b["id"])
    res = client.patch(f"/api/note-folders/{b['id']}", json={"name": "B2"})
    assert res.status_code == 200 and res.json()["parent_id"] == a["id"]
    # Không cho chuyển vào chính nó / con cháu của nó.
    assert client.patch(f"/api/note-folders/{a['id']}", json={"parent_id": c["id"]}).status_code == 422
    assert client.patch(f"/api/note-folders/{a['id']}", json={"parent_id": a["id"]}).status_code == 422
    # Chuyển C ra gốc (parent_id null tường minh).
    assert client.patch(f"/api/note-folders/{c['id']}", json={"parent_id": None}).json()["parent_id"] is None
    make_folder("Trùng")
    d = make_folder("Trùng", a["id"])
    assert client.patch(f"/api/note-folders/{d['id']}", json={"parent_id": None}).status_code == 409


def test_delete_folder_moves_content_up(client, make_folder, make_note):
    root = make_folder("Gốc")
    mid = make_folder("Giữa", root["id"])
    make_folder("Con", mid["id"])
    make_folder("Con", root["id"])  # trùng tên với thư mục con sẽ được chuyển lên
    note = make_note(folder_id=mid["id"])
    assert client.delete(f"/api/note-folders/{mid['id']}").status_code == 204
    assert client.get(f"/api/notes/{note['id']}").json()["folder"]["id"] == root["id"]
    children = sorted(f["name"] for f in client.get("/api/note-folders").json() if f["parent_id"] == root["id"])
    assert children == ["Con", "Con (2)"]
    assert client.delete(f"/api/note-folders/{mid['id']}").status_code == 404


# ---- Tag ----


def test_tags_crud(client, make_tag, make_note):
    tag = make_tag("  #Ôn   thi ")
    assert tag["name"] == "Ôn thi"
    assert client.post("/api/tags", json={"name": "ôn THI"}).status_code == 409
    assert client.post("/api/tags", json={"name": "#"}).status_code == 422
    other = make_tag("khác")
    make_note(tag_ids=[tag["id"]])
    assert client.patch(f"/api/tags/{tag['id']}", json={"name": "Khác"}).status_code == 409
    renamed = client.patch(f"/api/tags/{tag['id']}", json={"name": "Thi cuối kỳ"}).json()
    assert renamed == {"id": tag["id"], "name": "Thi cuối kỳ", "note_count": 1}
    assert [t["name"] for t in client.get("/api/tags").json()] == ["khác", "Thi cuối kỳ"]
    assert client.delete(f"/api/tags/{tag['id']}").status_code == 204
    assert client.get("/api/notes").json()["items"][0]["tags"] == []
    assert client.delete(f"/api/tags/{other['id']}").status_code == 204
    assert client.get("/api/tags").json() == []
