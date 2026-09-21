import {
  ArrowLeft,
  BookOpenCheck,
  Check,
  CloudOff,
  FileText,
  GraduationCap,
  ListTree,
  Loader2,
  MoreHorizontal,
  NotebookText,
  SpellCheck,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { refreshNoteLibrary } from '../../hooks/useNoteLibrary'
import { useViewportFit } from '../../hooks/useViewportFit'
import { clearNoteDraft, readNoteDraft, useNoteAutosave } from '../../hooks/useNoteAutosave'
import { api } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { noteStyleVars } from '../../lib/noteStyles'
import { applyProofreadSuggestions } from '../../lib/noteProofread'
import ConfirmDialog from '../ConfirmDialog'
import { useToast } from '../Toast'
import { Button, ErrorState, Spinner } from '../ui'
import { blockText, collectBlockIds, newCueId, revealBlock } from '../../lib/noteEditor'
import CueColumn from './CueColumn'
import FolderSelect from './FolderSelect'
import NoteAiPanel from './NoteAiPanel'
import NoteContentEditor from './NoteContentEditor'
import NoteLinksPanel from './NoteLinksPanel'
import NoteStylePicker from './NoteStylePicker'
import ProofreadDialog from './ProofreadDialog'
import TagPicker from './TagPicker'
import { useAutoGrow } from './useAutoGrow'
import { useDismiss } from './useDismiss'

const SUMMARY_TABS = [
  { id: 'mine', label: 'Của bạn' },
  { id: 'ai', label: 'AI' },
]

const MOBILE_TABS = [
  { id: 'content', label: 'Nội dung', icon: FileText },
  { id: 'cues', label: 'Câu hỏi', icon: ListTree },
  { id: 'summary', label: 'Tóm tắt', icon: NotebookText },
]

function SaveStatus({ status, error, updatedAt }) {
  const base = 'inline-flex items-center gap-1.5 text-[12.5px] whitespace-nowrap'
  if (status === 'saving' || status === 'pending')
    return (
      <span className={`${base} text-muted`} role="status">
        <Loader2 className="size-3.5 animate-spin" /> Đang lưu…
      </span>
    )
  if (status === 'error')
    return (
      <span className={`${base} text-warn`} role="status" title={error?.message}>
        <CloudOff className="size-3.5" /> Chưa lưu được — đã giữ bản nháp trên máy, đang thử lại
      </span>
    )
  return (
    <span className={`${base} text-muted`} role="status" title={updatedAt ? `Lưu lúc ${formatDateTime(updatedAt)}` : undefined}>
      <Check className="size-3.5 text-brand-600" /> Đã lưu
    </span>
  )
}

function MoreMenu({ onDelete }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useDismiss(ref, open, () => setOpen(false))
  return (
    <div className="relative" ref={ref}>
      <Button size="sm" variant="ghost" icon={MoreHorizontal} onClick={() => setOpen((o) => !o)} aria-label="Thao tác khác" aria-haspopup="menu" aria-expanded={open} />
      {open && (
        <div role="menu" className="absolute top-full right-0 z-40 mt-2 w-48 animate-slide-up rounded-xl border border-line bg-surface p-1.5 shadow-float">
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-rec hover:bg-rec-soft"
          >
            <Trash2 className="size-4" /> Xoá ghi chú
          </button>
        </div>
      )}
    </div>
  )
}

function AutoGrowSummary({ value, onChange, disabled }) {
  const ref = useRef(null)
  useAutoGrow(ref, value, 112)
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      readOnly={disabled}
      maxLength={50000}
      placeholder="Sau khi học xong, tóm tắt lại bài bằng lời của bạn trong vài câu…"
      aria-label="Tóm tắt của bạn"
      className="w-full resize-none bg-transparent text-[1em] leading-relaxed text-[var(--note-fg)] outline-none placeholder:text-[var(--note-muted)]/75"
    />
  )
}

