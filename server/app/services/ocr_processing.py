"""Luồng xử lý phiên "Quét tài liệu": OCR -> rà soát từ tiếng Anh -> lưu; và chốt từng đề xuất sửa.

Chạy nền (FastAPI BackgroundTasks) sau khi `POST /api/ocr-extract` trả 202: PDF nhiều trang + một lần gọi LLM
có thể mất vài phút, vượt timeout request của Render. Frontend poll `GET /api/ocr-extract/{id}/status`.
"""

import asyncio
import logging
import shutil
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

from sqlmodel import Session

from app import db as db_module
from app.models.common import aware, utcnow
from app.models.ocr import CorrectionDecision, OcrCorrection, OcrData, OcrPage, OcrSourceFile
from app.models.session import NoteSession, TranscriptSegment
from app.services.ocr import OcrError, OcrNotConfiguredError, OcrResult, OcrService
from app.services.ocr_review_agent import apply_correction, review_ocr_pages

logger = logging.getLogger(__name__)

# Job đang chạy trong process này (Render free chạy 1 instance / 1 worker).
_running: set[str] = set()
# Phiên "processing" không có job chạy trong process và không được cập nhật quá lâu -> máy chủ đã khởi động lại
# giữa chừng (job nền mất theo) -> báo failed để người dùng tải lại thay vì chờ mãi.
STALE_AFTER = timedelta(minutes=10)

INTERRUPTED_MESSAGE = "Quá trình xử lý bị gián đoạn do máy chủ khởi động lại. Vui lòng tải tài liệu lên lại."
NO_TEXT_MESSAGE = "Không nhận dạng được chữ nào trong tài liệu."
GENERIC_ERROR_MESSAGE = "Có lỗi khi xử lý tài liệu. Vui lòng thử lại."
SINGLE_FILE_ERROR_MESSAGE = "Mistral OCR không xử lý được tài liệu này. Vui lòng thử lại hoặc dùng file khác."
ALL_FILES_ERROR_MESSAGE = "Mistral OCR không xử lý được file nào trong lần tải này. Vui lòng thử lại hoặc dùng file khác."
FILE_ERROR_MESSAGE = "Không đọc được file này (file hỏng hoặc dịch vụ OCR lỗi)."


def _update(session_id: str, **fields) -> None:
    with Session(db_module.engine) as db:
        session = db.get(NoteSession, session_id)
        if session is None or session.status != "processing":
            return  # đã bị xoá (hoặc đã kết thúc) trong lúc xử lý
        for key, value in fields.items():
            setattr(session, key, value)
        session.touch()
        db.add(session)
        db.commit()


def _fail(session_id: str, message: str) -> None:
    _update(session_id, status="failed", error_message=message)


@dataclass
class OcrUpload:
    """Một file đã được router chép ra thư mục tạm, chờ OCR ở nền."""

    filename: str
    path: Path
    content_type: str | None


# Số file OCR chạy song song trong 1 phiên (mỗi file được đọc vào RAM khi gửi, tối đa 50 MB).
MAX_CONCURRENT_FILES = 3


async def _extract_all(ocr: OcrService, uploads: list[OcrUpload]) -> list[OcrResult | OcrError]:
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_FILES)

    async def run(upload: OcrUpload) -> OcrResult | OcrError:
        async with semaphore:
            try:
                content = await asyncio.to_thread(upload.path.read_bytes)
                return await ocr.extract(upload.filename, content, upload.content_type)
            except OcrNotConfiguredError:
                raise
            except OcrError as exc:
                logger.warning("OCR thất bại cho file %s: %s", upload.filename, exc)
                return exc

    return list(await asyncio.gather(*(run(u) for u in uploads)))


