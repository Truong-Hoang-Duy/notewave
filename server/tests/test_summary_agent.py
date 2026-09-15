import os

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app.config import Settings
from app.services.summary_agent import build_model_settings, get_summary_agent, summarize_transcript
from app.models.session import TranscriptSegment
from tests.helpers import seg


def test_default_summary_model_is_luna():
    assert Settings.model_fields["summary_model"].default == "openai:gpt-5.6-luna"
    assert Settings.model_fields["summary_reasoning_effort"].default == ""


@pytest.mark.parametrize(
    ("model", "effort", "expected"),
    [
        ("openai:gpt-5.6-luna", "", None),  # trống -> để model dùng reasoning mặc định
        ("openai:gpt-5.6-luna", " LOW ", {"openai_reasoning_effort": "low"}),
        ("anthropic:claude-sonnet-5", "low", None),  # chỉ áp dụng cho OpenAI
    ],
)
def test_build_model_settings(model, effort, expected):
    settings = Settings(summary_model=model, summary_reasoning_effort=effort, database_url="postgresql://x/y")
    assert build_model_settings(settings) == expected


def test_summarize_endpoint_runs_real_agent_pipeline(client, make_session):
    """Chạy đúng agent + endpoint, chỉ thay LLM bằng FunctionModel để kiểm tra prompt và output có cấu trúc."""
    captured = {}

    def fake_llm(messages, info: AgentInfo) -> ModelResponse:
        captured["prompt"] = "\n".join(str(getattr(p, "content", "")) for m in messages for p in m.parts)
        captured["instructions"] = "\n".join(m.instructions or "" for m in messages if hasattr(m, "instructions"))
        tool = info.output_tools[0]
        args = {
            "summary": "Nhóm chốt ngày ra mắt beta.",
            "key_points": ["Backend đã deploy thử"],
            "action_items": [{"task": "Viết hướng dẫn cấp quyền micro", "owner": "Lan (Người nói 3)", "due": "trước thứ Sáu"}],
            "decisions": ["Ra mắt beta ngày 22/9"],
        }
        return ModelResponse(parts=[ToolCallPart(tool.name, args)])

    a = make_session("Phần 1", segments=[seg("1", "Anh Minh cập nhật backend nhé", 0, 3000)], duration_ms=5000)
    b = make_session("Phần 2", segments=[seg("3", "Em viết hướng dẫn trước thứ Sáu", 0, 2000)])
    merged = client.post("/api/sessions/merge", json={"session_ids": [a["id"], b["id"]], "title": "Họp beta"}).json()

    with get_summary_agent().override(model=FunctionModel(fake_llm)):
        res = client.post(f"/api/sessions/{merged['id']}/summarize")

    assert res.status_code == 200, res.text
    assert res.json()["action_items"][0]["owner"] == "Lan (Người nói 3)"
    prompt = captured["prompt"]
    assert "Tiêu đề phiên: Họp beta" in prompt
    assert "[00:00 · Người nói 1] Anh Minh cập nhật backend nhé" in prompt
    assert "--- Phần 1 ---" in prompt and "--- Phần 2 ---" in prompt  # tiêu đề phần của phiên gộp
    assert "Tên (Người nói N)" in captured["instructions"]
    assert client.get(f"/api/sessions/{merged['id']}").json()["summary"]["decisions"] == ["Ra mắt beta ngày 22/9"]


async def _live_summary():
    segments = [
        TranscriptSegment(speaker="1", text="Anh Minh cập nhật tiến độ backend giúp em.", start_ms=0),
        TranscriptSegment(speaker="2", text="Dạ backend xong rồi, em sẽ test webhook với file 60 phút và báo lại trước thứ Tư.", start_ms=5000),
        TranscriptSegment(speaker="1", text="Ok, chốt ra mắt beta ngày 22 tháng 9.", start_ms=12000),
    ]
    return await summarize_transcript("Họp beta", segments)


@pytest.mark.skipif(os.environ.get("RUN_LLM_TESTS") != "1", reason="Gọi LLM thật (tốn phí) — bật bằng RUN_LLM_TESTS=1")
def test_live_summary_with_configured_model():
    import asyncio

    summary = asyncio.run(_live_summary())
    assert summary.summary
    assert any("22" in d for d in summary.decisions)
    assert any(item.due and "thứ Tư" in item.due for item in summary.action_items)