/** Trang chi tiết ghi chú Cornell (lazy chunk: kéo theo Tiptap). */
export default function NoteDetail({ noteId, onBack, onDeleted }) {
  const toast = useToast()
  const [note, setNote] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    // Component được mount lại theo `key={noteId}` (App.jsx) nên không cần reset state ở đây.
    const controller = new AbortController()
    const draft = readNoteDraft(noteId)
    Promise.all([api.getNote(noteId, { signal: controller.signal }), draft?.patch.tag_ids ? api.listTags() : null])
      .then(([loaded, allTags]) => {
        // Còn bản nháp chưa lên máy chủ và mới hơn bản trên máy chủ -> áp vào rồi lưu lại.
        if (!draft || draft.saved_at <= Date.parse(loaded.updated_at)) {
          if (draft) clearNoteDraft(noteId)
          return setNote(loaded)
        }
        const { tag_ids: tagIds, folder_id: folderId, ...fields } = draft.patch
        const restored = { ...loaded, ...fields, restoredDraft: draft.patch }
        if (folderId !== undefined) restored.folder = folderId ? { id: folderId, name: '' } : null
        if (tagIds && allTags) restored.tags = allTags.filter((t) => tagIds.includes(t.id)).map(({ id, name }) => ({ id, name }))
        setNote(restored)
      })
      .catch((err) => err?.name !== 'AbortError' && setLoadError(err))
    return () => controller.abort()
  }, [noteId, reloadKey])

  if (loadError)
    return (
      <ErrorState
        title="Không mở được ghi chú"
        message={loadError.message}
        onRetry={() => {
          setLoadError(null)
          setReloadKey((k) => k + 1)
        }}
      >
        <Button icon={ArrowLeft} onClick={onBack}>
          Về danh sách
        </Button>
      </ErrorState>
    )
  if (!note)
    return (
      <div className="grid place-items-center py-24">
        <Spinner />
      </div>
    )
  return <NoteWorkspace key={note.id} initialNote={note} onBack={onBack} onDeleted={onDeleted} toast={toast} />
}

