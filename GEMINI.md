# NoteWave — Ngữ cảnh dự án

> File này giúp Claude Code (và các AI coding agent khác) hiểu nhanh bối cảnh dự án
> mà không cần giải thích lại từ đầu mỗi phiên làm việc. Đặt file này ở thư mục gốc
> repo. Dùng nguyên bản này cho cả `CLAUDE.md` (Claude Code) và `GEMINI.md` (Gemini CLI) —
> hai công cụ đều tự động đọc file cùng tên đặt ở root khi khởi động.

## 1. Dự án là gì

**NoteWave** là ứng dụng web ghi chú/phụ đề cuộc họp bằng giọng nói, gồm 3 luồng nhập liệu:
1. **Ghi âm trực tiếp** — nói vào micro, transcript hiện real-time (phụ đề trực tiếp).
2. **Tải file ghi âm lên** — upload file audio có sẵn (.mp3, .wav, .m4a...), nhận lại transcript đầy đủ.
3. **Quét tài liệu** — chụp ảnh / tải ảnh hoặc PDF (biên bản viết tay, bảng trắng...), Mistral OCR trích xuất Markdown,
   AI đề xuất sửa từ tiếng Anh viết sai để người dùng duyệt.

4. **Ghi chú (Cornell)** — ghi chú học tập độc lập: cột câu hỏi/từ khoá (neo vào từng đoạn) — nội dung chi tiết
   (editor Tiptap) — tóm tắt tự viết; thư mục dạng cây + tag, tự lưu, chế độ ôn tập, giao diện riêng từng note
   (lộ trình các giai đoạn + trạng thái: mục "Lộ trình Ghi chú" trong `PROGRESS.md`).

2 luồng giọng nói hỗ trợ phân biệt người nói (speaker diarization); cả 3 luồng đều lưu lịch sử phiên,
tóm tắt bằng AI, và xuất file .txt/.docx.

## 2. Stack kỹ thuật (đừng đề xuất đổi sang stack khác trừ khi tôi yêu cầu)

- **Frontend:** React 19 + Vite, Tailwind CSS v4 (`@tailwindcss/vite`, token màu/font khai báo
  trong `@theme` ở `client/src/index.css`). Thư mục `/client`. Thư viện phụ đã được duyệt:
  `@soniox/client` (SDK chính thức — ghi âm micro + WebSocket real-time), `lucide-react` (icon),
  `react-markdown` + `remark-gfm` (render Markdown OCR — chunk lazy, chỉ tải khi mở phiên OCR),
  `pdfjs-dist` (xem trước PDF trước khi tải lên — chunk lazy, chỉ tải khi mở preview một file PDF),
  **Tiptap v3** (`@tiptap/react`, `pm`, `starter-kit`, `extension-list`, `extensions`, `markdown`, `extension-unique-id` —
  editor của Ghi chú, chunk lazy chỉ tải khi mở một ghi chú; duyệt 2026-09-18) + `extension-table`, `extension-image`,
  `extension-mathematics` (GĐ2); `katex` + `remark-math` + `rehype-katex` (render công thức, dùng chung cho Ghi chú và
  `OcrDocumentView`). **`katex` giữ ở `^0.16`**: `rehype-katex`/`micromark-extension-math` chỉ nhận 0.16 — cài 0.17+ sẽ
  có 2 bản KaTeX trong bundle; `vite.config.js` tách KaTeX thành chunk riêng (`codeSplitting.groups`) để 2 chunk lazy
  dùng chung. Chưa duyệt: `dexie`, `vite-plugin-pwa`.
  Điều hướng dùng hash router tự viết (`#/live`, `#/upload`, `#/scan`, `#/notes`, `#/notes/<id>`, `#/history/<id>`),
  không dùng react-router.
- **Backend:** Python, FastAPI (web server) + PydanticAI (agent tóm tắt / rà soát OCR bằng LLM). Thư mục `/server`.
  Thư viện phụ đã được duyệt: `mistralai` (SDK Mistral OCR), `pypdf` (đếm trang PDF trước khi OCR).
- **Database:** **Supabase Postgres (hosted), local và production dùng CHUNG 1 project, cùng 1 `DATABASE_URL`**
  (quyết định 2026-09-15, thay Supabase local qua Docker/CLI — đã gỡ `supabase/`, devDependency `supabase`,
  script `db:*`). Truy cập qua SQLModel/SQLAlchemy.
  - Local: dán connection string Transaction pooler của project production vào `.env`. **Không có Docker,
    không có Supabase CLI**; đừng đề xuất dựng lại Postgres local trừ khi tôi yêu cầu. Dữ liệu local = dữ liệu
    thật → không chạy thao tác phá huỷ trên dữ liệu thật khi dev. Nếu sau này tách project dev riêng thì chỉ đổi `.env`.
  - **Dev hằng ngày: `npm run dev`** (hoặc `dev.bat`, Ctrl+Shift+B trong VS Code): `run-dev.js` tự cài deps còn
    thiếu, tạo `.env` nếu chưa có, kiểm tra `DATABASE_URL` (trống / không phải Postgres / còn trỏ
    `127.0.0.1:54322` → báo lỗi), chạy backend, **chờ `/api/health` phản hồi rồi mới bật frontend** (backend khởi
    động ~7 giây vì `init_db` đi qua mạng tới Supabase; VS Code task "FE + BE" cũng chạy tuần tự). Khi thêm bước setup mới cho môi trường dev,
    đưa vào `run-dev.js` thay vì bắt người dùng chạy tay.
  - Kết nối luôn qua **Transaction pooler** (cổng 6543, `?sslmode=require`) cho cả local lẫn Render.
  - Chỉ hỗ trợ Postgres: `app/db.py` từ chối URL không phải Postgres, không còn nhánh code SQLite.
    Driver `psycopg[binary]` (v3); tự đổi `postgres://`/`postgresql://` → `postgresql+psycopg://`;
    `prepare_threshold=None` để chạy được qua pooler.
  - Kiểu cột dùng tính năng Postgres: `JSONB` cho `segments`/`summary`/`merge_sources`,
    `timestamptz` cho mọi cột thời gian (`models/common.py::tz_column`).
  - Dùng Postgres + **Storage** của Supabase (Storage cho ảnh trong Ghi chú — `services/storage.py` gọi REST bằng `httpx` từ
    backend với `SUPABASE_SECRET_KEY`, bucket private). Chưa dùng Supabase Auth, không dùng SDK Supabase ở client.
  - Bảng tạo bằng `SQLModel.metadata.create_all` lúc khởi động (không dùng migrations của Supabase CLI).
