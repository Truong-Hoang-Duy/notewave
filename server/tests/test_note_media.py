"""Ghi chú — GĐ2: ảnh (Supabase Storage giả lập), nhận diện công thức vẽ tay (Mistral giả lập), chuẩn hoá LaTeX,
bảo vệ công thức khỏi rà soát chính tả OCR."""

from datetime import timedelta

import httpx

from app.config import Settings, get_settings
from app.dependencies import get_ocr, get_storage
from app.main import app
from app.models.ocr import OcrPage, ProposedCorrection
from app.services.ocr import OcrService, normalize_formula
from app.services.ocr_review_agent import apply_correction, normalize_corrections
from app.services.storage import SupabaseStorage

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 200
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 200
WEBP = b"RIFF\x10\x00\x00\x00WEBPVP8 " + b"\x00" * 200


def _note(client, title="Ảnh"):
    return client.post("/api/notes", json={"title": title}).json()


def _upload(client, note_id, content=PNG, name="hinh.png"):
    return client.post(f"/api/notes/{note_id}/images", files={"file": (name, content, "application/octet-stream")})


# ---- Ảnh ----


def test_upload_image_creates_private_bucket_once(client, storage):
    note = _note(client)
    res = _upload(client, note["id"])
    assert res.status_code == 201, res.text
    img = res.json()
    assert img["url"] == f"/api/note-images/{img['id']}"
    assert img["content_type"] == "image/png" and img["filename"] == "hinh.png" and img["size_bytes"] == len(PNG)
    assert storage.objects == {f"note-assets/notes/{note['id']}/{img['id']}.png": PNG}
    assert storage.calls.count("POST /storage/v1/bucket") == 1
    # Lần 2: bucket đã có, không tạo lại; định dạng nhận theo magic bytes (tên .png nhưng là JPEG)
    img2 = _upload(client, note["id"], JPEG, "anh.png").json()
    assert img2["content_type"] == "image/jpeg"
    assert f"note-assets/notes/{note['id']}/{img2['id']}.jpg" in storage.objects
    assert storage.calls.count("POST /storage/v1/bucket") == 1
    assert _upload(client, note["id"], WEBP, "x.webp").json()["content_type"] == "image/webp"


def test_upload_image_validation(client, storage):
    note = _note(client)
    assert _upload(client, "nope").status_code == 404
    assert _upload(client, note["id"], b"not an image at all", "gia.png").status_code == 415
    assert _upload(client, note["id"], b"", "rong.png").status_code == 422
    small = get_settings().model_copy(update={"note_image_max_mb": 1})
    app.dependency_overrides[get_settings] = lambda: small
    assert _upload(client, note["id"], PNG + b"\x00" * (1024 * 1024)).status_code == 413
    assert storage.objects == {}


def test_upload_image_storage_errors(client, storage):
    note = _note(client)
    storage.fail_upload = True
    storage.buckets.add("note-assets")
    assert _upload(client, note["id"]).status_code == 502
    assert client.get(f"/api/notes/{note['id']}").status_code == 200  # note không bị ảnh hưởng
    unconfigured = Settings(database_url="postgresql://x@y/z", supabase_url="", supabase_secret_key="")
    app.dependency_overrides[get_storage] = lambda: SupabaseStorage(httpx.AsyncClient(), unconfigured)
    res = _upload(client, note["id"])
    assert res.status_code == 503 and "SUPABASE_SECRET_KEY" in res.json()["detail"]


def test_note_image_redirects_to_signed_url(client, storage):
    note = _note(client)
    img = _upload(client, note["id"]).json()
    res = client.get(img["url"], follow_redirects=False)
    assert res.status_code == 307
    location = res.headers["location"]
    assert location.startswith(f"https://storage.example.supabase.co/storage/v1/object/sign/note-assets/notes/{note['id']}/")
    assert "token=" in location
    assert "max-age=3000" in res.headers["cache-control"]
    assert client.get("/api/note-images/khong-co", follow_redirects=False).status_code == 404


def test_delete_note_removes_images(client, storage):
    note, other = _note(client), _note(client, "Khác")
    _upload(client, note["id"])
    _upload(client, note["id"], JPEG)
    keep = _upload(client, other["id"]).json()
    assert len(storage.objects) == 3
    assert client.delete(f"/api/notes/{note['id']}").status_code == 204
    assert list(storage.objects) == [f"note-assets/notes/{other['id']}/{keep['id']}.png"]
    assert client.get(keep["url"], follow_redirects=False).status_code == 307
    # Storage lỗi khi xoá -> vẫn xoá được note; dòng ảnh được giữ + đánh dấu để lần dọn sau xoá lại file
    storage.fail_delete = True
    assert client.delete(f"/api/notes/{other['id']}").status_code == 204
    assert len(storage.objects) == 1
    storage.fail_delete = False
    _patch_content(client, _note(client, "Kích hoạt dọn")["id"], "Không có ảnh")
    assert storage.objects == {}
    assert client.get(keep["url"], follow_redirects=False).status_code == 404


