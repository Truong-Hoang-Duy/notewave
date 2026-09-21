"""Ghi chú — GĐ3: tóm tắt AI (`note_summary_agent`) và soát lỗi chính tả (`note_proofread_agent`).

LLM luôn được thay bằng `FunctionModel` — test không gọi API thật.
"""

import asyncio

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app.models.note import ProofreadSuggestion
from app.services.note_proofread_agent import (
    chunk_markdown,
    get_note_proofread_agent,
    normalize_suggestions,
    proofread_note,
)
from app.services.note_summary_agent import build_prompt, get_note_summary_agent

SUMMARY_OUTPUT = {
    "summary": "Bài học về đạo hàm và ý nghĩa hình học.",
    "key_points": ["Đạo hàm là giới hạn của tỉ số gia tăng"],
    "concepts": [{"term": "Đạo hàm", "meaning": "Tốc độ thay đổi tức thời"}],
    "review_questions": ["Vì sao đạo hàm là hệ số góc tiếp tuyến?"],
}


def llm(output: dict, captured: dict | None = None) -> FunctionModel:
    def fn(messages, info: AgentInfo) -> ModelResponse:
        if captured is not None:
            captured["prompt"] = "\n".join(str(getattr(p, "content", "")) for m in messages for p in m.parts)
            captured["instructions"] = "\n".join(m.instructions or "" for m in messages if hasattr(m, "instructions"))
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, output)])

    return FunctionModel(fn)


def failing_llm() -> FunctionModel:
    def fn(messages, info):
        raise RuntimeError("quota exceeded")

    return FunctionModel(fn)


def note(client, title="Ghi chú", content=""):
    created = client.post("/api/notes", json={"title": title}).json()
    if content:
        assert client.patch(f"/api/notes/{created['id']}", json={"content_md": content}).status_code == 200
    return created


# ---- Tóm tắt AI ----


def test_ai_summary_endpoint_runs_agent_and_saves(client):
    captured = {}
    n = note(client, "Đạo hàm", "# Đạo hàm\n\nĐạo hàm là giới hạn của tỉ số gia tăng.")
    client.patch(f"/api/notes/{n['id']}", json={"cues": [{"id": "c1", "text": "Đạo hàm là gì?", "anchor": None}]})

    with get_note_summary_agent().override(model=llm(SUMMARY_OUTPUT, captured)):
        res = client.post(f"/api/notes/{n['id']}/ai-summary")

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["key_points"] == SUMMARY_OUTPUT["key_points"]
    assert body["concepts"][0]["term"] == "Đạo hàm"
    assert body["review_questions"] == SUMMARY_OUTPUT["review_questions"]
    assert body["model"] and body["generated_at"] and body["source_hash"]
    # Prompt kèm tiêu đề, câu hỏi ở cột trái và nội dung Markdown
    assert "Tiêu đề ghi chú: Đạo hàm" in captured["prompt"]
    assert "Đạo hàm là gì?" in captured["prompt"] and "tỉ số gia tăng" in captured["prompt"]
    assert "câu hỏi ôn tập" in captured["instructions"].lower()

    # Lưu vào cột riêng, không đụng tóm tắt người học tự viết
    saved = client.get(f"/api/notes/{n['id']}").json()
    assert saved["ai_summary"]["summary"] == SUMMARY_OUTPUT["summary"]
    assert saved["summary"] == "" and saved["ai_summary_outdated"] is False


def test_ai_summary_marked_outdated_after_content_change(client):
    n = note(client, "Bài 1", "Nội dung ban đầu.")
    with get_note_summary_agent().override(model=llm(SUMMARY_OUTPUT)):
        client.post(f"/api/notes/{n['id']}/ai-summary")

    # Lưu lại đúng nội dung cũ -> vẫn còn hạn
    client.patch(f"/api/notes/{n['id']}", json={"content_md": "Nội dung ban đầu."})
    assert client.get(f"/api/notes/{n['id']}").json()["ai_summary_outdated"] is False

    updated = client.patch(f"/api/notes/{n['id']}", json={"content_md": "Nội dung đã viết thêm."}).json()
    assert updated["ai_summary_outdated"] is True
    assert updated["ai_summary"]["summary"] == SUMMARY_OUTPUT["summary"]  # vẫn giữ bản cũ để đọc


def test_ai_summary_errors(client):
    empty = note(client, "Trống")
    assert client.post(f"/api/notes/{empty['id']}/ai-summary").status_code == 422
    assert client.post("/api/notes/khongcoid/ai-summary").status_code == 404

    n = note(client, "Có nội dung", "Vài dòng ghi chú.")
    with get_note_summary_agent().override(model=failing_llm()):
        res = client.post(f"/api/notes/{n['id']}/ai-summary")
    assert res.status_code == 502 and "SUMMARY_MODEL" in res.json()["detail"]
    assert client.get(f"/api/notes/{n['id']}").json()["ai_summary"] is None


def test_ai_summary_does_not_bump_updated_at(client):
    n = note(client, "Không đẩy lên đầu", "Nội dung.")
    before = client.get(f"/api/notes/{n['id']}").json()["updated_at"]
    with get_note_summary_agent().override(model=llm(SUMMARY_OUTPUT)):
        client.post(f"/api/notes/{n['id']}/ai-summary")
    assert client.get(f"/api/notes/{n['id']}").json()["updated_at"] == before


