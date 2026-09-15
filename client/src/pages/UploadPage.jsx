import { FileAudio, RotateCcw, UploadCloud, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import ProcessingCard from '../components/ProcessingCard'
import SessionDetail from '../components/SessionDetail'
import { Button, Card, ErrorState, InlineAlert } from '../components/ui'
import { useUploadStatus } from '../hooks/useUploadStatus'
import { api } from '../lib/api'
import { formatBytes } from '../lib/format'

const ACCEPTED_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'webm', 'mp4', 'amr', 'aiff', 'aif', 'asf']
const MAX_UPLOAD_MB = Number(import.meta.env.VITE_MAX_UPLOAD_MB) || 100
const ACTIVE_UPLOAD_KEY = 'notewave:active-upload'

function validateFile(file) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (!ext || !ACCEPTED_EXTENSIONS.includes(ext)) {
    return `Định dạng “.${ext ?? '?'}” không được hỗ trợ. Hãy chọn file ${ACCEPTED_EXTENSIONS.slice(0, 7).join(', ')}…`
  }
  if (file.size === 0) return 'File rỗng.'
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return `File lớn ${formatBytes(file.size)}, vượt giới hạn ${MAX_UPLOAD_MB} MB.`
  return null
}

function readActiveUpload() {
  try {
    return JSON.parse(localStorage.getItem(ACTIVE_UPLOAD_KEY))
  } catch {
    return null
  }
}
function writeActiveUpload(value) {
  try {
    if (value) localStorage.setItem(ACTIVE_UPLOAD_KEY, JSON.stringify(value))
    else localStorage.removeItem(ACTIVE_UPLOAD_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * stage: select | uploading | processing | done | failed
 */
export default function UploadPage({ onOpenHistory, onOpenSession }) {
  const [stage, setStage] = useState(() => (readActiveUpload() ? 'processing' : 'select'))
  const [file, setFile] = useState(null)
  const [fileError, setFileError] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0)
  const [uploadError, setUploadError] = useState(null)
  const [active, setActive] = useState(readActiveUpload) // { sessionId, filename, startedAt }
  const inputRef = useRef(null)
  const abortRef = useRef(null)

  const status = useUploadStatus(active?.sessionId, stage === 'processing')

  useEffect(() => {
    if (stage !== 'processing') return
    if (status.status === 'completed') {
      writeActiveUpload(null)
      setStage('done')
    } else if (status.status === 'failed') {
      writeActiveUpload(null)
      setUploadError(status.error || 'Soniox không xử lý được file này.')
      setStage('failed')
    }
  }, [stage, status.status, status.error])

  useEffect(() => () => abortRef.current?.(), [])

  const pick = (candidate) => {
    if (!candidate) return
    const err = validateFile(candidate)
    setFileError(err)
    setFile(err ? null : candidate)
  }

  const startUpload = async () => {
    if (!file) return
    setUploadError(null)
    setProgress(0)
    setStage('uploading')
    const { promise, abort } = api.uploadAudio(file, { onProgress: setProgress })
    abortRef.current = abort
    try {
      const res = await promise
      const next = { sessionId: res.session_id, filename: file.name, startedAt: Date.now() }
      writeActiveUpload(next)
      setActive(next)
      setStage('processing')
    } catch (err) {
      if (err?.name === 'AbortError') {
        setStage('select')
        return
      }
      setUploadError(err.message)
      setStage('failed')
    } finally {
      abortRef.current = null
    }
  }

  const reset = () => {
    writeActiveUpload(null)
    setActive(null)
    setFile(null)
    setFileError(null)
    setUploadError(null)
    setProgress(0)
    setStage('select')
  }

  if (stage === 'done' && active) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <InlineAlert tone="info">Đã chuyển xong “{active.filename}”. Phiên đã được lưu vào Lịch sử.</InlineAlert>
        </div>
        <SessionDetail sessionId={active.sessionId} onDeleted={reset} onOpenSession={onOpenSession} />
        <div className="flex justify-center pt-2">
          <Button icon={RotateCcw} onClick={reset}>
            Tải file khác
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">Tải file ghi âm lên</h1>
        <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
          Chuyển bản ghi cuộc họp, phỏng vấn hay bài giảng có sẵn thành văn bản, có phân biệt người nói.
        </p>
      </div>

      {stage === 'select' && (
        <>
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), inputRef.current?.click())}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              pick(e.dataTransfer.files?.[0])
            }}
            className={`flex animate-fade-in flex-col items-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors duration-200 sm:py-16 ${
              dragging ? 'border-brand-500 bg-brand-50' : 'border-line-strong bg-surface hover:border-brand-200 hover:bg-brand-50/40'
            }`}
          >
            <div className={`grid size-14 place-items-center rounded-2xl transition-transform duration-200 ${dragging ? 'scale-110 bg-brand-100 text-brand-700' : 'bg-brand-50 text-brand-600'}`}>
              <UploadCloud className="size-7" />
            </div>
            <p className="mt-5 font-medium text-ink">
              <span className="hidden sm:inline">Kéo thả file vào đây hoặc </span>
              <span className="text-brand-600 underline decoration-brand-200 underline-offset-4">chọn file từ thiết bị</span>
            </p>
            <p className="mt-1.5 text-[13px] text-muted">MP3, WAV, M4A, AAC, OGG, FLAC, WEBM… · tối đa {MAX_UPLOAD_MB} MB</p>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept={`audio/*,video/mp4,video/webm,${ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(',')}`}
              onChange={(e) => {
                pick(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>

          {fileError && <InlineAlert>{fileError}</InlineAlert>}

          {file && (
            <Card className="flex animate-slide-up flex-wrap items-center gap-4 p-4">
              <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#efedf9] text-[#4a44a8]">
                <FileAudio className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{file.name}</p>
                <p className="text-[13px] text-muted">{formatBytes(file.size)}</p>
              </div>
              <div className="flex w-full gap-2 sm:w-auto">
                <Button variant="ghost" icon={X} onClick={() => setFile(null)} aria-label="Bỏ chọn file" />
                <Button variant="primary" onClick={startUpload} className="flex-1 sm:flex-none">
                  Chuyển thành văn bản
                </Button>
              </div>
            </Card>
          )}
        </>
      )}

      {stage === 'uploading' && (
        <Card className="animate-fade-in p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600">
              <UploadCloud className="size-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-ink">{progress < 1 ? 'Đang tải file lên…' : 'Đang gửi tới dịch vụ nhận dạng…'}</h3>
              <p className="mt-0.5 truncate text-sm text-muted">{file?.name}</p>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-sunken">
                {progress < 1 ? (
                  <div className="h-full rounded-full bg-brand-500 transition-[width] duration-300" style={{ width: `${Math.round(progress * 100)}%` }} />
                ) : (
                  <div className="h-full w-2/5 animate-indeterminate rounded-full bg-brand-500" />
                )}
              </div>
              <div className="mt-3 flex items-center justify-between text-[13px] text-muted">
                <span className="font-mono tabular-nums">{Math.round(progress * 100)}%</span>
                <Button variant="ghost" size="sm" onClick={() => abortRef.current?.()} disabled={progress >= 1}>
                  Huỷ
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {stage === 'processing' && active && (
        <ProcessingCard filename={active.filename} connectionIssue={status.connectionIssue} startedAt={active.startedAt} />
      )}

      {stage === 'failed' && (
        <Card>
          <ErrorState title="Không chuyển được file" message={uploadError}>
            <Button variant="primary" icon={RotateCcw} onClick={reset}>
              Chọn file khác
            </Button>
            {active && (
              <Button variant="ghost" onClick={onOpenHistory}>
                Xem lịch sử
              </Button>
            )}
          </ErrorState>
        </Card>
      )}
    </div>
  )
}
