# Nhật Ký Tiến Độ Dự Án NoteWave

## [2026-09-15] — Khởi tạo dự án & Bắt đầu xây dựng nền tảng
- Đã làm:
  - Thiết lập file `.gitignore`, `.env.example`, `.env` tại root.
  - Lập kế hoạch chi tiết toàn bộ các giai đoạn trong `implementation_plan.md`.
  - Khởi tạo kiến trúc `/client` và `/server`.
- File/module đã thay đổi:
  - `.gitignore`
  - `.env.example`
  - `.env`
  - `PROGRESS.md`
- Đang dang dở / chưa xong:
  - Cài đặt dependencies cho Backend (`/server`) và Frontend (`/client`).
  - Triển khai endpoint Temporary Key và kết nối Soniox WebSocket.
- Việc cần làm tiếp theo:
  - Cài đặt server FastAPI + SQLModel + PydanticAI.
  - Cài đặt client Vite React + Tailwind CSS + Lucide React.
  - Xây dựng luồng ghi âm trực tiếp và waveform visualizer.
- Vấn đề đã biết:
  - Cần người dùng cung cấp `SONIOX_API_KEY` vào file `.env` để kết nối live tới máy chủ Soniox.

## [2026-09-15] — Dựng toàn bộ bước 1–8: backend FastAPI, frontend React, chuẩn bị deploy
- Quyết định trong phiên:
  - Provider tóm tắt mặc định: **OpenAI** (`SUMMARY_MODEL=openai:gpt-5.4-mini`).
  - Giữ `@soniox/client` (SDK chính thức) và `lucide-react`; thêm `psycopg[binary]` làm driver Postgres cho Neon.
- Đã làm:
  - Backend (`server/app`): config qua pydantic-settings; SQLModel `NoteSession` (source live/upload,
    status processing/completed/failed, segments JSON, summary JSON); endpoint temporary-key, CRUD
    sessions (+ PATCH đổi tên, tìm kiếm `q`, lọc `source`), summarize (PydanticAI `summary_agent` →
    `MeetingSummary`), export .txt/.docx, upload-transcribe (Soniox Async API) + status polling,
    webhook Soniox (xác thực Bearer secret), health. Dọn file + transcription trên Soniox sau khi xong.
  - Frontend (`client/src`): design system (nền giấy ấm, màu brand xanh lục, font Be Vietnam Pro),
    3 tab Ghi âm trực tiếp / Tải file lên / Lịch sử + trang chi tiết phiên; waveform theo micro thật,
    chấm đỏ nhấp nháy, đồng hồ, tạm dừng/tiếp tục, tự kết nối lại; transcript theo người nói có mốc
    thời gian, tự cuộn; lưu nháp localStorage khi lưu thất bại; upload kéo-thả có tiến trình +
    polling (khôi phục sau khi tải lại trang); lịch sử có tìm kiếm, lọc, skeleton/empty/error state;
    đổi tên, xoá (hộp xác nhận), xuất file, tóm tắt AI; banner "máy chủ đang khởi động" khi request chậm;
    responsive với bottom nav trên mobile.
  - Deploy: `render.yaml` (Render Blueprint), `client/.env.example`, `README.md` hướng dẫn chạy local + deploy.
- File/module đã thay đổi:
  - `server/app/{main,config,db,dependencies}.py`, `server/app/models/{session,summary}.py`,
    `server/app/routers/{temporary_key,sessions,upload,webhooks}.py`,
    `server/app/services/{soniox,transcript,summary_agent,export,upload_processing}.py`,
    `server/pyproject.toml`, `server/requirements.txt`
  - `client/src/{App,main}.jsx`, `client/src/index.css`, `client/src/lib/*`, `client/src/hooks/*`,
    `client/src/components/*`, `client/src/pages/*`, `client/index.html`, `client/vite.config.js`,
    `client/package.json`, `client/public/favicon.svg`
  - `.env.example`, `.env` (thêm biến mới, đổi SUMMARY_MODEL sang OpenAI), `render.yaml`, `README.md`,
    `CLAUDE.md`, `GEMINI.md`
- Đã kiểm thử:
  - Backend bằng TestClient: CRUD, tìm kiếm tiếng Việt có dấu, export txt/docx, validate upload,
    webhook sai secret → 401; luồng upload → polling → webhook → dọn file chạy đúng với Soniox giả lập
    (httpx MockTransport); `summary_agent` với PydanticAI `TestModel`.
  - Frontend: `npm run build` OK, `oxlint` không lỗi (chỉ còn warning `set-state-in-effect`);
    chụp màn hình headless Edge các trang ở desktop và mobile.
- Đang dang dở / chưa xong:
  - **Chưa test với Soniox thật và OpenAI thật** vì `.env` chưa có `SONIOX_API_KEY` / `OPENAI_API_KEY`.
  - Chưa deploy thật lên Render / Neon / Vercel.
- Việc cần làm tiếp theo:
  - Điền key vào `.env`, chạy thử ghi âm trực tiếp (Chrome + Safari iOS) và tải file thật.
  - Deploy theo `README.md`; sau đó đặt `PUBLIC_BASE_URL` để bật webhook.
  - Cân nhắc: Alembic cho migration khi đổi schema; xác thực người dùng (nhiều người dùng — giai đoạn 3);
    dark mode.
- Vấn đề đã biết:
  - Chưa có đăng nhập: ai có URL backend đều gọi được API (kể cả `/api/temporary-key`) — cần auth
    hoặc rate limit trước khi công khai rộng.
  - Bảng tạo bằng `create_all`, chưa có migration: đổi cột sau này phải migrate tay trên Neon.
  - Endpoint upload gửi file sang Soniox ngay trong request; file lớn trên mạng chậm có thể chạm timeout
    của Render (khi đó cân nhắc chuyển sang background task).
  - Headless Edge không chụp được dưới ~500px chiều ngang; layout mobile đã kiểm tra ở 500px.

**Trạng thái giai đoạn:** Code cho Giai đoạn 1–4 đã xong (chờ test với API key thật); phần chuẩn bị deploy (bước 7) đã xong.

## [2026-09-15] — Cấu hình tự động khởi chạy đồng thời FE & BE và tự mở trình duyệt
- Đã làm:
  - Cấu hình `open: true` trong `client/vite.config.js` để Vite tự động mở trình duyệt web khi khởi động client.
  - Tạo `.vscode/tasks.json` hỗ trợ chạy song song Backend (FastAPI) và Frontend (Vite) qua VS Code task (Run Task hoặc `Ctrl+Shift+B`).
  - Tạo `run-dev.js` ở root để điều phối khởi động cả 2 server đồng thời bằng Node.js thuần, bắt tín hiệu dừng (SIGINT) dọn dẹp tiến trình con mượt mà.
  - Thêm script `dev` vào root `package.json` để người dùng có thể chạy `npm run dev` từ thư mục gốc.
  - Tạo file chạy nhanh `dev.bat` và `dev.ps1` tiện dụng cho Windows.
  - Kiểm thử: Backend trả về health check `ok`, endpoint `POST /api/temporary-key` kết nối Soniox API thật thành công và sinh temporary token hợp lệ.
- File/module đã thay đổi:
  - `client/vite.config.js`
  - `.vscode/tasks.json`
  - `run-dev.js`
  - `package.json`
  - `dev.bat`, `dev.ps1`
  - `PROGRESS.md`
- Việc cần làm tiếp theo:
  - Trải nghiệm thử ghi âm trực tiếp qua mic và tải file audio trên giao diện web.


## [2026-09-15] — Transcript full chiều ngang, nhóm tài liệu, gộp phiên, chỉnh sửa transcript
- Quyết định trong phiên (đã hỏi người dùng):
  - Gộp phiên: người dùng chọn khi gộp — mặc định **lưu trữ (archive) bản gốc** (khôi phục được), hoặc xoá vĩnh viễn.
  - Thứ tự gộp: mặc định theo ngày tạo, cho sắp xếp lại (lên/xuống) trong hộp thoại; mốc thời gian cộng dồn.
  - `source` giữ 2 giá trị `live`/`upload` (phiên gộp lấy source của phiên đầu); thêm `merge_sources` để nhận biết.
- Đã làm:
  1. **Layout transcript rộng:** khung nội dung 96rem; trang chi tiết: transcript chiếm phần lớn chiều
     ngang, sidebar tóm tắt 20rem từ `xl`; dưới `xl` tóm tắt nằm dưới transcript + nút "Xem tóm tắt"
     cuộn tới. Áp dụng chung cho phiên `live` và `upload` (kể cả màn "Tải file lên" khi xử lý xong).
  2. **Nhóm tài liệu + gộp phiên:**
     - Backend: model `SessionGroup`; cột mới trên `note_sessions`: `group_id`, `merge_sources`,
       `archived_at`, `merged_into_id`, `summary_outdated`; router `groups.py` (CRUD nhóm);
       `POST /api/sessions/assign-group`, `POST /api/sessions/merge`, `POST /api/sessions/{id}/restore`;
       `GET /api/sessions` thêm `group_id` (`none`) và `archived`; service `merge.py`.
     - Frontend: trang Lịch sử có checkbox chọn nhiều + "chọn tất cả", thanh thao tác nổi (Gán nhóm /
       Gộp / Bỏ chọn), bộ lọc nhóm cạnh bộ lọc nguồn, chế độ "Đã lưu trữ" có nút Khôi phục, hộp thoại
       "Quản lý nhóm" (tạo/đổi tên/xoá) và hộp thoại "Gộp phiên" (sắp xếp thứ tự, tên, nhóm, lưu trữ/xoá
       bản gốc). Trang chi tiết: chọn nhóm (có tạo nhóm mới tại chỗ), nhãn "Gộp từ N phiên", đường phân
       cách tên phiên gốc trong transcript, banner phiên đã lưu trữ + khôi phục.
  3. **Chỉnh sửa transcript:** `PUT /api/sessions/{id}/segments`; component `TranscriptEditor` — sửa
     text inline (nhấp đúp hoặc nút bút), xoá từng đoạn, hoàn tác nhiều bước (nút + Ctrl+Z), chỉ ghi
     server khi bấm "Lưu thay đổi", hỏi xác nhận khi huỷ thay đổi chưa lưu, cảnh báo khi rời trang.
     Sau khi sửa, nếu đã có tóm tắt → `summary_outdated` + cảnh báo "Tóm tắt lại" (không tự gọi LLM).
     Export .txt/.docx đọc segments hiện tại (bản đã sửa); phiên gộp có tiêu đề từng phần khi export.
  - Migration nhẹ trong `db.py` (`_add_missing_columns`) để DB cũ (SQLite local, Neon) tự thêm cột mới.
- File/module đã thay đổi:
  - Backend: `server/app/db.py`, `models/{common,group,session}.py`, `routers/{groups,sessions}.py`,
    `services/{merge,export,transcript,summary_agent}.py`, `dependencies.py`, `main.py`
  - Frontend: `client/src/App.jsx`, `lib/{api,segments}.js`, `hooks/useGroups.js`,
    `components/{Modal,GroupSelect,GroupManagerDialog,MergeDialog,TranscriptEditor,PartDivider,TranscriptView,SessionDetail,SummaryPanel,ui}.jsx`,
    `pages/{HistoryPage,LivePage,UploadPage}.jsx`
  - `CLAUDE.md`, `GEMINI.md`, `PROGRESS.md`, `.gitignore` (thêm `*.db.bak*`)
- Đã kiểm thử:
  - Backend (TestClient, DB tạm): tạo/trùng tên/đổi tên/xoá nhóm, gán & lọc nhóm, gộp đảo thứ tự với
    mốc thời gian cộng dồn, lưu trữ/khôi phục, gộp + xoá bản gốc, lỗi 404/409/422, sửa segments →
    `summary_outdated`, export txt/docx phản ánh bản đã sửa và có tiêu đề phần.
  - Migration chạy thử trên **bản sao** `local.db` thật (phiên "Buổi 4" giữ nguyên), chạy lại lần 2 không lỗi.
  - Frontend: build + oxlint OK; chụp màn hình có tương tác (CDP, headless Edge) ở 1440/1280/390px:
    chi tiết, chế độ sửa, cảnh báo tóm tắt cũ, phiên gộp, chọn nhiều, hộp thoại gộp, quản lý nhóm,
    đã lưu trữ, mobile — không có lỗi JS.
- Đang dang dở / chưa xong: không.
- Việc cần làm tiếp theo:
  - Khởi động lại backend để migration thêm cột vào `server/local.db` (đã sao lưu sẵn
    `server/local.db.bak-before-groups`; xoá file backup khi thấy mọi thứ ổn).
  - Trên Neon (production) migration cũng tự chạy khi deploy bản mới — nên backup/branch DB trên Neon trước.
- Vấn đề đã biết:
  - Gộp một phiên đã-được-gộp: các đoạn nhận `origin` của phiên gộp đó (mất phân cách chi tiết cấp dưới).
  - Nhãn "Người nói 1" của các phiên khác nhau được giữ nguyên nên có thể là người khác nhau sau khi gộp.
  - Xoá phiên gộp không tự khôi phục các bản gốc đã lưu trữ (vẫn khôi phục tay được ở mục "Đã lưu trữ").
  - Chưa có khoá chống ghi đè khi 2 tab cùng sửa transcript một phiên (lần lưu sau thắng).

## [2026-09-15] — Chuyển database sang Supabase Postgres (local + production), thêm test suite pytest
- Lý do: đồng bộ Postgres giữa local và production, tránh lệch hành vi SQLite vs Postgres (đã gặp thực tế:
  thứ tự sắp xếp chữ có dấu, `lower()` tiếng Việt, kiểu JSON/timestamp khác nhau).
- Quyết định trong phiên (đã hỏi người dùng):
  - **Không migrate dữ liệu**: Neon chưa từng deploy (không có dữ liệu production); dữ liệu SQLite local
    (1 phiên "Buổi 4" + bảng nhóm) được bỏ, bắt đầu DB trống. File `server/local.db` và
    `server/local.db.bak-before-groups` vẫn còn trên đĩa (đã gitignore), có thể xoá.
  - Supabase CLI cài dạng **npm devDependency ở `package.json` gốc** (`npx supabase ...`).
  - Stack Supabase local bật đầy đủ (Auth/Storage để sẵn), nhưng code **chỉ dùng Postgres**.
  - Tạo test suite chính thức **pytest** (dev dependency).
- Đã làm:
  - `npx supabase init` → `supabase/config.toml` (project_id `notewave`, Postgres 17, cổng DB 54322, Studio 54323);
    tắt `[db.seed]` vì bảng do backend tạo. Scripts gốc: `db:start`, `db:stop`, `db:status`, `test:server`.
    `run-dev.js` cảnh báo nếu không thấy Postgres local ở cổng 54322.
  - `server/app/db.py`: bỏ toàn bộ nhánh SQLite (`check_same_thread`, hàm `lower` tự đăng ký); chỉ chấp nhận URL
    Postgres (báo lỗi rõ ràng kèm hướng dẫn nếu thiếu/sai); giữ chuẩn hoá `postgres://` → `postgresql+psycopg://`;
    `prepare_threshold=None` (tương thích Supabase Transaction pooler), pool nhỏ + `pool_pre_ping`; log DB đang dùng
    (ẩn mật khẩu) khi khởi động; thêm `_enable_row_level_security()` bật RLS cho mọi bảng.
  - `config.py`: bỏ mặc định `sqlite:///./local.db` (`DATABASE_URL` bắt buộc).
  - Models: cột JSON → `JSONB`; cột thời gian → `timestamptz` (`models/common.py::tz_column`).
  - `.env.example` / `.env`: `DATABASE_URL` trỏ Supabase local; hướng dẫn lấy URL Transaction pooler cho production.
  - `render.yaml`: chú thích `DATABASE_URL` = Supabase Transaction pooler. `README.md`: cài Supabase CLI,
    `supabase start/stop/status`, lấy DB URL, chạy test, deploy bằng Supabase (Transaction pooler, không dùng
    Direct connection vì IPv6), ghi chú bảo mật RLS và việc Supabase free tạm dừng project khi không hoạt động.
  - Test suite `server/tests/` (34 test): DB layer (chuẩn hoá URL, từ chối SQLite, kiểu JSONB/timestamptz, `lower()`
    tiếng Việt, tự thêm cột, RLS chặn role `anon`), sessions (CRUD, tìm kiếm có dấu, export, tóm tắt giả lập),
    nhóm + gộp phiên, sửa segments, upload/polling/webhook/temporary key với Soniox giả lập.
