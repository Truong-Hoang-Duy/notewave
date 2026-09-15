# NoteWave — Ngữ cảnh dự án

> File này giúp Claude Code (và các AI coding agent khác) hiểu nhanh bối cảnh dự án
> mà không cần giải thích lại từ đầu mỗi phiên làm việc. Đặt file này ở thư mục gốc
> repo. Dùng nguyên bản này cho cả `CLAUDE.md` (Claude Code) và `GEMINI.md` (Gemini CLI) —
> hai công cụ đều tự động đọc file cùng tên đặt ở root khi khởi động.

## 1. Dự án là gì

**NoteWave** là ứng dụng web ghi chú/phụ đề cuộc họp bằng giọng nói, gồm 2 luồng nhập liệu:
1. **Ghi âm trực tiếp** — nói vào micro, transcript hiện real-time (phụ đề trực tiếp).
2. **Tải file ghi âm lên** — upload file audio có sẵn (.mp3, .wav, .m4a...), nhận lại transcript đầy đủ.

Cả 2 luồng đều hỗ trợ phân biệt người nói (speaker diarization), lưu lịch sử phiên,
tóm tắt bằng AI, và xuất file .txt/.docx.

## 2. Stack kỹ thuật (đừng đề xuất đổi sang stack khác trừ khi tôi yêu cầu)

- **Frontend:** React 19 + Vite, Tailwind CSS v4 (`@tailwindcss/vite`, token màu/font khai báo
  trong `@theme` ở `client/src/index.css`). Thư mục `/client`. Thư viện phụ đã được duyệt:
  `@soniox/client` (SDK chính thức — ghi âm micro + WebSocket real-time), `lucide-react` (icon).
  Điều hướng dùng hash router tự viết (`#/live`, `#/upload`, `#/history/<id>`), không dùng react-router.
- **Backend:** Python, FastAPI (web server) + PydanticAI (agent tóm tắt bằng LLM). Thư mục `/server`.
- **Database:** **Supabase Postgres cho cả 2 môi trường** (quyết định 2026-09-15, thay SQLite local +
  Neon production), truy cập qua SQLModel/SQLAlchemy. Hai môi trường chỉ khác `DATABASE_URL`:
  - Local: Supabase local stack chạy bằng Supabase CLI + Docker (`npx supabase start`, cấu hình ở
    `supabase/config.toml`, Postgres ở cổng 54322). Supabase CLI là devDependency npm ở `package.json` gốc.
  - **Dev hằng ngày chỉ cần bật Docker Desktop rồi `npm run dev`** (hoặc `dev.bat`, Ctrl+Shift+B trong VS Code):
    `run-dev.js` tự cài deps còn thiếu, tạo `.env` nếu chưa có, chờ Docker, bật Supabase local nếu chưa chạy,
    rồi chạy backend + frontend. Ctrl+C không tắt Supabase (tắt hẳn: `npm run db:stop`). Khi thêm bước
    setup mới cho môi trường dev, đưa vào `run-dev.js` thay vì bắt người dùng chạy tay.
  - Production: Supabase project hosted, kết nối qua **Transaction pooler** (cổng 6543).
  - Chỉ hỗ trợ Postgres: `app/db.py` từ chối URL không phải Postgres, không còn nhánh code SQLite.
    Driver `psycopg[binary]` (v3); tự đổi `postgres://`/`postgresql://` → `postgresql+psycopg://`;
    `prepare_threshold=None` để chạy được qua pooler.
  - Kiểu cột dùng tính năng Postgres: `JSONB` cho `segments`/`summary`/`merge_sources`,
    `timestamptz` cho mọi cột thời gian (`models/common.py::tz_column`).
  - Stack Supabase local bật đầy đủ (Auth, Storage, Realtime, Studio...) để sẵn cho sau này, nhưng
    **hiện chỉ dùng phần Postgres**; chưa tích hợp Supabase Auth/Storage/SDK vào code.
  - Bảng tạo bằng `SQLModel.metadata.create_all` lúc khởi động (không dùng migrations/seed của Supabase CLI,
    `[db.seed]` đã tắt).