def test_build_prompt_truncates_very_long_note():
    prompt = build_prompt("Dài", "x" * 200_000)
    assert len(prompt) < 130_000 and "phần sau không gửi kèm" in prompt


# ---- Soát lỗi chính tả ----

CONTENT = """\
# Bài hoc về đạo hàm

Đạo ham là giới hạn của tỉ số gia tăng. Ghi nhớ: `hoc` trong code không được sửa.

Công thức $f'(x) = \\lim_{h \\to 0}$ phải giữ nguyên toàn bộ.

Tài liệu tham khảo: https://vi.wikipedia.org/wiki/Dao_ham
"""

PROPOSED = [
    {"original": "hoc", "corrected": "học", "context": "Bài hoc về đạo hàm", "reason": "thiếu dấu"},
    {"original": "Đạo ham", "corrected": "Đạo hàm", "context": "Đạo ham là giới hạn"},
    # Các đề xuất không hợp lệ -> bị lọc
    {"original": "không có trong bài", "corrected": "có"},
    {"original": "lim", "corrected": "limit"},  # chỉ nằm trong công thức
    {"original": "Dao_ham", "corrected": "Đạo hàm"},  # chỉ nằm trong URL
    {"original": "hoc", "corrected": "học"},  # trùng
    {"original": "đạo hàm", "corrected": "đạo hàm"},  # không đổi gì
    {"original": "tỉ số", "corrected": "tỷ `số`"},  # ký tự cấu trúc trong bản sửa
]


def proofread_llm(suggestions: list[dict], captured: dict | None = None) -> FunctionModel:
    def fn(messages, info: AgentInfo) -> ModelResponse:
        if captured is not None:
            captured.setdefault("prompts", []).append(
                "\n".join(str(getattr(p, "content", "")) for m in messages for p in m.parts)
            )
            captured["instructions"] = "\n".join(m.instructions or "" for m in messages if hasattr(m, "instructions"))
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {"suggestions": suggestions})])

    return FunctionModel(fn)


def test_proofread_endpoint_filters_and_counts(client):
    captured = {}
    n = note(client, "Đạo hàm", CONTENT)
    with get_note_proofread_agent().override(model=proofread_llm(PROPOSED, captured)):
        res = client.post(f"/api/notes/{n['id']}/proofread")

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["error"] is None
    assert [(s["original"], s["corrected"]) for s in body["suggestions"]] == [("hoc", "học"), ("Đạo ham", "Đạo hàm")]
    first = body["suggestions"][0]
    assert first["occurrences"] == 1  # "hoc" trong `code` không được tính
    assert first["reason"] == "thiếu dấu" and first["id"]
    assert "tiếng Việt" in captured["instructions"] and "đạo hàm" in captured["prompts"][0]

    # Backend KHÔNG tự sửa nội dung (frontend mới thay chữ sau khi người dùng duyệt)
    assert client.get(f"/api/notes/{n['id']}").json()["content_md"] == CONTENT


def test_proofread_errors(client):
    empty = note(client, "Trống")
    assert client.post(f"/api/notes/{empty['id']}/proofread").status_code == 422
    assert client.post("/api/notes/khongcoid/proofread").status_code == 404

    n = note(client, "Lỗi LLM", "Vài dòng ghi chú có lôi chính tả.")
    with get_note_proofread_agent().override(model=failing_llm()):
        body = client.post(f"/api/notes/{n['id']}/proofread").json()
    assert body["suggestions"] == [] and "Chưa soát được" in body["error"]


@pytest.mark.parametrize(
    ("original", "corrected", "kept"),
    [
        ("hoc", "học", True),
        ("hoc", "hoc", False),  # không đổi
        ("khong-co-trong-bai", "có", False),
        ("lim", "limit", False),  # trong công thức
        ("x" * 200, "y", False),  # quá dài
        (".", "!", False),  # không có ký tự chữ
        ("tỉ số", "tỷ\nsố", False),  # xuống dòng trong bản sửa
    ],
)
def test_normalize_suggestions_rules(original, corrected, kept):
    suggestions = normalize_suggestions(CONTENT, [ProofreadSuggestion(original=original, corrected=corrected)])
    assert bool(suggestions) is kept


def test_chunk_markdown_splits_long_content():
    content = "\n\n".join("Đoạn %d %s" % (i, "x" * 900) for i in range(50))
    chunks = chunk_markdown(content, budget=5_000)
    assert len(chunks) > 1
    assert all(len(c) <= 6_000 for c in chunks)
    assert "".join(c.replace("\n", "") for c in chunks) == content.replace("\n", "")  # không mất chữ


def test_proofread_runs_every_chunk_and_merges(monkeypatch):
    """Ghi chú dài -> nhiều lần gọi LLM; đề xuất của mọi phần được gộp và lọc theo toàn bộ nội dung."""
    monkeypatch.setattr("app.services.note_proofread_agent.CHUNK_CHAR_BUDGET", 100)
    content = "Phần một có chữ hoc sai.\n\n" + "y" * 200 + "\n\nPhần ba có chữ ham sai."
    captured = {}
    suggestions = [{"original": "hoc", "corrected": "học"}, {"original": "ham", "corrected": "hàm"}]
    with get_note_proofread_agent().override(model=proofread_llm(suggestions, captured)):
        result = asyncio.run(proofread_note(content))
    assert len(captured["prompts"]) >= 2
    assert [s.original for s in result.suggestions] == ["hoc", "ham"]  # gộp, bỏ trùng giữa các phần
