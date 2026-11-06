import { CheckCircle2, CircleAlert, Clock, FileAudio, Film, History, Loader2, RotateCcw, RotateCw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import FilePicker from '../components/FilePicker'
import GroupSelect from '../components/GroupSelect'
import SessionDetail from '../components/SessionDetail'
import SttProviderToggle from '../components/SttProviderToggle'
import { Button, InlineAlert } from '../components/ui'
import { getSttProvider } from '../hooks/useSttProvider'
import { useUploadStatus } from '../hooks/useUploadStatus'
import { api } from '../lib/api'
import { ACCEPTED_MEDIA_EXTENSIONS, isVideoFile, prepareMediaForUpload } from '../lib/extractAudioFromVideo'
import { formatBytes, formatClock } from '../lib/format'

const MAX_FILES = 20
// Số file xử lý & tải lên cùng lúc (mỗi file 1 request) — tránh nghẽn mạng/băng thông và giữ nhẹ cho Render free.
const CONCURRENT_UPLOADS = 2

function validateFile(file) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  const validExt = ext && ACCEPTED_MEDIA_EXTENSIONS.includes(ext)
  const validMime = file.type && (file.type.startsWith('audio/') || file.type.startsWith('video/'))
  if (!validExt && !validMime) {
    return `Định dạng “.${ext ?? '?'}” không được hỗ trợ (dùng MP3, WAV, M4A, MP4, MOV, MKV, WEBM…).`
  }
  if (file.size === 0) return 'File rỗng.'
  return null
}

/**
 * Tải nhiều file ghi âm hoặc video: mỗi file = 1 request = 1 phiên riêng.
 * Nếu là file video (.mov, .mp4, .mkv, .webm, .avi…), trình duyệt tự động trích xuất riêng kênh âm thanh nhẹ
 * trước khi gửi lên máy chủ để tiết kiệm băng thông và không làm tràn RAM trên Render Free.
 * job.status: queued | extracting | uploading | processing | completed | failed
 */
