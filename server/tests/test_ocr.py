import io
import os
from datetime import timedelta

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pypdf import PdfWriter
from sqlmodel import Session

from app import db as app_db
from app.config import Settings
from app.dependencies import get_ocr
from app.main import app
from app.models.common import utcnow
from app.models.ocr import OcrPage, ProposedCorrection
from app.models.session import NoteSession
from app.services import ocr as ocr_module
from app.services.ocr import OcrService
from app.services.ocr_review_agent import (
    apply_correction,
    chunk_pages,
    get_ocr_review_agent,
    normalize_corrections,
    review_ocr_pages,
)


def make_pdf(pages: int) -> bytes:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def review_llm(corrections: list[dict], captured: dict | None = None) -> FunctionModel:
    def fn(messages, info: AgentInfo) -> ModelResponse:
        if captured is not None:
            captured["prompt"] = "\n".join(str(getattr(p, "content", "")) for m in messages for p in m.parts)
            captured["instructions"] = "\n".join(m.instructions or "" for m in messages if hasattr(m, "instructions"))
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {"corrections": corrections})])

    return FunctionModel(fn)


def failing_llm() -> FunctionModel:
    def fn(messages, info):
        raise RuntimeError("quota exceeded")

    return FunctionModel(fn)


def db_session(session_id: str) -> NoteSession:
    with Session(app_db.engine) as db:
        return db.get(NoteSession, session_id)


PROPOSED = [
    {"page": 1, "original": "meetting", "corrected": "meeting", "context": "nhờ Lan viết meetting note"},
    {"page": 2, "original": "Kubernetis", "corrected": "Kubernetes", "context": "Cài Kubernetis"},
    {"page": 2, "original": "meetting", "corrected": "meeting"},
    # Các đề xuất không hợp lệ phải bị lọc bỏ:
    {"page": 1, "original": "Chốt", "corrected": "Chot"},  # "sửa" tiếng Việt
    {"page": 1, "original": "không có", "corrected": "khong co"},  # không xuất hiện trong trang
    {"page": 9, "original": "deadline", "corrected": "Deadline"},  # sai trang
    {"page": 1, "original": "meetting", "corrected": "meeting"},  # trùng lặp
]


def test_ocr_validation(client, mistral, monkeypatch):
    assert client.post("/api/ocr-extract", files={"file": ("a.txt", b"x")}).status_code == 415
    assert client.post("/api/ocr-extract", files={"file": ("a.png", b"")}).status_code == 422
    res = client.post("/api/ocr-extract", files={"file": ("hong.pdf", b"not a pdf")})
    assert res.status_code == 422 and "PDF" in res.json()["detail"]

    monkeypatch.setattr(ocr_module, "MAX_OCR_PAGES", 2)
    res = client.post("/api/ocr-extract", files={"file": ("dai.pdf", make_pdf(3), "application/pdf")})
    assert res.status_code == 422 and "3 trang" in res.json()["detail"]

    monkeypatch.setattr(ocr_module, "MAX_OCR_FILE_MB", 0)
    assert client.post("/api/ocr-extract", files={"file": ("a.png", b"\x89PNG")}).status_code == 413

    assert mistral.calls == []
    assert client.get("/api/sessions").json()["total"] == 0


def test_ocr_not_configured(client):
    app.dependency_overrides[get_ocr] = lambda: OcrService(Settings(mistral_api_key="", database_url="postgresql://x/y"))
    res = client.post("/api/ocr-extract", files={"file": ("a.png", b"\x89PNG", "image/png")})
    assert res.status_code == 503
    assert client.get("/api/sessions").json()["total"] == 0


