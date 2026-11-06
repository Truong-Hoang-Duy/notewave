from pydantic_ai.messages import ModelResponse, TextPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app.models.note import Note
from app.models.session import NoteSession
from app.services.chat_agent import (
    assemble_context,
    ask_documents,
    build_note_source,
    build_session_source,
    get_doc_chat_agent,
)


def test_build_sources_and_assemble_context():
    s = NoteSession(
        id="s1",
        title="Bài giảng Hệ điều hành",
        source="live",
        status="completed",
        segments=[
            {"speaker": "1", "text": "Tiến trình là chương trình đang thực thi.", "start_ms": 15000, "end_ms": 20000},
            {"speaker": "1", "text": "Luồng là đơn vị thực thi nhỏ nhất.", "start_ms": 21000, "end_ms": 25000},
        ],
    )
    n = Note(
        id="n1",
        title="Ôn tập Chương 2",
        cues=[{"id": "c1", "text": "Deadlock là gì?"}],
        content_md="Deadlock xảy ra khi 4 điều kiện Coffman đồng thời thoả mãn.",
        summary="Cần nhớ 4 điều kiện giữ và chờ.",
    )
    src_s = build_session_source("S1", s)
    src_n = build_note_source("N1", n)
    ctx = assemble_context([src_s, src_n], "Deadlock là gì?")
    assert "[S1] Ghi âm trực tiếp: Bài giảng Hệ điều hành" in ctx
    assert "[00:15 · Người nói 1] Tiến trình là chương trình đang thực thi." in ctx
    assert "[N1] Ghi chú Cornell: Ôn tập Chương 2" in ctx
    assert "Deadlock xảy ra khi 4 điều kiện Coffman" in ctx


async def test_ask_documents_with_function_model():
    s = NoteSession(
        id="s1",
        title="Bài giảng Mạng máy tính",
        source="ocr",
        status="completed",
        segments=[{"page": 3, "text": "TCP là giao thức hướng kết nối, đảm bảo tin cậy."}],
    )
    src = build_session_source("S1", s)

    def fake_llm(messages, info: AgentInfo) -> ModelResponse:
        # Đảm bảo agent có đăng ký đầy đủ 4 tools tra cứu DB
        tool_names = {t.name for t in info.function_tools}
        assert {"list_recent_documents", "search_user_documents", "read_session_content", "read_note_content"} <= tool_names
        return ModelResponse(parts=[TextPart(content="- **TCP** là giao thức hướng kết nối, truyền tin cậy.")])

    agent = get_doc_chat_agent()
    with agent.override(model=FunctionModel(fake_llm)):
        res = await ask_documents("TCP là gì?", [src])
        res_free = await ask_documents("Câu hỏi tự do không cần chọn tài liệu")

    assert "TCP" in res.answer_md
    assert len(res.used_sources) == 1
    assert res.used_sources[0].id == "s1"
    assert res_free.used_sources == []


def test_chat_endpoint_allows_free_chat_and_attached_sources(client, make_session, monkeypatch):
    from app.models.chat import ChatAskResponse, ChatSourceRef
    from app.routers import chat as chat_router

    s = make_session("Bài 1", source="live", segments=[{"speaker": "1", "text": "Nội dung bài 1", "start_ms": 0, "end_ms": 1000}])

    async def fake_ask(question, sources, history, db=None):
        used = [
            ChatSourceRef(source_type=src.source_type, id=src.id, title=src.title, source_kind=src.source_kind)
            for src in (sources or [])
        ]
        return ChatAskResponse(
            answer_md=f"Trả lời cho: {question}",
            used_sources=used,
            model="openai:gpt-5.6-luna",
        )

    monkeypatch.setattr(chat_router, "ask_documents", fake_ask)

    # 1. Chat tự do không cần đính kèm tài liệu
    res_free = client.post("/api/chat/ask", json={"question": "Giải thích định lý CAP?"})
    assert res_free.status_code == 200
    assert res_free.json()["used_sources"] == []

    # 2. Chat có đính kèm tài liệu
    res_with_doc = client.post("/api/chat/ask", json={"question": "Tóm tắt ý chính?", "session_ids": [s["id"]]})
    assert res_with_doc.status_code == 200
    assert res_with_doc.json()["used_sources"][0]["id"] == s["id"]
