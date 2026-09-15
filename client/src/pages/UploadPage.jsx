import { CheckCircle2, CircleAlert, Clock, FileAudio, History, Loader2, RotateCcw, RotateCw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import FilePicker from '../components/FilePicker'
import GroupSelect from '../components/GroupSelect'
import SessionDetail from '../components/SessionDetail'
import { Button, InlineAlert } from '../components/ui'
import { useUploadStatus } from '../hooks/useUploadStatus'
import { api } from '../lib/api'
import { formatBytes, formatClock } from '../lib/format'

const ACCEPTED_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'webm', 'mp4', 'amr', 'aiff', 'aif', 'asf']
const MAX_UPLOAD_MB = Number(import.meta.env.VITE_MAX_UPLOAD_MB) || 100
const MAX_FILES = 20
// Số file tải lên cùng lúc (mỗi file 1 request) — tránh nghẽn mạng/băng thông và RAM của Render free.
const CONCURRENT_UPLOADS = 2
const JOBS_KEY = 'notewave:active-uploads'
const LEGACY_KEY = 'notewave:active-upload' // phiên bản cũ chỉ lưu 1 file

function validateFile(file) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (!ext || !ACCEPTED_EXTENSIONS.includes(ext)) return `Định dạng “.${ext ?? '?'}” không được hỗ trợ (dùng ${ACCEPTED_EXTENSIONS.slice(0, 7).join(', ')}…).`
  if (file.size === 0) return 'File rỗng.'
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return `File lớn ${formatBytes(file.size)}, vượt giới hạn ${MAX_UPLOAD_MB} MB.`
  return null
}

/** Chỉ các file đã tạo phiên (có sessionId) mới khôi phục được sau khi tải lại trang — File chưa gửi không lưu được. */
function loadJobs() {
  try {
    const list = JSON.parse(localStorage.getItem(JOBS_KEY)) ?? []
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY))
    if (legacy?.sessionId && !list.some((j) => j.sessionId === legacy.sessionId)) {
      list.push({ key: `legacy-${legacy.sessionId}`, filename: legacy.filename, sessionId: legacy.sessionId, startedAt: legacy.startedAt, status: 'processing' })
    }
    localStorage.removeItem(LEGACY_KEY)
    return list.filter((j) => j.sessionId).map((j) => ({ ...j, progress: 1 }))
  } catch {
    return []
  }
}