function NoteWorkspace({ initialNote, onBack, onDeleted, toast }) {
  const noteId = initialNote.id
  const [title, setTitle] = useState(initialNote.title)
  const [cues, setCues] = useState(() => (initialNote.cues.length ? initialNote.cues : [{ id: newCueId(), text: '', anchor: null }]))
  const [summary, setSummary] = useState(initialNote.summary)
  const [style, setStyle] = useState(initialNote.style)
  const [tags, setTags] = useState(initialNote.tags)
  const [folderId, setFolderId] = useState(initialNote.folder?.id ?? '')
  const [updatedAt, setUpdatedAt] = useState(initialNote.updated_at)
  const [editor, setEditor] = useState(null)
  const [activeBlockId, setActiveBlockId] = useState(null)
  const [blockIds, setBlockIds] = useState(() => new Set())
  const [studyMode, setStudyMode] = useState(false)
  const [mobileTab, setMobileTab] = useState('content')
  // GĐ3: tóm tắt AI (cột riêng với tóm tắt tự viết), liên kết [[...]] và soát lỗi chính tả.
  const [summaryTab, setSummaryTab] = useState('mine')
  const [aiSummary, setAiSummary] = useState(initialNote.ai_summary)
  const [aiOutdated, setAiOutdated] = useState(initialNote.ai_summary_outdated)
  const [aiLoading, setAiLoading] = useState(false)
  const [links, setLinks] = useState(null)
  const [proofread, setProofread] = useState(null) // { loading, result } khi hộp thoại soát lỗi đang mở
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const latest = useRef({})
  useLayoutEffect(() => {
    latest.current = { title, cues, summary, style, tags, folderId, editor }
  })

  const collect = useCallback((fields) => {
    const s = latest.current
    const patch = {}
    if (fields.has('title')) patch.title = s.title.trim() || 'Ghi chú không tên'
    if (fields.has('cues')) patch.cues = s.cues.map(({ id, text, anchor }) => ({ id, text, anchor: anchor ?? null }))
    if (fields.has('summary')) patch.summary = s.summary
    if (fields.has('style')) patch.style = s.style
    if (fields.has('tags')) patch.tag_ids = s.tags.map((t) => t.id)
    if (fields.has('folder')) patch.folder_id = s.folderId || null
    if (fields.has('content') && s.editor) {
      patch.content_json = s.editor.getJSON()
      patch.content_md = s.editor.getMarkdown()
    }
    return patch
  }, [])

  const loadLinks = useCallback(
    (signal) => api.noteLinks(noteId, { signal }).then(setLinks).catch(() => {}),
    [noteId],
  )
  useEffect(() => {
    const controller = new AbortController()
    loadLinks(controller.signal)
    return () => controller.abort()
  }, [loadLinks])

  const onSaved = useCallback(
    (saved, patch) => {
      setUpdatedAt(saved.updated_at)
      // Số note trong thư mục / tag thay đổi -> cập nhật kho dùng chung (sidebar danh sách).
      if ('tag_ids' in patch || 'folder_id' in patch) refreshNoteLibrary()
      // Backend tính lại liên kết [[...]] mỗi lần nội dung được lưu -> lấy danh sách mới.
      if ('content_md' in patch) loadLinks()
    },
    [loadLinks],
  )
  const { status, error, markDirty, flush, cancel } = useNoteAutosave(noteId, collect, { onSaved })

  // Khôi phục nháp (xem NoteDetail): đánh dấu các field trong nháp để lưu lại lên máy chủ.
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current || !initialNote.restoredDraft) return
    restored.current = true
    const map = { title: 'title', cues: 'cues', summary: 'summary', style: 'style', content_json: 'content', tag_ids: 'tags', folder_id: 'folder' }
    const fields = Object.keys(initialNote.restoredDraft).map((k) => map[k]).filter(Boolean)
    if (!fields.length) return
    fields.forEach((f) => markDirty(f, { immediate: true }))
    toast.success('Đã khôi phục thay đổi chưa kịp lưu lên máy chủ ở lần trước.')
  }, [initialNote.restoredDraft, markDirty, toast])

  const onEditorReady = useCallback((e) => {
    setEditor(e)
    setBlockIds(collectBlockIds(e))
  }, [])
  const blockIdsTimer = useRef(null)
  const onContentChange = useCallback(
    (e) => {
      markDirty('content')
      setAiOutdated(true) // chỉ có ý nghĩa khi đã có tóm tắt AI; NoteAiPanel tự quyết định hiện cảnh báo hay không
      clearTimeout(blockIdsTimer.current)
      blockIdsTimer.current = setTimeout(() => setBlockIds(collectBlockIds(e)), 300)
    },
    [markDirty],
  )
  useEffect(() => () => clearTimeout(blockIdsTimer.current), [])

  const changeCues = (next) => {
    setCues(next)
    markDirty('cues')
  }

  const anchorCue = (cueId) => {
    if (!activeBlockId) {
      toast.error('Đặt con trỏ vào đoạn cần neo ở phần nội dung trước, rồi bấm neo.')
      if (mobileTab !== 'content') setMobileTab('content')
      return
    }
    changeCues(cues.map((c) => (c.id === cueId ? { ...c, anchor: activeBlockId } : c)))
  }

  const goToBlock = (id) => {
    setMobileTab('content')
    // Chờ tab nội dung hiện ra (mobile) rồi mới cuộn.
    requestAnimationFrame(() => {
      if (!revealBlock(editor, id)) toast.error('Không tìm thấy đoạn được neo — có thể đã bị xoá.')
    })
  }

  const generateAiSummary = async () => {
    setSummaryTab('ai')
    setAiLoading(true)
    try {
      await flush() // nội dung mới nhất phải nằm trên máy chủ trước khi AI đọc
      const created = await api.aiSummarizeNote(noteId)
      setAiSummary(created)
      setAiOutdated(false)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setAiLoading(false)
    }
  }

  /** Thêm câu hỏi ôn tập do AI đề xuất vào cột câu hỏi (bỏ câu đã có, giữ lại một ô trống ở cuối để gõ tiếp). */
  const addQuestions = (questions) => {
    const existing = cues.filter((c) => c.text.trim())
    const known = new Set(existing.map((c) => c.text.trim().toLowerCase()))
    const added = questions.filter((q) => !known.has(q.trim().toLowerCase()))
    if (!added.length) {
      toast.success('Các câu hỏi này đã có trong cột câu hỏi.')
      return
    }
    changeCues([...existing, ...added.map((text) => ({ id: newCueId(), text, anchor: null })), { id: newCueId(), text: '', anchor: null }])
    toast.success(added.length === 1 ? 'Đã thêm 1 câu hỏi vào cột câu hỏi.' : `Đã thêm ${added.length} câu hỏi vào cột câu hỏi.`)
  }

  const runProofread = async () => {
    setProofread({ loading: true, result: null })
    try {
      await flush()
      const result = await api.proofreadNote(noteId)
      setProofread({ loading: false, result })
    } catch (err) {
      setProofread(null)
      toast.error(err.message)
    }
  }

  const applyProofread = (picked) => {
    setProofread(null)
    const changed = applyProofreadSuggestions(editor, picked)
    if (!changed) {
      toast.error('Những chỗ này vừa thay đổi nên không áp dụng được nữa. Hãy soát lỗi lại.')
      return
    }
    markDirty('content', { immediate: true })
    toast.success(`Đã sửa ${changed} chỗ trong nội dung. Ctrl+Z để hoàn tác.`)
  }

  const doDelete = async () => {
    setDeleting(true)
    try {
      cancel()
      await api.deleteNote(noteId)
      refreshNoteLibrary()
      toast.success('Đã xoá ghi chú.')
      onDeleted()
    } catch (err) {
      toast.error(err.message)
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  // Đánh dấu các đoạn đang được neo: vạch dọc mảnh + nền nhạt (CSS động theo id — không sửa DOM của ProseMirror).
  const anchorCss = useMemo(() => {
    const ids = [...new Set(cues.filter((c) => c.anchor && c.text.trim()).map((c) => c.anchor))]
    if (!ids.length) return ''
    return `${ids.map((id) => `.note-content [data-id="${CSS.escape(id)}"]`).join(',')}{` +
      'box-shadow:inset 2px 0 0 color-mix(in srgb,var(--note-accent) 60%,transparent);' +
      'background:color-mix(in srgb,var(--note-soft) 45%,transparent);border-radius:0 .3em .3em 0;padding-left:.6em}'
  }, [cues])

  const cueCount = cues.filter((c) => c.text.trim()).length
  // Khung ghi chú cao đúng phần màn hình còn lại (trang ngoài không cuộn); từng vùng tự cuộn bên trong.
  // Tối thiểu 220px (thanh công cụ + vài dòng): chỉ màn hình rất thấp / bàn phím chiếm quá nửa mới chạm mức này, khi
  // đó trang cuộn nhẹ để con trỏ không bị che.
  const fitRef = useViewportFit({ minHeight: 220, mobile: true })
  // Dưới lg: 3 tab, chỉ vùng đang chọn được hiện và chiếm hết chiều cao khung.
  const panel = (id) => (mobileTab === id ? 'flex' : 'hidden lg:flex')

  return (
    <div className="mx-auto max-w-7xl space-y-2 sm:space-y-4">
      <style>{anchorCss}</style>
      {/* Thanh trên: quay lại, trạng thái lưu, thao tác */}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={onBack} className="-ml-2">
          <span className="hidden sm:inline">Ghi chú</span>
        </Button>
        <div className="min-w-0 flex-1 truncate">
          <SaveStatus status={status} error={error} updatedAt={updatedAt} />
        </div>
        <Button
          size="sm"
          variant={studyMode ? 'primary' : 'ghost'}
          icon={studyMode ? BookOpenCheck : GraduationCap}
          onClick={() => {
            setStudyMode((m) => !m)
            setMobileTab(studyMode ? 'content' : 'cues')
          }}
          aria-pressed={studyMode}
          title="Che nội dung, tự trả lời các câu hỏi ở cột trái"
        >
          <span className="hidden sm:inline">Ôn tập</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={SpellCheck}
          onClick={runProofread}
          disabled={studyMode || Boolean(proofread)}
          title="AI soát lỗi chính tả trong phần nội dung (bạn duyệt từng chỗ trước khi sửa)"
        >
          <span className="hidden sm:inline">Soát lỗi</span>
        </Button>
        <NoteStylePicker
          style={style}
          onChange={(next) => {
            setStyle(next)
            markDirty('style', { immediate: true })
          }}
        />
        <MoreMenu onDelete={() => setConfirmDelete(true)} />
      </div>

      {/* Tiêu đề + thư mục + tag */}
      <div className="space-y-3">
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            markDirty('title')
          }}
          maxLength={200}
          placeholder="Tiêu đề ghi chú"
          aria-label="Tiêu đề ghi chú"
          className="w-full bg-transparent text-xl font-semibold tracking-tight text-ink outline-none placeholder:text-muted/60 sm:text-[28px]"
        />
        <div className="flex flex-wrap items-center gap-2">
          <FolderSelect
            value={folderId}
            onChange={(v) => {
              setFolderId(v)
              markDirty('folder', { immediate: true })
            }}
            className="min-w-0 flex-1 sm:w-60 sm:flex-none"
            ariaLabel="Thư mục của ghi chú"
          />
          <TagPicker
            tags={tags}
            onChange={(next) => {
              setTags(next)
              markDirty('tags', { immediate: true })
            }}
          />
        </div>
      </div>

      {/* Tab trên mobile (dưới lg): 3 phần Cornell xếp thành tab; từ lg hiện cùng lúc */}
      <div className="flex rounded-xl border border-line bg-sunken/60 p-1 lg:hidden" role="tablist" aria-label="Phần của ghi chú">
        {MOBILE_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={mobileTab === t.id}
            onClick={() => setMobileTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-medium transition-all ${
              mobileTab === t.id ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'
            }`}
          >
            <t.icon className="size-4" />
            {t.label}
            {t.id === 'cues' && cueCount > 0 && <span className="text-[11px] text-muted tabular-nums">{cueCount}</span>}
          </button>
        ))}
      </div>

      {/* Tờ ghi chú Cornell — chiều cao cố định theo viewport (--fit-h), cuộn bên trong từng vùng */}
      <div
        ref={fitRef}
        className="note-sheet flex h-(--fit-h) flex-col overflow-hidden rounded-2xl border border-[var(--note-line)] bg-[var(--note-bg)] text-[var(--note-fg)] shadow-card"
        style={noteStyleVars(style)}
      >
        <div
          className={`min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] ${
            mobileTab === 'summary' ? 'hidden' : 'flex'
          }`}
        >
          <section
            className={`scroll-area min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain border-[var(--note-line)] lg:border-r ${panel('cues')}`}
            aria-label="Câu hỏi / từ khoá"
          >
            <h2 className="px-4 pt-4 pb-2 text-[11.5px] font-semibold tracking-[0.08em] text-[var(--note-muted)] uppercase">Câu hỏi · Từ khoá</h2>
            <CueColumn
              key={studyMode ? 'study' : 'edit'}
              cues={cues}
              onChange={changeCues}
              activeBlockId={activeBlockId}
              blockIds={blockIds}
              studyMode={studyMode}
              onAnchorRequest={anchorCue}
              onGoTo={goToBlock}
              getAnswer={(id) => blockText(editor, id)}
            />
            <NoteLinksPanel links={links} />
          </section>
          <section className={`relative min-h-0 min-w-0 flex-1 flex-col ${panel('content')}`} aria-label="Nội dung chi tiết">
            <div
              className={`flex min-h-0 flex-1 flex-col ${studyMode ? 'pointer-events-none blur-[6px] select-none' : ''}`}
              aria-hidden={studyMode || undefined}
            >
              <NoteContentEditor
                noteId={noteId}
                initialContent={initialNote.content_json}
                editable={!studyMode}
                onReady={onEditorReady}
                onChange={onContentChange}
                onActiveBlockChange={setActiveBlockId}
              />
            </div>
            {studyMode && (
              <div className="absolute inset-x-0 top-0 flex justify-center p-6">
                <div className="max-w-sm rounded-2xl border border-[var(--note-line)] bg-[var(--note-bg)] p-5 text-center shadow-float">
                  <GraduationCap className="mx-auto size-6 text-[var(--note-accent)]" />
                  <p className="mt-2 text-sm leading-relaxed">
                    Nội dung đang được che. Tự trả lời từng câu hỏi ở cột câu hỏi, rồi bấm <b>Xem đáp án</b> để kiểm tra.
                  </p>
                  <Button size="sm" className="mt-4" onClick={() => setStudyMode(false)}>
                    Thoát ôn tập
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>
        {/* Tóm tắt: từ lg là dải dưới cao tối đa 30% khung (cuộn bên trong); dưới lg là tab riêng chiếm cả khung */}
        <section
          // Tab AI có nhiều mục (ý chính / khái niệm / câu hỏi) nên dải tóm tắt được cao hơn một chút; vẫn cuộn bên
          // trong nên khung ghi chú giữ nguyên chiều cao theo viewport.
          className={`min-h-0 flex-col border-[var(--note-line)] px-5 pt-3 pb-4 sm:px-8 lg:shrink-0 lg:border-t ${
            summaryTab === 'ai' ? 'lg:max-h-[45%]' : 'lg:max-h-[30%]'
          } ${mobileTab === 'summary' ? 'flex flex-1' : 'hidden lg:flex'}`}
          aria-label="Tóm tắt"
        >
          {/* 2 tab: tóm tắt người học tự viết và tóm tắt AI (cột dữ liệu riêng, không ghi đè nhau) */}
          <div className="mb-2 flex shrink-0" role="tablist" aria-label="Kiểu tóm tắt">
            {SUMMARY_TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={summaryTab === t.id}
                onClick={() => setSummaryTab(t.id)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold tracking-[0.06em] uppercase transition-colors ${
                  summaryTab === t.id ? 'bg-[var(--note-soft)] text-[var(--note-fg)]' : 'text-[var(--note-muted)] hover:text-[var(--note-fg)]'
                }`}
              >
                {t.label}
                {t.id === 'ai' && aiSummary && aiOutdated && (
                  <span className="size-1.5 rounded-full bg-warn" title="Nội dung đã đổi sau lần tóm tắt gần nhất" />
                )}
              </button>
            ))}
          </div>
          <div
            className={`scroll-area min-h-0 flex-1 overflow-y-auto overscroll-contain ${
              studyMode ? 'pointer-events-none blur-[5px] select-none' : ''
            }`}
          >
            {summaryTab === 'mine' ? (
              <AutoGrowSummary
                value={summary}
                disabled={studyMode}
                onChange={(v) => {
                  setSummary(v)
                  markDirty('summary')
                }}
              />
            ) : (
              <NoteAiPanel
                summary={aiSummary}
                outdated={aiOutdated}
                loading={aiLoading}
                onGenerate={generateAiSummary}
                onAddQuestion={(q) => addQuestions([q])}
                onAddAllQuestions={addQuestions}
              />
            )}
          </div>
        </section>
      </div>

      <ProofreadDialog
        open={Boolean(proofread)}
        loading={proofread?.loading ?? false}
        result={proofread?.result}
        onApply={applyProofread}
        onClose={() => setProofread(null)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Xoá ghi chú này?"
        description={`“${title || 'Ghi chú không tên'}” sẽ bị xoá vĩnh viễn, không khôi phục được.`}
        confirmLabel="Xoá ghi chú"
        loading={deleting}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