- **Speech-to-Text:** Soniox API.
  - Ghi âm trực tiếp → **Real-time WebSocket API** (`wss://api.soniox.com/transcribe-websocket`),
    kết nối thẳng từ trình duyệt bằng **Temporary API Key** lấy từ backend.
  - Tải file lên → **Async API** (REST): `POST /v1/files` upload → `POST /v1/transcriptions`
    tạo job → lấy kết quả qua polling hoặc webhook. Luôn thực hiện từ backend, dùng thẳng
    `SONIOX_API_KEY` (không expose ra client).
- **OCR (Quét tài liệu):** Mistral OCR API (`mistral-ocr-latest`) qua SDK `mistralai`, luôn từ backend với
  `MISTRAL_API_KEY`. Chưa có storage public nên: upload file lên Mistral Files API (`purpose="ocr"`) → lấy signed URL
  ngắn hạn của chính file đó → `ocr.process` (`document_url` cho PDF, `image_url` cho ảnh) → xoá file trên Mistral.

## 3. Quy tắc bảo mật quan trọng — LUÔN tuân thủ

- **Không bao giờ** trả `SONIOX_API_KEY` (key chính) về client. Client chỉ nhận Temporary
  API Key qua endpoint `POST /api/temporary-key`. `MISTRAL_API_KEY` cũng chỉ dùng ở backend.
- Mọi API key (Soniox, LLM provider cho PydanticAI, v.v.) đọc từ biến môi trường qua
  `pydantic-settings`, không hard-code trong source.
- CORS ở backend đọc danh sách origin cho phép từ biến môi trường `ALLOWED_ORIGINS`,
  không để `*` khi build cho production.
- Supabase công khai schema `public` qua Data API: mọi bảng mới phải bật **Row Level Security**.
  `db._enable_row_level_security()` tự bật RLS (không policy) cho mọi bảng trong SQLModel metadata
  lúc khởi động — frontend KHÔNG truy cập DB trực tiếp, chỉ qua FastAPI. Không đưa `DATABASE_URL`,
  `service_role`/secret key của Supabase ra client.

## 4. Các endpoint backend chính (giữ nguyên convention này khi thêm endpoint mới)

