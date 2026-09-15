# NoteWave

Ghi chú / phụ đề cuộc họp bằng giọng nói: ghi âm trực tiếp (Soniox real-time) hoặc tải file ghi âm lên
(Soniox Async API), phân biệt người nói, lưu lịch sử, tóm tắt bằng AI (PydanticAI) và xuất .txt/.docx.

- `client/` — React + Vite + Tailwind CSS
- `server/` — FastAPI + SQLModel + PydanticAI
- `supabase/` — cấu hình Supabase CLI (Postgres local qua Docker)

Database là **Supabase Postgres cho cả local lẫn production** — hai môi trường chỉ khác `DATABASE_URL`.

## Chạy local

Cần cài sẵn (một lần): Node.js ≥ 18, Python ≥ 3.10 (khuyên dùng [uv](https://docs.astral.sh/uv/)),
[Docker Desktop](https://www.docker.com/products/docker-desktop/).

### Hằng ngày: bật Docker Desktop → chạy một lệnh

```bash
npm run dev        # ở gốc repo — hoặc nhấp đúp dev.bat, hoặc Ctrl+Shift+B trong VS Code
```

`run-dev.js` tự làm hết:

1. **Lần đầu:** cài dependencies còn thiếu (npm gốc + `client/`, Python venv `server/.venv`) và tạo `.env` từ `.env.example`.
2. **Chờ Docker** sẵn sàng (tối đa 2 phút — có thể chạy lệnh ngay sau khi bấm mở Docker Desktop).
3. **Bật Supabase local** (Postgres) nếu chưa chạy — lần đầu tải image Docker vài GB, các lần sau ~30–45 giây;
   nếu đang chạy sẵn thì bỏ qua ngay.
4. **Chạy backend** (http://localhost:8000) **+ frontend** (http://localhost:5173, tự mở trình duyệt).

Ctrl+C chỉ dừng backend/frontend; Supabase local vẫn chạy nền để lần sau khởi động trong vài giây.
Tắt hẳn khi không dùng: `npm run db:stop` (dữ liệu vẫn được giữ).

Chỉ cần làm một lần sau khi `.env` được tạo: điền
- `SONIOX_API_KEY` — https://console.soniox.com → **API Keys**. Key này chỉ nằm ở backend; trình duyệt chỉ nhận
  Temporary API Key ngắn hạn qua `POST /api/temporary-key`.
- `OPENAI_API_KEY` — cho nút "Tóm tắt" (`SUMMARY_MODEL=openai:gpt-5.4-mini`).
- `DATABASE_URL` đã điền sẵn giá trị Supabase local (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`),
  không cần sửa. Bảng dữ liệu được backend tự tạo khi khởi động.

### Lệnh hữu ích

| Lệnh (ở gốc repo) | Tác dụng |
|---|---|
| `npm run dev` | Chuẩn bị môi trường + chạy backend & frontend |
| `node run-dev.js --prepare` | Chỉ cài deps thiếu + chờ Docker + bật Supabase, không chạy app |
| `npm run db:status` | Xem thông tin Supabase local (DB URL, Studio, API) |
| `npm run db:stop` | Tắt Supabase local (giữ dữ liệu) |
| `npx supabase stop --no-backup` | Tắt và xoá sạch dữ liệu local |
| `npm run test:server` | Chạy test backend (Windows) |

- Supabase Studio (xem bảng, chạy SQL): http://127.0.0.1:54323 — tài liệu API backend: http://localhost:8000/docs
- Supabase CLI cài theo repo (devDependency), gọi bằng `npx supabase ...`; không cần cài global.
- Trình duyệt chỉ cho dùng micro trên `localhost` hoặc HTTPS.
- Dev local không có URL public nên để trống `PUBLIC_BASE_URL`: luồng tải file dùng polling. Muốn thử webhook,
  dùng ngrok rồi đặt `PUBLIC_BASE_URL` = URL ngrok.

<details>
<summary>Chạy thủ công từng phần (không dùng run-dev.js)</summary>

```bash
npm install && (cd client && npm install)
cd server && uv venv && uv pip install -r requirements-dev.txt && cd ..
npx supabase start
cd server && .venv/Scripts/python -m uvicorn app.main:app --reload --port 8000   # macOS/Linux: .venv/bin/python
cd client && npm run dev
```
</details>

### Test backend

Test chạy trên Postgres thật của Supabase local (cần `npx supabase start`), dùng database riêng
`notewave_test` (tự tạo, dữ liệu bị xoá sau mỗi test — không đụng dữ liệu dev):

```bash
cd server && .venv/Scripts/python -m pytest      # hoặc ở gốc repo (Windows): npm run test:server
```

## Deploy miễn phí

Hướng dẫn chi tiết từng bước (kèm kiểm thử sau deploy và bảng xử lý sự cố): **[DEPLOY.md](DEPLOY.md)**.

Tóm tắt: Supabase (database, Transaction pooler) → GitHub → Render (backend, `render.yaml`) → Vercel
(frontend, Root Directory `client`) → cập nhật `ALLOWED_ORIGINS` trên Render → kiểm thử.