def test_ocr_extract_review_and_decide_corrections(client, mistral):
    captured: dict = {}
    with get_ocr_review_agent().override(model=review_llm(PROPOSED, captured)):
        res = client.post("/api/ocr-extract", files={"file": ("biên bản.pdf", make_pdf(2), "application/pdf")})
    assert res.status_code == 202, res.text
    assert res.json()["pages"] == 2
    sid = res.json()["session_id"]

    # Background task đã chạy xong trong TestClient
    assert client.get(f"/api/ocr-extract/{sid}/status").json() == {"session_id": sid, "status": "completed", "error_message": None}
    assert mistral.calls == ["POST /v1/files", "GET /v1/files/mf-1/url", "POST /v1/ocr", "DELETE /v1/files/mf-1"]
    assert mistral.last_ocr_body["document"] == {
        "type": "document_url",
        "document_url": "https://files.mistral.example/signed/mf-1",
        "document_name": "biên bản.pdf",
    }
    assert mistral.last_ocr_body["model"] == "mistral-ocr-latest" and mistral.last_ocr_body["include_image_base64"] is False
    assert "=== Trang 2 ===" in captured["prompt"] and "KHÔNG sửa" in captured["instructions"]

    detail = client.get(f"/api/sessions/{sid}").json()
    assert detail["source"] == "ocr" and detail["title"] == "biên bản" and detail["status"] == "completed"
    # Nội dung chốt ban đầu = bản OCR gốc (bỏ tham chiếu ảnh), chưa áp dụng đề xuất nào
    assert [s["page"] for s in detail["segments"]] == [1, 2]
    assert "![img-0.jpeg]" not in detail["segments"][0]["text"] and "meetting note" in detail["segments"][0]["text"]
    assert all(s.get("speaker") is None and s.get("start_ms") is None for s in detail["segments"])
    ocr = detail["ocr"]
    assert ocr["pages_processed"] == 2 and ocr["review_error"] is None
    assert [(c["id"], c["page"], c["original"], c["corrected"], c["status"]) for c in ocr["corrections"]] == [
        ("c1", 1, "meetting", "meeting", "pending"),
        ("c2", 2, "Kubernetis", "Kubernetes", "pending"),
        ("c3", 2, "meetting", "meeting", "pending"),
    ]
    assert "raw_pages" not in ocr  # bản gốc/bản rà soát chỉ lưu trong DB

    stored = db_session(sid).ocr_data()
    assert "Kubernetis" in stored.raw_pages[1].markdown  # bản gốc không bị ghi đè
    assert "Kubernetes" in stored.reviewed_pages[1].markdown and "meeting note" in stored.reviewed_pages[1].markdown

    listed = client.get("/api/sessions", params={"source": "ocr"}).json()
    assert listed["total"] == 1 and "#" not in listed["items"][0]["preview"]
    assert client.get("/api/sessions", params={"source": "live"}).json()["total"] == 0
    assert client.get("/api/sessions", params={"q": "kubernetis"}).json()["total"] == 1

    # Đã có tóm tắt -> chấp nhận sửa phải đánh dấu tóm tắt lỗi thời
    with Session(app_db.engine) as db:
        row = db.get(NoteSession, sid)
        row.summary = {"summary": "Tóm tắt", "key_points": [], "action_items": [], "decisions": []}
        db.add(row)
        db.commit()

    url = f"/api/sessions/{sid}/ocr-corrections"
    res = client.post(url, json={"accept": ["c1"], "reject": ["c2"]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert [c["status"] for c in body["ocr"]["corrections"]] == ["accepted", "rejected", "pending"]
    assert "meeting note" in body["segments"][0]["text"]
    assert "meetting note" in body["segments"][1]["text"] and "Kubernetis" in body["segments"][1]["text"]
    assert body["summary_outdated"] is True

    assert client.post(url, json={"accept": ["c9"]}).status_code == 422
    assert client.post(url, json={"accept": ["c3"], "reject": ["c3"]}).status_code == 422

    # "Chấp nhận tất cả" gửi mọi id; đề xuất đã quyết định giữ nguyên
    body = client.post(url, json={"accept": ["c1", "c2", "c3"]}).json()
    assert [c["status"] for c in body["ocr"]["corrections"]] == ["accepted", "rejected", "accepted"]
    assert "Kubernetis" in body["segments"][1]["text"] and "meeting note" in body["segments"][1]["text"]

    # Export dùng nội dung đã chốt
    txt = client.get(f"/api/sessions/{sid}/export", params={"format": "txt"}).content.decode("utf-8-sig")
    assert "Nguồn: Tài liệu quét (OCR)" in txt and "Số trang: 2" in txt
    assert "--- Trang 2 ---" in txt and "Gửi meeting note" in txt and "meetting" not in txt
    docx = client.get(f"/api/sessions/{sid}/export", params={"format": "docx"})
    assert docx.status_code == 200 and len(docx.content) > 1000


def test_accept_unavailable_after_manual_edit(client, mistral):
    with get_ocr_review_agent().override(model=review_llm(PROPOSED[:2])):
        sid = client.post("/api/ocr-extract", files={"file": ("a.png", b"\x89PNG", "image/png")}).json()["session_id"]
    assert mistral.last_ocr_body["document"] == {"type": "image_url", "image_url": "https://files.mistral.example/signed/mf-1"}

    detail = client.get(f"/api/sessions/{sid}").json()
    edited = [{**detail["segments"][0], "text": "Đã viết lại toàn bộ trang một"}, detail["segments"][1]]
    assert client.put(f"/api/sessions/{sid}/segments", json={"segments": edited}).status_code == 200
    body = client.post(f"/api/sessions/{sid}/ocr-corrections", json={"accept": ["c1", "c2"]}).json()
    assert [c["status"] for c in body["ocr"]["corrections"]] == ["unavailable", "accepted"]
    assert body["segments"][1]["page"] == 2 and "Kubernetes" in body["segments"][1]["text"]


def test_review_failure_keeps_ocr_result(client, mistral):
    with get_ocr_review_agent().override(model=failing_llm()):
        sid = client.post("/api/ocr-extract", files={"file": ("a.jpg", b"\xff\xd8", "image/jpeg")}).json()["session_id"]
    detail = client.get(f"/api/sessions/{sid}").json()
    assert detail["status"] == "completed" and len(detail["segments"]) == 2
    assert detail["ocr"]["corrections"] == [] and "Chưa rà soát" in detail["ocr"]["review_error"]


def test_ocr_api_failure_marks_failed(client, mistral):
    mistral.fail_ocr = True
    sid = client.post("/api/ocr-extract", files={"file": ("a.png", b"\x89PNG", "image/png")}).json()["session_id"]
    status = client.get(f"/api/ocr-extract/{sid}/status").json()
    assert status["status"] == "failed" and "Mistral OCR" in status["error_message"]
    assert "DELETE /v1/files/mf-1" in mistral.calls  # vẫn dọn file trên Mistral


def test_ocr_without_text_marks_failed(client, mistral):
    mistral.pages = ["", "![img-0.jpeg](img-0.jpeg)"]
    sid = client.post("/api/ocr-extract", files={"file": ("a.png", b"\x89PNG", "image/png")}).json()["session_id"]
    assert client.get(f"/api/ocr-extract/{sid}/status").json()["error_message"] == "Không nhận dạng được chữ nào trong tài liệu."


def test_orphaned_processing_session_expires(client):
    with Session(app_db.engine) as db:
        stale = NoteSession(title="Cũ", source="ocr", status="processing", updated_at=utcnow() - timedelta(minutes=30))
        fresh = NoteSession(title="Mới", source="ocr", status="processing")
        db.add(stale)
        db.add(fresh)
        db.commit()
        stale_id, fresh_id = stale.id, fresh.id
    assert client.get(f"/api/ocr-extract/{stale_id}/status").json()["status"] == "failed"
    assert client.get(f"/api/ocr-extract/{fresh_id}/status").json()["status"] == "processing"


def test_corrections_endpoint_rejects_non_ocr_session(client, make_session):
    sid = make_session()["id"]
    assert client.post(f"/api/sessions/{sid}/ocr-corrections", json={"accept": []}).status_code == 422


def test_apply_correction_matches_whole_words_only():
    assert apply_correction("API mới, APIs cũ, rapid API.", "API", "Api") == ("Api mới, APIs cũ, rapid Api.", 2)
    assert apply_correction("không có gì", "API", "Api") == ("không có gì", 0)
    assert apply_correction("dùng C++ và C", "C++", "C#")[1] == 1


def test_normalize_corrections_guards():
    pages = [OcrPage(page=1, markdown="Chốt deadlin cho team là thứ Sáu")]
    proposed = [
        ProposedCorrection(page=1, original="deadlin", corrected="deadline"),
        ProposedCorrection(page=1, original="Chốt", corrected="Chot"),
        ProposedCorrection(page=1, original="là", corrected="la"),
        ProposedCorrection(page=1, original="team", corrected="nhóm"),  # corrected không phải chữ Latin cơ bản
        ProposedCorrection(page=1, original="team", corrected="team"),
    ]
    assert [(c.original, c.corrected) for c in normalize_corrections(pages, proposed)] == [("deadlin", "deadline")]


def test_chunk_pages_by_budget():
    pages = [OcrPage(page=i + 1, markdown="x" * 30) for i in range(5)]
    assert [[p.page for p in c] for c in chunk_pages(pages, budget=70)] == [[1, 2], [3, 4], [5]]


@pytest.mark.skipif(os.environ.get("RUN_LLM_TESTS") != "1", reason="Gọi LLM thật (tốn phí) — bật bằng RUN_LLM_TESTS=1")
def test_live_ocr_review_with_configured_model():
    import asyncio

    pages = [
        OcrPage(
            page=1,
            markdown="Họp team sáng thứ Hai: anh Minh báo cáo tiến độ deploy lên Kubernetis, "
            "em Lan gửi meetting note trước deadlline thứ Sáu. Chị Hoa sẽ review pull reqest.",
        )
    ]
    result = asyncio.run(review_ocr_pages(pages))
    fixes = {(c.original, c.corrected) for c in result.corrections}
    assert result.error is None
    assert ("Kubernetis", "Kubernetes") in fixes and ("meetting", "meeting") in fixes
    assert "Họp team sáng thứ Hai" in result.corrected_text and "Chị Hoa sẽ review" in result.corrected_text


def test_summarize_ocr_session_uses_document_prompt(client, mistral):
    from app.services.summary_agent import get_summary_agent

    with get_ocr_review_agent().override(model=review_llm([])):
        sid = client.post("/api/ocr-extract", files={"file": ("a.pdf", make_pdf(2), "application/pdf")}).json()["session_id"]

    captured = {}

    def fake_llm(messages, info: AgentInfo) -> ModelResponse:
        captured["prompt"] = "\n".join(str(getattr(p, "content", "")) for m in messages for p in m.parts)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {"summary": "Biên bản họp demo."})])

    with get_summary_agent().override(model=FunctionModel(fake_llm)):
        res = client.post(f"/api/sessions/{sid}/summarize")
    assert res.status_code == 200, res.text
    assert "trích xuất bằng OCR" in captured["prompt"] and "Nội dung tài liệu:" in captured["prompt"]
    assert "--- Trang 1 ---" in captured["prompt"] and "--- Trang 2 ---" in captured["prompt"]