| Endpoint | Method | Chức năng |
|---|---|---|
| `/api/temporary-key` | POST | Sinh Temporary API Key cho luồng ghi âm trực tiếp |
| `/api/sessions` | POST/GET | Tạo/liệt kê phiên ghi chú (field `source`: `"live"`, `"upload"` hoặc `"ocr"`) |
| `/api/sessions/{id}` | GET/PATCH/DELETE | Xem/đổi tên (`{"title"}`)/xoá 1 phiên |
| `/api/sessions/{id}/summarize` | POST | Gọi PydanticAI `summary_agent`, trả `MeetingSummary` |
| `/api/sessions/{id}/export` | GET | Xuất `.txt` hoặc `.docx` (query `?format=`) |
| `/api/upload-transcribe` | POST | Nhận 1 file audio (+ `group_id`? gán nhóm ngay), gọi Soniox Async API, tạo session `processing`. Tải nhiều file = nhiều request (frontend xếp hàng, tối đa 2 song song), mỗi file 1 phiên |
| `/api/upload-transcribe/{id}/status` | GET | Poll trạng thái xử lý file (dùng khi chưa có webhook) |
| `/api/webhooks/soniox` | POST | Nhận callback từ Soniox khi transcription xong |
| `/api/ocr-extract` | POST | Nhận 1–20 ảnh/PDF (multipart `files` lặp lại theo đúng thứ tự; `file` đơn vẫn nhận), kiểm tra định dạng / mỗi file ≤50MB / tổng ≤200MB / tổng ≤1000 trang, gộp thành MỘT session `source="ocr"` `processing`, OCR + rà soát chạy nền; trả 202 `{session_id, status, pages, files}` |
| `/api/ocr-extract/{id}/status` | GET | Poll trạng thái phiên quét tài liệu (job nền mất do restart → `failed`) |
| `/api/sessions/{id}/ocr-corrections` | POST | Chấp nhận / bỏ qua đề xuất sửa từ tiếng Anh: `{"accept": [ids], "reject": [ids]}` → `SessionRead`; chấp nhận thì sửa `segments`, nếu đã có tóm tắt đặt `summary_outdated=true` |
| `/api/sessions/{id}/segments` | PUT | Lưu transcript đã chỉnh sửa (`{"segments": [...]}`, thay toàn bộ); nếu đã có tóm tắt thì đặt `summary_outdated=true` |
| `/api/sessions/{id}/restore` | POST | Khôi phục phiên đã lưu trữ (archived) sau khi gộp |
| `/api/sessions/merge` | POST | Gộp phiên: `{"session_ids" (đúng thứ tự nối, ≥2), "title"?, "group_id"?, "delete_originals"}` → tạo phiên mới |
| `/api/sessions/assign-group` | POST | Gán/gỡ nhiều phiên vào nhóm: `{"session_ids": [...], "group_id": "<id>" \| null}` |
| `/api/groups` | GET/POST | Liệt kê nhóm (kèm `session_count`, không tính phiên archived) / tạo nhóm `{"name"}` (tên không trùng, không phân biệt hoa thường) |
| `/api/groups/{id}` | PATCH/DELETE | Đổi tên nhóm / xoá nhóm (phiên trong nhóm chuyển về "chưa phân nhóm", không bị xoá) |
| `/api/notes` | POST/GET | Tạo ghi chú Cornell (`{title?, folder_id?, tag_ids?}`) / liệt kê (`?q=` tìm trong tiêu đề+câu hỏi+nội dung+tóm tắt, `?folder_id=<id>\|none` (chỉ note nằm TRỰC TIẾP), `?tag_id=`, `?sort=` `updated_desc` (mặc định) \| `created_desc` \| `created_asc` \| `title_asc` \| `title_desc`, `limit`, `offset`) |
| `/api/notes/{id}` | GET/PATCH/DELETE | Xem / cập nhật TỪNG PHẦN (autosave chỉ gửi field đã đổi: `title`, `folder_id` (null tường minh = ra gốc), `tag_ids` (thay toàn bộ), `cues`, `content_json`, `content_md`, `summary`, `style`) — last-write-wins, không kiểm tra phiên bản / xoá |
| `/api/notes/{id}/images` | POST | Tải 1 ảnh (multipart `file`; PNG/JPEG/WebP/GIF theo magic bytes, ≤ `NOTE_IMAGE_MAX_MB`) lên Supabase Storage → `{id, url: "/api/note-images/<id>", ...}`; chưa có `SUPABASE_SECRET_KEY` → 503 |
| `/api/note-images/{id}` | GET | URL ỔN ĐỊNH của ảnh trong note → 307 tới signed URL 1 giờ của bucket private (`Cache-Control: private, max-age=3000`) |
| `/api/notes/formula-ocr` | POST | Ảnh công thức vẽ tay (multipart `image`, PNG/JPEG/WebP ≤ 5MB) → Mistral OCR (data URI, không qua Files API) → `{latex, raw_markdown, multiple}`; không tạo phiên |
| `/api/notes/{id}/links` | GET | Liên kết `[[...]]` của ghi chú: `{incoming: [...], outgoing: [...]}` (mỗi mục `{id, title, folder}`) — backend tính lại mỗi lần lưu `content_md` |
| `/api/notes/{id}/ai-summary` | POST | Tạo (hoặc tạo lại) tóm tắt AI bằng `note_summary_agent` → `NoteAiSummary` (`summary`, `key_points`, `concepts`, `review_questions`, `model`, `generated_at`, `source_hash`); lưu vào cột `notes.ai_summary`, KHÔNG đụng `summary` tự viết, không đổi `updated_at`; nội dung rỗng → 422, LLM lỗi → 502 |
| `/api/notes/{id}/proofread` | POST | Soát lỗi chính tả nội dung (tiếng Việt + tiếng Anh) bằng `note_proofread_agent` → `{suggestions: [{id, original, corrected, context, reason, occurrences}], error}`; backend CHỈ đề xuất, không sửa nội dung; nội dung rỗng → 422 |
| `/api/note-folders` | GET/POST | Liệt kê thư mục (phẳng, kèm `parent_id` + `note_count` trực tiếp; frontend dựng cây) / tạo `{name, parent_id?}` (tên không trùng trong cùng thư mục cha, không phân biệt hoa thường) |
| `/api/note-folders/{id}` | PATCH/DELETE | Đổi tên và/hoặc chuyển thư mục cha (`parent_id`, chặn vòng lặp → 422) / xoá: note + thư mục con chuyển lên thư mục cha (trùng tên thì thêm hậu tố " (2)"), không xoá note |
| `/api/tags` | GET/POST | Liệt kê tag (kèm `note_count`) / tạo `{name}` (bỏ `#` đầu, gộp khoảng trắng, không trùng tên) |
| `/api/tags/{id}` | PATCH/DELETE | Đổi tên / xoá tag (gỡ khỏi mọi note, note không bị xoá) |
| `/api/health` | GET | Health check (Render) + frontend gọi khi mở app để "đánh thức" backend. Chạy `SELECT 1`: trả `database` `"ok"`/`"error"` (+ `database_error` = tên loại lỗi), `status` `"ok"`/`"degraded"`, `soniox_configured`, `ocr_configured`, `note_images_configured`, `webhook_enabled`; luôn HTTP 200 |

Ghi chú:
- `GET /api/sessions` hỗ trợ `?q=` (tìm theo tiêu đề/nội dung), `?source=live|upload|ocr`,
  `?group_id=<id>|none` (`none` = chưa phân nhóm), `?archived=true` (chỉ phiên đã lưu trữ; mặc định
  loại trừ), `limit`, `offset`, và `?sort=` (mặc định `created_desc`):
  `created_desc` | `created_asc` | `title_asc` | `title_desc` | `updated_desc` | `duration_desc` | `duration_asc`.
  Sắp xếp LUÔN làm ở DB (ORDER BY trong `routers/sessions.py::_SORTS`) để đúng với `limit`/`offset`, không sort ở
  frontend. Tiêu đề so sánh qua `func.lower` (không phân biệt hoa/thường, thứ tự theo collation Postgres);
  `duration_ms` null (phiên OCR) luôn xếp cuối. Session có `status`: `processing` | `completed` | `failed`.
- Logic hoàn tất upload dùng chung cho polling và webhook nằm ở `services/upload_processing.py` (idempotent).
- **Nhóm tài liệu:** model `SessionGroup` (bảng `session_groups`, `models/group.py`). `NoteSession.group_id`
  trỏ tới nhóm (mỗi phiên thuộc tối đa 1 nhóm). Không khai báo FK ở mức DB; router tự gỡ `group_id`
  khi xoá nhóm.
- **Gộp phiên** (`services/merge.py`): nối segments theo thứ tự `session_ids`, mốc thời gian phiên sau
  cộng dồn thời lượng các phiên trước, giữ nguyên nhãn người nói; mỗi segment gắn `origin` = id phiên
  gốc; phiên mới lưu `merge_sources` (snapshot id/title/source/offset_ms của phiên gốc) để UI và export
  vẽ tiêu đề từng phần. `source` của phiên gộp = `source` của phiên đầu tiên (KHÔNG thêm giá trị mới).
  Bản gốc: `delete_originals=false` → đặt `archived_at` + `merged_into_id` (khôi phục được);
  `true` → xoá vĩnh viễn.