function saveJobs(jobs) {
  try {
    const persisted = jobs
      .filter((j) => j.sessionId)
      .map(({ key, filename, size, sessionId, startedAt, status, error }) => ({ key, filename, size, sessionId, startedAt, status, error }))
    if (persisted.length) localStorage.setItem(JOBS_KEY, JSON.stringify(persisted))
    else localStorage.removeItem(JOBS_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Tải nhiều file ghi âm: mỗi file = 1 request = 1 phiên riêng. Hàng đợi tải lên song song có giới hạn, rồi mỗi phiên
 * được poll trạng thái riêng. Muốn nối các buổi lại thì dùng "Gộp phiên" trong Lịch sử.
 * job.status: queued | uploading | processing | completed | failed
 */
export default function UploadPage({ onOpenHistory, onOpenSession }) {
  const [items, setItems] = useState([]) // file đang chọn, chưa gửi
  const [groupId, setGroupId] = useState('')
  const [jobs, setJobs] = useState(loadJobs)
  const [now, setNow] = useState(() => Date.now())
  const abortsRef = useRef(new Map())
  const startedRef = useRef(new Set())

  const update = useCallback((key, patch) => setJobs((list) => list.map((j) => (j.key === key ? { ...j, ...patch } : j))), [])
  const removeJob = useCallback((key) => setJobs((list) => list.filter((j) => j.key !== key)), [])

  useEffect(() => saveJobs(jobs), [jobs])

  // Hàng đợi: luôn giữ tối đa CONCURRENT_UPLOADS file đang tải lên.
  useEffect(() => {
    const uploading = jobs.filter((j) => j.status === 'uploading').length
    const queued = jobs.filter((j) => j.status === 'queued' && !startedRef.current.has(j.key))
    for (const job of queued.slice(0, Math.max(0, CONCURRENT_UPLOADS - uploading))) {
      startedRef.current.add(job.key)
      update(job.key, { status: 'uploading', progress: 0, error: null })
      const { promise, abort } = api.uploadAudio(job.file, { groupId: job.groupId, onProgress: (p) => update(job.key, { progress: p }) })
      abortsRef.current.set(job.key, abort)
      promise
        .then((res) => update(job.key, { status: 'processing', sessionId: res.session_id, startedAt: Date.now(), progress: 1, file: null }))
        .catch((err) => {
          if (err?.name === 'AbortError') removeJob(job.key)
          else update(job.key, { status: 'failed', error: err.message, uploadFailed: true })
        })
        .finally(() => {
          abortsRef.current.delete(job.key)
          startedRef.current.delete(job.key)
        })
    }
  }, [jobs, update, removeJob])

  useEffect(() => {
    const aborts = abortsRef.current
    return () => aborts.forEach((abort) => abort())
  }, [])

  const busy = jobs.some((j) => j.status === 'queued' || j.status === 'uploading')
  const processing = jobs.some((j) => j.status === 'processing')

  // File chưa gửi xong sẽ mất khi đóng tab -> cảnh báo.
  useEffect(() => {
    if (!busy) return
    const handler = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [busy])

  useEffect(() => {
    if (!processing) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [processing])

  const enqueue = () => {
    const next = items.map((item) => ({
      key: item.id,
      file: item.file,
      filename: item.file.name,
      size: item.file.size,
      groupId: groupId || null,
      status: 'queued',
      progress: 0,
    }))
    setJobs((list) => [...list, ...next])
    setItems([])
  }

  const cancelJob = (job) => {
    if (job.status === 'uploading') abortsRef.current.get(job.key)?.()
    else removeJob(job.key)
  }

  const onStatus = useCallback(
    (key, status, error) => update(key, status === 'failed' ? { status, error: error || 'Soniox không xử lý được file này.' } : { status }),
    [update],
  )

  const clearFinished = () => setJobs((list) => list.filter((j) => j.status !== 'completed' && j.status !== 'failed'))

  // Chỉ tải 1 file và đã xong: giữ trải nghiệm cũ — xem transcript ngay tại trang.
  const single = jobs.length === 1 && items.length === 0 && jobs[0].status === 'completed' ? jobs[0] : null
  if (single) {
    return (
      <div className="space-y-6">
        <InlineAlert tone="info">Đã chuyển xong “{single.filename}”. Phiên đã được lưu vào Lịch sử.</InlineAlert>
        <SessionDetail sessionId={single.sessionId} onDeleted={() => setJobs([])} onOpenSession={onOpenSession} />
        <div className="flex justify-center pt-2">
          <Button icon={RotateCcw} onClick={() => setJobs([])}>
            Tải file khác
          </Button>
        </div>
      </div>
    )
  }

  const done = jobs.filter((j) => j.status === 'completed').length
  const failed = jobs.filter((j) => j.status === 'failed').length

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">Tải file ghi âm lên</h1>
        <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
          Chuyển bản ghi cuộc họp, phỏng vấn hay bài giảng có sẵn thành văn bản, có phân biệt người nói. Chọn nhiều file để xử lý cùng lúc — mỗi file thành một phiên riêng.
        </p>
      </div>

      <FilePicker
        items={items}
        onChange={setItems}
        accept={`audio/*,video/mp4,video/webm,${ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(',')}`}
        validate={validateFile}
        maxFiles={Math.max(1, MAX_FILES - jobs.filter((j) => j.status === 'queued' || j.status === 'uploading').length)}
        dropHint={`MP3, WAV, M4A, AAC, OGG, FLAC, WEBM… · mỗi file tối đa ${MAX_UPLOAD_MB} MB`}
        fileIcon={FileAudio}
        fileIconTone="bg-[#efedf9] text-[#4a44a8]"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <GroupSelect
            value={groupId}
            onChange={setGroupId}
            allowCreate
            extraOptions={[['', 'Không gán nhóm']]}
            className="w-full sm:w-56"
            ariaLabel="Gán các phiên vào nhóm"
          />
          <Button variant="primary" onClick={enqueue} className="w-full sm:ml-auto sm:w-auto">
            {items.length > 1 ? `Chuyển ${items.length} file thành văn bản` : 'Chuyển thành văn bản'}
          </Button>
        </div>
      </FilePicker>

      {jobs.length > 0 && (
        <section className="animate-slide-up overflow-hidden rounded-2xl border border-line bg-surface shadow-card" aria-label="Tiến trình tải lên">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="min-w-0 text-[13px]">
              <p className="font-semibold text-ink">
                {busy || processing ? 'Đang xử lý' : 'Đã xử lý xong'} · {done}/{jobs.length} file
              </p>
              <p className="text-muted">
                {failed > 0 ? `${failed} file lỗi · ` : ''}Có thể rời trang khi đã tải lên xong — kết quả nằm trong Lịch sử.
              </p>
            </div>
            <div className="flex gap-1">
              {done + failed > 0 && (
                <Button size="sm" variant="ghost" onClick={clearFinished}>
                  Dọn mục đã xong
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={History} onClick={onOpenHistory}>
                Lịch sử
              </Button>
            </div>
          </div>
          <div className="h-1 bg-sunken">
            <div className="h-full bg-brand-500 transition-[width] duration-500" style={{ width: `${Math.round(((done + failed) / jobs.length) * 100)}%` }} />
          </div>
          <ul className="divide-y divide-line">
            {jobs.map((job) => (
              <JobRow
                key={job.key}
                job={job}
                now={now}
                onStatus={onStatus}
                onOpen={() => onOpenSession(job.sessionId)}
                onRetry={() => update(job.key, { status: 'queued', error: null, uploadFailed: false })}
                onRemove={() => cancelJob(job)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function JobRow({ job, now, onStatus, onOpen, onRetry, onRemove }) {
  const status = useUploadStatus(job.sessionId, job.status === 'processing')

  useEffect(() => {
    if (job.status === 'processing' && status.status !== 'processing') onStatus(job.key, status.status, status.error)
  }, [job.key, job.status, status.status, status.error, onStatus])

  const icon = {
    queued: <Clock className="size-4 text-muted" />,
    uploading: <Loader2 className="size-4 animate-spin text-brand-600" />,
    processing: <Loader2 className="size-4 animate-spin text-brand-600" />,
    completed: <CheckCircle2 className="size-4 text-brand-600" />,
    failed: <CircleAlert className="size-4 text-rec" />,
  }[job.status]

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className={`grid size-9 shrink-0 place-items-center rounded-lg ${job.status === 'failed' ? 'bg-rec-soft' : job.status === 'completed' ? 'bg-brand-50' : 'bg-sunken'}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{job.filename}</p>
        {job.status === 'uploading' ? (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-sunken">
              {job.progress < 1 ? (
                <div className="h-full rounded-full bg-brand-500 transition-[width] duration-300" style={{ width: `${Math.round(job.progress * 100)}%` }} />
              ) : (
                <div className="h-full w-2/5 animate-indeterminate rounded-full bg-brand-500" />
              )}
            </div>
            <span className="w-24 shrink-0 text-right text-[12px] text-muted tabular-nums">
              {job.progress < 1 ? `Tải lên ${Math.round(job.progress * 100)}%` : 'Đang gửi…'}
            </span>
          </div>
        ) : (
          <p className={`text-[12.5px] ${job.status === 'failed' ? 'text-rec' : 'text-muted'}`}>
            {job.status === 'queued' && `Đang chờ tải lên${job.size ? ` · ${formatBytes(job.size)}` : ''}`}
            {job.status === 'processing' && (
              <>
                Đang chuyển thành văn bản…{job.startedAt && <span className="ml-1 font-mono tabular-nums">{formatClock(now - job.startedAt)}</span>}
                {status.connectionIssue && <span className="text-warn"> · mất kết nối, đang thử lại</span>}
              </>
            )}
            {job.status === 'completed' && 'Đã xong'}
            {job.status === 'failed' && (job.error || 'Có lỗi xảy ra.')}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {job.status === 'completed' && (
          <Button size="sm" variant="secondary" onClick={onOpen}>
            Mở
          </Button>
        )}
        {job.status === 'failed' && job.uploadFailed && job.file && (
          <Button size="sm" variant="secondary" icon={RotateCw} onClick={onRetry}>
            Thử lại
          </Button>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={job.status === 'uploading' || job.status === 'queued' ? `Huỷ tải ${job.filename}` : `Ẩn ${job.filename} khỏi danh sách`}
          title={job.status === 'uploading' || job.status === 'queued' ? 'Huỷ' : 'Ẩn khỏi danh sách (phiên vẫn nằm trong Lịch sử)'}
          className="grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-sunken hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>
    </li>
  )
}
