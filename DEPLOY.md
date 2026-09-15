# Hướng dẫn deploy NoteWave (free tier)

Tài liệu này hướng dẫn đưa NoteWave lên internet, làm lần lượt từ trên xuống. Tổng thời gian lần đầu: khoảng 45–60 phút.

## 0. Tổng quan

```
Trình duyệt ──HTTPS──> Vercel (frontend React, thư mục client/)
    │                        │  gọi API (VITE_API_BASE_URL)
    │                        ▼
    │                  Render (backend FastAPI, thư mục server/) ──> Supabase (Postgres, qua Transaction pooler)
    │                        │  ▲
    │                        ▼  │ webhook khi xử lý file xong
    └──WebSocket (temporary key)──> Soniox           OpenAI (tóm tắt)
```

| Thành phần | Dịch vụ | Gói | Cấu hình trong repo |
|---|---|---|---|
| Database | Supabase | Free | — (bảng do backend tự tạo khi khởi động) |
| Backend | Render Web Service | Free | `render.yaml` |
| Frontend | Vercel | Hobby (free) | `client/` (Vite, tự nhận diện) |

**Thứ tự bắt buộc** (vì các bước cần URL của nhau):
Supabase → GitHub → Render → Vercel → quay lại Render cập nhật CORS → kiểm thử.

### Chuẩn bị trước