- **Tóm tắt AI** (`services/summary_agent.py`): model mặc định `openai:gpt-5.6-luna` (quyết định 2026-09-15 —
  người dùng chọn; đo thực tế rẻ hơn gpt-5.4-mini ~3–4 lần, context 1.05M token). Luna mặc định bật reasoning;
  để trống `SUMMARY_REASONING_EFFORT` (đo thử: `low` nhanh hơn ~2 lần nhưng tạo việc trùng lặp/sai thời hạn).
  Prompt `INSTRUCTIONS` quy định: owner dạng "Tên (Người nói N)" khi suy ra chắc chắn tên, gộp việc trùng,
  `due` chỉ khi có mốc cụ thể, `decisions` chỉ ghi điều đã chốt. Sửa prompt thì chạy lại test LLM thật:
  `RUN_LLM_TESTS=1 pytest tests/test_summary_agent.py -k live` (tốn phí, mặc định bị skip).
- **Quét tài liệu (OCR)** — `routers/ocr.py`, `services/ocr.py` (Mistral + validate), `services/ocr_processing.py`
  (job nền `BackgroundTasks`, chốt đề xuất), `services/ocr_review_agent.py`, `models/ocr.py`:
  - **Lưu trữ:** nội dung CHỐT nằm ở `segments` như transcript (mỗi segment = 1 trang Markdown, có `page`, không có
    `speaker`/mốc thời gian) → tìm kiếm, tóm tắt, export, chỉnh sửa, gộp dùng lại nguyên hạ tầng. Cột JSONB
    `note_sessions.ocr` (`OcrData`) lưu `raw_pages` (OCR gốc, không ghi đè), `reviewed_pages` (gốc + mọi đề xuất),
    `corrections` (`id`, `page`, `original`, `corrected`, `context`, `status` `pending|accepted|rejected|unavailable`),
    `review_error`, `files` (`OcrSourceFile`: `filename`, `first_page`, `page_count`, `error` — nhiều file được nối theo thứ
    tự tải lên, trang đánh số liên tục cả phiên). `SessionRead.ocr` chỉ trả `model`, `pages_processed`, `files`,
    `corrections`, `review_error`.
  - **Luồng:** OCR → `ocr_review_agent` → lưu, phiên `completed`; `segments` ban đầu = bản OCR gốc — đề xuất chỉ áp
    dụng khi người dùng chấp nhận (thay NGUYÊN TỪ trong đúng trang của nội dung hiện tại; không còn thấy → `unavailable`).
    Router chép file ra thư mục tạm trên đĩa (không giữ cả lô trong RAM); job nền OCR tối đa 3 file song song, xoá thư
    mục tạm khi xong. Một vài file OCR lỗi → vẫn `completed`, ghi `files[].error`; mọi file lỗi / không có chữ →
    `failed`. LLM rà soát lỗi → vẫn `completed`, `review_error` có giá trị, không có đề xuất.
  - **`ocr_review_agent`:** dùng `SUMMARY_MODEL` + `build_model_settings`. LLM CHỈ trả `corrections` (không viết lại
    tài liệu); backend lọc (đúng trang, `original` có thật, `corrected` chỉ ký tự Latin cơ bản, chặn đụng tiếng Việt —
    chữ riêng tiếng Việt / chỉ bỏ dấu) rồi tự ghép `corrected_text`. Tài liệu dài chia phần ~40k ký tự theo trang, tối đa
    4 lần gọi song song. Sửa prompt thì chạy `RUN_LLM_TESTS=1 pytest tests/test_ocr.py -k live`.
  - **Job nền:** chạy trong process backend (Render free 1 instance); phiên `processing` không có job trong process và
    `updated_at` cũ hơn 10 phút → endpoint status đặt `failed` ("bị gián đoạn").
  - Công thức LaTeX trong kết quả OCR render bằng KaTeX ở `OcrDocumentView` (`remark-math` chạy TRƯỚC plugin tô đề xuất);
    `ocr_review_agent` bỏ qua mọi chỗ nằm trong `$...$`/`$$...$$`/`\[...\]`/`\(...\)` ở cả bước lọc lẫn bước áp dụng.
  - Tóm tắt phiên OCR: prompt báo nội dung là văn bản OCR (không đổi `INSTRUCTIONS`). Export: tiêu đề "Nội dung tài
    liệu", nhãn "Trang N" khi nhiều trang; .docx chuyển Markdown cơ bản (`services/markdown_docx.py`).
