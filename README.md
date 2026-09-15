# NoteWave

Ghi chú / phụ đề cuộc họp bằng giọng nói: ghi âm trực tiếp (Soniox real-time) hoặc tải file ghi âm lên
(Soniox Async API), phân biệt người nói, lưu lịch sử, tóm tắt bằng AI (PydanticAI) và xuất .txt/.docx.
Thêm luồng **Quét tài liệu**: ảnh chụp / PDF (nhiều file gộp thành 1 tài liệu) → Mistral OCR → AI đề xuất sửa từ
tiếng Anh viết sai (người dùng duyệt). Tải file ghi âm hỗ trợ chọn nhiều file một lúc (mỗi file thành 1 phiên).

- `client/` — React + Vite + Tailwind CSS
- `server/` — FastAPI + SQLModel + PydanticAI

Database là **Supabase Postgres (hosted)**. Local và production dùng **chung một project Supabase, cùng một
`DATABASE_URL`** — không dựng Postgres giả lập bằng Docker ở máy local.

## Chạy local

Cần cài sẵn (một lần): Node.js ≥ 18, Python ≥ 3.10 (khuyên dùng [uv](https://docs.astral.sh/uv/)).
Không cần Docker hay Supabase CLI.

### 1. Lấy connection string Supabase thật (một lần)

1. Supabase Dashboard → mở project `notewave` → nút **Connect** ở thanh trên cùng
   (hoặc **Project Settings → Database → Connection string**).
2. Chọn loại **URI**, mục **Transaction pooler** (cổng **6543**) — đúng chuỗi đang dùng cho Render:
   ```
   postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```
3. Thay `[YOUR-PASSWORD]` bằng mật khẩu DB (bỏ dấu `[]`; ký tự đặc biệt phải URL-encode, vd `@` → `%40`)
   và thêm `?sslmode=require` vào cuối.
4. Dán vào `DATABASE_URL` trong file `.env` ở gốc repo (file này nằm trong `.gitignore`, **không commit**).
   Nếu chưa có `.env`, chạy `npm run dev` một lần để script tự tạo từ `.env.example`.

Không dùng **Direct connection** (`db.<ref>.supabase.co:5432`) — chỉ có IPv6, nhiều mạng/Render không hỗ trợ.

### ⚠️ Local dùng chung dữ liệu với production

Mọi thao tác khi chạy local (tạo, sửa transcript, gộp, **xoá** phiên/nhóm) ghi thẳng vào **database production**
— người dùng thật sẽ thấy ngay, và dữ liệu bị xoá **không khôi phục được** (gói Supabase free không đảm bảo có
bản sao lưu). Ngoài ra khởi động backend ở local cũng tự `ALTER TABLE ADD COLUMN` trên production nếu model có
cột mới — tức là thay đổi schema production trước khi code được deploy.

Cách giảm rủi ro:
- Không thử tính năng xoá/gộp (`delete_originals=true`) trên phiên thật; tạo phiên thử với tiêu đề dễ nhận biết
  (vd bắt đầu bằng `[DEV]`) và tự xoá khi xong.
- Không sửa/xoá cột, không chạy SQL tay trên Supabase khi chưa sao lưu (`pg_dump` qua Session pooler, xem
  [DEPLOY.md](DEPLOY.md) mục 7).
- Đổi model (thêm cột) → deploy lên Render ngay sau khi chạy thử local, để code production khớp schema.
- **Khuyến nghị về sau:** tạo project Supabase riêng cho dev (gói free cho phép 2 project) rồi chỉ đổi
  `DATABASE_URL` trong `.env` local — không cần sửa code.

### 2. Hằng ngày: chạy một lệnh

```bash
npm run dev        # ở gốc repo — hoặc nhấp đúp dev.bat, hoặc Ctrl+Shift+B trong VS Code
```

`run-dev.js` tự làm hết:

1. **Dependencies:** cài khi còn thiếu (`client/`, Python venv `server/.venv`) và **tự cài lại khi `package-lock.json` /
   `server/requirements*.txt` thay đổi** (sau `git pull` có thư viện mới); tạo `.env` từ `.env.example` nếu chưa có.
2. **Kiểm tra `DATABASE_URL`**: báo lỗi rõ nếu còn trống, không phải Postgres, hoặc vẫn trỏ Supabase local cũ
   (`127.0.0.1:54322`); in ra host Supabase đang dùng.
3. **Chạy backend** (http://localhost:8000) **+ frontend** (http://localhost:5173, tự mở trình duyệt).

Kiểm tra kết nối DB: mở http://localhost:8000/api/health → phải có `"database": "ok"`
(`"status": "degraded"`, `"database": "error"` = không kết nối được — xem log backend).

Chỉ cần làm một lần sau khi `.env` được tạo, ngoài `DATABASE_URL` điền:
- `SONIOX_API_KEY` — https://console.soniox.com → **API Keys**. Key này chỉ nằm ở backend; trình duyệt chỉ nhận
  Temporary API Key ngắn hạn qua `POST /api/temporary-key`.
- `OPENAI_API_KEY` — cho nút "Tóm tắt" (`SUMMARY_MODEL=openai:gpt-5.6-luna`) và bước rà soát từ tiếng Anh sau OCR.
- `MISTRAL_API_KEY` — https://console.mistral.ai/api-keys, cho tab "Quét tài liệu" (Mistral OCR). Thiếu key thì tab
  này báo lỗi 503, các tính năng khác vẫn chạy.

Bảng dữ liệu được backend tự tạo khi khởi động (đã có sẵn trên production).

### Lệnh hữu ích

| Lệnh (ở gốc repo) | Tác dụng |
|---|---|
| `npm run dev` | Chuẩn bị môi trường + chạy backend & frontend |
| `node run-dev.js --prepare` | Chỉ cài deps thiếu + kiểm tra `DATABASE_URL`, không chạy app |
| `npm run test:server` | Chạy test backend (Windows) |

- Xem bảng / chạy SQL: Supabase Dashboard → **Table Editor** / **SQL Editor** (là dữ liệu production).
  Tài liệu API backend: http://localhost:8000/docs
- Trình duyệt chỉ cho dùng micro trên `localhost` hoặc HTTPS.
- Dev local không có URL public nên để trống `PUBLIC_BASE_URL`: luồng tải file dùng polling. Muốn thử webhook,
  dùng ngrok rồi đặt `PUBLIC_BASE_URL` = URL ngrok.

<details>
<summary>Chạy thủ công từng phần (không dùng run-dev.js)</summary>

```bash
(cd client && npm install)
cd server && uv venv && uv pip install -r requirements-dev.txt && cd ..
cd server && .venv/Scripts/python -m uvicorn app.main:app --reload --port 8000   # macOS/Linux: .venv/bin/python
cd client && npm run dev
```
</details>

### Test backend

Test chạy trên **cùng database Supabase** (`DATABASE_URL` trong `.env`, hoặc `TEST_DATABASE_URL` nếu đặt) nhưng
**chỉ trong schema riêng `notewave_test`** (tự tạo): mọi câu lệnh đều ghi rõ tên schema, dữ liệu test bị xoá
(TRUNCATE) sau mỗi test — schema `public` chứa dữ liệu thật không bị đụng tới. Không dùng lệnh
`SET search_path` trong test (Transaction pooler không giữ được); SQL thô trong test phải dùng `tests.helpers.qualified()`.

```bash
cd server && .venv/Scripts/python -m pytest      # hoặc ở gốc repo (Windows): npm run test:server
```

Test không gọi Soniox/Mistral/OpenAI thật. Muốn thử tóm tắt / rà soát OCR bằng model thật (dùng `OPENAI_API_KEY`
trong `.env`, tốn phí vài xu):

```bash
cd server && RUN_LLM_TESTS=1 .venv/Scripts/python -m pytest tests/test_summary_agent.py tests/test_ocr.py -k live
```

## Deploy miễn phí

Hướng dẫn chi tiết từng bước (kèm kiểm thử sau deploy và bảng xử lý sự cố): **[DEPLOY.md](DEPLOY.md)**.

Tóm tắt: Supabase (database, Transaction pooler) → GitHub → Render (backend, `render.yaml`) → Vercel
(frontend, Root Directory `client`) → cập nhật `ALLOWED_ORIGINS` trên Render → kiểm thử.