- File/module đã thay đổi:
  - `server/app/{db,config,main}.py`, `server/app/models/{common,group,session}.py`
  - `server/tests/{__init__,conftest,helpers,soniox_fake,test_db,test_sessions,test_groups_merge,test_segments,test_upload_soniox}.py`
  - `server/pyproject.toml` (dependency-groups dev + cấu hình pytest), `server/requirements-dev.txt` (mới)
  - `supabase/config.toml` (mới), `package.json`, `package-lock.json`, `run-dev.js`, `.gitignore`
  - `.env.example`, `.env`, `render.yaml`, `README.md`, `CLAUDE.md` (mục 2, 3, 4, 5, 7), `GEMINI.md`, `PROGRESS.md`
- Đã kiểm thử:
  - `pytest` trên Supabase local (Postgres 17.6, database `notewave_test`): **34 passed**. Không test nào phụ thuộc
    SQLite; 1 test cũ giả định thứ tự sắp xếp kiểu SQLite/codepoint đã sửa theo đúng hành vi Postgres
    (collation ICU en_US.UTF-8: "Ảnh…" xếp trước "Dự…").
  - Chạy thật backend với `.env` trỏ Supabase local (database `postgres`): tạo/tìm kiếm phiên tiếng Việt OK;
    gọi Supabase REST API bằng key `anon`: đọc trả `[]`, ghi bị chặn 401 "violates row-level security policy".
  - Driver `psycopg[binary]` giữ nguyên; không có dependency riêng cho SQLite cần xoá (sqlite3 là built-in).
- Đang dang dở / chưa xong:
  - Chưa tạo Supabase project hosted và chưa deploy Render (chưa kiểm thử kết nối qua Transaction pooler thật).
- Việc cần làm tiếp theo:
  - Tạo project trên supabase.com, đặt `DATABASE_URL` (Transaction pooler, `?sslmode=require`) trên Render rồi deploy.
  - Mỗi lần dev: bật Docker Desktop → `npx supabase start` → `npm run dev`.
- Vấn đề đã biết:
  - Supabase local chiếm khá nhiều RAM/Docker image (bật đủ stack); nếu máy yếu có thể tắt bớt service trong
    `supabase/config.toml` (vd `[analytics]`, `[edge_runtime]`) mà không ảnh hưởng backend.
  - Supabase free tier tạm dừng project sau ~1 tuần không hoạt động → cần Restore trong Dashboard.
  - Vẫn chưa có Alembic: đổi kiểu/xoá cột phải migrate tay (SQL Editor của Supabase).

## [2026-09-15] — Dev hằng ngày chỉ cần bật Docker: `npm run dev` tự chuẩn bị toàn bộ môi trường
- Đã làm:
  - Viết lại `run-dev.js`: (1) lần đầu tự cài deps còn thiếu (npm gốc + client, Python venv qua uv hoặc venv+pip
    với `requirements-dev.txt`) và tạo `.env` từ `.env.example`; (2) chờ Docker sẵn sàng tối đa 2 phút, báo lỗi rõ
    nếu chưa cài/chưa bật; (3) kiểm tra `supabase status`, tự `supabase start` nếu chưa chạy; (4) chạy backend +
    frontend. Ctrl+C dừng hẳn cây tiến trình (taskkill /T trên Windows), để Supabase chạy nền; nếu backend/frontend
    tự thoát lỗi thì dừng phần còn lại. Thêm cờ `--prepare` (chỉ làm bước 1–3).
  - `.vscode/tasks.json`: task mặc định "Run NoteWave (FE + BE)" (Ctrl+Shift+B) chạy tuần tự
    "Chuẩn bị (deps + Docker + Supabase)" → backend + frontend song song.
  - `dev.bat`, `dev.ps1`: cập nhật dòng giới thiệu. `README.md`: mục "Chạy local" viết lại theo luồng
    "bật Docker → npm run dev", bảng lệnh hữu ích, cách chạy thủ công để trong phần thu gọn.
  - `CLAUDE.md` (+ `GEMINI.md`) mục 2: ghi quy ước dev hằng ngày và việc đưa bước setup mới vào `run-dev.js`.
- File/module đã thay đổi: `run-dev.js`, `.vscode/tasks.json`, `dev.bat`, `dev.ps1`, `README.md`, `CLAUDE.md`, `GEMINI.md`, `PROGRESS.md`
- Đã kiểm thử:
  - Tắt Supabase rồi chạy `node run-dev.js --prepare`: tự nhận Docker, tự bật Supabase (~45 giây từ trạng thái dừng).
  - Chạy `npm run dev` khi Supabase đang chạy: bỏ qua bước bật DB, backend `/api/health` + frontend + proxy `/api`
    đều trả 200 sau ~3 giây; khi tiến trình con bị dừng, script thoát sạch.
  - Chưa thử trên máy hoàn toàn mới (chưa có venv/node_modules) và chưa thử trên macOS/Linux.
- Việc cần làm tiếp theo: không có việc dang dở; tiếp tục kế hoạch deploy Supabase hosted + Render.
- Vấn đề đã biết:
  - Script không tự mở Docker Desktop (theo yêu cầu: người dùng tự bật Docker), chỉ chờ.
  - Nếu một project Supabase khác đang chiếm cổng 5432x, `supabase start` sẽ lỗi — script in hướng dẫn dừng project đó.

## [2026-09-15] — Viết hướng dẫn deploy chi tiết (DEPLOY.md) + kiểm tra trước deploy
- Đã làm:
  - Tạo `DEPLOY.md`: tổng quan kiến trúc & thứ tự deploy, checklist chuẩn bị, từng bước Supabase (Transaction
    pooler, `?sslmode=require`, URL-encode mật khẩu, lệnh kiểm tra kết nối từ local) → GitHub (git init, kiểm tra
    file sẽ commit) → Render (Blueprint, biến môi trường, log mong đợi, kiểm tra `/api/health`) → Vercel (Root
    Directory `client`, biến `VITE_*`) → cập nhật CORS → checklist kiểm thử sau deploy → cập nhật về sau → bảng xử
    lý sự cố → giới hạn free tier → checklist bảo mật.
  - **Sửa lỗi nghiêm trọng trong `.gitignore`**: dòng `lib/` (mẫu Python) bỏ qua mọi thư mục `lib`, kể cả
    `client/src/lib/` (api.js, format.js, segments.js) → nếu push lên GitHub, Vercel build sẽ lỗi. Đã xoá `lib/`,
    `lib64/`; đổi `.vscode/` thành `.vscode/*` + `!.vscode/tasks.json` để chia sẻ task VS Code.
    Kiểm tra bằng git dir tạm: 83 file sẽ được commit, không có `.env`, DB, venv, node_modules.
  - `render.yaml`: thêm `region: singapore` (mặc định Render là Oregon; Supabase cũng nên chọn Singapore).
  - `README.md`: mục deploy rút gọn, trỏ tới `DEPLOY.md`. `CLAUDE.md` (+ `GEMINI.md`) mục 7: trỏ `DEPLOY.md`,
    region, thứ tự deploy, quy ước cập nhật DEPLOY.md khi đổi cách deploy.
- File/module đã thay đổi: `DEPLOY.md` (mới), `.gitignore`, `render.yaml`, `README.md`, `CLAUDE.md`, `GEMINI.md`, `PROGRESS.md`
- Đã kiểm thử (mô phỏng Render bằng Docker `python:3.12.8-slim`, đúng buildCommand/startCommand của `render.yaml`):
  - `pip install -r requirements.txt` thành công trên Linux trong ~60 giây (site-packages ~300MB).
  - App khởi động, kết nối Postgres (Supabase local), `/api/health` OK; tạo phiên, export .docx OK; tóm tắt với key
    giả trả 502 như mong đợi.
  - RAM: ~210MB khi rảnh, ~240MB sau khi nạp PydanticAI + export → an toàn với giới hạn 512MB của Render free.
  - CORS: origin trong `ALLOWED_ORIGINS` được chấp nhận, origin khác bị từ chối (400).
- Đang dang dở / chưa xong:
  - Chưa deploy thật: repo chưa có git/GitHub, chưa có tài khoản/project Supabase, Render, Vercel.
- Việc cần làm tiếp theo: làm theo `DEPLOY.md` từ bước 1.
- Vấn đề đã biết:
  - App chưa có đăng nhập: sau khi deploy, ai có URL đều truy cập được dữ liệu và dùng hạn mức Soniox/OpenAI
    (đã ghi cảnh báo trong DEPLOY.md mục 10).

## [2026-09-15] — Chuyển model tóm tắt sang `openai:gpt-5.6-luna` và tối ưu cho model này
- Bối cảnh: người dùng đổi `SUMMARY_MODEL=openai:gpt-5.6-luna` trong `.env`, yêu cầu cập nhật dự án cho phù hợp.
- Kiểm tra model (pydantic-ai 2.43): model được nhận diện, chạy qua OpenAI Responses API; reasoning **bật mặc định**
  (gpt-5.4-mini thì tắt), context 1.05M token, không hỗ trợ reasoning effort `minimal`.
- Đo thực tế với transcript họp tiếng Việt mẫu (gọi API thật):
  - Reasoning mặc định: ~8–11 giây, tóm tắt đúng, gộp đúng việc trùng lặp, thời hạn đúng.
  - `openai_reasoning_effort=low`: ~4 giây nhưng tách 1 việc thành 2 mục trùng, ghi sai thời hạn ("thêm hai ngày").
  - → Giữ reasoning mặc định. Giá theo bảng `genai_prices`: luna $0.40/1M input, $1.80/1M output
    (~$0.005 cho tóm tắt 1 buổi họp 60 phút) — rẻ hơn gpt-5.4-mini (~$0.018).
- Đã làm:
  - Đổi mặc định sang `openai:gpt-5.6-luna` ở `config.py`, `.env.example`, `render.yaml`, `README.md`, `DEPLOY.md`, `CLAUDE.md`.
  - Biến mới (tuỳ chọn) `SUMMARY_REASONING_EFFORT` (none|low|medium|high, trống = mặc định model; chỉ áp dụng
    cho model OpenAI) — thêm vào `.env.example`, `.env` (để trống), `CLAUDE.md` mục 5.
  - `summary_agent.py`: `build_model_settings()`, `retries=2` cho lỗi validate output; viết lại `INSTRUCTIONS`:
    owner dạng "Tên (Người nói N)" khi suy ra chắc chắn tên, gộp việc trùng, `due` chỉ khi có mốc cụ thể,
    `decisions` chỉ ghi điều đã chốt, bỏ qua câu đệm. Đo lại sau khi sửa prompt: owner ra "Minh (Người nói 2)",
    "Lan (Người nói 3)", không còn việc trùng/sai hạn.
  - Test mới `tests/test_summary_agent.py`: mặc định model, cấu hình reasoning theo provider, chạy endpoint
    `/summarize` qua agent thật với `FunctionModel` (kiểm tra prompt có nhãn người nói, tiêu đề phần của phiên gộp,
    instructions); test LLM thật chỉ chạy khi `RUN_LLM_TESTS=1` (conftest không ghi đè `OPENAI_API_KEY` khi bật).
  - `DEPLOY.md`: thêm dòng xử lý sự cố "tóm tắt chạy lâu".
- File/module đã thay đổi: `server/app/config.py`, `server/app/services/summary_agent.py`, `server/tests/conftest.py`,
  `server/tests/test_summary_agent.py` (mới), `.env.example`, `.env`, `render.yaml`, `README.md`, `DEPLOY.md`,
  `CLAUDE.md`, `GEMINI.md`, `PROGRESS.md`
- Đã kiểm thử: `pytest` 39 passed + 1 skipped (test LLM thật); chạy riêng `RUN_LLM_TESTS=1 ... -k live` với
  gpt-5.6-luna thật: passed.
- Việc cần làm tiếp theo: khi deploy, Render dùng `SUMMARY_MODEL=openai:gpt-5.6-luna` từ `render.yaml`; đảm bảo
  tài khoản OpenAI có quyền dùng model này.
- Vấn đề đã biết: số liệu thời gian/giá đo trên 1 transcript ngắn, transcript 1–2 giờ sẽ chậm hơn (vài chục giây).

## [2026-09-15] — DoD DEPLOY.md đã pass + local dùng chung DB Supabase thật với production (bỏ Docker/Supabase CLI)
- Đã làm:
  - **DEPLOY.md:** người dùng xác nhận đã chạy thật và thành công **cả 18 mục checklist** → đánh `[x]` toàn bộ:
    Chuẩn bị trước (4 mục: tài khoản GitHub/Supabase/Render/Vercel, `SONIOX_API_KEY`, `OPENAI_API_KEY`, local chạy
    được + test xanh + build), mục 6 Kiểm thử sau deploy (9 mục: trang tải/banner khởi động, Lịch sử/CORS, ghi âm
    trực tiếp, tóm tắt + xuất .txt/.docx, sửa transcript, tải file + webhook, nhóm & gộp, Table Editor có dữ liệu,
    Security Advisor không cảnh báo RLS), mục 10 Checklist bảo mật (5 mục). Cập nhật thêm: response mẫu
    `/api/health` có `database`, dòng xử lý sự cố `"database":"error"`, lưu ý local dùng chung DB ở mục 1 và 7,
    bỏ `supabase/config.toml`/`supabase/.temp/` khỏi danh sách kiểm tra file commit.
  - **Quyết định (người dùng chọn):** 1 project Supabase chung, local dùng đúng connection string production
    (Transaction pooler); gỡ hẳn Supabase CLI + Docker; không đánh dấu phiên tạo từ local; test chạy trên project
    dùng chung với production.
  - Gỡ Supabase local: `npx supabase stop` (volume Docker vẫn giữ trên máy), xoá thư mục `supabase/`, devDependency
    `supabase`, script `db:start/stop/status`, dòng `supabase/*` trong `.gitignore`.
  - `run-dev.js`: bỏ bước chờ Docker + `supabase start`, bỏ `npm install` ở gốc (không còn dependency); thêm bước kiểm
    tra `DATABASE_URL` (thứ tự ưu tiên giống pydantic-settings: biến môi trường → `server/.env` → `.env`), báo lỗi khi
    trống / không phải Postgres / còn `127.0.0.1:54322`, in host Supabase kèm cảnh báo dùng chung production.
    `.vscode/tasks.json`, `dev.bat`, `dev.ps1`: đổi nhãn/dòng giới thiệu.
  - `db.py`: xác nhận không còn nhánh SQLite/localhost (chỉ đọc `DATABASE_URL`); đổi `DATABASE_URL_HINT`; thêm
    `check_database()` (`SELECT 1`), `current_schema()`, `_qualified()` — SQL thô (RLS, ADD COLUMN) tôn trọng schema
    của engine.
  - `/api/health`: thêm `database` (`ok`/`error`), `database_error` (tên loại lỗi, không lộ connection string),
    `status` = `degraded` khi DB lỗi; luôn HTTP 200 (Render healthCheckPath — restart không giúp khi Supabase tạm dừng).
  - **Test an toàn khi dùng chung DB production:** conftest lấy `TEST_DATABASE_URL` hoặc `DATABASE_URL` trong `.env`,
    tạo schema `notewave_test`, thay `db.engine` bằng engine `schema_translate_map={None: "notewave_test"}`; TRUNCATE
    chỉ trên schema test (có assert chặn); `test_db.py` sửa mọi SQL thô sang tên bảng kèm schema
    (`tests.helpers.qualified`). Thêm test `test_health_reports_database_error`.
  - `.env.example` (`DATABASE_URL` để trống + hướng dẫn lấy từ Dashboard + cảnh báo), `README.md` mục "Chạy local"
    viết lại (lấy connection string, cảnh báo rủi ro dùng chung + cách giảm rủi ro, khuyến nghị tách project dev),
    `CLAUDE.md` + `GEMINI.md` mục 2, 4, 5.