def _patch_content(client, note_id, markdown):
    res = client.patch(f"/api/notes/{note_id}", json={"content_json": {"type": "doc"}, "content_md": markdown})
    assert res.status_code == 200, res.text
    return res.json()


def _orphaned(asset_id):
    from sqlmodel import Session

    from app.db import engine
    from app.models.note import NoteAsset

    with Session(engine) as db:
        asset = db.get(NoteAsset, asset_id)
        return None if asset is None else asset.orphaned_at


def test_removed_image_deleted_after_grace(client, storage, monkeypatch):
    note = _note(client)
    img = _upload(client, note["id"]).json()
    assert _orphaned(img["id"]) is not None  # vừa tải lên, chưa nằm trong nội dung
    _patch_content(client, note["id"], f"Hình vẽ\n\n![hinh]({img['url']})")
    assert _orphaned(img["id"]) is None  # đã chèn vào nội dung
    # Người dùng xoá ảnh khỏi nội dung -> chỉ đánh dấu, CHƯA xoá (còn Hoàn tác được)
    _patch_content(client, note["id"], "Hình vẽ")
    assert _orphaned(img["id"]) is not None and len(storage.objects) == 1
    # Hoàn tác trong thời gian chờ -> ảnh xuất hiện lại, bỏ đánh dấu
    _patch_content(client, note["id"], f"Hình vẽ\n\n![hinh]({img['url']})")
    assert _orphaned(img["id"]) is None
    # Xoá lần nữa và hết thời gian chờ -> lần lưu kế tiếp xoá thật khỏi Storage
    _patch_content(client, note["id"], "Hình vẽ")
    monkeypatch.setattr("app.services.note_media.ORPHAN_GRACE", timedelta(0))
    _patch_content(client, note["id"], "Hình vẽ đã sửa")
    assert storage.objects == {}
    assert client.get(img["url"], follow_redirects=False).status_code == 404
    # Lưu không đụng nội dung (vd. đổi tiêu đề) không chạy dọn ảnh
    calls = len(storage.calls)
    client.patch(f"/api/notes/{note['id']}", json={"title": "Tên mới"})
    assert len(storage.calls) == calls


def test_uploaded_but_never_inserted_image_is_purged(client, storage, monkeypatch):
    note = _note(client)
    img = _upload(client, note["id"]).json()  # tải lên nhưng không bao giờ chèn (đóng tab giữa chừng)
    monkeypatch.setattr("app.services.note_media.ORPHAN_GRACE", timedelta(0))
    _patch_content(client, _note(client, "Khác")["id"], "gì đó")  # lưu nội dung ở note bất kỳ -> dọn
    assert storage.objects == {}
    assert client.get(img["url"], follow_redirects=False).status_code == 404


def test_purge_keeps_rows_when_storage_unconfigured(client, storage, monkeypatch):
    note = _note(client)
    img = _upload(client, note["id"]).json()
    monkeypatch.setattr("app.services.note_media.ORPHAN_GRACE", timedelta(0))
    unconfigured = Settings(database_url="postgresql://x@y/z", supabase_url="", supabase_secret_key="")
    app.dependency_overrides[get_storage] = lambda: SupabaseStorage(httpx.AsyncClient(), unconfigured)
    _patch_content(client, note["id"], "Không có ảnh")  # đến hạn dọn nhưng Storage chưa cấu hình
    assert _orphaned(img["id"]) is not None  # dòng vẫn còn -> không mất dấu file trên Storage
    assert len(storage.objects) == 1
    app.dependency_overrides.pop(get_storage)  # cấu hình lại (fixture storage)
    app.dependency_overrides[get_storage] = lambda: SupabaseStorage(httpx.AsyncClient(transport=httpx.MockTransport(storage.handler)), get_settings())
    _patch_content(client, note["id"], "Lưu tiếp")
    assert storage.objects == {} and _orphaned(img["id"]) is None


def test_image_shared_with_other_note_is_kept(client, storage, monkeypatch):
    a, b = _note(client, "A"), _note(client, "B")
    img = _upload(client, a["id"]).json()
    _patch_content(client, a["id"], f"![x]({img['url']})")
    _patch_content(client, b["id"], f"Dán từ A: ![x]({img['url']})")  # copy ảnh sang note B
    monkeypatch.setattr("app.services.note_media.ORPHAN_GRACE", timedelta(0))
    _patch_content(client, a["id"], "A xoá ảnh")
    _patch_content(client, a["id"], "A lưu tiếp")
    assert len(storage.objects) == 1  # B vẫn dùng -> không xoá, chuyển sang B
    assert client.get(img["url"], follow_redirects=False).status_code == 307
    # Xoá note B (đang sở hữu ảnh) mà note C cũng dùng -> vẫn giữ
    c = _note(client, "C")
    _patch_content(client, c["id"], f"![x]({img['url']})")
    assert client.delete(f"/api/notes/{b['id']}").status_code == 204
    assert len(storage.objects) == 1
    # C xoá ảnh -> không còn ai dùng -> xoá thật
    _patch_content(client, c["id"], "C xoá ảnh")
    _patch_content(client, c["id"], "C lưu tiếp")
    assert storage.objects == {}


