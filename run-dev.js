// Khởi động môi trường dev NoteWave bằng MỘT lệnh: `npm run dev` (hoặc dev.bat / dev.ps1 / VS Code task).
// Local dùng CHUNG database Supabase (hosted) với production — không cần Docker hay Supabase CLI:
//   1. Cài dependencies còn thiếu (client, Python venv) — và cài lại khi package-lock.json / requirements*.txt
//      thay đổi (vd sau git pull có thư viện mới) — rồi tạo .env từ .env.example nếu chưa có.
//   2. Kiểm tra DATABASE_URL trong .env đã là connection string Supabase thật.
//   3. Chạy backend FastAPI (cổng 8000) + frontend Vite (cổng 5173).
// Tuỳ chọn: `node run-dev.js --prepare` chỉ làm bước 1–2 rồi thoát (dùng cho VS Code task).
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const isWin = os.platform() === 'win32'
const prepareOnly = process.argv.includes('--prepare')

const color = (code) => (msg) => console.log(`\x1b[${code}m%s\x1b[0m`, msg)
const info = color(36)
const ok = color(32)
const warn = color(33)
const fail = color(31)

function run(cmd, args, { cwd = ROOT, quiet = false } = {}) {
  const res = spawnSync(cmd, args, { cwd, stdio: quiet ? 'pipe' : 'inherit', shell: true, encoding: 'utf8' })
  return res.status === 0
}

function exitWith(message) {
  fail(`❌ ${message}`)
  process.exit(1)
}

// ---- 1. Dependencies & .env ----
const pythonExe = isWin
  ? path.join(ROOT, 'server', '.venv', 'Scripts', 'python.exe')
  : path.join(ROOT, 'server', '.venv', 'bin', 'python')
const clientDir = path.join(ROOT, 'client')
const serverDir = path.join(ROOT, 'server')

// "Dấu vân tay" của file khai báo dependencies, lưu trong node_modules/.venv: khác đi = cần cài lại.
function depsFingerprint(files) {
  const hash = createHash('sha256')
  for (const file of files) if (existsSync(file)) hash.update(readFileSync(file))
  return hash.digest('hex')
}
function readStamp(file) {
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : null
}

const clientStamp = path.join(clientDir, 'node_modules', '.notewave-deps')
const clientFingerprint = depsFingerprint([path.join(clientDir, 'package.json'), path.join(clientDir, 'package-lock.json')])
const hasNodeModules = existsSync(path.join(clientDir, 'node_modules'))
if (!hasNodeModules || readStamp(clientStamp) !== clientFingerprint) {
  info(hasNodeModules ? '📦 Dependencies frontend đã thay đổi — đang cài lại...' : '📦 Cài dependencies frontend...')
  if (!run('npm', ['install'], { cwd: clientDir })) exitWith('npm install trong client/ thất bại.')
  writeFileSync(clientStamp, clientFingerprint)
}

const serverStamp = path.join(serverDir, '.venv', '.notewave-deps')
const serverFingerprint = depsFingerprint([path.join(serverDir, 'requirements.txt'), path.join(serverDir, 'requirements-dev.txt')])
const hasUv = () => run('uv', ['--version'], { quiet: true })
const installServerDeps = () =>
  hasUv()
    ? run('uv', ['pip', 'install', '--python', `"${pythonExe}"`, '-r', 'requirements-dev.txt'], { cwd: serverDir })
    : run(`"${pythonExe}"`, ['-m', 'pip', 'install', '-r', 'requirements-dev.txt'], { cwd: serverDir })
if (!existsSync(pythonExe)) {
  info('🐍 Tạo môi trường Python cho backend (server/.venv)...')
  const created = (hasUv() ? run('uv', ['venv'], { cwd: serverDir }) : run(isWin ? 'python' : 'python3', ['-m', 'venv', '.venv'], { cwd: serverDir })) && installServerDeps()
  if (!created) exitWith('Không tạo được môi trường Python. Cần Python >= 3.10 (khuyên dùng uv).')
  writeFileSync(serverStamp, serverFingerprint)
} else if (readStamp(serverStamp) !== serverFingerprint) {
  info('🐍 Dependencies backend đã thay đổi — đang cài lại (server/requirements-dev.txt)...')
  if (!installServerDeps()) exitWith('Cài dependencies Python thất bại (server/requirements-dev.txt).')
  writeFileSync(serverStamp, serverFingerprint)
}
if (!existsSync(path.join(ROOT, '.env'))) {
  copyFileSync(path.join(ROOT, '.env.example'), path.join(ROOT, '.env'))
  warn('📝 Đã tạo .env từ .env.example — nhớ điền SONIOX_API_KEY, OPENAI_API_KEY và MISTRAL_API_KEY để dùng ghi âm / tóm tắt / quét tài liệu.')
}

