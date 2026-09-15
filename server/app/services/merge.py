from sqlmodel import Session

from app.models.common import aware, utcnow
from app.models.session import MergeSource, NoteSession, TranscriptSegment


def _session_length_ms(session: NoteSession, segments: list[TranscriptSegment]) -> int:
    if session.duration_ms:
        return session.duration_ms
    ends = [s.end_ms for s in segments if s.end_ms is not None]
    return max(ends) if ends else 0


def merge_sessions(
    db: Session,
    ordered: list[NoteSession],
    *,
    title: str | None,
    group_id: str | None,
    delete_originals: bool,
) -> NoteSession:
    """Nối transcript các phiên theo thứ tự cho trước thành một phiên mới.

    Mốc thời gian của mỗi phiên sau được cộng dồn thời lượng các phiên trước (mỗi phiên gốc bắt đầu
    từ 00:00). Nhãn người nói giữ nguyên như bản gốc; mỗi đoạn được gắn `origin` = id phiên gốc.
    """
    merged_segments: list[TranscriptSegment] = []
    sources: list[MergeSource] = []
    offset = 0

    for original in ordered:
        segments = [TranscriptSegment.model_validate(s) for s in original.segments]
        for seg in segments:
            merged_segments.append(
                seg.model_copy(
                    update={
                        "start_ms": seg.start_ms + offset if seg.start_ms is not None else None,
                        "end_ms": seg.end_ms + offset if seg.end_ms is not None else None,
                        "origin": original.id,
                    }
                )
            )
        length = _session_length_ms(original, segments)
        sources.append(
            MergeSource(
                id=original.id,
                title=original.title,
                source=original.source,  # type: ignore[arg-type]
                created_at=aware(original.created_at),
                duration_ms=length or None,
                offset_ms=offset,
            )
        )
        offset += length

    first = ordered[0]
    merged = NoteSession(
        title=(title or "").strip() or f"{first.title} (gộp {len(ordered)} phiên)"[:200],
        # Giữ quy ước source chỉ "live" | "upload": lấy theo phiên đầu tiên; thông tin gộp nằm ở merge_sources.
        source=first.source,
        status="completed",
        duration_ms=offset or None,
        group_id=group_id,
        merge_sources=[s.model_dump(mode="json") for s in sources],
    )
    merged.set_segments(merged_segments)
    db.add(merged)
    db.flush()  # cần merged.id cho merged_into_id

    now = utcnow()
    for original in ordered:
        if delete_originals:
            db.delete(original)
        else:
            original.archived_at = now
            original.merged_into_id = merged.id
            original.touch()
            db.add(original)

    db.commit()
    db.refresh(merged)
    return merged
