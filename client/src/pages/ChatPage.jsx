import {
  BookOpen,
  Check,
  Clock,
  Copy,
  FileAudio,
  Folder,
  History,
  Layers,
  MessageSquarePlus,
  Mic,
  NotebookPen,
  Paperclip,
  Plus,
  ScanText,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import 'katex/dist/katex.min.css'
import Markdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import Modal from '../components/Modal'
import { useToast } from '../components/Toast'
import { Card, Spinner } from '../components/ui'
import { chatActions, TTL_OPTIONS, useChatStore } from '../hooks/useChatStore'
import { useGroups } from '../hooks/useGroups'
import { useNoteLibrary } from '../hooks/useNoteLibrary'
import { useViewportFit } from '../hooks/useViewportFit'
import { api } from '../lib/api'
import { createLiveRecording } from '../lib/liveStt'

const REHYPE_PLUGINS = [[rehypeKatex, { throwOnError: false, strict: false }]]
const REMARK_PLUGINS = [remarkGfm, remarkMath]

function strip({ node: _node, ...rest }) {
  return rest
}

const MARKDOWN_COMPONENTS = {
  h1: (p) => <h3 className="mt-3.5 mb-1.5 text-base font-semibold text-ink first:mt-0" {...strip(p)} />,
  h2: (p) => <h4 className="mt-3 mb-1.5 text-[15px] font-semibold text-ink first:mt-0" {...strip(p)} />,
  h3: (p) => <h5 className="mt-2.5 mb-1 text-[14.5px] font-semibold text-ink first:mt-0" {...strip(p)} />,
  p: (p) => <p className="my-2 text-[15px] leading-[1.68] text-ink first:mt-0 last:mb-0 sm:text-[14.5px]" {...strip(p)} />,
  ul: (p) => <ul className="my-2 list-disc space-y-1 pl-5 text-[15px] leading-[1.65] text-ink marker:text-brand-600 sm:text-[14.5px]" {...strip(p)} />,
  ol: (p) => <ol className="my-2 list-decimal space-y-1 pl-5 text-[15px] leading-[1.65] text-ink marker:text-muted sm:text-[14.5px]" {...strip(p)} />,
  li: (p) => <li className="pl-0.5 break-words" {...strip(p)} />,
  blockquote: (p) => <blockquote className="my-2.5 border-l-2 border-brand-500 pl-3 text-ink-soft italic" {...strip(p)} />,
  table: (p) => (
    <div className="my-2.5 overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full border-collapse text-left text-[13.5px]" {...strip(p)} />
    </div>
  ),
  th: (p) => <th className="border-b border-line bg-paper px-3 py-2 font-semibold text-ink" {...strip(p)} />,
  td: (p) => <td className="border-t border-line px-3 py-2 align-top text-ink" {...strip(p)} />,
  pre: (p) => <pre className="my-2.5 overflow-x-auto rounded-xl border border-line bg-paper p-3 font-mono text-xs leading-relaxed" {...strip(p)} />,
  code: ({ className, ...p }) => <code className={`rounded bg-sunken px-1 py-0.5 font-mono text-[0.88em] ${className ?? ''}`} {...strip(p)} />,
}

function formatRemainingTtl(expiresAt) {
  if (!expiresAt) return ''
  const diffMs = Math.max(0, expiresAt - Date.now())
  const hours = Math.floor(diffMs / (3600 * 1000))
  const mins = Math.ceil((diffMs % (3600 * 1000)) / (60 * 1000))
  if (hours >= 24) return `${Math.ceil(hours / 24)} ngày`
  if (hours > 0) return `${hours}h${mins > 0 ? ` ${mins}p` : ''}`
  return `${mins} phút`
}

function SourceIcon({ kind }) {
  if (kind === 'live') return <Mic className="size-3.5 shrink-0 text-rec" />
  if (kind === 'upload') return <FileAudio className="size-3.5 shrink-0 text-[#4a44a8]" />
  if (kind === 'ocr') return <ScanText className="size-3.5 shrink-0 text-[#94580a]" />
  return <NotebookPen className="size-3.5 shrink-0 text-brand-600" />
}

export default function ChatPage({ onOpenSession, onOpenNote }) {
  const toast = useToast()
  const { ttlHours, threads, activeThread } = useChatStore()
  const { groups } = useGroups()
  const { folders } = useNoteLibrary()
  const fitRef = useViewportFit({ minHeight: 260, mobile: true })

  const [sessions, setSessions] = useState([])
  const [notes, setNotes] = useState([])
  const [loadingSources, setLoadingSources] = useState(true)
  const [sourceTab, setSourceTab] = useState('sessions') // 'sessions' | 'notes'
  const [searchQuery, setSearchQuery] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [folderFilter, setFolderFilter] = useState('')

  // Hộp thoại bottom-sheet trên điện thoại (iPhone)
  const [sourcesModalOpen, setSourcesModalOpen] = useState(false)
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const [copiedId, setCopiedId] = useState(null)

  const [input, setInput] = useState('')
  const [asking, setAsking] = useState(false)
  const [dictating, setDictating] = useState(false)
  const dictationRef = useRef(null)
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  // Tải danh sách phiên hoàn tất và ghi chú Cornell để đính kèm khi cần
  useEffect(() => {
    let cancelled = false
    setLoadingSources(true)
    Promise.all([
      api.listSessions({ limit: 150, sort: 'created_desc' }).catch(() => ({ items: [] })),
      api.listNotes({ limit: 150, sort: 'updated_desc' }).catch(() => ({ items: [] })),
    ]).then(([sRes, nRes]) => {
      if (cancelled) return
      setSessions((sRes.items || []).filter((s) => s.status === 'completed'))
      setNotes(nRes.items || [])
      setLoadingSources(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Tự cuộn xuống tin nhắn mới nhất
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [activeThread?.messages?.length, asking])

  // Tự co giãn chiều cao ô nhập theo nội dung (tối ưu màn hình iPhone 11)
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`
  }, [input])

  useEffect(
    () => () => {
      dictationRef.current?.cancel()
    },
    [],
  )

  const selectedSessionIds = activeThread?.sessionIds || []
  const selectedNoteIds = activeThread?.noteIds || []
  const totalSelected = selectedSessionIds.length + selectedNoteIds.length

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return sessions.filter((s) => {
      if (groupFilter === 'none' && s.group) return false
      if (groupFilter && groupFilter !== 'none' && s.group?.id !== groupFilter) return false
      if (q && !s.title.toLowerCase().includes(q) && !(s.preview || '').toLowerCase().includes(q)) return false
      return true
    })
  }, [sessions, searchQuery, groupFilter])

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return notes.filter((n) => {
      if (folderFilter === 'none' && n.folder) return false
      if (folderFilter && folderFilter !== 'none' && n.folder?.id !== folderFilter) return false
      if (q && !n.title.toLowerCase().includes(q) && !(n.preview || '').toLowerCase().includes(q)) return false
      return true
    })
  }, [notes, searchQuery, folderFilter])

  const toggleAllVisibleSessions = () => {
    const visibleIds = filteredSessions.map((s) => s.id)
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedSessionIds.includes(id))
    const next = allSelected
      ? selectedSessionIds.filter((id) => !visibleIds.includes(id))
      : [...new Set([...selectedSessionIds, ...visibleIds])]
    chatActions.setSources({ sessionIds: next })
  }

  const toggleAllVisibleNotes = () => {
    const visibleIds = filteredNotes.map((n) => n.id)
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedNoteIds.includes(id))
    const next = allSelected
      ? selectedNoteIds.filter((id) => !visibleIds.includes(id))
      : [...new Set([...selectedNoteIds, ...visibleIds])]
    chatActions.setSources({ noteIds: next })
  }

  const sendQuestion = useCallback(
    async (rawQuestion) => {
      const q = (rawQuestion ?? input).trim()
      if (!q || asking) return

      if (rawQuestion === undefined) setInput('')
      const historyPayload = (activeThread?.messages || []).slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      }))

      chatActions.appendMessage({ role: 'user', content: q })
      setAsking(true)
      try {
        const res = await api.askChat({
          question: q,
          session_ids: selectedSessionIds,
          note_ids: selectedNoteIds,
          history: historyPayload,
        })
        chatActions.appendMessage({
          role: 'assistant',
          content: res.answer_md,
          usedSources: res.used_sources || [],
        })
      } catch (err) {
        toast.error(err.message || 'Không gửi được câu hỏi.')
        chatActions.appendMessage({
          role: 'assistant',
          content: `⚠️ **Chưa trả lời được:** ${err.message || 'Có lỗi xảy ra khi kết nối tới AI.'}`,
        })
      } finally {
        setAsking(false)
      }
    },
    [input, asking, activeThread, selectedSessionIds, selectedNoteIds, toast],
  )

  const toggleVoiceInput = async () => {
    if (dictating) {
      try {
        await dictationRef.current?.stop()
      } catch {
        /* ignore */
      }
      dictationRef.current = null
      setDictating(false)
      return
    }

    setDictating(true)
    const rec = createLiveRecording({
      getConfig: () => api.getTemporaryKey({ diarize: false }),
      maxReconnectAttempts: 2,
      onResult: ({ tokens }) => {
        const finals = tokens.filter((t) => t.is_final && t.text).map((t) => t.text).join('')
        if (finals) {
          setInput((prev) => {
            const prefix = prev && !prev.endsWith(' ') ? prev + ' ' : prev
            return (prefix + finals.trim()).trimStart()
          })
        }
      },
      onError: (err) => {
        toast.error(err.message || 'Không thu được giọng nói.')
        dictationRef.current = null
        setDictating(false)
      },
    })
    dictationRef.current = rec
  }

  const copyMessage = async (msg) => {
    try {
      await navigator.clipboard.writeText(msg.content)
      setCopiedId(msg.id)
      setTimeout(() => setCopiedId((prev) => (prev === msg.id ? null : prev)), 1800)
    } catch {
      toast.error('Không sao chép được văn bản.')
    }
  }

  const selectedChips = useMemo(() => {
    const sMap = new Map(sessions.map((s) => [s.id, s]))
    const nMap = new Map(notes.map((n) => [n.id, n]))
    const chips = []
    for (const id of selectedSessionIds) {
      const s = sMap.get(id)
      if (s) chips.push({ type: 'session', id: s.id, title: s.title, kind: s.source })
    }
    for (const id of selectedNoteIds) {
      const n = nMap.get(id)
      if (n) chips.push({ type: 'note', id: n.id, title: n.title, kind: 'note' })
    }
    return chips
  }, [sessions, notes, selectedSessionIds, selectedNoteIds])

  /** Nội dung bộ chọn tài liệu dùng chung cho cả cột trái desktop lẫn bottom-sheet trên iPhone */
  const renderSourcePicker = () => (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Chuyển kho: Phiên ghi âm/OCR vs Ghi chú Cornell */}
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-paper/60 p-1">
        <button
          type="button"
          onClick={() => setSourceTab('sessions')}
          className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition ${
            sourceTab === 'sessions' ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'
          }`}
        >
          <Layers className="size-3.5" />
          Bài giảng · OCR ({selectedSessionIds.length}/{sessions.length})
        </button>
        <button
          type="button"
          onClick={() => setSourceTab('notes')}
          className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition ${
            sourceTab === 'notes' ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'
          }`}
        >
          <NotebookPen className="size-3.5" />
          Ghi chú ({selectedNoteIds.length}/{notes.length})
        </button>
      </div>

      {/* Tìm kiếm & lọc theo Nhóm / Thư mục — cỡ chữ 16px (text-base) trên iPhone để Safari không tự zoom */}
      <div className="mt-2.5 space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm tên bài giảng, tài liệu, ghi chú…"
            className="h-10 w-full rounded-xl border border-line bg-paper pr-3 pl-9 text-base text-ink placeholder:text-muted focus:border-brand-500 focus:bg-surface focus:outline-none sm:h-9 sm:text-xs"
          />
        </div>

        <div className="flex items-center gap-2">
          {sourceTab === 'sessions' ? (
            <>
              <select
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                aria-label="Lọc theo nhóm tài liệu"
                className="h-9 min-w-0 flex-1 rounded-xl border border-line bg-paper px-2.5 text-sm text-ink focus:border-brand-500 focus:outline-none sm:h-8 sm:text-xs"
              >
                <option value="">Tất cả nhóm</option>
                <option value="none">Chưa phân nhóm</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    📁 {g.name} ({g.session_count})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={toggleAllVisibleSessions}
                disabled={filteredSessions.length === 0}
                className="shrink-0 cursor-pointer rounded-xl border border-line bg-surface px-3 py-2 text-xs font-medium text-ink-soft hover:bg-sunken disabled:opacity-40 sm:py-1.5"
              >
                Chọn hết
              </button>
            </>
          ) : (
            <>
              <select
                value={folderFilter}
                onChange={(e) => setFolderFilter(e.target.value)}
                aria-label="Lọc theo thư mục ghi chú"
                className="h-9 min-w-0 flex-1 rounded-xl border border-line bg-paper px-2.5 text-sm text-ink focus:border-brand-500 focus:outline-none sm:h-8 sm:text-xs"
              >
                <option value="">Tất cả thư mục</option>
                <option value="none">Ngoài thư mục</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    📂 {f.name} ({f.note_count})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={toggleAllVisibleNotes}
                disabled={filteredNotes.length === 0}
                className="shrink-0 cursor-pointer rounded-xl border border-line bg-surface px-3 py-2 text-xs font-medium text-ink-soft hover:bg-sunken disabled:opacity-40 sm:py-1.5"
              >
                Chọn hết
              </button>
            </>
          )}
        </div>
      </div>

      {/* Danh sách tài liệu */}
      <div className="no-scrollbar mt-2.5 min-h-0 flex-1 divide-y divide-line/60 overflow-y-auto rounded-xl border border-line bg-surface">
        {loadingSources ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted">
            <Spinner className="size-4" /> Đang tải danh sách tài liệu…
          </div>
        ) : sourceTab === 'sessions' ? (
          filteredSessions.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-muted">Không có phiên tài liệu nào khớp bộ lọc.</p>
          ) : (
            filteredSessions.map((s) => {
              const checked = selectedSessionIds.includes(s.id)
              return (
                <label
                  key={s.id}
                  className={`flex cursor-pointer items-start gap-3 px-3.5 py-3 text-sm transition-colors sm:py-2.5 sm:text-xs ${
                    checked ? 'bg-brand-50/75' : 'hover:bg-paper/70'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => chatActions.toggleSession(s.id)}
                    className="mt-0.5 size-4.5 shrink-0 rounded border-line text-brand-600 focus:ring-brand-500 sm:size-4"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 font-medium text-ink">
                      <SourceIcon kind={s.source} />
                      <span className="truncate">{s.title}</span>
                    </div>
                    {s.group?.name && (
                      <span className="mt-0.5 inline-block rounded bg-sunken px-1.5 py-0.5 text-[11px] text-muted">
                        {s.group.name}
                      </span>
                    )}
                  </div>
                </label>
              )
            })
          )
        ) : filteredNotes.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted">Không có ghi chú Cornell nào khớp bộ lọc.</p>
        ) : (
          filteredNotes.map((n) => {
            const checked = selectedNoteIds.includes(n.id)
            return (
              <label
                key={n.id}
                className={`flex cursor-pointer items-start gap-3 px-3.5 py-3 text-sm transition-colors sm:py-2.5 sm:text-xs ${
                  checked ? 'bg-brand-50/75' : 'hover:bg-paper/70'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => chatActions.toggleNote(n.id)}
                  className="mt-0.5 size-4.5 shrink-0 rounded border-line text-brand-600 focus:ring-brand-500 sm:size-4"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-medium text-ink">
                    <SourceIcon kind="note" />
                    <span className="truncate">{n.title}</span>
                  </div>
                  {n.folder?.name && (
                    <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-sunken px-1.5 py-0.5 text-[11px] text-muted">
                      <Folder className="size-2.5" /> {n.folder.name}
                    </span>
                  )}
                </div>
              </label>
            )
          })
        )}
      </div>
    </div>
  )

  return (
    <div ref={fitRef} className="mx-auto flex h-(--fit-h) max-w-[96rem] flex-col lg:grid lg:grid-cols-[21rem_minmax(0,1fr)] lg:gap-6 xl:grid-cols-[23rem_minmax(0,1fr)]">
      {/* ---- CỘT TRÁI (CHỈ HIỆN TRÊN DESKTOP lg+): ĐÍNH KÈM TÀI LIỆU & LỊCH SỬ TẠM ---- */}
      <aside className="hidden min-h-0 flex-col gap-4 lg:flex">
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-3.5">
          <div className="mb-2.5 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink">Đính kèm tài liệu (tuỳ chọn)</h2>
              <p className="text-[11.5px] text-muted">
                {totalSelected > 0 ? (
                  <>
                    Đang ghim <span className="font-semibold text-brand-700 tabular-nums">{totalSelected}</span> tài liệu
                  </>
                ) : (
                  'Không chọn thì AI tự tìm trong kho của bạn'
                )}
              </p>
            </div>
            {totalSelected > 0 && (
              <button
                type="button"
                onClick={() => chatActions.setSources({ sessionIds: [], noteIds: [] })}
                className="cursor-pointer rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-sunken hover:text-ink"
              >
                Bỏ chọn
              </button>
            )}
          </div>
          {renderSourcePicker()}
        </Card>

        {/* Lịch sử chat tạm trên máy (localStorage + TTL) */}
        <Card className="flex max-h-60 shrink-0 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
              <Clock className="size-3.5 text-brand-600" />
              <span>Lịch sử tạm</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-muted">Tự xoá:</span>
              <select
                value={ttlHours}
                onChange={(e) => chatActions.setTtlHours(Number(e.target.value))}
                aria-label="Thời gian tự xoá lịch sử chat"
                className="rounded-md border border-line bg-paper px-1.5 py-0.5 text-[11px] font-medium text-ink focus:outline-none"
              >
                {TTL_OPTIONS.map((o) => (
                  <option key={o.hours} value={o.hours}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="no-scrollbar min-h-0 flex-1 divide-y divide-line/60 overflow-y-auto">
            {threads.map((t) => {
              const isCurrent = t.id === activeThread?.id
              return (
                <div
                  key={t.id}
                  className={`flex items-center justify-between gap-2 px-3.5 py-2 text-xs transition ${
                    isCurrent ? 'bg-brand-50/80 font-medium text-brand-700' : 'text-ink-soft hover:bg-paper/70'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => chatActions.selectThread(t.id)}
                    className="min-w-0 flex-1 cursor-pointer text-left"
                  >
                    <p className="truncate">{t.title}</p>
                    <p className="text-[10.5px] text-muted">
                      {t.messages.length} tin · còn {formatRemainingTtl(t.expiresAt)}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => chatActions.deleteThread(t.id)}
                    className="cursor-pointer rounded p-1 text-muted hover:bg-sunken hover:text-rec"
                    aria-label="Xoá cuộc trò chuyện"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between border-t border-line bg-paper/50 px-3 py-2">
            <button
              type="button"
              onClick={() => chatActions.createThread()}
              className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline"
            >
              <MessageSquarePlus className="size-3.5" /> Cuộc trò chuyện mới
            </button>
            <button
              type="button"
              onClick={() => chatActions.clearAll()}
              className="cursor-pointer text-[11px] text-muted hover:text-rec"
            >
              Xoá hết
            </button>
          </div>
        </Card>
      </aside>

      {/* ---- KHUNG CHAT AI AGENT CHÍNH (VỪA KHÍT MÀN HÌNH IPHONE 11) ---- */}
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        {/* Thanh đầu khung chat gọn gàng cho điện thoại */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-paper/60 px-3 py-2.5 sm:px-5 sm:py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-600 text-white shadow-card">
              <Sparkles className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="truncate text-sm font-semibold text-ink sm:text-base">Trợ lý AI NoteWave</h1>
              </div>
              <p className="truncate text-[11.5px] text-muted">
                {activeThread?.messages?.length > 0
                  ? activeThread.title
                  : 'Hỏi tự do hoặc nhờ AI tự tra cứu bài giảng & ghi chú'}
              </p>
            </div>
          </div>

          {/* Cụm nút thao tác nhanh (40px+ dễ bấm bằng ngón cái trên iPhone) */}
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSourcesModalOpen(true)}
              className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition lg:hidden ${
                totalSelected > 0
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-line bg-surface text-ink-soft hover:bg-sunken'
              }`}
              aria-label="Đính kèm tài liệu"
            >
              <Paperclip className="size-3.5" />
              <span>{totalSelected > 0 ? `${totalSelected} tài liệu` : 'Tài liệu'}</span>
            </button>

            <button
              type="button"
              onClick={() => setHistoryModalOpen(true)}
              className="grid size-9 cursor-pointer place-items-center rounded-xl border border-line bg-surface text-ink-soft transition hover:bg-sunken hover:text-ink lg:hidden"
              title="Lịch sử cuộc trò chuyện"
              aria-label="Lịch sử cuộc trò chuyện"
            >
              <History className="size-4" />
            </button>

            <button
              type="button"
              onClick={() => chatActions.createThread()}
              className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-xl border border-line bg-surface px-2.5 text-xs font-medium text-ink-soft transition hover:border-brand-500 hover:text-brand-700"
              title="Cuộc trò chuyện mới"
              aria-label="Cuộc trò chuyện mới"
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">Mới</span>
            </button>
          </div>
        </div>

        {/* Khu vực danh sách tin nhắn (cuộn độc lập, overscroll-contain mượt trên iOS) */}
        <div className="no-scrollbar min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-3 py-3.5 sm:space-y-4 sm:px-5 sm:py-5">
          {(!activeThread?.messages || activeThread.messages.length === 0) && (
            <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
              <div className="grid size-11 place-items-center rounded-2xl bg-brand-50 text-brand-700">
                <Sparkles className="size-5" />
              </div>
              <h2 className="mt-3 text-base font-semibold text-ink sm:text-lg">
                Hỏi bất cứ câu hỏi nào trên lớp
              </h2>
              <p className="mt-1 px-2 text-xs text-muted sm:text-[13px]">
                Hỏi tự do hoặc nhờ AI tự tra cứu bài giảng, tài liệu & ghi chú của bạn.
              </p>
            </div>
          )}

          {activeThread?.messages?.map((msg) => {
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[88%] rounded-2xl rounded-br-sm bg-brand-600 px-3.5 py-2.5 text-[15px] leading-relaxed text-white shadow-card sm:max-w-2xl sm:px-4 sm:text-[14.5px]">
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  </div>
                </div>
              )
            }

            // Hỗ trợ cả định dạng mới (usedSources) và định dạng cũ trong localStorage (citations)
            const sources = msg.usedSources?.length ? msg.usedSources : msg.citations || []

            return (
              <div key={msg.id} className="flex justify-start">
                <div className="w-full max-w-3xl space-y-2.5 rounded-2xl rounded-bl-sm border border-line bg-paper/55 px-3.5 py-3 sm:p-4">
                  <div className="prose-chat">
                    <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={MARKDOWN_COMPONENTS}>
                      {msg.content}
                    </Markdown>
                  </div>

                  {/* Nguồn bài giảng / ghi chú mà AI Agent đã tự tra cứu hoặc được đính kèm */}
                  {sources.length > 0 && (
                    <div className="border-t border-line/80 pt-2.5">
                      <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">
                        Tài liệu đã tham khảo:
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {sources.map((c, idx) => (
                          <button
                            key={`${c.id}-${idx}`}
                            type="button"
                            onClick={() => (c.source_type === 'note' ? onOpenNote?.(c.id) : onOpenSession?.(c.id))}
                            className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-brand-700 transition hover:border-brand-500 hover:bg-brand-50"
                          >
                            <BookOpen className="size-3 shrink-0" />
                            <span className="truncate">{c.title}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Thanh công cụ dưới mỗi câu trả lời: Sao chép nhanh 1 chạm */}
                  <div className="flex items-center justify-end pt-0.5">
                    <button
                      type="button"
                      onClick={() => copyMessage(msg)}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted transition hover:bg-sunken hover:text-ink"
                    >
                      {copiedId === msg.id ? (
                        <>
                          <Check className="size-3.5 text-brand-600" />
                          <span className="text-brand-700">Đã chép</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" />
                          <span>Sao chép</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}

          {asking && (
            <div className="flex items-center gap-2.5 px-1 py-1 text-sm text-muted">
              <Spinner className="size-4 text-brand-600" />
              <span>AI đang suy nghĩ và tra cứu thông tin…</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Thanh nhập câu hỏi cố định ở đáy khung chat — chuẩn iOS Safari (font 16px không bị zoom) */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            sendQuestion()
          }}
          className="shrink-0 border-t border-line bg-paper/80 p-2.5 sm:p-3.5"
        >
          {/* Chip tài liệu đang đính kèm (cuộn ngang gọn trên iPhone) */}
          {selectedChips.length > 0 && (
            <div className="no-scrollbar mb-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {selectedChips.map((c) => (
                <span
                  key={`${c.type}:${c.id}`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink-soft"
                >
                  <SourceIcon kind={c.kind} />
                  <span className="max-w-36 truncate">{c.title}</span>
                  <button
                    type="button"
                    onClick={() => (c.type === 'session' ? chatActions.toggleSession(c.id) : chatActions.toggleNote(c.id))}
                    className="cursor-pointer rounded p-0.5 text-muted hover:text-ink"
                    aria-label={`Bỏ đính kèm ${c.title}`}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {dictating && (
            <div className="mb-2 flex items-center gap-2 rounded-xl bg-rec-soft px-3 py-1.5 text-xs font-medium text-rec">
              <span className="size-2 shrink-0 animate-rec-pulse rounded-full bg-rec" />
              <span className="truncate">Đang nghe tiếng Việt… hãy nói câu hỏi</span>
            </div>
          )}

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={toggleVoiceInput}
              title={dictating ? 'Dừng thu giọng nói' : 'Nói câu hỏi bằng tiếng Việt'}
              aria-label={dictating ? 'Dừng thu giọng nói' : 'Nhập câu hỏi bằng giọng nói'}
              className={`grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl border transition ${
                dictating
                  ? 'border-rec bg-rec text-white shadow-card'
                  : 'border-line bg-surface text-ink-soft hover:border-brand-500 hover:text-brand-700'
              }`}
            >
              {dictating ? <Square className="size-4" /> : <Mic className="size-5" />}
            </button>

            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendQuestion()
                }
              }}
              placeholder="Nhắn tin cho AI hoặc hỏi bài giảng…"
              className="max-h-28 min-h-11 flex-1 resize-none rounded-xl border border-line bg-surface px-3.5 py-2.5 text-base leading-snug text-ink placeholder:text-muted focus:border-brand-500 focus:outline-none sm:text-sm"
            />

            <button
              type="submit"
              disabled={asking || !input.trim()}
              aria-label="Gửi tin nhắn"
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl bg-brand-600 text-white shadow-card transition hover:bg-brand-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {asking ? <Spinner className="size-4 text-white" /> : <Send className="size-4.5" />}
            </button>
          </div>
        </form>
      </section>

      {/* ---- BOTTOM SHEET CHỌN TÀI LIỆU ĐÍNH KÈM TRÊN ĐIỆN THOẠI ---- */}
      <Modal
        open={sourcesModalOpen}
        onClose={() => setSourcesModalOpen(false)}
        title="Đính kèm bài giảng & ghi chú"
        description="Tuỳ chọn: Ghim tài liệu cụ thể vào cuộc trò chuyện. Nếu không chọn, AI vẫn tự tìm trong kho của bạn khi cần."
        flexBody
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            {totalSelected > 0 ? (
              <button
                type="button"
                onClick={() => chatActions.setSources({ sessionIds: [], noteIds: [] })}
                className="cursor-pointer rounded-xl px-3 py-2 text-xs font-medium text-muted hover:bg-sunken hover:text-ink"
              >
                Bỏ chọn tất cả ({totalSelected})
              </button>
            ) : (
              <span className="text-xs text-muted">Chưa ghim tài liệu nào</span>
            )}
            <button
              type="button"
              onClick={() => setSourcesModalOpen(false)}
              className="cursor-pointer rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-card"
            >
              Xong
            </button>
          </div>
        }
      >
        {renderSourcePicker()}
      </Modal>

      {/* ---- BOTTOM SHEET LỊCH SỬ TRÒ CHUYỆN TẠM TRÊN ĐIỆN THOẠI ---- */}
      <Modal
        open={historyModalOpen}
        onClose={() => setHistoryModalOpen(false)}
        title="Lịch sử trò chuyện trên máy"
        description="Lưu tạm trên trình duyệt điện thoại của bạn và tự động xoá khi hết hạn."
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                chatActions.clearAll()
                setHistoryModalOpen(false)
              }}
              className="cursor-pointer rounded-xl px-3 py-2 text-xs font-medium text-rec hover:bg-rec-soft"
            >
              Xoá tất cả lịch sử
            </button>
            <button
              type="button"
              onClick={() => {
                chatActions.createThread()
                setHistoryModalOpen(false)
              }}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-card"
            >
              <MessageSquarePlus className="size-4" /> Cuộc trò chuyện mới
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl border border-line bg-paper px-3.5 py-2.5">
            <span className="text-xs font-medium text-ink">Tự động xoá sau:</span>
            <div className="flex gap-1">
              {TTL_OPTIONS.map((o) => (
                <button
                  key={o.hours}
                  type="button"
                  onClick={() => chatActions.setTtlHours(o.hours)}
                  className={`cursor-pointer rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    ttlHours === o.hours ? 'bg-brand-600 text-white' : 'bg-surface text-ink-soft'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-line rounded-xl border border-line bg-surface">
            {threads.map((t) => {
              const isCurrent = t.id === activeThread?.id
              return (
                <div
                  key={t.id}
                  className={`flex items-center justify-between gap-2 px-3.5 py-3 text-sm ${
                    isCurrent ? 'bg-brand-50/80 font-medium text-brand-700' : 'text-ink'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      chatActions.selectThread(t.id)
                      setHistoryModalOpen(false)
                    }}
                    className="min-w-0 flex-1 cursor-pointer text-left"
                  >
                    <p className="truncate">{t.title}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {t.messages.length} tin nhắn · tự xoá sau {formatRemainingTtl(t.expiresAt)}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => chatActions.deleteThread(t.id)}
                    className="cursor-pointer rounded-lg p-2 text-muted hover:bg-sunken hover:text-rec"
                    aria-label="Xoá cuộc trò chuyện"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </Modal>
    </div>
  )
}