def test_health_reports_note_images(client):
    assert client.get("/api/health").json()["note_images_configured"] is True


def test_storage_url_derived_from_database_url():
    s = Settings(database_url="postgresql://postgres.abcd1234:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres", supabase_url="")
    assert s.supabase_storage_url == "https://abcd1234.supabase.co"
    assert Settings(database_url="postgresql://x@y/z", supabase_url="https://custom.example/").supabase_storage_url == "https://custom.example"


# ---- Công thức vẽ tay -> LaTeX ----


def test_formula_ocr_sends_data_uri(client, mistral):
    mistral.pages = ["$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$"]
    res = client.post("/api/notes/formula-ocr", files={"image": ("f.png", PNG, "image/png")})
    assert res.status_code == 200, res.text
    assert res.json() == {"latex": "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}", "raw_markdown": mistral.pages[0], "multiple": False}
    assert mistral.last_ocr_body["document"]["image_url"].startswith("data:image/png;base64,")
    assert not any(c.startswith("POST /v1/files") for c in mistral.calls)  # không đi qua Files API


def test_formula_ocr_multiple_and_errors(client, mistral):
    mistral.pages = ["\\[\n\\frac{a+b}{c+d}=e\n\\]\n\n\\[\n\\frac{1}{2}mv^2\n\\]"]
    body = client.post("/api/notes/formula-ocr", files={"image": ("f.png", PNG, "image/png")}).json()
    assert body["multiple"] is True and body["latex"].startswith("\\begin{gathered}")
    mistral.pages = [""]
    assert client.post("/api/notes/formula-ocr", files={"image": ("f.png", PNG, "image/png")}).status_code == 422
    assert client.post("/api/notes/formula-ocr", files={"image": ("f.gif", b"GIF89a" + b"0" * 50, "image/gif")}).status_code == 415
    mistral.fail_ocr = True
    mistral.pages = ["$$x$$"]
    assert client.post("/api/notes/formula-ocr", files={"image": ("f.png", PNG, "image/png")}).status_code == 502
    no_key = Settings(database_url="postgresql://x@y/z", mistral_api_key="")
    app.dependency_overrides[get_ocr] = lambda: OcrService(no_key)
    assert client.post("/api/notes/formula-ocr", files={"image": ("f.png", PNG, "image/png")}).status_code == 503


def test_normalize_formula_real_outputs():
    # Kết quả Mistral thật ở Thử nghiệm 1 (2026-09-18)
    assert normalize_formula("$$x^2 + 2x + 1 = 0$$") == ("x^2 + 2x + 1 = 0", False)
    assert normalize_formula("$$\\lim_{x \\rightarrow 0} \\frac{\\sin x}{x} = 1$$")[0] == "\\lim_{x \\rightarrow 0} \\frac{\\sin x}{x} = 1"
    system = "\\[ \\left\\{{\\begin{matrix}2x+3y=7\\\\x-y=1\\end{matrix}}\\right. \\]"
    assert normalize_formula(system) == ("\\left\\{{\\begin{matrix}2x+3y=7\\\\x-y=1\\end{matrix}}\\right.", False)
    assert normalize_formula("\\(a+b\\)") == ("a+b", False)
    assert normalize_formula("E = mc^2") == ("E = mc^2", False)  # không có dấu bọc -> cả đoạn
    assert normalize_formula("Giá $5 và $x^2$") == ("x^2", False)  # "$5" là tiền, không phải công thức
    assert normalize_formula("") == ("", False)


# ---- Rà soát chính tả OCR không đụng vào công thức ----


def test_ocr_review_skips_math():
    text = "The derivativ of $\\sin x$ is shown: $$\\lim_{h \\to 0} derivativ$$ and \\(derivativ\\)."
    new, count = apply_correction(text, "derivativ", "derivative")
    assert count == 1
    assert new.startswith("The derivative of") and "\\lim_{h \\to 0} derivativ$$" in new and "\\(derivativ\\)" in new
    pages = [OcrPage(page=1, markdown="Công thức $\\sinn x$ và lim")]
    proposed = [ProposedCorrection(page=1, original="sinn", corrected="sin"), ProposedCorrection(page=1, original="lim", corrected="limit")]
    assert [c.original for c in normalize_corrections(pages, proposed)] == ["lim"]