- **Speech-to-Text:** Soniox API.
  - Ghi âm trực tiếp → **Real-time WebSocket API** (`wss://api.soniox.com/transcribe-websocket`),
    kết nối thẳng từ trình duyệt bằng **Temporary API Key** lấy từ backend.
  - Tải file lên → **Async API** (REST): `POST /v1/files` upload → `POST /v1/transcriptions`
    tạo job → lấy kết quả qua polling hoặc webhook. Luôn thực hiện từ backend, dùng thẳng
    `SONIOX_API_KEY` (không expose ra client).

## 3. Quy tắc bảo mật quan trọng — LUÔN tuân thủ

- **Không bao giờ** trả `SONIOX_API_KEY` (key chính) về client. Client chỉ nhận Temporary
  API Key qua endpoint `POST /api/temporary-key`.
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
| `/api/sessions` | POST/GET | Tạo/liệt kê phiên ghi chú (field `source`: `"live"` hoặc `"upload"`) |
| `/api/sessions/{id}` | GET/PATCH/DELETE | Xem/đổi tên (`{"title"}`)/xoá 1 phiên |
| `/api/sessions/{id}/summarize` | POST | Gọi PydanticAI `summary_agent`, trả `MeetingSummary` |
| `/api/sessions/{id}/export` | GET | Xuất `.txt` hoặc `.docx` (query `?format=`) |
| `/api/upload-transcribe` | POST | Nhận file audio, gọi Soniox Async API, tạo session `processing` |
| `/api/upload-transcribe/{id}/status` | GET | Poll trạng thái xử lý file (dùng khi chưa có webhook) |
| `/api/webhooks/soniox` | POST | Nhận callback từ Soniox khi transcription xong |
| `/api/sessions/{id}/segments` | PUT | Lưu transcript đã chỉnh sửa (`{"segments": [...]}`, thay toàn bộ); nếu đã có tóm tắt thì đặt `summary_outdated=true` |
| `/api/sessions/{id}/restore` | POST | Khôi phục phiên đã lưu trữ (archived) sau khi gộp |
| `/api/sessions/merge` | POST | Gộp phiên: `{"session_ids" (đúng thứ tự nối, ≥2), "title"?, "group_id"?, "delete_originals"}` → tạo phiên mới |
| `/api/sessions/assign-group` | POST | Gán/gỡ nhiều phiên vào nhóm: `{"session_ids": [...], "group_id": "<id>" \| null}` |
| `/api/groups` | GET/POST | Liệt kê nhóm (kèm `session_count`, không tính phiên archived) / tạo nhóm `{"name"}` (tên không trùng, không phân biệt hoa thường) |
| `/api/groups/{id}` | PATCH/DELETE | Đổi tên nhóm / xoá nhóm (phiên trong nhóm chuyển về "chưa phân nhóm", không bị xoá) |
| `/api/health` | GET | Health check (Render) + frontend gọi khi mở app để "đánh thức" backend |

Ghi chú:
- `GET /api/sessions` hỗ trợ `?q=` (tìm theo tiêu đề/nội dung), `?source=live|upload`,
  `?group_id=<id>|none` (`none` = chưa phân nhóm), `?archived=true` (chỉ phiên đã lưu trữ; mặc định
  loại trừ), `limit`, `offset`. Session có `status`: `processing` | `completed` | `failed`.
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
- **Sửa transcript:** export/summarize luôn đọc `segments` hiện tại trong DB (bản đã sửa). Tóm tắt lại
  sẽ đặt `summary_outdated=false`; không bao giờ tự động gọi LLM sau khi sửa.
- **Migration:** chưa có Alembic. `db.init_db()` gọi `create_all` → `_add_missing_columns()` (tự
  `ALTER TABLE ADD COLUMN` cho cột mới, luôn nullable) → `_enable_row_level_security()`. Chỉ hỗ trợ THÊM
  cột — đổi kiểu/xoá cột phải migrate tay (SQL Editor của Supabase). Khi thêm cột mới vào model, đặt
  nullable hoặc có default.