- **Ghi chú Cornell** (`models/note.py`, `services/notes.py`, `routers/notes.py`, `routers/note_folders.py`,
  `routers/tags.py`; quyết định 2026-09-18 — lộ trình và các quyết định đã chốt ở `PROGRESS.md`): note là đối tượng ĐỘC LẬP (không liên kết `NoteSession`, không "tạo note từ phiên").
  - Bảng `notes`, `note_folders` (cây, `parent_id`), `note_tags`, `note_tag_links` (nhiều-nhiều), `note_links` (liên kết
    `[[...]]` giữa các note, GĐ3) — không FK ở DB, router tự dọn liên kết. `NoteFolder` riêng, KHÔNG dùng lại `SessionGroup`.
  - Nội dung lưu 2 dạng: `content_json` (Tiptap JSON, để mở lại editor) + `content_md` (Markdown do frontend sinh bằng
    `editor.getMarkdown()`) — backend chỉ đọc Markdown (tìm kiếm, sau này export/AI/backlink). `search_text` = chữ thường
    của tiêu đề + câu hỏi + Markdown + tóm tắt, cập nhật mỗi lần lưu.
  - `cues` (cột trái) = `[{id, text, anchor}]`; `anchor` = id khối nội dung (thuộc tính `data-id` do Tiptap UniqueID sinh)
    → bấm câu hỏi cuộn tới đoạn đó; chế độ "Ôn tập" che nội dung + tóm tắt, "Xem đáp án" hiện chữ của đoạn được neo.
  - `summary` = tóm tắt người học TỰ viết (tóm tắt AI sẽ là cột riêng). `style` = `{theme, font, font_size}` chỉ nhận giá
    trị có sẵn (`NoteTheme`/`NoteFont`/`NoteFontSize` ↔ `client/src/lib/noteStyles.js`), áp riêng cho từng note.
  - Không đồng bộ nhiều thiết bị, không kiểm tra phiên bản (last-write-wins, người dùng chấp nhận rủi ro ghi đè).
  - **Ảnh** (`services/storage.py` REST `httpx` + `services/note_media.py` + `routers/note_media.py`, bảng `note_assets`):
    bucket PRIVATE `note-assets` (tự tạo ở lần tải đầu), object `notes/<note_id>/<asset_id>.<ext>`. Nội dung note chỉ lưu
    `/api/note-images/<id>` (frontend ghép `VITE_API_BASE_URL` khi hiển thị — `lib/noteImages.js::NoteImage`); xoá note →
    xoá ảnh. Khoá `sb_secret_...` gửi header `apikey`, khoá JWT cũ gửi thêm `Authorization`.
    **Dọn ảnh không còn dùng** (`services/note_media.py`, cột `note_assets.orphaned_at`): mỗi lần lưu `content_md`, ảnh của
    note không còn trong nội dung được đánh dấu chờ xoá, ảnh xuất hiện lại (Hoàn tác / dán từ note khác) được bỏ đánh dấu;
    quá `ORPHAN_GRACE` (10 phút — để Ctrl+Z còn khôi phục được) thì xoá thật file + dòng ở lần lưu nội dung / xoá note kế
    tiếp (không có job nền). Ảnh mới tải lên cũng bắt đầu ở trạng thái chờ (tải mà không chèn → tự dọn). Ảnh còn nằm trong
    nội dung note khác (tìm qua `search_text`) thì KHÔNG xoá mà chuyển sang note đó. Storage lỗi → giữ dòng, thử lại lần sau.
  - **Công thức:** node `inlineMath`/`blockMath` (KaTeX), Markdown `$...$` / `$$` trên dòng riêng; gõ tắt `$$x$$` (trong dòng),
    `$$$x$$$` (khối); bấm vào công thức mở `MathDialog` (sửa / đổi kiểu / xoá). Bảng ký hiệu `MathPalette` lấy dữ liệu từ
    `lib/mathSnippets.js` (7 nhóm, 272 mục: cơ bản, Hy Lạp, giải tích, tập hợp·logic, mũi tên, ma trận·hệ, mẫu công thức);
    quy ước `{}` = ô cần điền (con trỏ vào `{}` đầu tiên, nút vẽ thành □). Thêm mục mới phải render được bằng KaTeX ở chế
    độ `strict: 'error'` (chữ tiếng Việt trong công thức bọc `	ext{}`). **Vẽ công thức** (`DrawFormulaDialog`,
    canvas + Pointer Events, bỏ chạm tay khi đã dùng bút) → cắt sát nét + lề 24px → `/api/notes/formula-ocr` →
    `services/ocr.py::normalize_formula` (bỏ `$$`/`\[ \]`/`\( \)`/`$`; `$5` là tiền, không phải công thức; nhiều khối
    → `gathered` + `multiple=true`) → mở `MathDialog` để xem trước + sửa, KHÔNG chèn thẳng.
  - **Liên kết giữa các ghi chú (GĐ3)** (`models/note.py::NoteLink`, `services/note_links.py`, `lib/noteLink.js`): gõ `[[` trong
    nội dung mở menu chọn ghi chú (`NoteLinkMenu`, tìm qua `GET /api/notes?q=`); gõ tên chưa có → "Tạo ghi chú mới" rồi chèn luôn.
    Node Tiptap `noteLink` (inline, atom) lưu `id` + `title`, Markdown xuất ra **`[[Tiêu đề]](/notes/<id>)`** — liên kết theo ID nên
    đổi tên note đích không gãy. Mỗi lần lưu `content_md`, backend tính lại bảng `note_links` (bỏ tự trỏ và note đã xoá); xoá note
    thì xoá cả liên kết hai chiều. Panel liên kết (`NoteLinksPanel`) nằm dưới cột câu hỏi.
  - **Tóm tắt AI (GĐ3)** (`services/note_summary_agent.py`, `components/notes/NoteAiPanel.jsx`): cột JSONB riêng `notes.ai_summary`
    (không bao giờ ghi đè `summary` người học tự viết), gồm tóm tắt / ý chính / khái niệm / câu hỏi ôn tập. `ai_summary_outdated`
    KHÔNG phải cột: tính bằng cách so `source_hash` (sha1 rút gọn của `content_md` lúc tạo) với nội dung hiện tại. Chỉ chạy khi
    người dùng bấm. Dải tóm tắt có 2 tab "Của bạn" / "AI" (thanh tab đứng yên, nội dung tự cuộn; tab AI cao tối đa 45% khung);
    câu hỏi ôn tập có nút thêm thẳng vào cột câu hỏi Cornell.
  - **Soát lỗi chính tả (GĐ3)** (`services/note_proofread_agent.py`, `components/notes/ProofreadDialog.jsx`,
    `lib/noteProofread.js`): theo mẫu `ocr_review_agent` (LLM chỉ trả danh sách chỗ sửa) nhưng soát CẢ tiếng Việt lẫn tiếng Anh
    (quyết định người dùng 2026-09-21). Backend lọc: `original` phải có thật ngoài vùng code/công thức/URL (đếm `occurrences`),
    `corrected` không chứa ký tự cấu trúc Markdown/LaTeX, bỏ trùng, tối đa 200 mục; chia phần ~20k ký tự, tối đa 4 lần gọi song song.
    Backend KHÔNG sửa nội dung — frontend thay chữ trong editor (1 transaction, Ctrl+Z hoàn tác được) sau khi người dùng duyệt,
    bỏ qua khối code / code trong dòng / công thức.
  - **Bảng** (`TableKit`, `resizable: true`, `cellMinWidth: 96` → bảng bọc `.tableWrapper` cuộn ngang, không bị ép hẹp
    trên điện thoại); thanh "Bảng:" hiện khi con trỏ ở trong bảng.
  - **Dán / kéo thả:** dán HTML giữ định dạng (Tiptap); file ảnh dán / thả / chọn → nén ở trình duyệt
    (`lib/imageCompress.js`: ≤ 2000px, WebP) → tải lên với ô chờ là decoration (không bao giờ lưu URL tạm); thả ảnh giữa
    dòng chữ thì đặt ở ranh giới khối (không cắt đôi từ), dán thì chèn đúng con trỏ.