- File/module đã thay đổi: `DEPLOY.md`, `README.md`, `.env.example`, `.gitignore`, `package.json`, `package-lock.json`,
  `run-dev.js`, `dev.bat`, `dev.ps1`, `.vscode/tasks.json`, `server/app/db.py`, `server/app/main.py`,
  `server/tests/conftest.py`, `server/tests/helpers.py`, `server/tests/test_db.py`, `server/tests/test_sessions.py`,
  `supabase/` (xoá), `CLAUDE.md`, `GEMINI.md`, `PROGRESS.md`
- Đã kiểm thử:
  - `pytest` (trước khi tắt Supabase local): 40 passed + 1 skipped; chèn 1 dòng mẫu vào `public.session_groups`, chạy
    toàn bộ test → dòng mẫu vẫn còn (test không đụng schema `public`).
  - `node run-dev.js --prepare`: báo lỗi đúng khi `DATABASE_URL` trống / trỏ `127.0.0.1:54322`; chấp nhận URL pooler.
  - **Kết nối Supabase thật từ local: OK.** Lần đầu lỗi `ConnectionTimeout` — mạng dây (Ethernet) chặn mọi cổng
    database đi ra (5432/6543/3306, kể cả tới portquiz.net; 443 vẫn mở), không phải lỗi code. Người dùng route host
    `aws-0-ap-southeast-1.pooler.supabase.com` qua WiFi cá nhân (script split-tunnel ngoài repo) → psycopg kết nối
    được (PostgreSQL 17.6); `uvicorn` khởi động OK và `GET /api/health` trả
    `{"status":"ok","database":"ok","database_error":null,"soniox_configured":true,"webhook_enabled":false}`.
  - **Sửa lỗi `[vite] http proxy error ... ECONNREFUSED` khi mở app:** backend giờ khởi động ~7 giây (import 2,9s +
    `init_db` 4,4s qua mạng tới Supabase, trước là ~1s với DB local) nhưng backend và frontend được bật song song →
    Vite mở trình duyệt trước, request `/api/*` đầu tiên bị từ chối. `run-dev.js` chờ `GET /api/health` OK (tối đa
    90 giây, cảnh báo nếu `database: error`) rồi mới bật frontend; `.vscode/tasks.json` "FE + BE" đổi
    `dependsOrder` sang `sequence` (Frontend chờ endsPattern "Application startup complete" của Backend).
- Đang dang dở / chưa xong: chưa chạy `pytest` trên Supabase thật (sẽ tạo schema `notewave_test` trong project production).
- Việc cần làm tiếp theo: chạy `pytest` trên Supabase thật; cân nhắc tạo project Supabase riêng cho dev.
- Vấn đề đã biết:
  - Local ghi/xoá thẳng dữ liệu production; backend local khởi động có thể `ALTER TABLE ADD COLUMN` trên production
    trước khi code được deploy.
  - Test trên DB production chậm hơn (độ trễ mạng tới Singapore) và để lại schema `notewave_test` (rỗng sau khi chạy).
  - Dữ liệu cũ trong Supabase local (volume Docker) không còn được dùng; xoá bằng Docker Desktop nếu muốn giải phóng dung lượng.
  - Trên mạng dây ở máy dev, cổng 6543 bị chặn: local chỉ kết nối được DB khi IP pooler đi qua WiFi. IP pooler (AWS)
    có thể đổi → nếu lại gặp `connection timeout expired`, chạy lại script split-tunnel.

## [2026-09-15] — Trang chi tiết phiên: 2 cột vừa khung màn hình, cuộn độc lập + nút sao chép tóm tắt
- Đã làm:
  - **Layout (từ breakpoint `xl`, khi Transcript và Tóm tắt đứng cạnh nhau):** khối 2 cột cao đúng phần viewport còn lại
    (từ dưới toolbar tới đáy màn hình, trừ padding dưới của `<main>`), trang không còn cuộn theo độ dài nội dung →
    breadcrumb/tiêu đề/toolbar đứng yên. Mỗi khối có header cố định ("Transcript" + người nói; "Tóm tắt bằng AI" +
    nút) và vùng nội dung tự cuộn riêng (`overflow-y-auto`, `overscroll-contain`), 2 cột cuộn độc lập. Khối tóm tắt co
    theo nội dung, chỉ bị chặn (và cuộn) khi dài hơn cột. Chiều cao đo bằng callback ref `useViewportFit` (biến CSS
    `--fit-h`, tối thiểu 420px; tự đo lại qua `ResizeObserver(document.body)` + `resize` khi đổi tên phiên, hiện cảnh báo
    lưu trữ, banner máy chủ…). Header hiện bóng mờ (tóm tắt: thêm viền) khi vùng dưới đã cuộn (`useScrolled`).
    Thanh cuộn mảnh tông giấy ấm + `scrollbar-gutter: stable` (class `.scroll-area` trong `index.css`).
  - **Dưới `xl` (tablet/mobile, 2 khối xếp dọc):** giữ cuộn trang tự nhiên như trước, không ép vừa 1 màn hình.
  - Thanh công cụ chế độ "Chỉnh sửa transcript" (sticky): dưới `xl` vẫn dính dưới header app, từ `xl` dính đầu vùng cuộn
    của khối transcript (`xl:top-0`). Bỏ `xl:sticky` của sidebar tóm tắt (không còn cần).
  - **Nút sao chép tóm tắt** (cạnh "Tạo lại", chỉ có khi đã có tóm tắt): chép Markdown (`# tiêu đề phiên`, `## Tóm tắt`,
    `## Ý chính` bullet, `## Việc cần làm` checklist `- [ ] việc — Phụ trách: … · Hạn: …`, `## Quyết định`) — định dạng
    ở `lib/summary.js::summaryToMarkdown`. Clipboard API, dự phòng textarea + `execCommand` khi không phải secure context
    (`lib/clipboard.js`); lỗi → toast, không `alert()`. Phản hồi: icon copy → dấu tick (scale/opacity), nền brand nhạt
    ~1,8 giây; từ `sm` tới dưới `xl` có nhãn "Sao chép"/"Đã chép" (2 nhãn chồng nhau giữ nguyên bề rộng), ở sidebar hẹp
    `xl` và mobile chỉ icon + bong bóng "Đã chép" nổi bên dưới; có `role="status"` cho trình đọc màn hình.
- File/module đã thay đổi: `client/src/components/SessionDetail.jsx`, `client/src/components/SummaryPanel.jsx`,
  `client/src/components/TranscriptEditor.jsx`, `client/src/index.css`, mới: `client/src/hooks/useViewportFit.js`,
  `client/src/hooks/useScrolled.js`, `client/src/lib/clipboard.js`, `client/src/lib/summary.js`, `PROGRESS.md`
- Đã kiểm thử: `vite build` OK; `oxlint` không có cảnh báo mới. Chạy bản build với API giả lập (server Node tạm trong
  scratchpad, không đụng DB) + Edge headless: 1440×900 → `scrollHeight` trang = 900 (không cuộn trang), 2 vùng cuộn
  riêng hoạt động độc lập, header giữ nguyên, tóm tắt ngắn co theo nội dung; 1024px → xếp dọc, cuộn trang bình thường;
  nút sao chép (giả lập `clipboard.writeText`) → nội dung Markdown đúng, nhãn/tick đổi rồi trở lại sau ~1,8 giây, bề rộng
  nút không đổi; khi trình duyệt từ chối clipboard → hiện toast lỗi.
- Đang dang dở / chưa xong: chưa kiểm tra tay trên thiết bị mobile thật và với dữ liệu thật (chế độ chỉnh sửa transcript
  ở `xl` mới kiểm tra qua code, chưa chụp màn hình).
- Việc cần làm tiếp theo: người dùng thử trên trình duyệt thật (desktop ≥1280px + mobile), đặc biệt chế độ chỉnh sửa
  transcript trong khung cuộn mới.
- Vấn đề đã biết: màn hình desktop thấp (<~720px) hoặc header rất cao (tiêu đề dài nhiều dòng + cảnh báo lưu trữ) → khối
  2 cột giữ tối thiểu 420px nên trang có thể cuộn thêm một đoạn ngắn.

## [2026-09-15] — Tối giản tasks.json: bỏ bước chuẩn bị, chỉ mở đúng 2 terminal BE và FE
- Đã làm:
  - Xoá task "Chuẩn bị (deps + kiểm tra DATABASE_URL)" trong `.vscode/tasks.json`.
  - Task mặc định "Run NoteWave (FE + BE)" trực tiếp khởi chạy `Backend (FastAPI)` rồi đến `Frontend (Vite)` theo thứ tự tuần tự (`dependsOrder: sequence`).
  - Khi ấn `Ctrl+Shift+B` hoặc Run Task, VS Code chỉ mở đúng 2 terminal chuyên dụng (Backend và Frontend), không còn terminal thứ 3 thừa phải ấn phím để đóng.
- File/module đã thay đổi: `.vscode/tasks.json`, `PROGRESS.md`

## [2026-09-15] — Tính năng mới: Quét tài liệu (Mistral OCR + rà soát từ tiếng Anh bằng AI, duyệt kiểu track changes)
- Đã làm:
  - **Quyết định đã hỏi và người dùng chọn (mục 8):** render Markdown bằng `react-markdown` + `remark-gfm`; đếm trang PDF
    bằng `pypdf`; `ocr_review_agent` CHỈ trả danh sách `corrections`, backend tự ghép `corrected_text`; OCR xong mà bước
    LLM rà soát lỗi → phiên vẫn `completed` + cảnh báo (không `failed`, không mất kết quả OCR đã trả phí).
  - **Cách lưu nội dung OCR (tự quyết định theo hướng ít phá vỡ nhất):** tái dùng `segments` cho nội dung CHỐT — mỗi
    segment = 1 trang Markdown (`TranscriptSegment` thêm field tuỳ chọn `page`, không có speaker/mốc thời gian). Lý do:
    tìm kiếm (`transcript_text`), tóm tắt, export, "Chỉnh sửa nội dung" (TranscriptEditor), gộp phiên, `summary_outdated`
    chạy ngay không cần nhánh code riêng; dữ liệu cũ không đổi (field mới bị bỏ qua khi None). Thêm 1 cột JSONB nullable
    `note_sessions.ocr` (`models/ocr.py::OcrData`, tự `ALTER TABLE ADD COLUMN` khi khởi động) lưu: `raw_pages` (OCR gốc,
    không bao giờ ghi đè), `reviewed_pages` (gốc + mọi đề xuất của LLM), `corrections` (id `cN`, `page`, `original`,
    `corrected`, `context`, `status` pending/accepted/rejected/unavailable), `review_error`, `model`, `pages_processed`.
    Chọn 1 cột JSON thay vì nhiều cột để chỉ cần 1 lần ADD COLUMN và không phải đổi schema khi mở rộng. `SessionRead.ocr`
    không trả raw/reviewed pages (response gọn với PDF dài).
  - **Backend:**
    - `POST /api/ocr-extract` (`routers/ocr.py`): kiểm tra đuôi file (PDF, jpg/jpeg/png/webp/avif/gif/bmp/tif/tiff), file
      rỗng, ≤ 50MB, PDF hỏng/có mật khẩu, ≤ 1000 trang (pypdf) TRƯỚC khi gọi Mistral; thiếu `MISTRAL_API_KEY` → 503; tạo
      phiên `source="ocr"`, `processing`, trả 202 `{session_id, status, pages}`.
    - **Xử lý nền** (`services/ocr_processing.py`, FastAPI `BackgroundTasks`) thay vì đồng bộ: PDF nhiều trang + LLM có
      thể mất vài phút, vượt timeout request của Render (đúng khuyến nghị trong "Vấn đề đã biết" của luồng upload). Lỗi
      bất kỳ trong job → `failed`; phiên bị xoá giữa chừng → bỏ qua. Job mất do restart: `GET /api/ocr-extract/{id}/status`
      đặt `failed` nếu không có job trong process và `updated_at` cũ hơn 10 phút.
    - `services/ocr.py`: SDK `mistralai` 2.x (`from mistralai.client import Mistral`), không cần URL public — upload file lên
      Mistral Files API (`purpose="ocr"`, multipart, không phình như base64) → signed URL 1 giờ → `ocr.process`
      (`document_url` cho PDF / `image_url` cho ảnh, `include_image_base64=False`) → luôn xoá file trên Mistral. Bỏ tham
      chiếu ảnh `![img-0](...)` khỏi Markdown. httpx client riêng timeout 600s trong lifespan (`app.state.ocr_http`).
    - `services/ocr_review_agent.py` (`ocr_review_agent`, dùng `SUMMARY_MODEL`): prompt chỉ sửa từ tiếng Anh, không đụng
      tiếng Việt; chia tài liệu theo trang ~40k ký tự/lần, tối đa 4 lần gọi song song; lọc đề xuất (đúng trang, `original`
      có thật dạng nguyên từ, `corrected` chỉ ký tự Latin cơ bản, chặn chữ riêng tiếng Việt / chỉ bỏ dấu, bỏ trùng); áp
      dụng tuần tự để `reviewed_pages` nhất quán với danh sách đề xuất.
    - `POST /api/sessions/{id}/ocr-corrections` `{"accept": [...], "reject": [...]}`: chấp nhận = thay nguyên từ trong đúng
      trang của `segments` hiện tại (kể cả sau khi sửa tay; không còn thấy → `unavailable`); gọi lặp an toàn; nếu đã có tóm
      tắt → `summary_outdated=true`.
    - `source` nhận thêm `"ocr"` (Literal, bộ lọc `GET /api/sessions?source=ocr`, tiêu đề mặc định, preview bỏ ký hiệu
      Markdown). Tóm tắt phiên OCR: prompt báo nội dung là văn bản OCR (không đổi `INSTRUCTIONS` của summary_agent).
      `segments_to_plain_text` chèn "--- Trang N ---" khi nhiều trang. Export .txt/.docx: nguồn "Tài liệu quét (OCR)",
      "Số trang", mục "Nội dung tài liệu"; .docx chuyển Markdown (heading, list, quote, bảng, code, đậm/nghiêng) qua
      `services/markdown_docx.py`. `/api/health` thêm `ocr_configured`.
  - **Frontend:**
    - Tab thứ 3 **"Quét tài liệu"** (`#/scan`, nhãn ngắn "Quét"; nav desktop dùng nhãn ngắn từ md tới dưới lg, bottom nav
      4 cột). `pages/ScanPage.jsx`: kéo-thả / chọn ảnh-PDF, nút **Chụp ảnh tài liệu** (`capture="environment"`, chỉ hiện trên
      thiết bị cảm ứng), tiến trình upload + thẻ xử lý nền, nhớ phiên đang xử lý qua localStorage.
    - Tách luồng upload dùng chung thành `components/FileIngestPage.jsx`; `UploadPage` giờ chỉ truyền config (hành vi giữ
      nguyên). `ProcessingCard` nhận `icon`/`hint`; `useUploadStatus` nhận hàm poll (`api.ocrStatus`).
    - Chi tiết phiên OCR: tiêu đề khối "Nội dung tài liệu", không có danh sách người nói, meta "N trang", nút "Chỉnh sửa
      nội dung"; dòng cảnh báo "Nội dung do AI trích xuất… nên kiểm tra lại"; banner "Đã phát hiện N từ tiếng Anh có thể
      viết sai… bấm để xem chi tiết"; cảnh báo `review_error`. `OcrDocumentView` render Markdown (style theo design system,
      bảng cuộn ngang, không render HTML thô/ảnh) + tô sáng từ đang có đề xuất (bấm → mở đúng mục). Tách chunk lazy
      (47 KB gzip), bundle chính chỉ tăng ~4 KB.
    - `OcrCorrectionsDialog`: từ gốc (gạch ngang) → đề xuất, câu ngữ cảnh, Chấp nhận / Bỏ qua từng mục, "Chấp nhận tất cả",
      mục đã xử lý gom trong "Đã xử lý (N)"; khoá chấp nhận khi đang chỉnh sửa nội dung. Không tự áp dụng khi chưa bấm.
    - Lịch sử: bộ lọc thêm "Tài liệu quét" (nhãn ngắn trên mobile), icon `ScanText` + màu xanh dương riêng
      (`lib/sources.js::SOURCE_META`, dùng chung với `SourceBadge`); empty state thêm nút "Quét tài liệu".
  - **Dev/deploy:** `run-dev.js` tự cài lại dependencies khi `client/package*.json` hoặc `server/requirements*.txt` đổi
    (dấu vân tay lưu ở `client/node_modules/.notewave-deps`, `server/.venv/.notewave-deps`). `.env.example`, `render.yaml`
    (`MISTRAL_API_KEY` sync:false, `OCR_MODEL`), `DEPLOY.md` (chuẩn bị key, bảng biến, health, checklist kiểm thử, 4 dòng
    xử lý sự cố, giới hạn), `README.md`, `CLAUDE.md` + `GEMINI.md` (luồng, thư viện đã duyệt, bảo mật, 3 endpoint, ghi chú
    OCR, biến môi trường, `source` 3 giá trị).