- **Test:** `server/tests` (pytest, dev dependency trong `requirements-dev.txt` / `[dependency-groups]`)
  chạy trên Postgres của Supabase local, database riêng `notewave_test` (tự tạo; TRUNCATE sau mỗi test;
  đổi bằng `TEST_DATABASE_URL`, tên DB bắt buộc chứa "test"). Soniox giả lập bằng `httpx.MockTransport`
  (`tests/soniox_fake.py`), LLM giả lập bằng monkeypatch — test không gọi API thật. Thêm endpoint mới thì
  thêm test tương ứng.

## 5. Biến môi trường (giữ file `.env.example` luôn cập nhật khi thêm biến mới)

Backend (`/.env` ở gốc repo hoặc `server/.env`; trên Render khai báo trong Dashboard / `render.yaml`):
```
SONIOX_API_KEY=
SONIOX_ASYNC_MODEL=      # mặc định stt-async-v5
DATABASE_URL=            # BẮT BUỘC, luôn là Postgres của Supabase (xem cách lấy bên dưới)
ALLOWED_ORIGINS=         # comma-separated, danh sách domain frontend được phép gọi API
SUMMARY_MODEL=           # provider:model, mặc định openai:gpt-5.4-mini
OPENAI_API_KEY=          # (hoặc ANTHROPIC_API_KEY / GEMINI_API_KEY tuỳ SUMMARY_MODEL)
PUBLIC_BASE_URL=         # URL public của backend; có giá trị -> đăng ký webhook Soniox
SONIOX_WEBHOOK_SECRET=   # Soniox gửi "Authorization: Bearer <secret>" khi gọi webhook
MAX_UPLOAD_MB=           # mặc định 100
```
Frontend (`client/.env`, trên Vercel khai báo trong Project Settings):
```
VITE_API_BASE_URL=       # để trống khi dev (Vite proxy /api -> localhost:8000)
VITE_SONIOX_RT_MODEL=    # mặc định stt-rt-v5
VITE_MAX_UPLOAD_MB=      # mặc định 100
```
Cách lấy `DATABASE_URL`:
- **Local:** chạy `npx supabase start` (Docker phải đang chạy), dùng dòng "DB URL" (xem lại bằng
  `npx supabase status`): `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- **Production (Render):** Supabase Dashboard → nút **Connect** (hoặc Project Settings → Database) →
  **Transaction pooler** (host `aws-0-<region>.pooler.supabase.com`, cổng 6543), thêm `?sslmode=require`:
  `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require`.
  Không dùng Direct connection (`db.<ref>.supabase.co:5432`) cho Render — chỉ có IPv6, Render không hỗ trợ.
- **Test:** `TEST_DATABASE_URL` (tuỳ chọn), mặc định `postgresql://postgres:postgres@127.0.0.1:54322/notewave_test`.

Lưu ý: pydantic-settings không tự đưa giá trị file `.env` vào `os.environ`, nên
`config.export_llm_provider_keys()` chép các API key LLM sang để PydanticAI đọc được.

## 6. Quy ước code

- Backend: tách rõ `routers/`, `models/`, `services/`. Mọi model dữ liệu định nghĩa bằng
  Pydantic/SQLModel, không dùng `dict` trần cho response.
- Đặt tên session field `source` chỉ nhận 2 giá trị: `"live"` | `"upload"` — dùng để
  frontend gắn nhãn phân biệt trong trang Lịch sử. Phiên gộp vẫn dùng 1 trong 2 giá trị này;
  nhận biết phiên gộp qua `merge_sources` (UI hiện nhãn "Gộp từ N phiên").
- Frontend: state nhóm dùng chung qua `client/src/hooks/useGroups.js` (`useGroups()` + `groupActions`)
  — tạo/đổi tên/xoá/gán nhóm luôn đi qua đây để mọi màn hình cập nhật đồng bộ. Hộp thoại dùng
  `components/Modal.jsx`; xác nhận xoá dùng `components/ConfirmDialog.jsx`.
- Layout: khung nội dung `max-w-[96rem]`; trang chi tiết phiên cho transcript chiếm phần lớn chiều
  ngang, tóm tắt AI là sidebar 20rem từ breakpoint `xl`, dưới `xl` tóm tắt nằm dưới transcript.
  Form (ghi âm, tải lên) giới hạn `max-w-3xl`, danh sách Lịch sử `max-w-4xl`.
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