def test_ocr_multiple_files_combined_into_one_session(client, mistral, monkeypatch):
    import tempfile

    created_dirs: list[str] = []
    real_mkdtemp = tempfile.mkdtemp
    monkeypatch.setattr(tempfile, "mkdtemp", lambda **kw: created_dirs.append(real_mkdtemp(**kw)) or created_dirs[-1])

    mistral.pages_by_filename = {
        "trang-1.jpg": ["Trang một: họp về meetting tuần sau"],
        "phu-luc.pdf": ["Phụ lục A", "Phụ lục B có Kubernetis"],
        "trang-3.png": ["Trang cuối"],
    }
    proposed = [{"page": 3, "original": "Kubernetis", "corrected": "Kubernetes"}]
    with get_ocr_review_agent().override(model=review_llm(proposed)):
        res = client.post(
            "/api/ocr-extract",
            files=[
                ("files", ("trang-1.jpg", b"\xff\xd8", "image/jpeg")),
                ("files", ("phu-luc.pdf", make_pdf(2), "application/pdf")),
                ("files", ("trang-3.png", b"\x89PNG", "image/png")),
            ],
        )
    assert res.status_code == 202, res.text
    body = res.json()
    assert body["files"] == 3 and body["pages"] == 4
    sid = body["session_id"]

    detail = client.get(f"/api/sessions/{sid}").json()
    assert detail["status"] == "completed" and detail["title"] == "trang-1 (+2 file)"
    assert detail["original_filename"] == "trang-1.jpg, phu-luc.pdf, trang-3.png"
    # Nối đúng thứ tự gửi, trang đánh số liên tục qua các file
    assert [(s["page"], s["text"]) for s in detail["segments"]] == [
        (1, "Trang một: họp về meetting tuần sau"),
        (2, "Phụ lục A"),
        (3, "Phụ lục B có Kubernetis"),
        (4, "Trang cuối"),
    ]
    assert detail["ocr"]["pages_processed"] == 4
    assert detail["ocr"]["files"] == [
        {"filename": "trang-1.jpg", "first_page": 1, "page_count": 1, "error": None},
        {"filename": "phu-luc.pdf", "first_page": 2, "page_count": 2, "error": None},
        {"filename": "trang-3.png", "first_page": 4, "page_count": 1, "error": None},
    ]
    assert [(c["page"], c["original"]) for c in detail["ocr"]["corrections"]] == [(3, "Kubernetis")]
    assert sorted(mistral.uploaded_filenames) == ["phu-luc.pdf", "trang-1.jpg", "trang-3.png"]
    assert sum(c.startswith("DELETE /v1/files/") for c in mistral.calls) == 3  # dọn mọi file trên Mistral
    assert created_dirs and not any(os.path.exists(d) for d in created_dirs)  # xoá thư mục tạm

    txt = client.get(f"/api/sessions/{sid}/export", params={"format": "txt"}).content.decode("utf-8-sig")
    assert txt.index("--- Trang 1 ---") < txt.index("Phụ lục A") < txt.index("--- Trang 4 ---")


