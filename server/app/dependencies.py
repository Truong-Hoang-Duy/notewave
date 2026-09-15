from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlmodel import Session

from app.config import Settings, get_settings
from app.db import get_db
from app.models.group import SessionGroup
from app.models.session import NoteSession
from app.services.soniox import SonioxService

SettingsDep = Annotated[Settings, Depends(get_settings)]
DbDep = Annotated[Session, Depends(get_db)]


def get_soniox(request: Request, settings: SettingsDep) -> SonioxService:
    return SonioxService(request.app.state.http, settings)


SonioxDep = Annotated[SonioxService, Depends(get_soniox)]


def get_session_or_404(db: Session, session_id: str) -> NoteSession:
    session = db.get(NoteSession, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy phiên ghi chú.")
    return session


def get_group_or_404(db: Session, group_id: str) -> SessionGroup:
    group = db.get(SessionGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhóm.")
    return group