- File/module đã thay đổi:
  - Backend mới: `server/app/models/ocr.py`, `server/app/routers/ocr.py`, `server/app/services/ocr.py`,
    `server/app/services/ocr_processing.py`, `server/app/services/ocr_review_agent.py`, `server/app/services/markdown_docx.py`,
    `server/tests/mistral_fake.py`, `server/tests/test_ocr.py`.
  - Backend sửa: `server/app/config.py`, `server/app/dependencies.py`, `server/app/main.py`, `server/app/models/session.py`,
    `server/app/routers/sessions.py`, `server/app/services/export.py`, `server/app/services/summary_agent.py`,
    `server/app/services/transcript.py`, `server/tests/conftest.py`, `server/tests/test_sessions.py`,
    `server/requirements.txt`, `server/pyproject.toml`.
  - Frontend mới: `client/src/pages/ScanPage.jsx`, `client/src/components/FileIngestPage.jsx`,
    `client/src/components/OcrDocumentView.jsx`, `client/src/components/OcrCorrectionsDialog.jsx`, `client/src/lib/sources.js`.
  - Frontend sửa: `client/src/App.jsx`, `client/src/pages/UploadPage.jsx`, `client/src/pages/HistoryPage.jsx`,
    `client/src/components/SessionDetail.jsx`, `client/src/components/TranscriptEditor.jsx`,
    `client/src/components/ProcessingCard.jsx`, `client/src/components/ui.jsx`, `client/src/hooks/useUploadStatus.js`,
    `client/src/lib/api.js`, `client/src/lib/format.js`, `client/package.json`, `client/package-lock.json`.
  - Khác: `run-dev.js`, `.env.example`, `render.yaml`, `DEPLOY.md`, `README.md`, `CLAUDE.md`, `GEMINI.md`, `PROGRESS.md`.
- Đã kiểm thử:
  - `pytest` toàn bộ trên Supabase (schema `notewave_test`): **53 passed, 2 skipped** trên tổng 55 test (2 test gọi LLM
    thật; phiên sau đếm lại, trước đó ghi nhầm "55 passed"). `test_ocr.py` (14 test): validate (415/422/413, PDF hỏng, quá số trang), 503 khi thiếu key, luồng đầy đủ với Mistral giả lập
    (MockTransport; kiểm tra thứ tự upload → signed URL → OCR → xoá file, body `document_url`/`image_url`) + LLM giả lập
    (`FunctionModel`, kiểm tra lọc đề xuất sai), lưu raw/reviewed không ghi đè, lọc/tìm kiếm, accept/reject/gọi lặp/422,
    `summary_outdated`, `unavailable` sau khi sửa tay, LLM lỗi → completed + `review_error`, OCR lỗi / không có chữ →
    failed, job mồ côi → failed, export txt/docx, prompt tóm tắt OCR, unit test thay nguyên từ / chia phần / chặn tiếng Việt.
  - `vite build` OK, `oxlint` không có cảnh báo mới. Bản build + API giả lập + Edge headless (1440×900): trang Quét, Lịch
    sử (bộ lọc + icon), chi tiết phiên OCR (Markdown, tô sáng, banner, cảnh báo), hộp thoại — bấm từ tô sáng mở đúng mục,
    chấp nhận 1 mục → nội dung đổi, banner giảm số.
  - `node run-dev.js --prepare`: lần đầu cài lại deps (fingerprint mới), lần 2 bỏ qua.
- Đang dang dở / chưa xong:
  - **Chưa gọi Mistral OCR thật** (`.env` chưa có `MISTRAL_API_KEY`) — request/response dựa theo SDK `mistralai` 2.10 +
    tài liệu Mistral, mới kiểm bằng giả lập. Chưa chạy test LLM thật của `ocr_review_agent`.
  - Chưa thử trên điện thoại thật (nút chụp ảnh, bố cục mobile của hộp thoại).
- Việc cần làm tiếp theo:
  - Điền `MISTRAL_API_KEY` vào `.env` → quét thử 1 ảnh ghi chú tay + 1 PDF nhiều trang; chạy
    `RUN_LLM_TESTS=1 pytest tests/test_ocr.py -k live` để đánh giá chất lượng prompt rà soát.
  - Deploy: thêm `MISTRAL_API_KEY` trên Render (Blueprint đã tạo không tự thêm biến mới), đánh dấu mục checklist "Quét tài
    liệu" trong `DEPLOY.md` sau khi kiểm thử production.
  - Cân nhắc: chụp nhiều ảnh thành 1 phiên (hiện 1 file / phiên — tạm gộp bằng tính năng Gộp phiên); hoàn tác một đề xuất
    đã chấp nhận.
- Vấn đề đã biết:
  - Task VS Code "Run NoteWave (FE + BE)" (Ctrl+Shift+B) chạy thẳng uvicorn/vite, KHÔNG qua `run-dev.js` → sau khi pull
    code có thư viện mới (`mistralai`, `pypdf`, `react-markdown`) phải chạy `npm run dev` hoặc `node run-dev.js --prepare`
    một lần, không thì backend lỗi import.
  - Chạy backend local sẽ `ALTER TABLE note_sessions ADD COLUMN ocr` trên DB production (dùng chung) — deploy code lên Render
    sớm cho khớp.
  - Job OCR nền chạy trong process: Render restart/deploy giữa chừng → phiên `failed` sau 10 phút (người dùng tải lại).
    Nếu sau này chạy nhiều worker/instance, cần hàng đợi thật (vd. bảng job) thay cho `_running` trong bộ nhớ.
  - File (≤ 50MB) được giữ trong RAM khi xử lý nền — Render free 512MB, tránh nhiều người cùng quét PDF lớn.
  - Chấp nhận đề xuất thay mọi lần xuất hiện NGUYÊN TỪ của `original` trong trang đó (theo thiết kế, agent gộp lỗi lặp lại
    thành 1 mục); từ nằm vắt qua định dạng Markdown (vd. `**dead**line`) sẽ không được tô sáng / không khớp.
  - LLM rà soát vẫn có thể đề xuất sai (vd. "sửa" tên riêng tiếng Anh vốn đúng) — vì vậy mọi đề xuất phải được duyệt.

## [2026-09-15] — Tải lên nhiều file một lúc (Quét tài liệu gộp 1 phiên, Tải file ghi âm mỗi file 1 phiên)
- Quyết định (đã hỏi người dùng): áp dụng cho **cả hai luồng**; **Quét tài liệu**: nhiều ảnh/PDF → **gộp thành 1 phiên**
  theo thứ tự người dùng sắp xếp; **Tải file ghi âm**: **mỗi file 1 phiên riêng** (muốn nối thì dùng Gộp phiên có sẵn).
  Tự quyết thêm: file OCR lỗi lẻ không làm hỏng cả lô (giữ các file khác, cảnh báo) — nhất quán với quyết định "giữ
  kết quả OCR đã trả phí" trước đó; giới hạn 20 file/lần, Quét tổng ≤ 200MB; tải ghi âm 2 file song song.
- Đã làm:
  - **Backend — OCR nhiều file:**
    - `POST /api/ocr-extract` nhận `files` (lặp lại, đúng thứ tự) và vẫn nhận `file` đơn (tương thích). Kiểm tra từng file
      (lỗi ghi rõ tên file), số file ≤ `MAX_OCR_FILES`=20, tổng ≤ `MAX_OCR_BATCH_MB`=200, tổng trang ≤ 1000. File được chép
      ra thư mục tạm trên đĩa (`tempfile.mkdtemp`) thay vì giữ trong RAM; validate PDF đọc từ đường dẫn; lỗi validate /
      thiếu key thì xoá thư mục ngay. Response thêm `files`. Tiêu đề mặc định "tên-file-đầu (+N file)",
      `original_filename` = danh sách tên (cắt 255 ký tự).
    - Job nền (`process_ocr_session`): OCR tối đa 3 file song song (đọc file vào RAM ngay trước khi gửi), nối trang theo
      thứ tự tải lên, đánh số liên tục; `OcrData.files` (`OcrSourceFile`: filename, first_page, page_count, error) — cũng
      trả trong `SessionRead.ocr.files`. Một phần file lỗi → `completed` + `files[].error`; mọi file lỗi → `failed`
      ("không xử lý được file nào"); luôn xoá thư mục tạm.
  - **Backend — ghi âm:** `POST /api/upload-transcribe` thêm form `group_id` tuỳ chọn (kiểm tra nhóm tồn tại TRƯỚC khi
    gửi file sang Soniox) để gán cả lô vào 1 nhóm ngay khi tạo.
  - **Frontend:**
    - `components/FilePicker.jsx` (mới, dùng chung): chọn / kéo thả nhiều file, chống trùng, liệt kê file bị bỏ qua kèm
      lý do, ảnh thu nhỏ (object URL, tự thu hồi), sắp xếp thứ tự bằng kéo thả + nút mũi tên, bỏ từng file / tất cả, nút
      "Chụp ảnh tài liệu" → "Chụp thêm trang" trên thiết bị cảm ứng.
    - Quét tài liệu (`FileIngestPage` + `ScanPage`): nhiều file → 1 request → 1 phiên; nút "Trích xuất N file thành 1 tài
      liệu", cảnh báo vượt 200MB; lỗi khi tải lên thì giữ danh sách để sửa ("Sửa danh sách file"). Trang chi tiết: nhãn
      "Trang N · tên file" khi gộp nhiều file, meta "N trang · M file", cảnh báo "Không đọc được N file".
    - Tải file lên (`UploadPage` viết lại): hàng đợi — chọn nhiều file + nhóm (tuỳ chọn, tạo nhóm tại chỗ), mỗi file 1
      dòng: chờ → tiến trình tải lên → đang chuyển (đồng hồ, tự poll) → xong (nút "Mở") / lỗi (nút "Thử lại" nếu lỗi lúc
      tải lên); huỷ / ẩn từng dòng, "Dọn mục đã xong", thanh tiến độ tổng. Có thể chọn thêm file khi hàng đợi đang chạy.
      Cảnh báo khi đóng tab lúc còn file chưa gửi xong. Phiên đã tạo lưu localStorage `notewave:active-uploads` (tự chuyển
      dữ liệu cũ `notewave:active-upload`). Tải đúng 1 file và xong → vẫn hiện transcript ngay tại trang như trước.
    - `api.js`: `uploadWithProgress(path, fields, …)` gửi field lặp lại cho mảng; `ocrExtract(files)`,
      `uploadAudio(file, { groupId })`.
  - Tài liệu: `CLAUDE.md` + `GEMINI.md` (bảng endpoint `/api/upload-transcribe`, `/api/ocr-extract`; ghi chú OCR `files` /
    thư mục tạm / lỗi từng file; quy ước frontend FilePicker / FileIngestPage / hàng đợi UploadPage), `DEPLOY.md` (checklist
    kiểm thử quét nhiều trang + tải nhiều file ghi âm, 1 dòng xử lý sự cố), `README.md`. Sửa số liệu test ghi nhầm ở mục
    trước ("55 passed" → 53 passed + 2 skipped).
- File/module đã thay đổi:
  - Backend: `server/app/models/ocr.py`, `server/app/models/session.py`, `server/app/routers/ocr.py`,
    `server/app/routers/upload.py`, `server/app/services/ocr.py`, `server/app/services/ocr_processing.py`,
    `server/tests/mistral_fake.py`, `server/tests/test_ocr.py`, `server/tests/test_upload_soniox.py`.
  - Frontend: `client/src/components/FilePicker.jsx` (mới), `client/src/components/FileIngestPage.jsx`,
    `client/src/pages/ScanPage.jsx`, `client/src/pages/UploadPage.jsx`, `client/src/components/OcrDocumentView.jsx`,
    `client/src/components/SessionDetail.jsx`, `client/src/lib/api.js`.
  - Khác: `CLAUDE.md`, `GEMINI.md`, `DEPLOY.md`, `README.md`, `PROGRESS.md`.
- Đã kiểm thử:
  - `pytest` toàn bộ trên Supabase (schema `notewave_test`): **57 passed, 2 skipped** (tổng 59; 2 test gọi LLM thật). Test
    mới: gộp 3 file (ảnh + PDF 2 trang + ảnh) → đúng thứ tự, trang 1–4, `files` đúng, đề xuất gắn đúng trang, xoá cả 3 file
    trên Mistral, thư mục tạm bị xoá, export có nhãn trang; 1/3 file lỗi → completed giữ 2 file; mọi file lỗi → failed;
    validate nhiều file (quá số file, file sai định dạng nêu tên, tổng số trang, không có file); upload ghi âm với
    `group_id` (gán nhóm; nhóm không tồn tại → 404 và không gọi Soniox). Mistral giả lập giờ cấp id riêng từng file và trả
    nội dung / lỗi theo tên file.
  - `vite build` OK, `oxlint` không có cảnh báo mới. Bản build + API giả lập + Edge headless (tạo file bằng
    `DataTransfer`): Tải file lên 6 file → 1 file .txt bị bỏ qua kèm lý do, hàng đợi hiện đồng thời xong (nút Mở) / đang
    chuyển (đồng hồ) / lỗi tải lên (Thử lại); Quét tài liệu 4 file → ảnh thu nhỏ, số thứ tự, nút mũi tên đổi thứ tự đúng.