def test_ocr_partial_file_failure_keeps_other_files(client, mistral):
    mistral.pages_by_filename = {"a.jpg": ["Nội dung A"], "c.jpg": ["Nội dung C"]}
    mistral.fail_files = {"b.jpg"}
    with get_ocr_review_agent().override(model=review_llm([])):
        sid = client.post(
            "/api/ocr-extract",
            files=[("files", (name, b"\xff\xd8", "image/jpeg")) for name in ("a.jpg", "b.jpg", "c.jpg")],
        ).json()["session_id"]
    detail = client.get(f"/api/sessions/{sid}").json()
    assert detail["status"] == "completed"
    assert [(s["page"], s["text"]) for s in detail["segments"]] == [(1, "Nội dung A"), (2, "Nội dung C")]
    files = detail["ocr"]["files"]
    assert [f["filename"] for f in files] == ["a.jpg", "b.jpg", "c.jpg"]
    assert files[1]["error"] and files[1]["first_page"] is None and files[2]["first_page"] == 2

    mistral.fail_files = {"a.jpg", "c.jpg"}
    sid = client.post(
        "/api/ocr-extract", files=[("files", (name, b"\xff\xd8", "image/jpeg")) for name in ("a.jpg", "c.jpg")]
    ).json()["session_id"]
    status = client.get(f"/api/ocr-extract/{sid}/status").json()
    assert status["status"] == "failed" and "không xử lý được file nào" in status["error_message"]


def test_ocr_multiple_files_validation(client, mistral, monkeypatch):
    monkeypatch.setattr(ocr_module, "MAX_OCR_FILES", 2)
    three = [("files", (f"{i}.png", b"\x89PNG", "image/png")) for i in range(3)]
    res = client.post("/api/ocr-extract", files=three)
    assert res.status_code == 422 and "tối đa 2 file" in res.json()["detail"]
    monkeypatch.setattr(ocr_module, "MAX_OCR_FILES", 20)

    res = client.post("/api/ocr-extract", files=[("files", ("ok.png", b"\x89PNG")), ("files", ("sai.txt", b"x"))])
    assert res.status_code == 415 and "“sai.txt”" in res.json()["detail"]

    monkeypatch.setattr(ocr_module, "MAX_OCR_PAGES", 3)
    res = client.post(
        "/api/ocr-extract",
        files=[("files", ("a.pdf", make_pdf(2), "application/pdf")), ("files", ("b.pdf", make_pdf(2), "application/pdf"))],
    )
    assert res.status_code == 422 and "Tổng số trang" in res.json()["detail"]

    assert client.post("/api/ocr-extract", data={"title": "x"}).status_code == 422
    assert mistral.calls == [] and client.get("/api/sessions").json()["total"] == 0