- [ ] Tài khoản: [GitHub](https://github.com), [Supabase](https://supabase.com), [Render](https://render.com), [Vercel](https://vercel.com) — nên đăng nhập Supabase/Render/Vercel **bằng GitHub** cho tiện kết nối repo.
- [ ] `SONIOX_API_KEY` — https://console.soniox.com → API Keys.
- [ ] `OPENAI_API_KEY` — https://platform.openai.com/api-keys (tài khoản cần có credit).
- [ ] Máy local chạy được app (`npm run dev`) và test backend xanh:
  ```bash
  npm run test:server        # cần Docker + Supabase local đang chạy
  npm run build              # build thử frontend
  ```

Chuẩn bị sẵn một file ghi chú (KHÔNG commit) để lưu các giá trị sẽ dùng: mật khẩu DB, connection string, URL Render, URL Vercel.

---

## 1. Tạo database trên Supabase

1. Vào https://supabase.com/dashboard → **New project**.
2. Điền:
   - **Organization**: chọn/tạo tổ chức của bạn.
   - **Project name**: `notewave`.
   - **Database Password**: bấm **Generate a password** rồi **copy lưu lại ngay** (không xem lại được).
     Nếu tự đặt, tránh ký tự `@ : / ? # % &` — nếu có, phải URL-encode khi ghép vào connection string
     (vd `@` → `%40`, `#` → `%23`).
   - **Region**: **Southeast Asia (Singapore)** — trùng region Render trong `render.yaml`.
   - Gói: **Free**.
3. Bấm **Create new project**, chờ 1–2 phút tới khi trạng thái xanh.
4. Lấy connection string:
   - Bấm nút **Connect** ở thanh trên cùng của project (hoặc **Project Settings → Database**).
   - Chọn tab **Connection String**, loại **URI**, mục **Transaction pooler** (cổng **6543**).
   - Chuỗi có dạng:
     ```
     postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
     ```
   - Thay `[YOUR-PASSWORD]` bằng mật khẩu ở bước 2 (bỏ cả dấu `[]`) và **thêm `?sslmode=require` vào cuối**:
     ```
     postgresql://postgres.abcdefghijklmnop:MatKhau123@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require
     ```
   - Đây là giá trị `DATABASE_URL` cho Render.

> ⚠️ **Không dùng "Direct connection"** (`db.<ref>.supabase.co:5432`): kết nối trực tiếp chỉ có IPv6, Render không
> hỗ trợ IPv6 → backend sẽ không kết nối được. Luôn dùng **Transaction pooler**.

5. (Tuỳ chọn, nên làm) Kiểm tra connection string từ máy local trước khi đưa lên Render — thay `<DATABASE_URL>`:
   ```bash
   server/.venv/Scripts/python -c "import psycopg; c = psycopg.connect('<DATABASE_URL>', prepare_threshold=None); print(c.execute('select version()').fetchone()[0])"
   ```
   In ra `PostgreSQL 17...` là đúng. Lỗi `password authentication failed` → sai mật khẩu hoặc chưa URL-encode ký tự đặc biệt.

Không cần tạo bảng: backend tự tạo bảng và tự bật Row Level Security ở lần khởi động đầu tiên trên Render.

---

## 2. Đưa code lên GitHub

Repo hiện chưa có git. Làm ở gốc repo (`D:\Project\notewave`):

1. Kiểm tra lần cuối không có file bí mật sẽ bị commit:
   ```bash
   git init
   git add .
   git status
   ```
   Danh sách **không được có**: `.env`, `server/local.db`, `server/.venv/`, `node_modules/`, `supabase/.temp/`.
   **Phải có**: `client/src/lib/api.js` (và các file trong `client/src/lib/`), `render.yaml`, `supabase/config.toml`.
   Nếu thấy `.env` → dừng lại, kiểm tra `.gitignore` trước khi commit.
2. Commit:
   ```bash
   git commit -m "NoteWave: first deploy"
   git branch -M main
   ```
3. Tạo repo trên GitHub: https://github.com/new → **Repository name** `notewave` → nên chọn **Private** →
   **KHÔNG** tick "Add a README/.gitignore/license" → **Create repository**.
4. Đẩy code (thay `<user>` bằng tên GitHub của bạn):
   ```bash
   git remote add origin https://github.com/<user>/notewave.git
   git push -u origin main
   ```
   Lần đầu Git sẽ mở cửa sổ đăng nhập GitHub.

---

## 3. Deploy backend lên Render

1. Vào https://dashboard.render.com → **New +** → **Blueprint**.
2. **Connect a repository**: chọn GitHub, cấp quyền cho repo `notewave` (Configure account → Only select repositories → chọn `notewave`) → bấm **Connect** ở dòng repo.
3. **Blueprint Name**: `notewave`. **Branch**: `main`. Render đọc `render.yaml` và hiện service `notewave-api` (Free, Singapore).
4. Điền các biến Render hỏi (những biến `sync: false`):

   | Biến | Giá trị |
   |---|---|
   | `SONIOX_API_KEY` | key Soniox |
   | `DATABASE_URL` | connection string Transaction pooler ở bước 1 (có `?sslmode=require`) |
   | `ALLOWED_ORIGINS` | tạm thời điền `https://notewave.vercel.app` — sẽ sửa lại ở bước 5 |
   | `OPENAI_API_KEY` | key OpenAI |
   | `PUBLIC_BASE_URL` | `https://notewave-api.onrender.com` — sẽ kiểm tra lại ở bước 3.7 |

   Các biến còn lại đã có sẵn trong `render.yaml`: `PYTHON_VERSION=3.12.8`, `SUMMARY_MODEL=openai:gpt-5.4-mini`,
   `MAX_UPLOAD_MB=100`, `SONIOX_WEBHOOK_SECRET` (Render tự sinh chuỗi ngẫu nhiên).
5. Bấm **Deploy Blueprint** (hoặc **Apply**).
6. Mở service **notewave-api** → tab **Logs**, chờ build (lần đầu ~3–5 phút). Log thành công có:
   ```
   ==> Build successful 🎉
   INFO app: Database: postgresql+psycopg://postgres.abcdefghijklmnop:***@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require
   INFO:     Application startup complete.
   ==> Your service is live 🎉
   ```
7. Lấy URL thật ở đầu trang service (dạng `https://notewave-api.onrender.com`, có thể có hậu tố như
   `https://notewave-api-x1y2.onrender.com` nếu tên đã bị dùng).
   - Nếu **khác** giá trị `PUBLIC_BASE_URL` đã điền: tab **Environment** → sửa `PUBLIC_BASE_URL` = URL thật
     (không có `/` cuối) → **Save, rebuild, and deploy**.
8. Kiểm tra: mở `https://<URL-render>/api/health` → phải thấy
   ```json
   {"status":"ok","soniox_configured":true,"webhook_enabled":true}
   ```
   Tài liệu API: `https://<URL-render>/docs`.
9. Kiểm tra trên Supabase: **Table Editor** có 2 bảng `note_sessions`, `session_groups`, và không có cảnh báo
   "RLS disabled" trên bảng nào.

---

## 4. Deploy frontend lên Vercel

1. Vào https://vercel.com/new → **Import Git Repository** → chọn `notewave` (lần đầu bấm **Install** để cấp quyền GitHub cho repo).
2. Cấu hình:
   - **Project Name**: `notewave` → domain sẽ là `https://notewave.vercel.app` (nếu tên đã có người dùng, Vercel thêm hậu tố).
   - **Framework Preset**: Vite (tự nhận).
   - **Root Directory**: bấm **Edit** → chọn **`client`** → Continue. *(Bắt buộc — thiếu bước này build sẽ lỗi.)*
   - Build Command `npm run build`, Output Directory `dist`: để mặc định.
   - **Environment Variables**:

     | Name | Value |
     |---|---|
     | `VITE_API_BASE_URL` | URL Render ở bước 3.7, **không có `/` cuối**, vd `https://notewave-api.onrender.com` |
     | `VITE_MAX_UPLOAD_MB` | `100` |
     | `VITE_SONIOX_RT_MODEL` | `stt-rt-v5` (có thể bỏ qua — đây là mặc định) |
3. Bấm **Deploy**, chờ ~1 phút. Lấy domain chính thức ở **Project → Domains** (vd `https://notewave.vercel.app`).

> Biến `VITE_*` được "đóng gói" vào code lúc build. Mỗi lần sửa biến này trên Vercel phải **Redeploy**
> (Deployments → ⋯ → Redeploy) thì mới có hiệu lực.

---

## 5. Nối frontend ↔ backend (CORS)

1. Render → service **notewave-api** → **Environment** → sửa `ALLOWED_ORIGINS` = domain Vercel chính xác ở bước 4.3:
   ```
   https://notewave.vercel.app
   ```
   - Có `https://`, **không** có `/` cuối, không dùng `*`.
   - Nhiều domain (vd thêm domain riêng) → phân cách bằng dấu phẩy: `https://notewave.vercel.app,https://notewave.vn`
2. **Save, rebuild, and deploy**, chờ service live lại.

> Link preview của Vercel (dạng `notewave-git-abc-user.vercel.app`) có domain khác nên sẽ bị CORS chặn —
> chỉ domain production hoạt động, trừ khi bạn thêm domain đó vào `ALLOWED_ORIGINS`.

---

## 6. Kiểm thử sau deploy

Mở domain Vercel trên **Chrome desktop** và **điện thoại** (4G, không cùng Wi-Fi), đi lần lượt:

- [ ] Trang tải được; nếu backend đang ngủ sẽ thấy banner vàng "Máy chủ đang khởi động…" rồi tự hết (≤ 1 phút).
- [ ] Tab **Lịch sử**: hiện trạng thái trống, không báo lỗi → frontend gọi được backend, CORS đúng.
- [ ] **Ghi âm trực tiếp**: bấm ghi → trình duyệt hỏi quyền micro → nói vài câu tiếng Việt → chữ hiện real-time → **Dừng** → "Đã lưu vào lịch sử".
- [ ] Mở phiên vừa ghi: **Tóm tắt cuộc họp** ra kết quả; **Xuất file** .txt và .docx mở được, đúng tiếng Việt.
- [ ] **Chỉnh sửa transcript**: xoá 1 đoạn → Lưu → tải lại trang vẫn giữ thay đổi.
- [ ] **Tải file lên**: chọn file mp3/m4a ngắn (1–2 phút) → "Đang chuyển…" → hiện transcript.
      Render Logs có dòng `POST /api/webhooks/soniox HTTP/1.1" 204` → webhook hoạt động
      (nếu không có, app vẫn chạy nhờ polling — xem mục 8).
- [ ] **Nhóm & gộp**: tạo nhóm, gán 2 phiên, gộp 2 phiên → phiên gộp có đường phân cách giữa các phần.
- [ ] Supabase → **Table Editor → note_sessions** thấy dữ liệu vừa tạo.
- [ ] Supabase → **Advisors → Security Advisor**: không có cảnh báo "RLS disabled in public".

---

## 7. Cập nhật app về sau

- **Sửa code**: commit rồi `git push` lên `main` → Render và Vercel **tự build & deploy** lại.
  Chạy `npm run test:server` và `npm run build` ở local trước khi push.
- **Thêm/sửa biến môi trường**: sửa trên dashboard (Render: Save, rebuild, and deploy; Vercel: Redeploy),
  đồng thời cập nhật `.env.example` và `render.yaml` nếu là biến mới.
- **Thêm cột vào model**: backend tự `ALTER TABLE ADD COLUMN` khi khởi động. Đổi kiểu/xoá cột phải chạy SQL tay
  ở Supabase **SQL Editor** — nên tự sao lưu trước bằng `pg_dump` (dùng connection string **Session pooler**,
  cổng 5432), vì gói free không đảm bảo có bản sao lưu để khôi phục.

---

## 8. Xử lý sự cố

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Render build lỗi `No matching distribution` / lỗi pip | Sai Python version | Kiểm tra `PYTHON_VERSION=3.12.8` trong Environment |
| Log: `DATABASE_URL chưa được cấu hình` / `phải là connection string Postgres` | Thiếu biến hoặc dán nhầm | Dán lại connection string bắt đầu bằng `postgresql://` |
| Log: `password authentication failed` | Sai mật khẩu, ký tự đặc biệt chưa URL-encode, hoặc user không phải `postgres.<ref>` | Lấy lại chuỗi Transaction pooler; đổi mật khẩu DB ở Project Settings → Database nếu cần |
| Log: `Network is unreachable` / timeout tới `db.<ref>.supabase.co` | Dùng Direct connection (IPv6) | Đổi sang **Transaction pooler** (`...pooler.supabase.com:6543`) |
| Log: `prepared statement ... already exists` | Kết nối pooler với prepared statement | Code đã tắt (`prepare_threshold=None`); kiểm tra đang deploy đúng bản mới nhất |
| Backend đang chạy bỗng lỗi kết nối DB sau nhiều ngày | Supabase free **tạm dừng project** sau ~1 tuần không hoạt động | Supabase Dashboard → **Restore project**, chờ vài phút |
| Trình duyệt Console: `blocked by CORS policy` | `ALLOWED_ORIGINS` không khớp domain đang mở (thừa `/`, thiếu `https://`, link preview) | Sửa `ALLOWED_ORIGINS` (mục 5) |
| Frontend báo "Không kết nối được tới máy chủ", Network tab thấy request tới `notewave.vercel.app/api/...` | Thiếu/sai `VITE_API_BASE_URL` | Sửa biến trên Vercel rồi **Redeploy** |
| Lần mở đầu tiên chờ lâu 30–60 giây | Render free ngủ sau 15 phút không có request | Bình thường. Muốn tránh: nâng gói Render hoặc dùng dịch vụ ping định kỳ `/api/health` |
| Bấm ghi âm báo lỗi khoá tạm thời / `503` ở `/api/temporary-key` | Thiếu/sai `SONIOX_API_KEY` | Kiểm tra `/api/health` → `soniox_configured` phải `true` |
| Tóm tắt báo "Không tạo được bản tóm tắt" (502) | Sai `OPENAI_API_KEY`, hết credit, hoặc sai `SUMMARY_MODEL` | Xem Render Logs dòng `Tóm tắt thất bại` để biết lỗi cụ thể |
| Upload xong nhưng Render Logs không có `POST /api/webhooks/soniox` | `PUBLIC_BASE_URL` sai (không trùng URL Render) | Sửa `PUBLIC_BASE_URL` (mục 3.7). App vẫn chạy nhờ polling khi đang mở trang |
| Upload file lớn báo lỗi / timeout | File quá lớn cho Render free (RAM 512MB, mạng) | Dùng file ≤ 100MB; nén sang m4a/mp3 trước khi tải lên |
| Điện thoại không hỏi quyền micro | Trình duyệt chặn quyền trước đó | Cài đặt trang (biểu tượng ổ khoá) → cho phép Micro, tải lại trang |

---

## 9. Giới hạn gói free cần biết

| Dịch vụ | Giới hạn chính |
|---|---|
| **Render Free** | 512MB RAM (NoteWave dùng ~250MB), ngủ sau 15 phút không có request, 750 giờ chạy/tháng cho mỗi workspace |
| **Supabase Free** | Database 500MB, tạm dừng sau ~1 tuần không hoạt động, tối đa 2 project free |
| **Vercel Hobby** | Chỉ dùng cho mục đích cá nhân/phi thương mại |
| **Soniox, OpenAI** | Tính phí theo lượng dùng — đặt giới hạn chi tiêu (usage limit) trong console của từng dịch vụ |

## 10. Checklist bảo mật trước khi chia sẻ link

- [ ] `.env` **không** có trên GitHub (kiểm tra trang repo). Nếu lỡ push: xoá file, **đổi ngay** tất cả key/mật khẩu trong đó.
- [ ] Mọi key chỉ nằm trong Environment của Render/Vercel. Trên Vercel chỉ có biến `VITE_*` (không có key bí mật nào).
- [ ] `ALLOWED_ORIGINS` là domain cụ thể, không phải `*`.
- [ ] Đặt usage limit cho Soniox và OpenAI.
- [ ] ⚠️ **App chưa có đăng nhập**: ai biết URL frontend/backend đều xem, sửa, xoá được toàn bộ phiên ghi chú và dùng
      hạn mức Soniox/OpenAI của bạn. Chỉ chia sẻ link cho người tin cậy cho tới khi thêm xác thực người dùng.