- **Sửa transcript:** export/summarize luôn đọc `segments` hiện tại trong DB (bản đã sửa). Tóm tắt lại
  sẽ đặt `summary_outdated=false`; không bao giờ tự động gọi LLM sau khi sửa.
- **Migration:** chưa có Alembic. `db.init_db()` gọi `create_all` → `_add_missing_columns()` (tự
  `ALTER TABLE ADD COLUMN` cho cột mới, luôn nullable) → `_enable_row_level_security()`. Chỉ hỗ trợ THÊM
  cột — đổi kiểu/xoá cột phải migrate tay (SQL Editor của Supabase). Khi thêm cột mới vào model, đặt
  nullable hoặc có default.
- **Test:** `server/tests` (pytest, dev dependency trong `requirements-dev.txt` / `[dependency-groups]`)
  chạy trên **cùng DB Supabase với production** (`TEST_DATABASE_URL` nếu có, không thì `DATABASE_URL` trong `.env`)
  nhưng **chỉ trong schema riêng `notewave_test`**: conftest thay `db.engine` bằng engine có
  `schema_translate_map={None: "notewave_test"}` (tên schema ghi rõ trong mọi câu lệnh — không dùng `search_path`
  vì Transaction pooler không giữ). TRUNCATE sau mỗi test chỉ trên schema test (có assert chặn). SQL thô trong app
  dùng `db._qualified()`, trong test dùng `tests.helpers.qualified()` — **tuyệt đối không viết SQL thô không kèm
  schema trong test** (sẽ đụng `public` = dữ liệu thật). Soniox giả lập bằng `httpx.MockTransport`
  (`tests/soniox_fake.py`), Mistral OCR bằng `tests/mistral_fake.py`, LLM giả lập bằng monkeypatch / `FunctionModel`
  — test không gọi API thật. Thêm endpoint mới thì
  thêm test tương ứng.

## 5. Biến môi trường (giữ file `.env.example` luôn cập nhật khi thêm biến mới)

Backend (`/.env` ở gốc repo hoặc `server/.env`; trên Render khai báo trong Dashboard / `render.yaml`):
```
SONIOX_API_KEY=
SONIOX_ASYNC_MODEL=      # mặc định stt-async-v5
DATABASE_URL=            # BẮT BUỘC, connection string Transaction pooler của Supabase — local dùng chung với production
TEST_DATABASE_URL=       # tuỳ chọn, chỉ cho pytest; trống = DATABASE_URL (test chỉ dùng schema notewave_test)
ALLOWED_ORIGINS=         # comma-separated, danh sách domain frontend được phép gọi API
SUMMARY_MODEL=           # provider:model, mặc định openai:gpt-5.6-luna
SUMMARY_REASONING_EFFORT= # tuỳ chọn, chỉ model OpenAI: none|low|medium|high; trống = mặc định của model
OPENAI_API_KEY=          # (hoặc ANTHROPIC_API_KEY / GEMINI_API_KEY tuỳ SUMMARY_MODEL)
MISTRAL_API_KEY=         # Mistral OCR cho "Quét tài liệu"; trống -> POST /api/ocr-extract trả 503
OCR_MODEL=               # mặc định mistral-ocr-latest
PUBLIC_BASE_URL=         # URL public của backend; có giá trị -> đăng ký webhook Soniox
SONIOX_WEBHOOK_SECRET=   # Soniox gửi "Authorization: Bearer <secret>" khi gọi webhook
MAX_UPLOAD_MB=           # mặc định 100 (file ghi âm; file OCR cố định theo giới hạn Mistral: 50MB / 1000 trang)
SUPABASE_SECRET_KEY=     # Supabase Storage cho ảnh trong Ghi chú (sb_secret_... / service_role) — CHỈ backend; trống -> tắt chèn ảnh
SUPABASE_URL=            # tuỳ chọn, trống = suy ra https://<ref>.supabase.co từ user "postgres.<ref>" trong DATABASE_URL
NOTE_ASSETS_BUCKET=      # mặc định note-assets (private, backend tự tạo)
NOTE_IMAGE_MAX_MB=       # mặc định 10 (mỗi ảnh, sau khi trình duyệt nén)
```
Frontend (`client/.env`, trên Vercel khai báo trong Project Settings):
```
VITE_API_BASE_URL=       # để trống khi dev (Vite proxy /api -> localhost:8000)
VITE_SONIOX_RT_MODEL=    # mặc định stt-rt-v5
VITE_MAX_UPLOAD_MB=      # mặc định 100
```
Cách lấy `DATABASE_URL` (local và Render dùng cùng giá trị):
- Supabase Dashboard → nút **Connect** (hoặc Project Settings → Database → Connection string) →
  **Transaction pooler** (host `aws-0-<region>.pooler.supabase.com`, cổng 6543), thay mật khẩu, thêm `?sslmode=require`:
  `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require`.
  Local dán vào `.env` (không commit); Render khai báo trong Environment.
  Không dùng Direct connection (`db.<ref>.supabase.co:5432`) — chỉ có IPv6, Render không hỗ trợ.

Lưu ý: pydantic-settings không tự đưa giá trị file `.env` vào `os.environ`, nên
`config.export_llm_provider_keys()` chép các API key LLM sang để PydanticAI đọc được.

## 6. Quy ước code

- Backend: tách rõ `routers/`, `models/`, `services/`. Mọi model dữ liệu định nghĩa bằng
  Pydantic/SQLModel, không dùng `dict` trần cho response.
