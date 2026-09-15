import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Layers,
  PenLine,
  Pencil,
  SpellCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  Users,
  X,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { groupActions } from '../hooks/useGroups'
import { useScrolled } from '../hooks/useScrolled'
import { useUploadStatus } from '../hooks/useUploadStatus'
import { useViewportFit } from '../hooks/useViewportFit'
import { api } from '../lib/api'
import { formatDateTime, formatDuration, speakerColor, speakerLabel } from '../lib/format'
import ConfirmDialog from './ConfirmDialog'
import GroupSelect from './GroupSelect'
import OcrCorrectionsDialog from './OcrCorrectionsDialog'
import ProcessingCard from './ProcessingCard'
import SummaryPanel from './SummaryPanel'
import { useToast } from './Toast'
import TranscriptEditor from './TranscriptEditor'
import TranscriptView from './TranscriptView'
import { Button, Card, EmptyState, ErrorState, InlineAlert, SourceBadge } from './ui'

// react-markdown + remark-gfm chỉ cần cho phiên quét tài liệu -> tách chunk, tải khi mở phiên OCR.
const OcrDocumentView = lazy(() => import('./OcrDocumentView'))

function ContentSkeleton() {
  return (
    <div aria-busy="true" className="space-y-3">
      <div className="skeleton h-5 w-1/3" />
      <div className="skeleton h-4 w-full" />
      <div className="skeleton h-4 w-11/12" />
      <div className="skeleton h-4 w-4/5" />
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" className="space-y-6">
      <div className="skeleton h-8 w-2/3" />
      <div className="skeleton h-4 w-1/3" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="space-y-5 p-6">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-2">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-4/5" />
            </div>
          ))}
        </Card>
        <div className="skeleton h-40 rounded-2xl" />
      </div>
    </div>
  )
}

function TitleEditor({ title, onSave }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = async () => {
    const next = value.trim()
    if (!next || next === title) {
      setValue(title)
      setEditing(false)
      return
    }
    setSaving(true)
    const ok = await onSave(next)
    setSaving(false)
    if (ok) setEditing(false)
  }

  if (!editing) {
    return (
      <div className="group flex min-w-0 items-start gap-2">
        <h1 className="min-w-0 text-2xl font-semibold tracking-tight text-balance break-words text-ink sm:text-[28px] sm:leading-tight">
          {title}
        </h1>
        <button
          onClick={() => {
            setValue(title)
            setEditing(true)
          }}
          className="mt-1 shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-sunken hover:text-ink sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
          aria-label="Đổi tên phiên"
          title="Đổi tên"
        >
          <Pencil className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        commit()
      }}
    >
      <input
        ref={inputRef}
        value={value}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && (setValue(title), setEditing(false))}
        className="h-11 min-w-0 flex-1 rounded-xl border border-brand-500 bg-surface px-3 text-lg font-semibold text-ink outline-none ring-4 ring-brand-100"
        aria-label="Tên phiên"
        disabled={saving}
      />
      <Button type="submit" variant="primary" icon={Check} loading={saving} aria-label="Lưu tên" />
      <Button variant="ghost" icon={X} onClick={() => setEditing(false)} disabled={saving} aria-label="Huỷ" />
    </form>
  )
}