- Đang dang dở / chưa xong: chưa thử với Mistral / Soniox thật cho lô nhiều file; chưa thử trên điện thoại thật (chụp nhiều
  trang liên tiếp, kéo thả sắp xếp không có trên cảm ứng — dùng nút mũi tên).
- Việc cần làm tiếp theo: điền `MISTRAL_API_KEY` và quét thử 3–5 ảnh chụp liên tiếp trên điện thoại; tải thử 3 file ghi âm
  thật với nhóm; sau khi deploy đánh dấu 2 mục checklist mới trong `DEPLOY.md`.
- Vấn đề đã biết:
  - Hàng đợi tải ghi âm nằm ở trình duyệt: file CHƯA gửi xong sẽ mất khi tải lại / đóng tab (có cảnh báo); file đã tạo
    phiên thì vẫn được xử lý và khôi phục trong danh sách.
  - Quét nhiều file: file tạm nằm trên đĩa tạm của Render (mất khi restart — cùng cơ chế `failed` sau 10 phút như trước).
  - Mỗi dòng đang xử lý trong hàng đợi poll trạng thái riêng mỗi 3 giây (tối đa 20 dòng) — chấp nhận được với Render free.

## [2026-09-16] — Sắp xếp Lịch sử, xem trước file trước khi tải lên, thu gọn khối trên màn hình nhỏ + nghiên cứu công thức toán
- Quyết định (đã hỏi người dùng): preview PDF bằng **pdf.js** (`pdfjs-dist`, vẽ từng trang ra canvas) thay vì nhúng
  `<iframe>` — giao diện giống nhau mọi trình duyệt, Safari iOS cũng xem được (đổi lại: thêm thư viện, chunk lazy
  ~432 KB / 130 KB gzip + worker 1,26 MB chỉ tải khi mở preview PDF); **không** preview cho file ghi âm; được phép gọi
  Mistral OCR thật để nghiên cứu công thức toán.
- Đã làm:
  1. **Sắp xếp danh sách Lịch sử** (`?sort=`, ORDER BY ở DB để đúng với `limit`/`offset`):
     - Backend: `SessionSort` trong `models/session.py`; bảng `_SORTS` trong `routers/sessions.py` với 7 kiểu —
       `created_desc` (mặc định), `created_asc`, `title_asc`, `title_desc`, `updated_desc`, `duration_desc`,
       `duration_asc`. Tiêu đề so sánh `func.lower` (không phân biệt hoa/thường, thứ tự chữ cái theo collation
       Postgres — "Ảnh tuần" đứng trước "bản ghi"); `duration_ms` null (phiên OCR) luôn xếp cuối (`nullslast`);
       luôn kèm `created_at` làm tiêu chí phụ để phân trang ổn định; giá trị lạ → 422.
     - Frontend: dropdown "Sắp xếp" cạnh bộ lọc nhóm trong `HistoryPage`, nhớ lựa chọn qua localStorage
       `notewave:history-sort` (bộ lọc `source`/`group_id` vẫn là state tạm như trước — sort là *tuỳ chọn hiển thị*
       nên đáng nhớ, còn bộ lọc thì không). Đổi từ khoá / bộ lọc không làm mất kiểu sắp xếp.
  2. **Xem trước file trước khi tải lên** (dùng chung trong `FilePicker`, bật bằng prop `preview`):
     - `components/FilePreviewDialog.jsx` (Modal `size="xl"` — thêm cỡ `xl` cho `Modal.jsx`): ảnh hiện full-size
       (dùng lại object URL của thumbnail), PDF vẽ bằng pdf.js; chuyển qua lại giữa các file (‹ ›), nút "Bỏ file này".
     - `components/PdfPreview.jsx` (lazy): vẽ từng trang ra canvas theo bề rộng khung, có điều hướng trang, giới hạn
       độ phân giải 2.5×. **Lỗi đã gặp và sửa:** đặt `GlobalWorkerOptions.workerSrc` bằng URL (`?url`) làm pdf.js tạo
       *classic worker* trong khi bản dist v6 là ES module → mọi PDF đều báo "không đọc được"; phải dùng
       `workerPort = new Worker(new URL(...), { type: 'module' })`.
     - Dòng file trong danh sách trở thành nút "xem trước" (hiện icon con mắt khi rê chuột) khi file là ảnh/PDF —
       chỉ bật ở trang "Quét tài liệu"; trang "Tải file lên" (audio) giữ nguyên.
  3. **Thu gọn khối trên màn hình nhỏ** (`< xl`): thêm `ui.jsx::CollapseToggle` (chevron, `aria-expanded`), dùng ở
     header khối "Transcript"/"Nội dung tài liệu" và "Tóm tắt bằng AI". State cục bộ trong `SessionDetail`, mặc định
     nội dung mở + tóm tắt đóng; khi thu gọn, header hiện tóm lược ("N đoạn" / "N trang") và ẩn danh sách người nói /
     cảnh báo OCR. Nút "Xem tóm tắt" trên toolbar tự mở khối tóm tắt rồi cuộn tới. Từ `xl` nút bị ẩn, layout 2 cột
     giữ nguyên. Áp dụng cho cả 3 loại phiên (khối nội dung dùng chung cho `TranscriptView` và `OcrDocumentView`).
  4. **Nghiên cứu công thức toán (chưa code)** — xem mục "Kết quả nghiên cứu" bên dưới.
- File/module đã thay đổi:
  - Backend: `server/app/models/session.py`, `server/app/routers/sessions.py`, `server/tests/test_sessions.py`.
  - Frontend mới: `client/src/components/FilePreviewDialog.jsx`, `client/src/components/PdfPreview.jsx`,
    `client/src/lib/files.js`.
  - Frontend sửa: `client/src/pages/HistoryPage.jsx`, `client/src/lib/api.js`, `client/src/components/FilePicker.jsx`,
    `client/src/components/FileIngestPage.jsx`, `client/src/pages/ScanPage.jsx`, `client/src/components/Modal.jsx`,
    `client/src/components/SessionDetail.jsx`, `client/src/components/SummaryPanel.jsx`, `client/src/components/ui.jsx`,
    `client/package.json` (+ `pdfjs-dist`), `client/package-lock.json`.
  - Khác: `CLAUDE.md`, `GEMINI.md`, `PROGRESS.md`.
- Đã kiểm thử:
  - `pytest` toàn bộ: **58 passed, 2 skipped** (2 test LLM thật). Test sort mới: 7 kiểu sắp xếp, kết hợp bộ lọc,
    phân trang giữ đúng thứ tự, `sort` sai → 422, phiên không có thời lượng xếp cuối, đổi tên → lên đầu `updated_desc`.
  - `vite build` OK, `oxlint` không có cảnh báo mới. Kiểm tra UI trên bản build + API giả lập, điều khiển trình duyệt
    qua **CDP** (`scratchpad/cdp.mjs` — `--virtual-time-budget` của Edge headless bị treo với trang có module worker):
    dropdown sắp xếp hiện đúng; preview ảnh và preview PDF (render trang bài giảng toán) hoạt động; màn hình 520px:
    mặc định nội dung mở + tóm tắt đóng, bấm thu gọn nội dung → chỉ còn header "Nội dung tài liệu · 2 trang".
- Kết quả nghiên cứu công thức toán (gọi Mistral OCR THẬT, 3 trang, ~1 cent):
  - **Mistral OCR trả LaTeX thật**: inline `$...$` và block `$$...$$` — `\frac`, `\int_0^1`, `\sum_{i=1}^n`,
    `\lim_{h \to 0}`, `\sqrt`, `\begin{vmatrix}`, `\Delta`, `\pm`, `\det` đều đúng. Kết quả giống nhau với cả PDF
    (text layer) và ảnh PNG chụp màn hình → không phụ thuộc việc PDF có text sẵn.
  - **Hiện tại app KHÔNG render**: `OcrDocumentView` chưa có `remark-math`/`rehype-katex` nên người dùng thấy
    nguyên văn `$$\int_0^1 x^2 dx = ...$$`.
  - **Chi phí nếu thêm KaTeX** (đo thật): `katex.min.js` 272 KB (76 KB gzip), `katex.min.css` 25 KB (3,6 KB gzip),
    fonts tổng 1,2 MB / 60 file nhưng trình duyệt chỉ tải subset thực dùng (~26 KB Main-Regular + ~16 KB Math-Italic
    + vài font Size khi có dấu tích phân lớn). Gộp vào chunk lazy `OcrDocumentView` (đang 158 KB / 47 KB gzip) →
    chỉ ảnh hưởng phiên OCR. Phiên bản: katex 0.18.7, rehype-katex 7, remark-math 6.
  - **Đồ thị / hình vẽ:** Mistral trả về dạng **vùng ảnh cắt** (`img-0.jpeg` + bbox trong `page.images`), KHÔNG
    tái tạo vector. Muốn hiển thị phải bật `include_image_base64=True` và lưu ảnh (hiện code đặt `False` và xoá
    tham chiếu ảnh khỏi Markdown) → tốn dung lượng DB/response; chưa làm.
  - **Tương tác với `ocr_review_agent`:** chạy thật trên trang có công thức — agent chỉ đề xuất `derivativ`→`derivative`
    và `exsam`→`exam`, KHÔNG đụng vào LaTeX. Bộ lọc sẵn có (`corrected` chỉ ký tự Latin cơ bản, khớp nguyên từ) cũng
    chặn được phần lớn rủi ro; nếu thêm render công thức thì nên bổ sung: bỏ qua đoạn nằm giữa `$...$`/`$$...$$` khi
    gửi cho agent (hoặc chặn ở bước lọc).
  - Ghi nhận thêm: chính Mistral OCR tự sửa vài từ tiếng Anh sai trong ảnh in ("meetting"→"meeting",
    "Jupyther"→"Jupyter") nhưng giữ nguyên "derivativ", "exsam" → vẫn cần bước rà soát bằng LLM.
- Đang dang dở / chưa xong: chưa render công thức toán (chờ quyết định); chưa thử preview/thu gọn trên điện thoại thật.
- Việc cần làm tiếp theo: người dùng quyết định có thêm `remark-math` + `rehype-katex` + `katex` hay không (nếu có:
  thêm vào pipeline `OcrDocumentView`, import CSS KaTeX trong chunk lazy, loại trừ vùng `$...$` khỏi rà soát tiếng Anh,
  thêm test render công thức).
- Vấn đề đã biết:
  - Khối "Tóm tắt bằng AI" khi CHƯA có tóm tắt (thẻ giới thiệu + nút) không có nút thu gọn — khối đã ngắn, không cần.
  - Preview PDF vẽ bằng canvas nên không chọn/copy được text trong preview (chỉ để xem đúng file trước khi gửi).
  - pdf.js worker + `--virtual-time-budget` của Edge headless không chạy được: kiểm thử UI có PDF phải dùng CDP.


## [2026-09-16] — Đổi nhãn tab "Tải file lên" → "Tải audio"
- Đã làm: nhãn tab điều hướng (desktop) đổi thành "Tải audio", nhãn ngắn (md và bottom nav trên mobile) thành
  "Audio" — tránh nhầm với tab "Quét tài liệu" vì cả hai đều là tải file lên. Nút tắt cùng trỏ tới tab này ở
  empty state trang Lịch sử đổi theo.
- File/module đã thay đổi: `client/src/App.jsx`, `client/src/pages/HistoryPage.jsx`, `PROGRESS.md`
- Đã kiểm thử: `vite build` OK, `oxlint` không có cảnh báo mới; chụp màn hình bản build (1440px và 820px) thấy
  nhãn mới hiển thị đúng.
- Chưa đổi (giữ nguyên, chờ ý kiến): tiêu đề trang "Tải file ghi âm lên"; nhãn nguồn phiên "File tải lên"
  (`lib/format.js::SOURCE_LABELS`, bộ lọc trang Lịch sử) và nhãn trong file xuất .txt/.docx + tiêu đề mặc định
  ở backend (`services/export.py`, `routers/sessions.py`).

## [2026-09-16] — Sửa xem trước file: nội dung co vừa màn hình, không cuộn
- Vấn đề: ảnh dọc (vd. ảnh chụp vở 1200×1900) trong hộp thoại xem trước bị giới hạn `max-h-[70svh]`, trong khi thân
  hộp thoại còn thấp hơn (đã trừ header/footer) → sinh thanh cuộn, ảnh bị cắt.
- Đã làm:
  - `Modal.jsx`: thêm prop `fill` — panel cao cố định `h-[92svh]` (thay vì `max-h`) để phần trăm chiều cao bên trong
    phân giải được, thân hộp thoại thành flex + `overflow-hidden`; thêm `data-modal-body` cho dễ kiểm thử.
  - `FilePreviewDialog.jsx`: bật `fill`; ảnh dùng `m-auto max-h-full max-w-full object-contain` → luôn vừa khung.
  - `PdfPreview.jsx`: khung canvas là flex-1 `min-h-0`, canvas `max-h-full max-w-full`; scale khi render tính theo
    MIN(bề ngang, chiều cao) của khung thay vì chỉ bề ngang → trang PDF hiện trọn trong một màn hình.
- File/module đã thay đổi: `client/src/components/Modal.jsx`, `client/src/components/FilePreviewDialog.jsx`,
  `client/src/components/PdfPreview.jsx`, `PROGRESS.md`
- Đã kiểm thử: `vite build` OK, `oxlint` không có cảnh báo mới. Qua CDP ở cửa sổ 1091×790 với ảnh dọc 1200×1900 và
  PDF bài giảng: `bodyScroll=false`, ảnh 286×451 và trang PDF 346×449 nằm gọn trong vùng 896×483 — không còn cuộn.

## [2026-09-16] — Xem trước PDF: cuộn qua toàn bộ trang (sửa hành vi vừa làm)
- Vấn đề: lần sửa trước ẩn thanh cuộn của hộp thoại để ảnh vừa màn hình, nhưng PDF nhiều trang thì chỉ xem được
  1 trang và không kéo xuống được.
- Hành vi mới (`PdfPreview.jsx` viết lại):
  - Vùng xem là danh sách dọc TẤT CẢ các trang, cuộn như trình đọc PDF; ảnh vẫn giữ "vừa khung, không cuộn".
  - Mỗi trang chỉ được vẽ khi tới gần tầm nhìn (IntersectionObserver, `rootMargin` 600px) và canvas được giải phóng
    (`width=0`) khi cuộn ra xa → PDF dài không phình RAM; khung giữ chỗ đúng kích thước nên thanh cuộn không nhảy.
  - Chỉ báo "Trang x / N" tính theo `scrollTop`, nút ‹ › cuộn mượt tới trang trước/sau.
  - 2 chế độ: **Vừa cả trang** (mặc định — mỗi trang hiện trọn, cuộn để sang trang) và **Vừa chiều ngang** (trang
    rộng bằng khung, chữ to hơn, cuộn dọc trong từng trang). Canvas vẽ theo `devicePixelRatio` (tối đa 2×).
