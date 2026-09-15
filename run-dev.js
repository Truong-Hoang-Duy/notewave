// Khởi động môi trường dev NoteWave bằng MỘT lệnh: `npm run dev` (hoặc dev.bat / dev.ps1 / VS Code task).
// Chỉ cần bật Docker Desktop trước; script tự lo phần còn lại:
//   1. Lần đầu: cài dependencies còn thiếu (npm gốc + client, Python venv) và tạo .env từ .env.example.
//   2. Chờ Docker sẵn sàng (nếu vừa bật Docker Desktop).
//   3. Bật Supabase local (Postgres) nếu chưa chạy.
//   4. Chạy backend FastAPI (cổng 8000) + frontend Vite (cổng 5173).
// Tuỳ chọn: `node run-dev.js --prepare` chỉ làm bước 1–3 rồi thoát (dùng cho VS Code task).
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function run(cmd, args, { cwd = ROOT, quiet = false } = {}) {
  const res = spawnSync(cmd, args, { cwd, stdio: quiet ? 'pipe' : 'inherit', shell: true, encoding: 'utf8' })
  return res.status === 0
}

function exitWith(message) {
  fail(`❌ ${message}`)
  process.exit(1)
}

// ---- 1. Dependencies & .env (chỉ chạy khi thiếu) ----
const supabaseBin = path.join(ROOT, 'node_modules', '.bin', isWin ? 'supabase.cmd' : 'supabase')
const pythonExe = isWin
  ? path.join(ROOT, 'server', '.venv', 'Scripts', 'python.exe')
  : path.join(ROOT, 'server', '.venv', 'bin', 'python')

if (!existsSync(supabaseBin)) {
  info('📦 Cài dependencies ở gốc repo (Supabase CLI)...')
  if (!run('npm', ['install'])) exitWith('npm install ở gốc repo thất bại.')
}
if (!existsSync(path.join(ROOT, 'client', 'node_modules'))) {
  info('📦 Cài dependencies frontend...')
  if (!run('npm', ['install'], { cwd: path.join(ROOT, 'client') })) exitWith('npm install trong client/ thất bại.')
}
if (!existsSync(pythonExe)) {
  info('🐍 Tạo môi trường Python cho backend (server/.venv)...')
  const serverDir = path.join(ROOT, 'server')
  const hasUv = run('uv', ['--version'], { quiet: true })
  const created = hasUv
    ? run('uv', ['venv'], { cwd: serverDir }) && run('uv', ['pip', 'install', '-r', 'requirements-dev.txt'], { cwd: serverDir })
    : run(isWin ? 'python' : 'python3', ['-m', 'venv', '.venv'], { cwd: serverDir }) &&
      run(`"${pythonExe}"`, ['-m', 'pip', 'install', '-r', 'requirements-dev.txt'], { cwd: serverDir })
  if (!created) exitWith('Không tạo được môi trường Python. Cần Python >= 3.10 (khuyên dùng uv).')
}
if (!existsSync(path.join(ROOT, '.env'))) {
  copyFileSync(path.join(ROOT, '.env.example'), path.join(ROOT, '.env'))
  warn('📝 Đã tạo .env từ .env.example — nhớ điền SONIOX_API_KEY và OPENAI_API_KEY để dùng ghi âm / tóm tắt.')
}

// ---- 2. Docker ----
const dockerReady = () => run('docker', ['info'], { quiet: true })
if (!dockerReady()) {
  if (!run('docker', ['--version'], { quiet: true })) {
    exitWith('Không tìm thấy Docker. Cài Docker Desktop: https://www.docker.com/products/docker-desktop/')
  }
  warn('⏳ Docker chưa sẵn sàng — đang chờ (hãy bật Docker Desktop nếu chưa bật)...')
  const deadline = Date.now() + 120_000
  while (!dockerReady()) {
    if (Date.now() > deadline) exitWith('Docker chưa chạy sau 2 phút. Bật Docker Desktop rồi chạy lại `npm run dev`.')
    await sleep(3000)
  }
}
ok('🐳 Docker đã sẵn sàng.')

// ---- 3. Supabase local (Postgres) ----
if (run(`"${supabaseBin}"`, ['status'], { quiet: true })) {
  ok('🗄️  Supabase local đang chạy (Postgres: 127.0.0.1:54322, Studio: http://127.0.0.1:54323).')
} else {
  info('🗄️  Đang bật Supabase local (lần đầu sẽ tải image Docker, có thể mất vài phút)...')
  if (!run(`"${supabaseBin}"`, ['start'])) {
    exitWith(
      'Không bật được Supabase local. Xem lỗi phía trên (thường do trùng cổng 5432x với project Supabase khác — ' +
        'dừng project đó bằng `npx supabase stop --project-id <tên>`).',
    )
  }
  ok('🗄️  Supabase local đã chạy (Postgres: 127.0.0.1:54322, Studio: http://127.0.0.1:54323).')
}

if (prepareOnly) {
  ok('✅ Môi trường dev đã sẵn sàng.')
  process.exit(0)
}

// ---- 4. Backend + Frontend ----
info('🚀 Đang khởi động NoteWave Backend (FastAPI trên port 8000)...')
const backend = spawn(`"${pythonExe}"`, ['-m', 'uvicorn', 'app.main:app', '--reload', '--port', '8000'], {
  cwd: path.join(ROOT, 'server'),
  stdio: 'inherit',
  shell: true,
})

ok('✨ Đang khởi động NoteWave Frontend (Vite & tự động mở trình duyệt)...')
const frontend = spawn('npm', ['run', 'dev'], {
  cwd: path.join(ROOT, 'client'),
  stdio: 'inherit',
  shell: true,
})

let stopping = false
const cleanup = () => {
  if (stopping) return
  stopping = true
  warn('\n🛑 Đang dừng NoteWave (backend + frontend)...')
  for (const child of [backend, frontend]) {
    try {
      // shell: true tạo cây tiến trình con -> trên Windows cần taskkill /T để dừng hẳn uvicorn/vite.
      if (isWin && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      else child.kill()
    } catch {}
  }
  info('ℹ️  Supabase local vẫn chạy nền để lần sau khởi động nhanh. Tắt hẳn: npm run db:stop')
  process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
backend.on('exit', (code) => !stopping && code && (fail(`Backend dừng với mã ${code}.`), cleanup()))
frontend.on('exit', (code) => !stopping && code && (fail(`Frontend dừng với mã ${code}.`), cleanup()))
