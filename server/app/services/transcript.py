from collections.abc import Iterable
from typing import Any

from app.models.session import TranscriptSegment


def _normalize_speaker(speaker: Any) -> str | None:
    if speaker is None or isinstance(speaker, bool):
        return None
    if isinstance(speaker, int):
        return str(speaker + 1)
    s = str(speaker).strip()
    return s or None


def utterances_to_segments(
    utterances: Iterable[dict[str, Any]],
    default_language: str | None = None,
) -> list[TranscriptSegment]:
    """Gom các utterance/word liên tiếp cùng người nói (từ Deepgram) thành các đoạn TranscriptSegment."""
    segments: list[TranscriptSegment] = []
    for item in utterances:
        text = (item.get("text") or item.get("transcript") or item.get("punctuated_word") or item.get("word") or "").strip()
        if not text:
            continue
        speaker = _normalize_speaker(item.get("speaker"))
        start_s = item.get("start")
        end_s = item.get("end")
        start_ms = (
            int(item["start_ms"])
            if item.get("start_ms") is not None
            else (round(float(start_s) * 1000) if start_s is not None else None)
        )
        end_ms = (
            int(item["end_ms"])
            if item.get("end_ms") is not None
            else (round(float(end_s) * 1000) if end_s is not None else None)
        )
        language = item.get("language") or default_language
        current = segments[-1] if segments else None
        if current is None or current.speaker != speaker:
            segments.append(
                TranscriptSegment(
                    speaker=speaker,
                    text=text,
                    start_ms=start_ms,
                    end_ms=end_ms,
                    language=language,
                )
            )
            continue
        current.text = f"{current.text} {text}"
        if end_ms is not None:
            current.end_ms = end_ms
    return [s for s in segments if s.text]


def tokens_to_segments(tokens: Iterable[dict[str, Any]]) -> list[TranscriptSegment]:
    """Gom các token liên tiếp cùng người nói thành một đoạn transcript."""
    segments: list[TranscriptSegment] = []
    for token in tokens:
        text = token.get("text") or ""
        if not text or token.get("translation_status") == "translation":
            continue
        if text in ("<end>", "<fin>"):
            continue
        speaker = _normalize_speaker(token.get("speaker"))
        start_ms = token.get("start_ms")
        end_ms = token.get("end_ms")
        current = segments[-1] if segments else None
        if current is None or current.speaker != speaker:
            segments.append(
                TranscriptSegment(
                    speaker=speaker,
                    text=text.lstrip(),
                    start_ms=start_ms,
                    end_ms=end_ms,
                    language=token.get("language"),
                )
            )
            continue
        current.text += text
        if end_ms is not None:
            current.end_ms = end_ms
    for seg in segments:
        seg.text = seg.text.strip()
    return [s for s in segments if s.text]


def format_timestamp(ms: int | None) -> str:
    if ms is None:
        return ""
    total = ms // 1000
    hours, rem = divmod(total, 3600)
    minutes, seconds = divmod(rem, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def speaker_label(speaker: str | None) -> str | None:
    return f"Người nói {speaker}" if speaker else None


def segments_to_plain_text(segments: list[TranscriptSegment], part_titles: dict[str, str] | None = None) -> str:
    """`part_titles` (id phiên gốc -> tiêu đề): chèn tiêu đề phần khi transcript chuyển sang phiên gốc khác."""
    lines: list[str] = []
    current_origin: str | None = None
    # Phiên quét tài liệu nhiều trang: chèn nhãn "Trang N" trước mỗi trang.
    multi_page = len({s.page for s in segments if s.page is not None}) > 1
    for seg in segments:
        if part_titles and seg.origin and seg.origin != current_origin:
            current_origin = seg.origin
            lines.append(f"--- {part_titles.get(seg.origin, 'Phần gộp')} ---")
        if multi_page and seg.page is not None:
            lines.append(f"--- Trang {seg.page} ---")
        prefix_parts = [p for p in (format_timestamp(seg.start_ms), speaker_label(seg.speaker)) if p]
        prefix = f"[{' · '.join(prefix_parts)}] " if prefix_parts else ""
        lines.append(f"{prefix}{seg.text}")
    return "\n\n".join(lines)