// ---- 2. DATABASE_URL (Supabase thật, dùng chung với production) ----
// Đọc thô file .env (không cần thư viện): lấy dòng DATABASE_URL= cuối cùng, bỏ comment/dấu nháy.
function readEnvValue(file, key) {
  if (!existsSync(file)) return undefined
  let value
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`))
    if (m) value = m[1].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '')
  }
  return value
}
const databaseUrl =
  process.env.DATABASE_URL ?? readEnvValue(path.join(ROOT, 'server', '.env'), 'DATABASE_URL') ?? readEnvValue(path.join(ROOT, '.env'), 'DATABASE_URL')
if (!databaseUrl) {
  exitWith(
    'DATABASE_URL trong .env đang trống. Supabase Dashboard > nút Connect (hoặc Project Settings > Database) > ' +
      'Transaction pooler (cổng 6543) > copy connection string, thay mật khẩu, thêm ?sslmode=require rồi dán vào .env.',
  )
}
if (/@(127\.0\.0\.1|localhost):54322\b/.test(databaseUrl)) {
  exitWith('DATABASE_URL vẫn trỏ vào Supabase local (127.0.0.1:54322) — đã bỏ Docker/Supabase CLI. Dán connection string Supabase thật vào .env.')
}
if (!/^postgres(ql)?(\+psycopg)?:\/\//.test(databaseUrl)) {
  exitWith('DATABASE_URL phải là connection string Postgres của Supabase (bắt đầu bằng postgresql://).')
}
const dbHost = databaseUrl.replace(/^[^@]*@/, '').replace(/[/?].*$/, '')
ok(`🗄️  Database: Supabase ${dbHost} (DÙNG CHUNG với production — cẩn thận khi xoá/sửa dữ liệu).`)

if (prepareOnly) {
  ok('✅ Môi trường dev đã sẵn sàng.')
  process.exit(0)
}

// ---- 3. Backend + Frontend ----
info('🚀 Đang khởi động NoteWave Backend (FastAPI trên port 8000)...')
const backend = spawn(`"${pythonExe}"`, ['-m', 'uvicorn', 'app.main:app', '--reload', '--port', '8000'], {
  cwd: path.join(ROOT, 'server'),
  stdio: 'inherit',
  shell: true,
})

let frontend
let stopping = false
const cleanup = () => {
  if (stopping) return
  stopping = true
  warn('\n🛑 Đang dừng NoteWave (backend + frontend)...')
  for (const child of [backend, frontend]) {
    if (!child) continue
    try {
      // shell: true tạo cây tiến trình con -> trên Windows cần taskkill /T để dừng hẳn uvicorn/vite.
      if (isWin && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      else child.kill()
    } catch {}
  }
  process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
backend.on('exit', (code) => !stopping && code && (fail(`Backend dừng với mã ${code}.`), cleanup()))

// Chờ backend sẵn sàng rồi mới bật frontend: backend khởi động ~7 giây (init_db qua mạng tới Supabase);
// bật song song thì Vite mở trình duyệt trước và proxy /api báo ECONNREFUSED.
const BACKEND_READY_TIMEOUT_MS = 90_000
const backendDeadline = Date.now() + BACKEND_READY_TIMEOUT_MS
let backendReady = false
while (!stopping && Date.now() < backendDeadline) {
  try {
    const res = await fetch('http://127.0.0.1:8000/api/health', { signal: AbortSignal.timeout(3000) })
    if (res.ok) {
      const body = await res.json().catch(() => ({}))
      if (body.database === 'error') warn(`⚠️  Backend chạy nhưng không kết nối được database (${body.database_error}).`)
      backendReady = true
      break
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 500))
}
if (stopping) process.exit(1)
if (!backendReady) warn('⚠️  Backend chưa phản hồi /api/health sau 90 giây — vẫn bật frontend, xem log backend phía trên.')

ok('✨ Đang khởi động NoteWave Frontend (Vite & tự động mở trình duyệt)...')
frontend = spawn('npm', ['run', 'dev'], {
  cwd: path.join(ROOT, 'client'),
  stdio: 'inherit',
  shell: true,
})
frontend.on('exit', (code) => !stopping && code && (fail(`Frontend dừng với mã ${code}.`), cleanup()))