- Đặt tên session field `source` chỉ nhận 3 giá trị: `"live"` | `"upload"` | `"ocr"` (thêm `"ocr"` ngày 2026-09-15 cho
  luồng Quét tài liệu) — dùng để frontend gắn nhãn/icon/màu phân biệt (`lib/format.js::SOURCE_LABELS`,
  `lib/sources.js::SOURCE_META`). Phiên gộp vẫn dùng 1 trong các giá trị này (theo phiên đầu);
  nhận biết phiên gộp qua `merge_sources` (UI hiện nhãn "Gộp từ N phiên").
- Toàn app được bọc `components/ErrorBoundary.jsx` (trong `main.jsx`): lỗi JS của một component sẽ hiện thông báo
  + nút "Tải lại trang" thay vì trang trắng. Cleanup trong `useEffect` không được ném lỗi ra ngoài.
- Frontend Ghi chú (`pages/NotesPage.jsx`, `components/notes/*`, lazy trong `App.jsx`): kho thư mục + tag dùng chung
  `hooks/useNoteLibrary.js` (`useNoteLibrary()` + `noteLibraryActions`, cùng mẫu `useGroups`). Tự lưu qua
  `hooks/useNoteAutosave.js`: debounce 1,2 s (tối đa 8 s khi gõ liên tục), tag/thư mục/giao diện lưu ngay, PATCH chỉ field
  đã đổi; nháp localStorage `notewave:note-draft:<id>` ghi trước mỗi lần gửi và chỉ xoá khi máy chủ nhận xong → lỗi mạng /
  Render đang dậy thì giữ nháp + tự thử lại, mở lại note thì áp nháp nếu mới hơn `updated_at`. Tiện ích editor ở
  `lib/noteEditor.js`. **Bẫy đã gặp:** (1) ProseMirror tự khôi phục mọi thuộc tính DOM bị sửa từ ngoài → hiệu ứng trên
  node của editor phải dùng `el.animate()` hoặc CSS theo `[data-id]`, không `classList.add`; (2) textarea mount khi tab còn
  ẩn đo `scrollHeight = 0` → dùng `components/notes/useAutoGrow.js` (ResizeObserver); (3) UniqueID KHÔNG sửa id trùng khi
  tách một khối (vd. Enter 2 lần giữa danh sách → 2 nửa cùng id) → `lib/blockIdGuard.js` dọn id trùng. Thứ tự extension
  bắt buộc: `UniqueID` → `BlockIdGuard` → `OrderedListContinuation` (`lib/orderedListContinuation.js`: danh sách số mới /
  nửa sau khi tách tự đánh số tiếp theo danh sách số phía trên, dừng ở tiêu đề; gõ "N. " giữ số N; nút thanh công cụ
  "Đánh số lại từ 1" / "Đánh số tiếp"); (4) ProseMirror chèn `img.ProseMirror-separator` sau node inline (vd. công thức
  trong dòng) → CSS/selector cho ảnh phải dùng `img:not(.ProseMirror-separator)`; (5) `Extension.configure()` của Tiptap
  **deep-clone** options → truyền object rồi gán thêm hàm sau khi cấu hình thì plugin KHÔNG thấy (mất phím của menu `[[`);
  phải truyền các HÀM cố định (hàm được sao theo tham chiếu) rồi mới trỏ tới state mới nhất; (6) plugin cần chặn Enter/↑↓
  trước keymap của StarterKit phải đặt `priority` cao hơn (menu `[[` dùng `priority: 1000`).
- Hộp thoại có vùng nội dung dài (vd. `MathDialog`) dùng `Modal flexBody`: thân là cột flex, phần dài (bảng ký hiệu) đặt
  `min-h-0` + tự cuộn bên trong -> hộp thoại luôn vừa màn hình, KHÔNG cuộn cả thân (người dùng yêu cầu 2026-09-19).
- Frontend: state nhóm dùng chung qua `client/src/hooks/useGroups.js` (`useGroups()` + `groupActions`)
  — tạo/đổi tên/xoá/gán nhóm luôn đi qua đây để mọi màn hình cập nhật đồng bộ. Hộp thoại dùng
  `components/Modal.jsx`; xác nhận xoá dùng `components/ConfirmDialog.jsx`.
- Chọn file (nhiều file, kéo thả, ảnh thu nhỏ, sắp xếp thứ tự, chụp ảnh, XEM TRƯỚC) dùng chung
  `components/FilePicker.jsx` — bật preview bằng prop `preview` (hiện chỉ "Quét tài liệu": ảnh/PDF; file ghi âm
  không cần). Preview mở trong `components/FilePreviewDialog.jsx` (Modal `size="xl"` + `fill`: panel cao cố định
  `92svh` để phần trăm chiều cao bên trong phân giải được).
  - **Ảnh:** dùng lại object URL của thumbnail, `max-h-full max-w-full object-contain` → vừa khung, KHÔNG cuộn.
  - **PDF** (`components/PdfPreview.jsx`, chunk lazy): cuộn qua tất cả các trang như trình đọc PDF — mỗi trang chỉ
    được vẽ khi tới gần tầm nhìn (IntersectionObserver, `rootMargin` 600px) và canvas bị giải phóng khi cuộn ra xa,
    nên PDF dài không phình bộ nhớ; có chỉ báo "Trang x / N", nút chuyển trang và 2 chế độ: "vừa cả trang" (mặc
    định) / "vừa chiều ngang" (chữ to hơn, cuộn trong từng trang).
  - Chọn pdf.js thay vì nhúng `<iframe>` để giao diện giống nhau trên mọi trình duyệt (Safari iOS không nhúng PDF
    inline). Hai cái bẫy của pdf.js v6 đã gặp: (1) worker phải tạo bằng
    `new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' })` — đặt
    `GlobalWorkerOptions.workerSrc` bằng URL sẽ tạo classic worker và lỗi với bản dist ES module; (2) chỉ
    `PDFDocumentLoadingTask` mới có `destroy()` (v6 đã bỏ `PDFDocumentProxy.destroy()`) — gọi nhầm sẽ ném lỗi
    trong cleanup của effect và làm React gỡ sạch cây component (trang trắng).
  "Quét tài liệu" (`pages/ScanPage.jsx`) = `components/FileIngestPage.jsx`: nhiều file → 1 request → 1 phiên.
  "Tải file lên" (`pages/UploadPage.jsx`) = hàng đợi: mỗi file 1 request / 1 phiên, tối đa 2 file tải song song, mỗi
  dòng tự poll trạng thái; phiên đã tạo lưu localStorage `notewave:active-uploads` để khôi phục sau khi tải lại trang.
  Phiên OCR hiển thị bằng `OcrDocumentView`, duyệt đề xuất sửa bằng `OcrCorrectionsDialog`.