- File/module đã thay đổi: `client/src/components/PdfPreview.jsx`, `CLAUDE.md`, `GEMINI.md`, `PROGRESS.md`
- Đã kiểm thử: `vite build` OK, `oxlint` không có cảnh báo mới. Qua CDP với PDF 12 trang (cửa sổ 1091×790):
  mở ra thấy 12 khung trang, chỉ 3 canvas được vẽ; cuộn 2000px → nhãn đổi thành "Trang 6 / 12", số canvas đã vẽ = 5
  (các trang xa đã được giải phóng); đổi sang "Vừa chiều ngang" → trang rộng 804px, tổng chiều cao cuộn 13808px.
- Vấn đề đã biết: chưa có zoom tự do / kéo ảnh; PDF có trang khác khổ thì khung giữ chỗ tính theo trang đầu (trang
  vẫn vẽ đúng tỉ lệ của nó, chỉ có thể lệch khoảng trống).

## [2026-09-16] — Sửa lỗi trắng trang khi đóng xem trước PDF
- Lỗi: bấm "Đóng" (hoặc Esc) sau khi xem trước PDF → toàn bộ giao diện biến mất, chỉ còn nền.
- Nguyên nhân: cleanup của effect trong `PdfPreview` gọi `PDFDocumentProxy.destroy()`, nhưng **pdf.js v6 đã bỏ
  `destroy()` trên `PDFDocumentProxy`** (chỉ `PDFDocumentLoadingTask` còn) → `TypeError: destroy is not a function`
  ném ra trong lúc React unmount → React gỡ sạch cây component (không có error boundary nên ra trang trắng).
- Đã sửa:
  - `PdfPreview.jsx`: giữ `loadingTask` và gọi `task.destroy()` (nuốt promise reject, bọc try/catch để cleanup không
    bao giờ ném ra ngoài); nhánh bị huỷ (StrictMode chạy effect 2 lần ở dev) cũng tự `destroy()` để không giữ worker.
  - Thêm `components/ErrorBoundary.jsx` bọc toàn app trong `main.jsx`: lỗi component sau này sẽ hiện thông báo +
    nút "Tải lại trang" kèm message lỗi, thay vì trang trắng.
- File/module đã thay đổi: `client/src/components/PdfPreview.jsx`, `client/src/components/ErrorBoundary.jsx` (mới),
  `client/src/main.jsx`, `CLAUDE.md`, `GEMINI.md`, `PROGRESS.md`
- Đã kiểm thử: tái hiện được lỗi trên bản build (root rỗng, `rootHtmlLength = 0`, exception
  `n?.destroy is not a function`). Sau khi sửa, kiểm tra qua CDP trên **cả bản build lẫn `vite dev` (StrictMode)**
  với PDF 12 trang: mở preview → cuộn 1500px → Đóng (và thử cả phím Esc) → hộp thoại đóng, `rootHtmlLength = 18108`,
  danh sách file còn nguyên, không có lỗi/console error nào. `vite build` OK, `oxlint` không có cảnh báo mới.

## [2026-09-18] — Phân tích yêu cầu "Ghi chú Cornell" + chốt quyết định (chưa code)
- Đã làm: đánh giá tính khả thi của yêu cầu tính năng, đối chiếu với code hiện tại, hỏi người dùng các quyết định kiến trúc.
- Quyết định đã chốt (người dùng trả lời):
  - **Không đồng bộ nhiều thiết bị** (không polling / WebSocket / Supabase Realtime). App vẫn một người dùng, không auth.
  - **Không kiểm tra phiên bản khi lưu** — last-write-wins. Người dùng chấp nhận rủi ro: tab/thiết bị giữ nội dung cũ
    tự lưu sẽ ghi đè bản mới hơn mà không cảnh báo.
  - **Ảnh trong note → Supabase Storage**, gọi REST từ backend bằng `httpx` (không dùng SDK Supabase ở client), bucket
    private, ảnh trả về qua signed URL ngắn hạn. Cần biến mới: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (chỉ backend),
    `NOTE_ASSETS_BUCKET` → cập nhật `.env.example`, `render.yaml`, `DEPLOY.md` khi làm.
  - **Lưu nội dung:** `content_json` (Tiptap JSON, để mở lại editor) + `content_md` (Markdown do frontend sinh bằng
    `@tiptap/markdown`) → backend chỉ dùng Markdown cho tìm kiếm / tóm tắt / export (`markdown_docx.py`) / backlink.
  - **Thư viện được duyệt:** Tiptap v3 (`@tiptap/*` MIT: StarterKit, TaskList, Table, Image, Mathematics, Markdown),
    `katex` + `remark-math` + `rehype-katex` (dùng chung cho `OcrDocumentView` → quyết định treo ngày 2026-09-16 đã
    được thông qua). Tải lazy chỉ ở `#/notes`. `dexie` / `vite-plugin-pwa`: chưa duyệt.
  - **Thư mục:** `NoteFolder` riêng **dạng cây** (`parent_id`) + Tag nhiều-nhiều; KHÔNG dùng lại `SessionGroup`.
  - **Cột trái Cornell:** danh sách câu hỏi `{id, text, anchor}`, mỗi câu **neo vào một đoạn** của nội dung (bấm → cuộn
    tới), có **chế độ ôn tập** (ẩn cột nội dung để tự kiểm tra).
  - **Tuỳ chỉnh giao diện: chỉ theo từng note** (cột `style` JSONB, không có cấu hình chung).
  - **Note tách biệt hoàn toàn với phiên:** không có "Tạo note từ phiên", bỏ `source_session_id` và endpoint
    `/api/notes/from-session/{id}`.
  - **Tóm tắt AI:** agent `NoteSummary` riêng (ý chính, khái niệm, câu hỏi ôn tập), dùng chung `SUMMARY_MODEL` +
    `build_model_settings`; không dùng `MeetingSummary`.
  - Chưa hỏi lại nhưng áp dụng theo đề xuất ban đầu: canvas thuần cho bảng vẽ công thức; xuất PDF bằng `window.print()`;
    backlink do backend tự tính lại từ node liên kết trong nội dung mỗi lần lưu (chỉ cần `GET .../backlinks`).
- File/module đã thay đổi: `PROGRESS.md`
- Việc cần làm tiếp theo:
  1. Thử nghiệm trước khi code: (a) Mistral OCR với công thức **viết tay** trên canvas (gửi data URI, chưa kiểm chứng —
     trước đây chỉ đo chữ in); (b) Tiptap với bộ gõ tiếng Việt (Telex, Gboard/Laban Key) trên Android thật.
  2. Giai đoạn 1: model `Note`/`NoteFolder`/`Tag`/`NoteTagLink` + CRUD, trang `#/notes`, layout Cornell, tự lưu debounce
     + nháp cục bộ khi lưu thất bại (Render đang khởi động lại / mất mạng).
- Vấn đề đã biết: app không có auth, ai biết URL backend thì đọc được mọi note.

## [2026-09-18] — Thử nghiệm 1: Mistral OCR với công thức vẽ tay trên canvas (chưa code tính năng)
- Cách làm: vẽ 8 công thức bằng `<canvas>` trong Edge headless (font viết tay Ink Free có rung/xoay ngẫu nhiên, tích
  phân/căn/sigma/ngoặc vẽ bằng path, nét tròn 3px, nền trắng 1000×360) → gọi `mistral-ocr-latest` THẬT. Mỗi ảnh chạy
  3 lần ở 2 dạng: nguyên khung và cắt sát nét vẽ (+ lề 24px). Tổng ~58 lần gọi (~5–10 cent). Script, ảnh, kết quả nằm
  trong scratchpad của phiên (không commit).
- Kết quả:
  - **Đúng 7/8 công thức**: mũ, tích phân có cận, căn, tổng Σ có cận, giới hạn, nghiệm phương trình bậc 2 (phân số lồng
    căn), hệ phương trình. Trả LaTeX chuẩn, render được bằng KaTeX.
  - **Kết quả tất định**: 3 lần chạy cho kết quả y hệt → gọi lại không sửa được lỗi, phải để người dùng sửa tay.
  - **1 công thức sai ổn định**: `(a+b)/(c-d) = k` đọc thành `c+d` và `= e`. Với ảnh nguyên khung (nhiều khoảng trắng)
    Mistral còn **bịa thêm 2 công thức không có trong ảnh**; ảnh đã cắt sát thì hết bịa, nhưng vẫn đọc sai ký tự.
  - **Cắt sát nét vẽ** loại bỏ được lỗi bịa nội dung, không làm hỏng công thức nào (hệ phương trình ra `\{\begin{matrix}`
    thay vì `\left\{...\right.` — vẫn đúng nội dung, KaTeX render được).
  - **Cách bọc không thống nhất**: `$$...$$`, `\[...\]`, có khi nhiều khối → backend phải chuẩn hoá (bỏ dấu bọc, trả
    LaTeX trần; nếu có nhiều khối thì trả kèm cảnh báo).
  - **Độ trễ**: gửi data URI ~0,4–0,8 s (lần đầu ~3,8 s), qua Files API (upload → signed URL → OCR → xoá) ~1,6–1,9 s →
    endpoint công thức gửi **data URI**, không đi Files API.
- Kết luận thiết kế cho `POST /api/notes/formula-ocr` (Giai đoạn 2): frontend cắt canvas sát nét vẽ trước khi gửi;
  backend gửi data URI, chuẩn hoá dấu bọc; UI **luôn cho xem trước bản render KaTeX + ô sửa LaTeX** trước khi chèn
  (không chèn thẳng).
- Giới hạn của thử nghiệm: ảnh là font viết tay + rung ngẫu nhiên, sạch hơn chữ viết tay thật → cần kiểm lại bằng nét vẽ
  thật của người dùng (tiện nhất là khi đã có bảng vẽ ở Giai đoạn 2). Chưa so sánh với model vision (gpt-5.6-luna).
- File/module đã thay đổi: `PROGRESS.md`
- Việc cần làm tiếp theo: Thử nghiệm 2 (Tiptap + bộ gõ tiếng Việt trên Android thật) hoặc bắt đầu Giai đoạn 1.

## [2026-09-18] — Ghi chú Cornell: GIAI ĐOẠN 1 XONG (nền tảng note, online-only)
- Trạng thái giai đoạn của tính năng Ghi chú (xem "Lộ trình Ghi chú" bên dưới): **Giai đoạn 1 — xong.**
  Giai đoạn 2 (ảnh / bảng / KaTeX / vẽ công thức → LaTeX / paste) — chưa bắt đầu. Giai đoạn 3–5 — chưa bắt đầu
  (GĐ4 phần đồng bộ nhiều thiết bị đã bị bỏ theo quyết định của người dùng).
- Đã làm:
  - **Backend:** model `Note`, `NoteFolder` (cây, `parent_id`), `NoteTag`, `NoteTagLink` (`models/note.py`); logic dùng chung
    `services/notes.py`; router `/api/notes` (CRUD + PATCH từng phần + tìm/lọc/sắp xếp ở DB), `/api/note-folders` (tạo /
    đổi tên / chuyển cha có chặn vòng lặp / xoá chuyển nội dung lên cha), `/api/tags` (CRUD). 4 bảng mới tự bật RLS qua cơ
    chế sẵn có (đã kiểm tra `relrowsecurity = true`).
  - **Frontend:** tab "Ghi chú" (`#/notes`, `#/notes/<id>`, 5 tab trên header và bottom nav); `pages/NotesPage.jsx` (cây thư
    mục + tag ở sidebar từ `lg`, dưới `lg` là dropdown + chip; tìm kiếm, sắp xếp nhớ localStorage `notewave:notes-sort`,
    quản lý thư mục/tag); `components/notes/NoteDetail.jsx` (bố cục Cornell: `lg` 2 cột + dải tóm tắt, dưới `lg` 3 tab);
    editor Tiptap có thanh công cụ (heading, đậm/nghiêng/gạch chân/gạch ngang/code, 3 loại danh sách + checklist, trích
    dẫn, khối code, kẻ ngang, undo/redo) + gõ tắt Markdown; cột câu hỏi có neo vào đoạn / đi tới đoạn / cảnh báo neo mất;
    chế độ Ôn tập; giao diện riêng từng note (6 màu, 4 font — Lora / Patrick Hand tải từ Google Fonts khi dùng, 4 cỡ chữ);
    tự lưu + nháp cục bộ + tự thử lại + khôi phục nháp; xoá note.
  - Tiptap là chunk lazy `NoteDetail` (~495 KB / 157 KB gzip); `NotesPage` 19 KB / 6 KB gzip; bundle chính không đổi.
- File/module đã thay đổi:
  - Backend mới: `server/app/models/note.py`, `server/app/services/notes.py`, `server/app/routers/notes.py`,
    `server/app/routers/note_folders.py`, `server/app/routers/tags.py`, `server/tests/test_notes.py`.
  - Backend sửa: `server/app/main.py`, `server/app/db.py` (import model), `server/tests/conftest.py` (TRUNCATE thêm 4 bảng).
  - Frontend mới: `client/src/pages/NotesPage.jsx`, `client/src/components/notes/` (`NoteDetail`, `NoteContentEditor`,
    `CueColumn`, `NoteStylePicker`, `FolderSelect`, `TagPicker`, `NameDialog`, `useDismiss.js`, `useAutoGrow.js`),
    `client/src/hooks/useNoteLibrary.js`, `client/src/hooks/useNoteAutosave.js`, `client/src/lib/noteEditor.js`,
    `client/src/lib/noteStyles.js`.
  - Frontend sửa: `client/src/App.jsx`, `client/src/lib/api.js` (API note + tuỳ chọn `keepalive`), `client/src/index.css`
    (`.note-sheet` / `.note-prose`), `client/package.json` + lock (Tiptap v3.31).
  - Khác: `CLAUDE.md`, `GEMINI.md`, `PROGRESS.md`.
- Đã kiểm thử:
  - `pytest` toàn bộ: **72 passed, 2 skipped** (14 test mới cho note/thư mục/tag; 2 skip là test LLM thật).
  - `vite build` OK; `oxlint` không có cảnh báo mới (các cảnh báo còn lại đều ở file cũ).
  - UI thật qua CDP (Edge headless) với **backend thật chạy trên schema `notewave_test`** (launcher trong scratchpad, cùng cơ
    chế `schema_translate_map` của conftest — đã kiểm tra schema `public` KHÔNG có bảng note nào) + `vite dev` (StrictMode):
    - Desktop 1440px (25 bước): tạo thư mục → note mới vào đúng thư mục → gõ tắt `## `, `- `, `[ ] ` ra đúng khối → mọi khối có
      `data-id` → 3 câu hỏi (Enter tạo câu mới), neo 2 câu, vạch đánh dấu đúng 2 đoạn → tự lưu (tiêu đề, cues + neo, tóm tắt,
      Markdown đúng) → bấm câu hỏi cuộn + nháy đoạn → giao diện sepia/viết tay/lớn áp dụng + lưu → tạo tag mới trong picker →
      Ôn tập (chỉ đọc, "Xem đáp án" chỉ ở câu đã neo, hiện đúng chữ) → danh sách hiện thư mục/tag/số câu hỏi → tìm theo nội dung.
    - Mobile 390px (23 bước): không tràn ngang, sidebar → dropdown, 3 tab, thanh công cụ cuộn ngang trong chính nó, câu hỏi
      hiện đủ chữ khi mở tab, bấm câu đã neo tự về tab Nội dung; **mất mạng** khi gõ → "Chưa lưu được" + nháp localStorage →
      có mạng lại tự lưu + xoá nháp; **khôi phục nháp** mới hơn máy chủ khi mở lại (nháp cũ hơn thì bỏ); rời trang trước khi hết
      debounce vẫn lưu; đổi tên / xoá thư mục (note chuyển ra ngoài); xoá note (404, không sót nháp). Không có lỗi console.
  - Lỗi phát hiện qua kiểm thử và đã sửa: (1) hiệu ứng nháy bằng class bị ProseMirror gỡ ngay → `el.animate()`;
    (2) chấm đánh dấu đoạn được neo trông như dấu đầu dòng → vạch dọc + nền nhạt; (3) textarea câu hỏi cao 0px khi mount
    lúc tab đang ẩn (chữ không hiện trên mobile) → `useAutoGrow` với ResizeObserver; (4) preview danh sách còn dấu `-`.