function ExportMenu({ onExport, exporting }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <Button icon={Download} loading={!!exporting} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        Xuất file
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-52 animate-slide-up rounded-xl border border-line bg-surface p-1.5 shadow-float">
          {[
            ['txt', 'Văn bản (.txt)', 'Nhẹ, mở được ở mọi nơi'],
            ['docx', 'Word (.docx)', 'Có định dạng, dễ chỉnh sửa'],
          ].map(([format, label, hint]) => (
            <button
              key={format}
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onExport(format)
              }}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-paper"
            >
              <FileText className="mt-0.5 size-4 text-brand-600" />
              <span>
                <span className="block text-sm font-medium text-ink">{label}</span>
                <span className="block text-xs text-muted">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Dòng cảnh báo độ tin cậy OCR + banner đề xuất sửa từ tiếng Anh (nằm trong header cố định của khối nội dung). */
function OcrNotices({ ocr, onOpen }) {
  const pending = ocr?.corrections.filter((c) => c.status === 'pending').length ?? 0
  const failedFiles = ocr?.files?.filter((f) => f.error) ?? []
  return (
    <div className="w-full space-y-2.5">
      <p className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-muted">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" />
        Nội dung do AI trích xuất từ ảnh/PDF, có thể sai sót với chữ viết tay khó đọc — hãy kiểm tra lại trước khi dùng.
      </p>
      {pending > 0 && (
        <button
          onClick={onOpen}
          className="group flex w-full animate-fade-in items-center gap-3 rounded-xl border border-[#f0dcb8] bg-warn-soft px-3.5 py-2.5 text-left text-[13px] text-[#7a4a0c] transition-colors hover:border-[#e6c894]"
        >
          <SpellCheck className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 leading-snug">
            Đã phát hiện <strong className="font-semibold">{pending} từ tiếng Anh</strong> có thể viết sai, đã đề xuất sửa —{' '}
            <span className="underline decoration-[#d9b27a] underline-offset-2">bấm để xem chi tiết</span>
          </span>
          <ChevronRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </button>
      )}
      {failedFiles.length > 0 && (
        <p className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-rec">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Không đọc được {failedFiles.length} file (đã bỏ qua, các file khác vẫn được giữ):{' '}
            <span className="font-medium break-all">{failedFiles.map((f) => f.filename).join(', ')}</span>
          </span>
        </p>
      )}
      {ocr?.review_error && (
        <p className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-warn">
          <SpellCheck className="mt-0.5 size-3.5 shrink-0" />
          {ocr.review_error} Bạn vẫn có thể tự sửa bằng “Chỉnh sửa nội dung”.
        </p>
      )}
    </div>
  )
}

export default function SessionDetail({ sessionId, onBack, onDeleted, onOpenSession, backLabel = 'Lịch sử' }) {
  const toast = useToast()
  const [session, setSession] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [summarizing, setSummarizing] = useState(false)
  const [summaryError, setSummaryError] = useState(null)
  const [exporting, setExporting] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pollStartedAt] = useState(() => Date.now())
  const [editing, setEditing] = useState(false)
  const [editDirty, setEditDirty] = useState(false)
  const [savingSegments, setSavingSegments] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [changingGroup, setChangingGroup] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [correctionsOpen, setCorrectionsOpen] = useState(false)
  const [focusCorrection, setFocusCorrection] = useState(null)
  const [deciding, setDeciding] = useState(null) // null | 'all' | id đề xuất
  const fitRef = useViewportFit()
  const [transcriptScrolled, onTranscriptScroll] = useScrolled()

  useEffect(() => {
    const controller = new AbortController()
    setLoadError(null)
    api
      .getSession(sessionId, { signal: controller.signal })
      .then(setSession)
      .catch((err) => {
        if (err?.name !== 'AbortError') setLoadError(err)
      })
    return () => controller.abort()
  }, [sessionId, reloadKey])

  const isProcessing = session?.status === 'processing'
  const isOcr = session?.source === 'ocr'
  const upload = useUploadStatus(sessionId, isProcessing, isOcr ? api.ocrStatus : api.uploadStatus)

  useEffect(() => {
    if (isProcessing && upload.status !== 'processing') setReloadKey((k) => k + 1)
  }, [isProcessing, upload.status])

  const partsById = useMemo(
    () => (session?.merge_sources?.length ? new Map(session.merge_sources.map((m) => [m.id, m])) : null),
    [session],
  )

  const speakers = useMemo(() => {
    const counts = new Map()
    for (const seg of session?.segments ?? []) if (seg.speaker) counts.set(seg.speaker, (counts.get(seg.speaker) ?? 0) + 1)
    return [...counts.keys()].sort((a, b) => Number(a) - Number(b))
  }, [session])

  const rename = useCallback(
    async (title) => {
      try {
        const updated = await api.renameSession(sessionId, title)
        setSession(updated)
        toast.success('Đã đổi tên phiên.')
        return true
      } catch (err) {
        toast.error(err.message)
        return false
      }
    },
    [sessionId, toast],
  )

  const summarize = async () => {
    setSummarizing(true)
    setSummaryError(null)
    try {
      const summary = await api.summarizeSession(sessionId)
      setSession((s) => ({ ...s, summary, summary_outdated: false }))
    } catch (err) {
      setSummaryError(err.message)
    } finally {
      setSummarizing(false)
    }
  }

  const exportAs = async (format) => {
    setExporting(format)
    try {
      await api.exportSession(sessionId, format)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setExporting(null)
    }
  }

  const saveSegments = async (segments) => {
    setSavingSegments(true)
    try {
      const updated = await api.updateSegments(sessionId, segments)
      setSession(updated)
      setEditing(false)
      setEditDirty(false)
      toast.success(updated.summary_outdated ? 'Đã lưu transcript. Nên tóm tắt lại để cập nhật bản tóm tắt.' : 'Đã lưu transcript.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingSegments(false)
    }
  }

  const cancelEditing = () => {
    if (editDirty) setConfirmDiscard(true)
    else setEditing(false)
  }

  const changeGroup = async (groupId) => {
    setChangingGroup(true)
    try {
      const res = await groupActions.assign([sessionId], groupId || null)
      const group = res.items[0]?.group ?? null
      setSession((s) => ({ ...s, group }))
      toast.success(group ? `Đã chuyển vào nhóm “${group.name}”.` : 'Đã gỡ khỏi nhóm.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setChangingGroup(false)
    }
  }

  const restore = async () => {
    setRestoring(true)
    try {
      setSession(await api.restoreSession(sessionId))
      toast.success('Đã khôi phục phiên về danh sách chính.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setRestoring(false)
    }
  }

  const openCorrections = useCallback((id = null) => {
    setFocusCorrection(id)
    setCorrectionsOpen(true)
  }, [])

  const decideCorrections = async (decision, key) => {
    setDeciding(key)
    try {
      const updated = await api.decideOcrCorrections(sessionId, decision)
      setSession(updated)
      const byId = new Map(updated.ocr.corrections.map((c) => [c.id, c]))
      const accepted = decision.accept ?? []
      const unavailable = accepted.filter((id) => byId.get(id)?.status === 'unavailable').length
      if (unavailable) toast.error(`${unavailable} đề xuất không còn áp dụng được vì nội dung đã được chỉnh sửa.`)
      if (key === 'all') {
        setCorrectionsOpen(false)
        if (accepted.length > unavailable) toast.success(`Đã áp dụng ${accepted.length - unavailable} chỉnh sửa.`)
      } else if (!updated.ocr.corrections.some((c) => c.status === 'pending')) {
        setCorrectionsOpen(false)
        toast.success('Đã xử lý hết các đề xuất sửa.')
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setDeciding(null)
    }
  }

  const remove = async () => {
    setDeleting(true)
    try {
      await api.deleteSession(sessionId)
      toast.success('Đã xoá phiên ghi chú.')
      setConfirmDelete(false)
      onDeleted?.()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const backButton = onBack && (
    <button onClick={onBack} className="-ml-2 mb-4 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-sunken hover:text-ink">
      <ArrowLeft className="size-4" />
      {backLabel}
    </button>
  )

  if (loadError) {
    return (
      <div>
        {backButton}
        <Card>
          <ErrorState
            title={loadError.status === 404 ? 'Không tìm thấy phiên' : 'Không tải được phiên ghi chú'}
            message={loadError.status === 404 ? 'Phiên này có thể đã bị xoá.' : loadError.message}
            onRetry={loadError.status === 404 ? undefined : () => setReloadKey((k) => k + 1)}
          />
        </Card>
      </div>
    )
  }

  if (!session) {
    return (
      <div>
        {backButton}
        <DetailSkeleton />
      </div>
    )
  }

  const duration = formatDuration(session.duration_ms)

  return (
    <div className="animate-fade-in">
      {backButton}

      <header className="mb-6 space-y-3">
        <TitleEditor key={session.title} title={session.title} onSave={rename} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted">
          <SourceBadge source={session.source} />
          <span>{formatDateTime(session.created_at)}</span>
          {duration && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" />
              {duration}
            </span>
          )}
          {session.ocr?.pages_processed > 0 && (
            <span className="inline-flex items-center gap-1">
              <FileText className="size-3.5" />
              {session.ocr.pages_processed} trang
              {session.ocr.files?.length > 1 && ` · ${session.ocr.files.length} file`}
            </span>
          )}
          {session.original_filename && <span className="max-w-full truncate">{session.original_filename}</span>}
          {session.merge_sources.length > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-sunken px-2.5 py-1 text-xs font-medium text-ink-soft"
              title={session.merge_sources.map((m) => m.title).join(' · ')}
            >
              <Layers className="size-3.5" />
              Gộp từ {session.merge_sources.length} phiên
            </span>
          )}
        </div>
        {session.status === 'completed' && !editing && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <GroupSelect
              value={session.group?.id ?? ''}
              onChange={changeGroup}
              allowCreate
              extraOptions={[['', 'Chưa phân nhóm']]}
              disabled={changingGroup}
              className="w-full sm:w-56"
              ariaLabel="Nhóm của phiên"
            />
            <Button icon={PenLine} onClick={() => setEditing(true)}>
              {isOcr ? 'Chỉnh sửa nội dung' : 'Chỉnh sửa transcript'}
            </Button>
            <ExportMenu onExport={exportAs} exporting={exporting} />
            <Button
              variant="ghost"
              icon={Sparkles}
              className="xl:hidden"
              onClick={() => document.getElementById('ai-summary')?.scrollIntoView({ behavior: 'smooth' })}
            >
              {session.summary ? 'Xem tóm tắt' : 'Tóm tắt AI'}
            </Button>
            <Button variant="danger-ghost" icon={Trash2} onClick={() => setConfirmDelete(true)}>
              Xoá
            </Button>
          </div>
        )}
      </header>

      {session.archived_at && (
        <div className="mb-6">
          <InlineAlert
            tone="warn"
            action={
              <div className="flex flex-wrap gap-2">
                {session.merged_into_id && onOpenSession && (
                  <Button size="sm" variant="ghost" icon={Layers} onClick={() => onOpenSession(session.merged_into_id)}>
                    Xem phiên đã gộp
                  </Button>
                )}
                <Button size="sm" variant="secondary" icon={ArchiveRestore} onClick={restore} loading={restoring}>
                  Khôi phục
                </Button>
              </div>
            }
          >
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Archive className="size-3.5" /> Phiên này đã được lưu trữ
            </span>{' '}
            sau khi gộp vào một phiên khác, nên không hiện trong danh sách chính.
          </InlineAlert>
        </div>
      )}

      {isProcessing && upload.status === 'processing' && (
        <ProcessingCard filename={session.original_filename} connectionIssue={upload.connectionIssue} startedAt={pollStartedAt} />
      )}

      {session.status === 'failed' && (
        <Card>
          <ErrorState title="Không xử lý được file" message={session.error_message || 'Soniox không thể chuyển file này thành văn bản.'}>
            <Button variant="danger-ghost" icon={Trash2} onClick={() => setConfirmDelete(true)}>
              Xoá phiên
            </Button>
          </ErrorState>
        </Card>
      )}

      {session.status === 'completed' && (
        // Từ xl: 2 cột vừa khung màn hình, mỗi cột tự cuộn nội dung (header từng khối đứng yên).
        // Dưới xl (xếp dọc): trang cuộn tự nhiên theo nội dung.
        <div ref={fitRef} className="grid gap-6 xl:h-(--fit-h) xl:grid-cols-[minmax(0,1fr)_20rem] xl:grid-rows-[minmax(0,1fr)]">
          <Card className="xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden">
            <div
              className={`relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-5 pt-5 pb-4 transition-shadow duration-200 sm:px-7 sm:pt-7 ${
                transcriptScrolled ? 'shadow-[0_10px_18px_-14px_rgb(29_27_24/0.28)]' : ''
              }`}
            >
              <h2 className="text-sm font-semibold text-ink">{isOcr ? 'Nội dung tài liệu' : 'Transcript'}</h2>
              {speakers.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
                  <Users className="size-3.5" />
                  {speakers.map((sp) => (
                    <span key={sp} className="inline-flex items-center gap-1.5 font-medium" style={{ color: speakerColor(sp) }}>
                      <span className="size-2 rounded-full" style={{ backgroundColor: speakerColor(sp) }} />
                      {speakerLabel(sp)}
                    </span>
                  ))}
                </div>
              )}
              {isOcr && <OcrNotices ocr={session.ocr} onOpen={() => openCorrections()} />}
            </div>
            <div onScroll={onTranscriptScroll} className="scroll-area px-5 py-6 sm:px-7 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-contain">
              {editing ? (
                <TranscriptEditor
                  initialSegments={session.segments}
                  partsById={partsById}
                  saving={savingSegments}
                  onSave={saveSegments}
                  onCancel={cancelEditing}
                  onDirtyChange={setEditDirty}
                  title={isOcr ? 'Đang chỉnh sửa nội dung' : undefined}
                />
              ) : isOcr ? (
                <Suspense fallback={<ContentSkeleton />}>
                  <OcrDocumentView
                    segments={session.segments}
                    corrections={session.ocr?.corrections}
                    files={session.ocr?.files}
                    onOpenCorrection={openCorrections}
                    placeholder={<EmptyState icon={FileText} title="Tài liệu trống" description="Không có nội dung nào được trích xuất." />}
                  />
                </Suspense>
              ) : (
                <TranscriptView
                  segments={session.segments}
                  partsById={partsById}
                  placeholder={<EmptyState icon={FileText} title="Transcript trống" description="Không nhận dạng được lời nói nào trong phiên này." />}
                />
              )}
            </div>
          </Card>

          <aside id="ai-summary" className="scroll-mt-24 xl:flex xl:min-h-0 xl:flex-col">
            <SummaryPanel
              title={session.title}
              summary={session.summary}
              outdated={session.summary_outdated}
              loading={summarizing}
              error={summaryError}
              disabled={summarizing || editing || session.segments.length === 0}
              onSummarize={summarize}
            />
          </aside>
        </div>
      )}

      {isOcr && session.ocr && (
        <OcrCorrectionsDialog
          open={correctionsOpen}
          corrections={session.ocr.corrections}
          focusId={focusCorrection}
          deciding={deciding}
          locked={editing}
          onDecide={decideCorrections}
          onClose={() => !deciding && setCorrectionsOpen(false)}
        />
      )}

      <ConfirmDialog
        open={confirmDiscard}
        title="Huỷ các thay đổi chưa lưu?"
        description="Những chỉnh sửa và đoạn đã xoá trong lần chỉnh sửa này sẽ bị bỏ, transcript giữ nguyên như trước."
        confirmLabel="Huỷ thay đổi"
        onConfirm={() => {
          setConfirmDiscard(false)
          setEditing(false)
          setEditDirty(false)
        }}
        onCancel={() => setConfirmDiscard(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Xoá phiên ghi chú này?"
        description={`“${session.title}” cùng transcript và bản tóm tắt sẽ bị xoá vĩnh viễn.`}
        confirmLabel="Xoá vĩnh viễn"
        loading={deleting}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