- Layout: khung nội dung `max-w-[96rem]`; trang chi tiết phiên cho transcript chiếm phần lớn chiều
  ngang, tóm tắt AI là sidebar 20rem từ breakpoint `xl`, dưới `xl` tóm tắt nằm dưới transcript.
  Dưới `xl`, mỗi khối (Transcript / Nội dung tài liệu và Tóm tắt bằng AI) có nút thu gọn `ui.jsx::CollapseToggle`
  (state cục bộ của `SessionDetail`, mặc định nội dung mở + tóm tắt đóng; nút "Xem tóm tắt" trên toolbar tự mở
  khối tóm tắt rồi cuộn tới). Từ `xl` nút thu gọn bị ẩn và hai khối luôn mở.
  Form (ghi âm, tải lên) giới hạn `max-w-3xl`, danh sách Lịch sử `max-w-4xl`.
  Trang chi tiết Ghi chú: khung ghi chú CỐ ĐỊNH theo viewport ở MỌI kích thước (người dùng yêu cầu 2026-09-18 — trang ngoài
  không có thanh cuộn): `useViewportFit({ mobile: true, minHeight: 220 })` (trừ thêm padding dành cho bottom nav, tính theo
  `visualViewport` khi bàn phím ảo mở); thanh công cụ editor đứng yên, cột câu hỏi / nội dung / dải tóm tắt (từ `lg`, tối
  đa 30% khung) mỗi vùng tự cuộn; dưới `lg` tab đang chọn chiếm cả khung.
- Khi thêm agent PydanticAI mới, model provider luôn cấu hình qua biến môi trường
  (dạng chuỗi kiểu `provider:model-name`, ví dụ `anthropic:claude-sonnet-4-6`), không
  hard-code provider trong code.
- Ưu tiên tiếng Việt trong UI text và comment hướng người dùng cuối; code/biến/tên hàm
  vẫn viết bằng tiếng Anh theo chuẩn thông thường.

## 7. Deploy (free tier) — hướng dẫn từng bước ở `DEPLOY.md`

- Frontend → Vercel (Root Directory `client`). Backend → Render Free Web Service (Blueprint
  `render.yaml` ở gốc repo). Database production → Supabase Postgres (project hosted, free tier),
  `DATABASE_URL` = connection string Transaction pooler. Supabase free tạm dừng project sau ~1 tuần không
  hoạt động — Restore trong Dashboard nếu backend báo lỗi kết nối DB.
- Region: Render `singapore` (khai báo trong `render.yaml`) và Supabase project cũng chọn Singapore để giảm
  độ trễ backend ↔ DB. Thứ tự deploy: Supabase → GitHub → Render → Vercel → cập nhật `ALLOWED_ORIGINS`.
- Khi thay đổi cách deploy (biến môi trường mới, dịch vụ mới, bước cấu hình mới) phải cập nhật `DEPLOY.md`
  (các bước + bảng xử lý sự cố) cùng với `.env.example` và `render.yaml`.
- Webhook Soniox chỉ hoạt động khi backend có domain public (sau khi deploy lên Render);
  lúc dev local, dùng polling thay vì webhook.

## 8. Khi không chắc, hãy hỏi trước khi tự quyết định

- Nếu cần thêm thư viện mới ngoài stack đã liệt kê ở mục 2, hỏi tôi trước.
- Nếu phát hiện xung đột giữa yêu cầu mới và các quy tắc ở file này, ưu tiên hỏi lại
  thay vì tự suy diễn.

## 9. Sau mỗi phiên làm việc — LUÔN cập nhật lại ngữ cảnh

Trước khi kết thúc phiên (hoặc khi hoàn thành một phần việc rõ ràng), thực hiện:

1. **Cập nhật `PROGRESS.md`** (tạo file này ở gốc repo nếu chưa có) theo mẫu:
   ```
   ## [Ngày] — [Tóm tắt ngắn việc đã làm]
   - Đã làm: ...
   - File/module đã thay đổi: ...
   - Đang dang dở / chưa xong: ...
   - Việc cần làm tiếp theo: ...
   - Vấn đề đã biết (nếu có): ...
   ```
   Ghi thêm vào cuối file (append), không ghi đè lịch sử cũ, để giữ nhật ký theo thời gian.

2. **Cập nhật `CLAUDE.md` (file này)** nếu trong phiên có phát sinh thay đổi mang tính
   lâu dài, ví dụ: thêm endpoint mới, đổi convention, thêm biến môi trường mới, đổi
   quyết định kiến trúc. Không cần cập nhật nếu chỉ sửa bug nhỏ hoặc thay đổi không ảnh
   hưởng tới ngữ cảnh tổng thể.

3. Nếu vừa hoàn thành xong một giai đoạn lớn (theo mục "Tính năng theo giai đoạn" trong
   file mô tả dự án chính), đánh dấu rõ trong `PROGRESS.md` giai đoạn nào đã xong, giai
   đoạn nào đang làm.

**Mục đích:** để phiên làm việc tiếp theo (dù là tôi tự mở lại, hay một AI agent khác)
chỉ cần đọc `CLAUDE.md` + `PROGRESS.md` là nắm được toàn bộ bối cảnh, không phải hỏi lại
từ đầu hoặc đoán mò trạng thái hiện tại của code.
