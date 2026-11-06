import logging

from fastapi import APIRouter, HTTPException
from sqlmodel import col, select

from app.dependencies import DbDep
from app.models.chat import ChatAskRequest, ChatAskResponse
from app.models.note import Note
from app.models.session import NoteSession
from app.services.chat_agent import (
    SourceDocument,
    ask_documents,
    build_note_source,
    build_session_source,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("/ask", response_model=ChatAskResponse)
async def ask_chat(payload: ChatAskRequest, db: DbDep) -> ChatAskResponse:
    """Chat với AI Agent (hỗ trợ cả hỏi tự do, đính kèm tài liệu tuỳ chọn và tự tra cứu DB bằng tools)."""
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="Vui lòng nhập câu hỏi.")

    sources: list[SourceDocument] = []

    if payload.session_ids:
        rows = db.exec(select(NoteSession).where(col(NoteSession.id).in_(payload.session_ids))).all()
        by_id = {r.id: r for r in rows}
        idx = 1
        for sid in dict.fromkeys(payload.session_ids):
            s = by_id.get(sid)
            if s is None or s.status != "completed":
                continue
            src = build_session_source(f"S{idx}", s)
            if src.blocks:
                sources.append(src)
                idx += 1

    if payload.note_ids:
        rows = db.exec(select(Note).where(col(Note.id).in_(payload.note_ids))).all()
        by_id = {r.id: r for r in rows}
        idx = 1
        for nid in dict.fromkeys(payload.note_ids):
            n = by_id.get(nid)
            if n is None:
                continue
            src = build_note_source(f"N{idx}", n)
            if src.blocks:
                sources.append(src)
                idx += 1

    try:
        return await ask_documents(
            question=question,
            sources=sources,
            history=payload.history,
            db=db,
        )
    except Exception as exc:
        logger.exception("Chat AI Agent thất bại")
        raise HTTPException(
            status_code=502,
            detail="Không kết nối được tới AI Agent. Kiểm tra cấu hình SUMMARY_MODEL / API key của LLM.",
        ) from exc
