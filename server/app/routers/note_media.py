from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import RedirectResponse

from app.dependencies import DbDep, OcrDep, SettingsDep, StorageDep
from app.models.note import FormulaOcrResult, NoteAsset, NoteImageRead, note_image_url
from app.services.note_media import store_note_image, validate_image
from app.services.notes import get_note_or_404
from app.services.ocr import FORMULA_IMAGE_TYPES, MAX_FORMULA_IMAGE_MB, OcrError, OcrNotConfiguredError, normalize_formula
from app.services.storage import StorageError, StorageNotConfiguredError

router = APIRouter(tags=["notes"])

# Signed URL sống 1 giờ; trình duyệt được cache lời chuyển hướng ngắn hơn để không dùng link đã hết hạn.
SIGNED_URL_TTL = 3600
REDIRECT_CACHE_SECONDS = 3000


@router.post("/api/notes/formula-ocr", response_model=FormulaOcrResult)
async def formula_ocr(ocr: OcrDep, image: UploadFile = File(...)) -> FormulaOcrResult:
    """Ảnh công thức vẽ tay (PNG từ canvas, đã cắt sát nét) -> LaTeX. Không tạo phiên, không rà soát chính tả."""
    content = await image.read()
    content_type, _ = validate_image(content, MAX_FORMULA_IMAGE_MB, FORMULA_IMAGE_TYPES)
    try:
        markdown = await ocr.extract_formula(content, content_type)
    except OcrNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail="Chưa cấu hình MISTRAL_API_KEY nên chưa nhận diện được công thức.") from exc
    except OcrError as exc:
        raise HTTPException(status_code=502, detail="Dịch vụ nhận diện công thức đang lỗi. Vui lòng thử lại.") from exc
    latex, multiple = normalize_formula(markdown)
    if not latex:
        raise HTTPException(status_code=422, detail="Không nhận ra công thức nào. Hãy viết to, rõ hơn rồi thử lại.")
    return FormulaOcrResult(latex=latex, raw_markdown=markdown, multiple=multiple)


@router.post("/api/notes/{note_id}/images", response_model=NoteImageRead, status_code=201)
async def upload_note_image(note_id: str, db: DbDep, storage: StorageDep, settings: SettingsDep, file: UploadFile = File(...)) -> NoteImageRead:
    """Tải 1 ảnh (PNG / JPEG / WebP / GIF, ≤ NOTE_IMAGE_MAX_MB) cho note -> Supabase Storage. Nội dung note tham chiếu ảnh
    bằng `url` trả về (ổn định, không hết hạn)."""
    get_note_or_404(db, note_id)
    if not storage.configured:
        raise HTTPException(status_code=503, detail="Chưa cấu hình Supabase Storage (SUPABASE_SECRET_KEY) nên chưa chèn được ảnh.")
    content = await file.read()
    try:
        asset = await store_note_image(db, storage, note_id, content, file.filename, settings.note_image_max_mb)
    except StorageError as exc:
        raise HTTPException(status_code=502, detail="Không lưu được ảnh lên kho lưu trữ. Vui lòng thử lại.") from exc
    return NoteImageRead(id=asset.id, url=note_image_url(asset.id), filename=asset.filename, content_type=asset.content_type, size_bytes=asset.size_bytes)


@router.get("/api/note-images/{asset_id}", include_in_schema=True)
async def get_note_image(asset_id: str, db: DbDep, storage: StorageDep) -> RedirectResponse:
    """URL ổn định của ảnh trong note -> chuyển hướng (307) tới signed URL ngắn hạn của bucket private."""
    asset = db.get(NoteAsset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy ảnh.")
    try:
        url = await storage.signed_url(asset.storage_path, SIGNED_URL_TTL)
    except StorageNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except StorageError as exc:
        raise HTTPException(status_code=502, detail="Không lấy được ảnh từ kho lưu trữ.") from exc
    return RedirectResponse(url, status_code=307, headers={"Cache-Control": f"private, max-age={REDIRECT_CACHE_SECONDS}"})