export default function UploadPage({ onOpenHistory, onOpenSession }) {
  const [items, setItems] = useState([]) // file đang chọn, chưa gửi
  const [groupId, setGroupId] = useState('')
  const [jobs, setJobs] = useState([]) // Khởi tạo rỗng để khi load lại trang luôn làm mới như ban đầu
  const [now, setNow] = useState(() => Date.now())
  const abortsRef = useRef(new Map())
  const startedRef = useRef(new Set())

  // Dọn sạch các key cache cũ để khi load lại trang luôn mới hoàn toàn
  useEffect(() => {
    try {
      localStorage.removeItem('notewave:active-uploads')
      localStorage.removeItem('notewave:active-upload')
    } catch {
      /* ignore */
    }
  }, [])

  const update = useCallback((key, patch) => setJobs((list) => list.map((j) => (j.key === key ? { ...j, ...patch } : j))), [])
  const removeJob = useCallback((key) => setJobs((list) => list.filter((j) => j.key !== key)), [])

  // Hàng đợi: luôn giữ tối đa CONCURRENT_UPLOADS file đang tách âm thanh / tải lên.
  useEffect(() => {
    const activeCount = jobs.filter((j) => j.status === 'extracting' || j.status === 'uploading').length
    const queued = jobs.filter((j) => j.status === 'queued' && !startedRef.current.has(j.key))
    for (const job of queued.slice(0, Math.max(0, CONCURRENT_UPLOADS - activeCount))) {
      startedRef.current.add(job.key)

      ;(async () => {
        let uploadTarget = job.file
        let extractedInfo = null
        let cancelled = false

        abortsRef.current.set(job.key, () => {
          cancelled = true
        })

        try {
          if (job.isVideo) {
            update(job.key, { status: 'extracting', extractProgress: 0, error: null })
            const prepared = await prepareMediaForUpload(job.file, {
              onProgress: (p) => update(job.key, { extractProgress: p }),
            })
            if (cancelled) {
              removeJob(job.key)
              return
            }
            uploadTarget = prepared.file
            if (prepared.extracted) {
              extractedInfo = {
                originalSize: prepared.originalSize,
                extractedSize: prepared.extractedSize,
              }
            }
          }

          update(job.key, {
            status: 'uploading',
            progress: 0,
            error: null,
            extractedInfo,
          })

          const { promise, abort } = api.uploadAudio(uploadTarget, {
            title: job.title,
            groupId: job.groupId,
            provider: job.provider,
            onProgress: (p) => update(job.key, { progress: p }),
          })
          abortsRef.current.set(job.key, abort)

          const res = await promise
          update(job.key, {
            status: 'processing',
            sessionId: res.session_id,
            startedAt: Date.now(),
            progress: 1,
            file: null,
          })
        } catch (err) {
          if (cancelled || err?.name === 'AbortError') removeJob(job.key)
          else update(job.key, { status: 'failed', error: err.message, uploadFailed: true })
        } finally {
          abortsRef.current.delete(job.key)
          startedRef.current.delete(job.key)
        }
      })()
    }
  }, [jobs, update, removeJob])

  useEffect(() => {
    const aborts = abortsRef.current
    return () => aborts.forEach((abort) => abort())
  }, [])

  const busy = jobs.some((j) => j.status === 'queued' || j.status === 'extracting' || j.status === 'uploading')
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
    const selectedProvider = getSttProvider()
    const next = items.map((item) => {
      const stem = item.file.name.replace(/\.[^/.]+$/, '')
      const customTitle = (item.title !== undefined ? item.title : stem).trim() || stem
      return {
        key: item.id,
        file: item.file,
        filename: item.file.name,
        title: customTitle,
        size: item.file.size,
        isVideo: isVideoFile(item.file),
        groupId: groupId || null,
        provider: selectedProvider,
        status: 'queued',
        progress: 0,
        extractProgress: 0,
      }
    })
    setJobs((list) => [...list, ...next])
    setItems([])
  }

  const cancelJob = (job) => {
    if (job.status === 'extracting' || job.status === 'uploading') abortsRef.current.get(job.key)?.()
    else removeJob(job.key)
  }

  const onStatus = useCallback(
    (key, status, error) => update(key, status === 'failed' ? { status, error: error || 'Không xử lý được file này.' } : { status }),
    [update],
  )

  const clearFinished = () => setJobs((list) => list.filter((j) => j.status !== 'completed' && j.status !== 'failed'))

  // Chỉ tải 1 file và đã xong: giữ trải nghiệm xem transcript ngay tại trang.
  const single = jobs.length === 1 && items.length === 0 && jobs[0].status === 'completed' ? jobs[0] : null
  if (single) {
    return (
      <div className="space-y-6">
        <InlineAlert tone="info">Đã chuyển xong “{single.title || single.filename}”. Phiên đã được lưu vào Lịch sử.</InlineAlert>
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
    <div className="mx-auto max-w-3xl space-y-4 sm:space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-card sm:px-5 sm:py-3.5">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">Tải Audio · Video</h1>
          <p className="mt-0.5 text-xs text-muted sm:text-[13.5px]">
            Tự tách âm thanh từ video & chuyển thành văn bản có phân biệt người nói.
          </p>
        </div>
        <SttProviderToggle size="sm" className="shrink-0" />
      </div>

      <FilePicker
        items={items}
        onChange={setItems}
        accept={`audio/*,video/*,${ACCEPTED_MEDIA_EXTENSIONS.map((e) => `.${e}`).join(',')}`}
        validate={validateFile}
        maxFiles={Math.max(
          1,
          MAX_FILES - jobs.filter((j) => j.status === 'queued' || j.status === 'extracting' || j.status === 'uploading').length,
        )}
        dropHint="Audio (MP3, WAV, M4A…) · Video (MP4, MOV, MKV, WEBM…)"
        fileIcon={FileAudio}
        fileIconTone="bg-[#efedf9] text-[#4a44a8]"
        editableTitle
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
    extracting: <Film className="size-4 animate-pulse text-brand-600" />,
    uploading: <Loader2 className="size-4 animate-spin text-brand-600" />,
    processing: <Loader2 className="size-4 animate-spin text-brand-600" />,
    completed: <CheckCircle2 className="size-4 text-brand-600" />,
    failed: <CircleAlert className="size-4 text-rec" />,
  }[job.status]

  const sizeSavedBadge = job.extractedInfo ? (
    <span className="ml-1.5 inline-flex items-center rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">
      Đã tách audio: {formatBytes(job.extractedInfo.originalSize)} → {formatBytes(job.extractedInfo.extractedSize)}
    </span>
  ) : job.isVideo ? (
    <span className="ml-1.5 inline-flex items-center rounded bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-ink-soft">
      Video
    </span>
  ) : null

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className={`grid size-9 shrink-0 place-items-center rounded-lg ${job.status === 'failed' ? 'bg-rec-soft' : job.status === 'completed' ? 'bg-brand-50' : 'bg-sunken'}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1">
          <p className="truncate text-sm font-medium text-ink">{job.title || job.filename}</p>
          {sizeSavedBadge}
        </div>
        {job.title && job.title !== job.filename && (
          <p className="truncate font-mono text-[11.5px] text-muted/80">{job.filename}</p>
        )}
        {job.status === 'extracting' ? (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-sunken">
              <div
                className="h-full rounded-full bg-brand-500 transition-[width] duration-300"
                style={{ width: `${Math.max(8, Math.round((job.extractProgress || 0) * 100))}%` }}
              />
            </div>
            <span className="shrink-0 text-right text-[12px] text-brand-700 tabular-nums">
              Đang tách âm thanh từ video… {Math.round((job.extractProgress || 0) * 100)}%
            </span>
          </div>
        ) : job.status === 'uploading' ? (
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
            {job.status === 'queued' && `Đang chờ xử lý${job.size ? ` · ${formatBytes(job.size)}` : ''}`}
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
          aria-label={job.status === 'extracting' || job.status === 'uploading' || job.status === 'queued' ? `Huỷ ${job.filename}` : `Ẩn ${job.filename} khỏi danh sách`}
          title={job.status === 'extracting' || job.status === 'uploading' || job.status === 'queued' ? 'Huỷ' : 'Ẩn khỏi danh sách (phiên vẫn nằm trong Lịch sử)'}
          className="grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-sunken hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>
    </li>
  )
}