async def process_ocr_session(session_id: str, uploads: list[OcrUpload], workdir: Path, ocr: OcrService) -> None:
    """OCR từng file (song song có giới hạn), nối thành 1 tài liệu theo đúng thứ tự tải lên, đánh số trang liên tục,
    rồi rà soát từ tiếng Anh trên toàn bộ tài liệu. File lỗi không làm hỏng các file khác (ghi lại ở `files[].error`);
    chỉ khi mọi file đều lỗi / không có chữ thì phiên mới `failed`."""
    _running.add(session_id)
    try:
        try:
            results = await _extract_all(ocr, uploads)
        except OcrNotConfiguredError as exc:
            _fail(session_id, str(exc))
            return

        pages: list[OcrPage] = []
        files: list[OcrSourceFile] = []
        model: str | None = None
        pages_processed = 0
        for upload, result in zip(uploads, results):
            if isinstance(result, OcrError):
                files.append(OcrSourceFile(filename=upload.filename, error=FILE_ERROR_MESSAGE))
                continue
            model = model or result.model
            pages_processed += result.pages_processed
            first = len(pages) + 1
            pages.extend(OcrPage(page=first + i, markdown=p.markdown) for i, p in enumerate(result.pages))
            files.append(OcrSourceFile(filename=upload.filename, first_page=first if result.pages else None, page_count=len(result.pages)))

        if all(isinstance(r, OcrError) for r in results):
            _fail(session_id, SINGLE_FILE_ERROR_MESSAGE if len(uploads) == 1 else ALL_FILES_ERROR_MESSAGE)
            return
        if not any(p.markdown for p in pages):
            _fail(session_id, NO_TEXT_MESSAGE)
            return
        _update(session_id)  # heartbeat trước bước LLM

        review = await review_ocr_pages(pages)
        data = OcrData(
            model=model or "",
            pages_processed=pages_processed,
            files=files,
            raw_pages=pages,
            reviewed_pages=review.corrected_pages,
            corrections=[OcrCorrection(id=f"c{i + 1}", **c.model_dump()) for i, c in enumerate(review.corrections)],
            review_error=review.error,
        )
        # Nội dung chốt ban đầu = bản OCR gốc; đề xuất sửa chỉ được áp dụng khi người dùng chấp nhận.
        segments = [TranscriptSegment(text=p.markdown, page=p.page) for p in pages if p.markdown]
        with Session(db_module.engine) as db:
            session = db.get(NoteSession, session_id)
            if session is None or session.status != "processing":
                return
            session.set_segments(segments)
            session.ocr = data.model_dump(mode="json")
            session.status = "completed"
            session.error_message = None
            session.touch()
            db.add(session)
            db.commit()
    except Exception:  # noqa: BLE001 - job nền: mọi lỗi phải chuyển phiên sang failed, không để treo "processing"
        logger.exception("Xử lý OCR thất bại cho session %s", session_id)
        _fail(session_id, GENERIC_ERROR_MESSAGE)
    finally:
        _running.discard(session_id)
        shutil.rmtree(workdir, ignore_errors=True)


def expire_if_orphaned(db: Session, session: NoteSession) -> NoteSession:
    if session.source != "ocr" or session.status != "processing" or session.id in _running:
        return session
    if utcnow() - aware(session.updated_at) < STALE_AFTER:  # type: ignore[operator]
        return session
    session.status = "failed"
    session.error_message = INTERRUPTED_MESSAGE
    session.touch()
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


class CorrectionDecisionError(ValueError):
    pass


def decide_corrections(session: NoteSession, decision: CorrectionDecision) -> None:
    """Chấp nhận / bỏ qua đề xuất sửa. Chấp nhận = thay nguyên từ trong đúng trang của nội dung hiện tại
    (kể cả khi người dùng đã chỉnh sửa tay); không còn tìm thấy từ gốc -> `unavailable`.
    Đề xuất đã được quyết định thì giữ nguyên (gọi lặp lại an toàn)."""
    data = session.ocr_data()
    if data is None:
        raise CorrectionDecisionError("Phiên này không có dữ liệu quét tài liệu.")
    accept, reject = set(decision.accept), set(decision.reject)
    if accept & reject:
        raise CorrectionDecisionError("Một đề xuất không thể vừa chấp nhận vừa bỏ qua.")
    unknown = (accept | reject) - {c.id for c in data.corrections}
    if unknown:
        raise CorrectionDecisionError(f"Không tìm thấy đề xuất sửa: {', '.join(sorted(unknown))}.")

    segments = [TranscriptSegment.model_validate(s) for s in session.segments]
    changed = False
    for correction in data.corrections:
        if correction.status != "pending":
            continue
        if correction.id in reject:
            correction.status = "rejected"
        elif correction.id in accept:
            replaced = 0
            for seg in segments:
                if seg.page == correction.page:
                    seg.text, count = apply_correction(seg.text, correction.original, correction.corrected)
                    replaced += count
            correction.status = "accepted" if replaced else "unavailable"
            changed = changed or replaced > 0

    session.ocr = data.model_dump(mode="json")
    if changed:
        session.set_segments(segments)
        if session.summary is not None:
            session.summary_outdated = True