- Đang dang dở / chưa xong: chưa có export note (.txt/.docx/.pdf — lộ trình để GĐ5, có thể làm sớm bằng `content_md` +
  `markdown_docx.py`); chưa có kéo-thả note/thư mục (chuyển thư mục cha qua menu "Chuyển tới…", chuyển note qua dropdown).
- Việc cần làm tiếp theo: Giai đoạn 2 — thêm `katex`/`remark-math`/`rehype-katex`, `@tiptap/extension-mathematics`,
  `@tiptap/extension-table`; ảnh qua Supabase Storage (biến mới `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `NOTE_ASSETS_BUCKET`
  → cập nhật `.env.example`, `render.yaml`, `DEPLOY.md`); bảng vẽ canvas + `POST /api/notes/formula-ocr` (theo kết luận
  Thử nghiệm 1: cắt sát nét vẽ, gửi data URI, chuẩn hoá dấu bọc, luôn cho xem trước + sửa LaTeX trước khi chèn).
- Vấn đề đã biết:
  - **Chưa thử bộ gõ tiếng Việt (Telex/VNI, Gboard/Laban Key) trên điện thoại thật** — người dùng bỏ qua Thử nghiệm 2; CDP chỉ
    chèn chữ trực tiếp, không mô phỏng IME. Nên thử sớm trên Android thật.
  - Last-write-wins: mở cùng một note ở 2 tab/thiết bị thì bản lưu sau ghi đè (đã được người dùng chấp nhận).
  - Nháp khôi phục so sánh `saved_at` (đồng hồ máy khách) với `updated_at` (máy chủ) — lệch giờ lớn có thể bỏ nhầm / áp nhầm nháp.
  - Request `keepalive` khi đóng tab bị trình duyệt giới hạn ~64 KB: note lớn hơn thì chỉ còn nháp localStorage, được lưu ở lần mở sau.
  - Đoạn xem trước trong danh sách bỏ ký tự `|` (vd. `|x|` → `x`) do dùng chung quy tắc lọc ký hiệu bảng Markdown.
  - StarterKit v3 có `TrailingNode`: tài liệu luôn kết thúc bằng một đoạn trống (hành vi chuẩn, không phải lỗi).

## [2026-09-18] — Ghi chú: danh sách số đánh tiếp khi bị ngắt bởi đoạn văn + sửa id khối trùng
- Vấn đề (người dùng báo): danh sách số bị ngắt bởi một đoạn văn thì danh sách sau lại bắt đầu từ 1.
- Đã làm:
  - `lib/orderedListContinuation.js` (extension Tiptap): danh sách số MỚI tạo (nút thanh công cụ, gõ `1. `) đang bắt đầu từ 1
    tự nối số theo danh sách số gần nhất phía trên trong cùng khối cha; gặp tiêu đề thì dừng (phần mới → đánh lại từ 1); gõ
    số cụ thể (`7. `) giữ nguyên. Tách danh sách (Enter 2 lần ở giữa): nửa đầu giữ số bắt đầu cũ, nửa sau nối tiếp. Nút thanh
    công cụ khi con trỏ ở danh sách số: "Đánh số lại từ 1" / "Đánh số tiếp theo danh sách phía trên". Markdown lưu đúng số
    (`3. Mục ba`) vì `@tiptap/markdown` đã dùng thuộc tính `start`.
  - Phát hiện khi kiểm thử: **Tiptap UniqueID để lại id trùng khi tách một khối** (2 nửa danh sách cùng `data-id`) — ảnh hưởng
    cả neo câu hỏi Cornell. Thêm `lib/blockIdGuard.js`: sau mỗi thay đổi, khối xuất hiện trước giữ id, khối sau nhận id mới
    (có fallback khi không có `crypto.randomUUID` — mở dev qua IP LAN không phải secure context).
- File/module đã thay đổi: `client/src/lib/orderedListContinuation.js` (mới), `client/src/lib/blockIdGuard.js` (mới),
  `client/src/components/notes/NoteContentEditor.jsx`, `CLAUDE.md`, `GEMINI.md`, `PROGRESS.md`
- Đã kiểm thử: CDP + backend thật trên schema `notewave_test`: kịch bản đánh số 13 bước (tình huống trong ảnh của người dùng
  → 3; đánh lại từ 1 / đánh tiếp; thêm mục; sau tiêu đề về 1; `7. ` giữ 7; bật bằng nút → 8; tách danh sách → 2; Markdown
  đúng số; tải lại trang không đổi số) — qua hết. Chạy lại kịch bản desktop (25 bước) và mobile (23 bước) — qua hết, không
  lỗi console. `vite build` OK, `oxlint` không có cảnh báo mới.
- Vấn đề đã biết: nối số chỉ xét danh sách cùng khối cha (danh sách lồng trong mục khác không nối với danh sách ngoài); tạo
  danh sách mới phía TRÊN một danh sách có sẵn không đánh lại số của danh sách bên dưới (giống Google Docs). Muốn viết đoạn
  giải thích mà không ngắt danh sách: Shift+Enter xuống dòng trong cùng mục.

## [2026-09-18] — Ghi chú: khung ghi chú cố định theo màn hình, cuộn bên trong từng vùng
- Yêu cầu (người dùng): trên máy tính và điện thoại, trang chi tiết ghi chú không được có thanh cuộn ngoài cùng; chỉ cuộn bên
  trong khung ghi chú.
- Đã làm:
  - `hooks/useViewportFit.js`: thêm tuỳ chọn `mobile` — trừ thêm padding dưới của khung app (chỗ của bottom nav cố định) và
    tính theo `visualViewport` (khung co lại khi bàn phím ảo mở; bỏ qua khi đang phóng to). Mặc định giữ nguyên hành vi cũ
    (SessionDetail không đổi).
  - `NoteDetail.jsx`: khung Cornell `h-(--fit-h)` ở mọi breakpoint, `overflow-hidden`; từ `lg`: grid 2 cột
    `grid-rows-[minmax(0,1fr)]`, cột câu hỏi và nội dung tự cuộn, dải tóm tắt tối đa 30% khung và tự cuộn (bỏ `sticky` cũ của
    cột câu hỏi); dưới `lg`: tab đang chọn chiếm cả khung và tự cuộn. Tối thiểu 220px (màn hình rất thấp / bàn phím chiếm quá
    nửa thì trang cuộn nhẹ). Tiêu đề nhỏ hơn trên mobile, dropdown thư mục + tag chung một hàng, khoảng cách khối 8px trên mobile.
  - `NoteContentEditor.jsx`: thanh công cụ nằm cố định đầu khung (không còn `sticky` theo trang), nội dung trong vùng cuộn riêng;
    bấm vào khoảng trống dưới nội dung -> đưa con trỏ về cuối tài liệu.
- File/module đã thay đổi: `client/src/hooks/useViewportFit.js`, `client/src/components/notes/NoteDetail.jsx`,
  `client/src/components/notes/NoteContentEditor.jsx`, `CLAUDE.md`, `GEMINI.md`, `PROGRESS.md`
- Đã kiểm thử (CDP + backend thật trên schema `notewave_test`, ghi chú 60 đoạn / 30 câu hỏi / tóm tắt 25 dòng): 1440×900,
  1024×768, 820×1180, 390×844, 360×640 — trang ngoài không cuộn (`scrollHeight = innerHeight`), đáy khung nằm trên bottom nav,
  nội dung cuộn bên trong + thanh công cụ không trôi, cột câu hỏi / tóm tắt tự cuộn, bấm câu hỏi đã neo chỉ cuộn vùng nội dung
  tới đúng đoạn; mỗi tab mobile chiếm cả khung; thu viewport 844 -> 520 (mô phỏng bàn phím Android) khung co 485 -> 220px;
  46 bước qua. Chạy lại kịch bản desktop (25), mobile (23), đánh số (12) — qua hết, không lỗi console. `vite build` OK,
  `oxlint` không có cảnh báo mới.
- Vấn đề đã biết: chưa thử bàn phím ảo trên iOS/Android thật (iOS còn tự cuộn layout viewport khi focus ô nhập — có thể cần
  tinh chỉnh thêm sau khi thử máy thật); màn hình rất thấp (<~600px chiều cao, hoặc bàn phím mở trên máy nhỏ) chạm mức tối
  thiểu 220px nên trang cuộn nhẹ.

## [2026-09-19] — Bỏ file đặc tả Ghi chú, chuyển lộ trình vào đây
- Người dùng không cần file đặc tả Ghi chú nữa (đã xoá khỏi repo) → bỏ mọi chỗ nhắc tới trong `CLAUDE.md`,
  `GEMINI.md`, `PROGRESS.md`. Phần lộ trình còn dùng được chép lại ở mục dưới (đã áp các quyết định của người dùng).
- File/module đã thay đổi: `CLAUDE.md`, `GEMINI.md`, `PROGRESS.md`

### Lộ trình Ghi chú (nguồn duy nhất — cập nhật trạng thái tại đây)
- **GĐ1 — Nền tảng** (xong 2026-09-18): note / thư mục cây / tag, CRUD + tìm/lọc/sắp xếp, layout Cornell, editor Tiptap,
  tự lưu + nháp cục bộ, giao diện riêng từng note, chế độ ôn tập.
- **GĐ2 — Nội dung phong phú** (xong 2026-09-19, chờ người dùng thêm `SUPABASE_SECRET_KEY` để chạy ảnh thật): chèn ảnh (Supabase Storage qua REST từ backend, bucket private), bảng, công thức toán KaTeX
  (dùng chung cho `OcrDocumentView`), vẽ tay công thức → Mistral OCR → LaTeX (kết luận Thử nghiệm 1: cắt sát nét, gửi data
  URI, chuẩn hoá dấu bọc, luôn xem trước + sửa trước khi chèn), dán nội dung có định dạng / dán ảnh trực tiếp.
- **GĐ3 — Liên kết & AI:** backlink giữa các note (`[[...]]`, backend tự tính lại liên kết mỗi lần lưu, panel "note trỏ
  tới note này"); tóm tắt AI bằng agent `NoteSummary` riêng (ý chính, khái niệm, câu hỏi ôn tập; dùng chung
  `SUMMARY_MODEL`), cột `ai_summary` tách khỏi tóm tắt tự viết; gợi ý sửa lỗi chính tả cho nội dung note (mẫu
  `ocr_review_agent`, chạy khi người dùng bấm, không chạy mỗi lần lưu). Không có "tạo note từ phiên" (đã bỏ).
- **GĐ4 — Offline:** đồng bộ nhiều thiết bị đã BỎ theo quyết định người dùng; còn lại tuỳ chọn: IndexedDB + PWA (cần duyệt
  `dexie`, `vite-plugin-pwa` trước khi làm).
- **GĐ5 — Export & input:** export .txt / .docx (từ `content_md` + `markdown_docx.py`) / .pdf (`window.print()` + CSS
  `@media print`); nút "Ghi âm nhanh" trong note dùng lại luồng Soniox trực tiếp (`useLiveTranscription`), transcript đổ vào
  nội dung; rà soát UX mobile trên máy thật (bộ gõ tiếng Việt, bàn phím ảo iOS/Android, canvas cảm ứng).
- Định nghĩa "xong" mỗi giai đoạn: `pytest` pass (trừ `-k live`) + test cho endpoint mới; `vite build` OK, `oxlint` không cảnh
  báo mới; kiểm thử UI ở ≥ 2 kích thước (desktop + mobile); cập nhật `PROGRESS.md`, `CLAUDE.md`, `.env.example` khi cần.

## [2026-09-19] — Ghi chú: GIAI ĐOẠN 2 XONG (ảnh, bảng, công thức KaTeX, vẽ công thức → LaTeX, dán nội dung)
- Trạng thái lộ trình Ghi chú: GĐ1 xong, **GĐ2 xong** (ảnh cần `SUPABASE_SECRET_KEY` thật mới chạy trên máy/Render — xem
  "Việc cần làm tiếp theo"), GĐ3 chưa bắt đầu.
- Đã làm:
  - **Ảnh (Supabase Storage):** `services/storage.py` (REST bằng `httpx`, không SDK; tự tạo bucket PRIVATE `note-assets` ở lần tải
    đầu; khoá `sb_secret_` gửi `apikey`, khoá JWT cũ gửi thêm Bearer), `services/note_media.py` (nhận dạng PNG/JPEG/WebP/GIF
    theo magic bytes, giới hạn dung lượng, dọn ảnh khi xoá note), bảng `note_assets`, endpoint `POST /api/notes/{id}/images`,
    `GET /api/note-images/{id}` (307 tới signed URL 1 giờ). Nội dung note chỉ lưu `/api/note-images/<id>`. Frontend: nén ở
    trình duyệt (`lib/imageCompress.js`, ≤ 2000px, WebP — ảnh thử 12,5 KB PNG → 5,1 KB WebP), ô chờ tải là decoration
    (`lib/noteImages.js`), chèn qua nút / dán / kéo thả; thả giữa dòng chữ thì đặt ở ranh giới khối.
  - **Bảng:** `TableKit` (resizable, cột tối thiểu 96px, cuộn ngang trong `.tableWrapper`), thanh "Bảng:" (thêm/xoá hàng
    cột, bật/tắt hàng tiêu đề, xoá bảng).
  - **Công thức:** `@tiptap/extension-mathematics` + KaTeX; `MathDialog` (xem trước KaTeX trực tiếp, báo lỗi cú pháp, nút chèn
    nhanh ký hiệu, trong dòng / khối riêng, sửa khi bấm vào công thức); gõ tắt `$$x$$` / `$$$x$$$`.
  - **Vẽ công thức → LaTeX:** `DrawFormulaDialog` (canvas, Pointer Events, bút / ngón tay / chuột, hoàn tác, xoá hết; cắt sát nét
    trước khi gửi) → `POST /api/notes/formula-ocr` (Mistral OCR qua data URI) → `normalize_formula` → mở `MathDialog` để kiểm
    tra rồi mới chèn (cảnh báo riêng khi nhận ra nhiều công thức).
  - **KaTeX cho phiên Quét tài liệu:** `OcrDocumentView` dùng `remark-math` + `rehype-katex`; `ocr_review_agent` không bao giờ
    đề xuất / áp dụng sửa chữ bên trong công thức.
  - `/api/health` thêm `note_images_configured`; nút chèn ảnh tự tắt (kèm lý do) khi chưa cấu hình.
  - Bỏ mọi chỗ nhắc file đặc tả Ghi chú (người dùng không cần) — lộ trình nằm ở mục "Lộ trình Ghi chú" trong file này.
- File/module đã thay đổi:
  - Backend mới: `app/services/storage.py`, `app/services/note_media.py`, `app/routers/note_media.py`, `tests/storage_fake.py`,
    `tests/test_note_media.py`. Sửa: `app/config.py`, `app/dependencies.py`, `app/main.py`, `app/models/note.py`
    (`NoteAsset`, `NoteImageRead`, `FormulaOcrResult`), `app/routers/notes.py` (xoá note dọn ảnh), `app/services/ocr.py`
    (`extract_formula`, `normalize_formula`), `app/services/ocr_review_agent.py` (bỏ qua công thức), `tests/conftest.py`.
  - Frontend mới: `components/notes/MathDialog.jsx`, `components/notes/DrawFormulaDialog.jsx`, `lib/noteImages.js`,
    `lib/imageCompress.js`. Sửa: `components/notes/NoteContentEditor.jsx`, `components/notes/NoteDetail.jsx`,
    `components/OcrDocumentView.jsx`, `lib/api.js` (`apiUrl`, `toApiPath`, `uploadNoteImage`, `formulaOcr`), `lib/noteEditor.js`
    (neo được bảng / ảnh / công thức; "đáp án" ôn tập hiện LaTeX / nhãn ảnh), `index.css`, `vite.config.js` (chunk KaTeX),
    `package.json` + lock (`@tiptap/extension-table|image|mathematics`, `katex@^0.16`, `remark-math`, `rehype-katex`).
  - Khác: `.env.example`, `render.yaml`, `DEPLOY.md` (biến mới, checklist kiểm thử, xử lý sự cố, giới hạn Storage 1GB),
    `CLAUDE.md`, `GEMINI.md`, `PROGRESS.md`.
- Đã kiểm thử:
  - `pytest` toàn bộ: **83 passed, 2 skipped** (11 test mới: tải ảnh + tự tạo bucket + nhận dạng định dạng, lỗi 404/413/415/422/
    502/503, chuyển hướng signed URL, xoá note dọn ảnh (kể cả khi Storage lỗi), suy ra `SUPABASE_URL`, formula-ocr gửi data URI
    không qua Files API, chuẩn hoá LaTeX trên kết quả Mistral thật của Thử nghiệm 1, rà soát OCR bỏ qua công thức).
  - UI qua CDP với backend thật (schema `notewave_test`, Storage giả lập trong bộ nhớ có route trả file để ảnh hiển thị được,
    Mistral THẬT cho vẽ công thức): desktop 31 bước (bảng, công thức: chèn / sửa / đổi kiểu / gõ tắt / LaTeX sai bị chặn, ảnh:
    chọn file / dán / kéo thả + hiển thị + không cắt đôi từ, dán HTML có định dạng, **vẽ "2+3=5" bằng chuột → Mistral trả đúng
    `2 + 3 = 5`**, Markdown lưu đúng, tải lại còn nguyên, xoá note dọn ảnh, KaTeX trong phiên OCR); mobile 390px 10 bước (thanh
    công cụ cuộn ngang, bảng 6 cột cuộn ngang với cột 96px, vẽ bằng ngón tay, hộp thoại công thức vừa màn hình, không tràn
    trang). Chạy lại 4 kịch bản GĐ1 (desktop 25, mobile 23, đánh số 12, khung cố định 46) — qua hết. Không lỗi console.
  - `vite build` OK (KaTeX chunk dùng chung 77 KB gzip; `NoteDetail` 181 KB gzip; `OcrDocumentView` 52 KB gzip); `oxlint` không
    cảnh báo mới.
  - Lỗi phát hiện qua kiểm thử và đã sửa: bảng nhiều cột trên điện thoại bị ép tới mức chữ gãy từng ký tự (→ resizable +
    `cellMinWidth`); thả ảnh giữa dòng chữ cắt đôi từ (→ đặt ở ranh giới khối); CSS ảnh áp nhầm lên `img.ProseMirror-separator`;
    2 bản KaTeX (0.18 + 0.16) cùng vào bundle (→ ghim `katex@^0.16`).
- Việc cần làm tiếp theo:
  1. **Người dùng thêm `SUPABASE_SECRET_KEY`** (Supabase Dashboard → Project Settings → API Keys → Secret keys) vào `.env` và
     Render, rồi chạy thử chèn ảnh thật một lần (bucket `note-assets` tự tạo). Chưa kiểm chứng được với Storage thật.
  2. GĐ3: backlink `[[...]]`, tóm tắt AI `NoteSummary`, gợi ý sửa chính tả cho note.
- Vấn đề đã biết:
  - Ảnh bị xoá khỏi nội dung nhưng note vẫn còn thì file vẫn nằm trên Storage (cố ý — tránh mất ảnh khi Hoàn tác); cần dọn định
    kỳ nếu dung lượng 1GB gần đầy.
  - Dán HTML từ web có `<img src="https://...">` thì ảnh vẫn trỏ về trang gốc (không tải lại lên Storage); ảnh base64 trong HTML
    dán vào bị bỏ (`allowBase64: false`).
  - Vẽ công thức chỉ kiểm chứng bằng nét chuột mô phỏng ("2+3=5") — cần thử chữ viết tay thật trên máy cảm ứng / bút.
  - Chunk `NoteDetail` > 500 KB (chưa nén) nên Vite cảnh báo — chunk lazy, chỉ tải khi mở ghi chú.

## [2026-09-19] — Ghi chú: xoá ảnh khỏi nội dung thì xoá luôn file trên Supabase Storage
- Yêu cầu (người dùng): xoá ảnh trong note thì xoá cả ở Storage (trước đó chỉ dọn khi xoá cả note).
- Cách làm (có thời gian chờ để không phá Hoàn tác / ảnh dùng chung):
  - Cột mới `note_assets.orphaned_at` (nullable, index — `_add_missing_columns` tự thêm vào DB thật khi khởi động).
  - `PATCH /api/notes/{id}` có `content_md`: `sync_note_images` đánh dấu ảnh của note không còn trong nội dung, bỏ đánh dấu
    ảnh xuất hiện lại (Ctrl+Z, dán ảnh copy từ note khác); sau đó `purge_orphan_images` xoá thật (Storage + dòng) các ảnh đã
    chờ quá `ORPHAN_GRACE = 10 phút` (tối đa 50 ảnh / lần, của mọi note). Cũng chạy sau khi xoá note. Lưu không đổi nội dung
    (đổi tiêu đề, tag…) không chạy dọn.
  - Ảnh mới tải lên bắt đầu ở trạng thái chờ → tải lên nhưng không bao giờ chèn (đóng tab giữa chừng) cũng được dọn.
  - Ảnh vẫn nằm trong nội dung note khác → không xoá, chuyển quyền sở hữu sang note đó (áp dụng cả khi xoá note).
  - Storage lỗi khi xoá → giữ dòng (đánh dấu quá hạn) để lần dọn sau thử lại, không để file mồ côi.
- File/module đã thay đổi: `server/app/models/note.py`, `server/app/services/note_media.py`, `server/app/routers/notes.py`
  (PATCH/DELETE thành async, gọi sync/purge), `server/tests/test_note_media.py`, `CLAUDE.md`, `GEMINI.md`, `PROGRESS.md`.
- Đã kiểm thử: `pytest` toàn bộ **86 passed, 2 skipped** (3 test mới: xoá → chờ → Hoàn tác → xoá thật sau thời gian chờ; ảnh tải
  lên không chèn bị dọn; ảnh dùng chung giữa các note được giữ và chuyển chủ; sửa test xoá note khi Storage lỗi). UI qua CDP
  (backend thật, schema test, Storage giả lập, thời gian chờ rút còn 8 giây): chèn ảnh → chọn ảnh + Delete → file còn → Ctrl+Z →
  ảnh quay lại, qua thời gian chờ vẫn còn, tải lại trang vẫn hiện → xoá lần 2 → quá thời gian chờ → lần lưu kế tiếp xoá file
  (7 bước, không lỗi console). Chạy lại kịch bản GĐ2 desktop (31) + mobile (10) — qua hết.
- Vấn đề đã biết:
  - File chỉ bị xoá ở **lần lưu nội dung tiếp theo sau 10 phút** (bất kỳ note nào) — Render free không có job nền định kỳ; nếu
    không ai sửa note nữa, ảnh chờ xoá vẫn nằm trên Storage tới lần sửa sau.
  - Hoàn tác SAU hơn 10 phút (và đã có lần lưu nội dung khác) → ảnh đã bị xoá, hiện ảnh hỏng — chèn lại ảnh.
  - Kiểm tra "note khác còn dùng ảnh" dựa trên `search_text` (chứa `content_md`); nếu sau này tách nội dung khỏi `search_text`
    phải đổi truy vấn trong `_other_note_using`.

## [2026-09-19] — Ghi chú: bảng ký hiệu / mẫu công thức đầy đủ cho hộp thoại chèn công thức
- Yêu cầu (người dùng): bổ sung thêm nhiều công thức toán học cho việc chèn công thức (trước chỉ có 18 nút).
- Đã làm:
  - `lib/mathSnippets.js`: **7 nhóm, 272 mục** — Cơ bản (53: phân số, căn bậc n, mũ/chỉ số, ngoặc tự co giãn, giá trị tuyệt đối,
    làm tròn, phép toán, so sánh, dấu trên đầu, ngoặc nhọn trên/dưới, chữ trong công thức, khoảng trắng, dấu ba chấm…), Hy Lạp
    (40: đủ chữ thường + biến thể + chữ hoa), Giải tích (46: giới hạn trái/phải, tổng, tích, nguyên hàm, tích phân xác định / kép
    / bội ba / đường, thế cận, đạo hàm các kiểu, đạo hàm riêng, nabla, mũ, log, lượng giác + ngược + hyperbolic, max/min/sup/inf),
    Tập hợp · Logic (48: quan hệ tập hợp, ℕ ℤ ℚ ℝ ℂ, đoạn/khoảng, lượng từ, phép logic, hình học, chia hết, đồng dư), Mũi tên (18),
    Ma trận · Hệ (19: ma trận 2×2 / 3×3, định thức, vector cột, hệ 2–3 phương trình, tuyển, hàm nhiều nhánh, biến đổi thẳng hàng,
    tổ hợp/chỉnh hợp, chuyển vị, nghịch đảo, tích vô hướng / có hướng), Mẫu công thức (48 công thức hoàn chỉnh có tên tiếng Việt:
    bậc hai, Vi-ét, Pytago, hằng đẳng thức, nhị thức Newton, cấp số, đạo hàm, Newton–Leibniz, từng phần, lượng giác, định lý
    sin/cos, logarit, hình học giải tích, xác suất / Bayes / thống kê, số phức, vật lý).
  - `components/notes/MathPalette.jsx`: tab nhóm (điện thoại cuộn ngang, desktop xuống dòng — đủ 7 tab), lưới nút hiển thị ký hiệu
    bằng KaTeX (cache, chỉ render nhóm đang mở), tooltip tên tiếng Việt + LaTeX, nhóm Mẫu công thức dạng danh sách "tên + công
    thức"; nhớ nhóm vừa dùng. `MathDialog` dùng bảng này thay 18 nút cũ.
  - Chèn: con trỏ vào ô `{}` đầu tiên (gõ ngay vào tử số / ô ma trận…); lệnh kết thúc bằng chữ (`\alpha`, `\le`…) chèn ngay trước
    một chữ cái thì tự thêm dấu cách (tránh thành lệnh lạ `\alphax`).
- File/module đã thay đổi: `client/src/lib/mathSnippets.js` (mới), `client/src/components/notes/MathPalette.jsx` (mới),
  `client/src/components/notes/MathDialog.jsx`, `CLAUDE.md`, `GEMINI.md`, `PROGRESS.md`.
- Đã kiểm thử:
  - Script Node chạy KaTeX thật (`strict: 'error'`) trên cả 272 mục ở dạng chèn và dạng hiển thị: 0 lỗi, 0 trùng (phát hiện và sửa
    3 lỗi: `\text{}` không nhận □, chữ "đ" trong công thức phải bọc `\text{}`; 2 nút khoảng trắng hiển thị trống -> vẽ `□ □`).
  - UI qua CDP ở 1280px và 390px (19 bước): 7 nhóm, đủ 272 nút đều render KaTeX, không tràn ngang, desktop hiện đủ 7 tab, chèn mẫu
    "Nghiệm phương trình bậc hai" đúng LaTeX, "Phân số" -> gõ "1" ra `\frac{1}{}`, `\alpha` trước "x" -> `\alpha x`, ma trận 2×2
    chèn vào ghi chú render KaTeX, mở lại hộp thoại nhớ nhóm vừa dùng. Chạy lại kịch bản GĐ2 desktop (31 bước) — qua. Không lỗi
    console. `vite build` OK, `oxlint` không cảnh báo mới.
- Vấn đề đã biết: chưa có ô tìm kiếm ký hiệu theo tên (có tooltip tên từng nút); chưa có ký hiệu hoá học (`\ce` cần extension
  mhchem của KaTeX — chưa thêm).

## [2026-09-19] — Hộp thoại chèn công thức không cuộn cả thân + sửa lỗi dọn ảnh khi chưa cấu hình Storage
- Yêu cầu (người dùng): khung modal "Chèn công thức" đang cuộn cả thân (màn hình ~800px) — không muốn có thanh cuộn đó.
- Đã làm:
  - `Modal.jsx`: thêm prop `flexBody` (thân là cột flex, con `min-h-0` co lại được; chỉ màn hình cực thấp mới còn cuộn dự phòng).
    Mặc định tắt — các hộp thoại khác không đổi.
  - `MathDialog.jsx` dùng `flexBody`: ô LaTeX (2 dòng), chọn kiểu, ô xem trước, nút giữ nguyên kích thước (`shrink-0`); riêng
    `MathPalette` co lại theo chỗ trống (lưới ký hiệu `min-h-[5.5rem]`, tối đa 13–15rem, tự cuộn bên trong).
  - **Sửa lỗi phát hiện khi rà soát** (`services/note_media.py::_delete_assets`): khi chưa / tạm mất cấu hình Storage mà có ảnh
    đến hạn dọn, trước đây xoá dòng `note_assets` nhưng bỏ qua file -> mất dấu file trên Storage. Nay giữ nguyên dòng để lần dọn
    sau (khi có cấu hình) xoá cả file. Thêm test `test_purge_keeps_rows_when_storage_unconfigured`.
- File/module đã thay đổi: `client/src/components/Modal.jsx`, `client/src/components/notes/MathDialog.jsx`,
  `client/src/components/notes/MathPalette.jsx`, `server/app/services/note_media.py`, `server/tests/test_note_media.py`,
  `CLAUDE.md`, `GEMINI.md`, `PROGRESS.md`.
- Đã kiểm thử: `pytest` toàn bộ qua (87 passed, 2 skipped). UI qua CDP: hộp thoại công thức ở 1280×800 / 700 / 600, 390×844 / 667,
  360×640 — thân KHÔNG cuộn, bảng ký hiệu còn 88–209px (tự cuộn bên trong), ô xem trước và nút Chèn luôn trong màn hình (18 bước);
  chạy lại bảng ký hiệu (19), GĐ2 desktop (31), xoá ảnh (7) — qua hết, không lỗi console. `vite build` OK, `oxlint` không cảnh báo mới.
- **Sự cố trong lúc kiểm thử (đã kiểm tra, không ảnh hưởng dữ liệu):** một lần chạy kịch bản UI rơi vào phiên `npm run dev` của
  người dùng đang giữ cổng 8000/5173 (server kiểm thử của agent không bind được cổng) -> kịch bản tạo rồi xoá 1 note thử
  "Hộp thoại vừa màn hình" trên DB thật. Đã kiểm tra chỉ-đọc: note thử đã bị xoá (0 bản ghi), note thật còn nguyên, không có ảnh.
  Từ nay kiểm thử UI của agent chạy ở cổng riêng (backend 8001, Vite 5174 qua `createServer`, không sửa `vite.config.js`) và bộ
  điều khiển trình duyệt từ chối chạy nếu backend không phải launcher kiểm thử (thiếu route `/__fake_storage_list`).
