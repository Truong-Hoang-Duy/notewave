"""Ghi chú — GĐ3: liên kết [[...]] giữa các note và backlink."""

from app.services.note_links import parse_note_links


def link(note: dict) -> str:
    """Markdown do frontend sinh cho một liên kết tới note (node `noteLink`)."""
    return f"[[{note['title']}]](/notes/{note['id']})"


def note(client, title="Ghi chú"):
    return client.post("/api/notes", json={"title": title}).json()


def save(client, note_id, markdown):
    res = client.patch(f"/api/notes/{note_id}", json={"content_md": markdown})
    assert res.status_code == 200, res.text
    return res.json()


def links(client, note_id):
    res = client.get(f"/api/notes/{note_id}/links")
    assert res.status_code == 200, res.text
    body = res.json()
    return [n["title"] for n in body["incoming"]], [n["title"] for n in body["outgoing"]]


def test_parse_note_links():
    a, b = "a" * 32, "b" * 32
    md = f"Xem [[Đạo hàm]](/notes/{a}) và [[Tích phân]](/notes/{b}), nhắc lại [[Đạo hàm]](/notes/{a})."
    assert parse_note_links(md) == [a, b]  # giữ thứ tự, bỏ trùng
    # Không phải liên kết note: link thường, ảnh, id sai định dạng, xuống dòng trong tiêu đề
    assert parse_note_links("[Đạo hàm](/notes/abc) ![x](/api/note-images/" + "c" * 32 + ")") == []
    assert parse_note_links(f"[[Tên]](/notes/{a[:31]})") == []
    assert parse_note_links("") == []


def test_links_and_backlinks(client):
    a, b, c = note(client, "Giải tích"), note(client, "Đạo hàm"), note(client, "Tích phân")
    save(client, a["id"], f"Chương này dùng {link(b)} và {link(c)}.")

    incoming_a, outgoing_a = links(client, a["id"])
    assert incoming_a == [] and set(outgoing_a) == {"Đạo hàm", "Tích phân"}
    assert links(client, b["id"]) == (["Giải tích"], [])
    assert links(client, c["id"]) == (["Giải tích"], [])

    # Liên kết hai chiều: B trỏ ngược lại A
    save(client, b["id"], f"Xem lại {link(a)}")
    assert links(client, a["id"])[0] == ["Đạo hàm"]
    assert links(client, b["id"]) == (["Giải tích"], ["Giải tích"])


def test_backlink_follows_rename_and_folder(client):
    a, b = note(client, "Nguồn"), note(client, "Đích")
    save(client, a["id"], link(b))
    folder = client.post("/api/note-folders", json={"name": "Toán"}).json()
    client.patch(f"/api/notes/{a['id']}", json={"title": "Nguồn (đã đổi tên)", "folder_id": folder["id"]})

    body = client.get(f"/api/notes/{b['id']}/links").json()
    assert body["incoming"][0]["title"] == "Nguồn (đã đổi tên)"  # liên kết theo id nên đổi tên không gãy
    assert body["incoming"][0]["folder"] == {"id": folder["id"], "name": "Toán"}


def test_self_link_and_unknown_target_ignored(client):
    a = note(client, "Tự trỏ")
    missing = "f" * 32
    save(client, a["id"], f"{link(a)} và [[Đã xoá]](/notes/{missing})")
    assert links(client, a["id"]) == ([], [])


def test_links_recomputed_on_every_save(client):
    a, b, c = note(client, "A"), note(client, "B"), note(client, "C")
    save(client, a["id"], f"{link(b)} {link(c)}")
    assert sorted(links(client, a["id"])[1]) == ["B", "C"]

    save(client, a["id"], link(c))  # bỏ liên kết tới B
    assert links(client, a["id"])[1] == ["C"]
    assert links(client, b["id"])[0] == []

    # Lưu field khác (không phải nội dung) không đụng tới liên kết
    client.patch(f"/api/notes/{a['id']}", json={"title": "A2"})
    assert links(client, a["id"])[1] == ["C"]


def test_delete_note_clears_links_both_ways(client):
    a, b = note(client, "Còn lại"), note(client, "Sắp xoá")
    save(client, a["id"], link(b))
    save(client, b["id"], link(a))

    assert client.delete(f"/api/notes/{b['id']}").status_code == 204
    assert links(client, a["id"]) == ([], [])
    assert client.get(f"/api/notes/{b['id']}/links").status_code == 404
