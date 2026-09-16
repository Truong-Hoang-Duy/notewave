import { RotateCcw, UploadCloud } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useUploadStatus } from '../hooks/useUploadStatus'
import { formatBytes } from '../lib/format'
import FilePicker from './FilePicker'
import ProcessingCard from './ProcessingCard'
import SessionDetail from './SessionDetail'
import { Button, Card, ErrorState, InlineAlert } from './ui'

function readActive(key) {
  try {
    return JSON.parse(localStorage.getItem(key))
  } catch {
    return null
  }
}
function writeActive(key, value) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value))
    else localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

const batchLabel = (items) => (items.length === 1 ? items[0].file.name : `${items.length} file`)

/**
 * Luồng "chọn 1 hoặc nhiều file → tải lên trong MỘT request (có tiến trình) → máy chủ gộp thành MỘT phiên, xử lý nền
 * (poll) → xem kết quả". Dùng cho "Quét tài liệu" (nhiều ảnh/PDF → 1 tài liệu). Nội dung khác nhau truyền qua `config`.
 * stage: select | uploading | processing | done | failed
 */
export default function FileIngestPage({ config, onOpenHistory, onOpenSession }) {
  const { storageKey } = config
  const [stage, setStage] = useState(() => (readActive(storageKey) ? 'processing' : 'select'))
  const [items, setItems] = useState([]) // [{ id, file }]
  const [progress, setProgress] = useState(0)
  const [uploadError, setUploadError] = useState(null)
  const [active, setActive] = useState(() => readActive(storageKey)) // { sessionId, filename, startedAt }
  const abortRef = useRef(null)

  const status = useUploadStatus(active?.sessionId, stage === 'processing', config.fetchStatus)

  useEffect(() => {
    if (stage !== 'processing') return
    if (status.status === 'completed') {
      writeActive(storageKey, null)
      setStage('done')
    } else if (status.status === 'failed') {
      writeActive(storageKey, null)
      setUploadError(status.error || config.defaultFailure)
      setStage('failed')
    }
  }, [stage, status.status, status.error, storageKey, config.defaultFailure])

  useEffect(() => () => abortRef.current?.(), [])

  const totalBytes = items.reduce((sum, i) => sum + i.file.size, 0)
  const tooLarge = config.maxTotalBytes && totalBytes > config.maxTotalBytes

  const startUpload = async () => {
    if (!items.length || tooLarge) return
    setUploadError(null)
    setProgress(0)
    setStage('uploading')
    const { promise, abort } = config.upload(
      items.map((i) => i.file),
      { onProgress: setProgress },
    )
    abortRef.current = abort
    try {
      const res = await promise
      const next = { sessionId: res.session_id, filename: batchLabel(items), startedAt: Date.now() }
      writeActive(storageKey, next)
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
    writeActive(storageKey, null)
    setActive(null)
    setItems([])
    setUploadError(null)
    setProgress(0)
    setStage('select')
  }

  if (stage === 'done' && active) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <InlineAlert tone="info">{config.doneMessage(active.filename)}</InlineAlert>
        </div>
        <SessionDetail sessionId={active.sessionId} onDeleted={reset} onOpenSession={onOpenSession} />
        <div className="flex justify-center pt-2">
          <Button icon={RotateCcw} onClick={reset}>
            {config.resetLabel}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{config.heading}</h1>
        <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{config.description}</p>
      </div>

      {stage === 'select' && (
        <FilePicker
          items={items}
          onChange={setItems}
          accept={config.accept}
          validate={config.validate}
          maxFiles={config.maxFiles}
          dropHint={config.dropHint}
          fileIcon={config.fileIcon}
          fileIconTone={config.fileIconTone}
          reorderable={config.reorderable}
          thumbnails={config.thumbnails}
          preview={config.preview}
          camera={config.camera}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className={`text-[13px] ${tooLarge ? 'font-medium text-rec' : 'text-muted'}`}>
              {tooLarge ? `Tổng dung lượng ${formatBytes(totalBytes)} vượt giới hạn ${formatBytes(config.maxTotalBytes)} mỗi lần.` : config.batchHint?.(items.length)}
            </p>
            <Button variant="primary" onClick={startUpload} disabled={tooLarge} className="w-full sm:w-auto">
              {config.submitLabel(items.length)}
            </Button>
          </div>
        </FilePicker>
      )}

      {stage === 'uploading' && (
        <Card className="animate-fade-in p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600">
              <UploadCloud className="size-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-ink">{progress < 1 ? `Đang tải ${items.length > 1 ? `${items.length} file ` : 'file '}lên…` : config.sendingLabel}</h3>
              <p className="mt-0.5 truncate text-sm text-muted">
                {items.length === 1 ? items[0].file.name : `${items.map((i) => i.file.name).join(', ')}`} · {formatBytes(totalBytes)}
              </p>
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
        <ProcessingCard
          title={config.processing.title}
          icon={config.processing.icon}
          hint={config.processing.hint}
          filename={active.filename}
          connectionIssue={status.connectionIssue}
          startedAt={active.startedAt}
        />
      )}

      {stage === 'failed' && (
        <Card>
          <ErrorState title={config.failedTitle} message={uploadError}>
            {active ? (
              <Button variant="primary" icon={RotateCcw} onClick={reset}>
                Chọn file khác
              </Button>
            ) : (
              // Lỗi khi tải lên (chưa tạo phiên): giữ nguyên danh sách để sửa rồi gửi lại.
              <>
                <Button variant="primary" icon={RotateCcw} onClick={() => setStage('select')}>
                  Sửa danh sách file
                </Button>
                <Button variant="ghost" onClick={reset}>
                  Chọn file khác
                </Button>
              </>
            )}
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
