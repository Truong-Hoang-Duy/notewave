import { CornerDownLeft, FileText, FolderClosed, Loader2, Plus } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { dismissNoteLinkSuggestion, insertNoteLink } from '../../lib/noteLink'
import { useDismiss } from './useDismiss'

const MAX_ITEMS = 8
const WIDTH = 288 // px — khớp w-72

/**
 * Danh sách chọn ghi chú khi gõ `[[` (xem `lib/noteLink.js`).
 * - Gõ tiếp để lọc (tìm trong tiêu đề + nội dung qua `?q=`); ↑ ↓ chọn, Enter/Tab chèn, Esc đóng.
 * - Không có kết quả (hoặc muốn tách ý mới) -> "Tạo ghi chú mới" rồi chèn liên kết ngay.
 */
export default function NoteLinkMenu({ editor, state, currentNoteId, registerKeys, onCreated, onError }) {
  // `found.query` = phần đang gõ mà `found.items` ứng với -> khác query hiện tại nghĩa là đang chờ kết quả.
  const [found, setFound] = useState({ query: null, items: [] })
  const [active, setActive] = useState(0)
  const [creating, setCreating] = useState(false)
  const [pos, setPos] = useState(() => ({ left: 0, top: 0 }))
  const ref = useRef(null)
  const query = state.query.trim()

  useDismiss(ref, true, () => dismissNoteLinkSuggestion(editor, state.from))

  // Vị trí: bám theo `[[` trong editor, tính lại khi cuộn / đổi kích thước (popup dùng position: fixed).
  useLayoutEffect(() => {
    const update = () => {
      let coords
      try {
        coords = editor.view.coordsAtPos(state.from)
      } catch {
        return // vị trí không còn hợp lệ (nội dung vừa đổi) — giữ nguyên chỗ cũ
      }
      const left = Math.max(8, Math.min(coords.left, window.innerWidth - WIDTH - 8))
      const below = window.innerHeight - coords.bottom
      setPos({ left, top: below > 240 ? coords.bottom + 6 : undefined, bottom: below > 240 ? undefined : window.innerHeight - coords.top + 6 })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [editor, state.from])

  // Tìm ghi chú theo phần đang gõ (chờ 180ms cho đỡ gọi liên tục).
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api
        .listNotes({ q: query || undefined, sort: 'updated_desc', limit: 20, signal: controller.signal })
        .then((res) => {
          setFound({ query, items: res.items.filter((n) => n.id !== currentNoteId).slice(0, MAX_ITEMS) })
          setActive(0)
        })
        .catch((err) => {
          if (err?.name !== 'AbortError') setFound({ query, items: [] })
        })
    }, 180)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, currentNoteId])

  const loading = found.query !== query
  const options = useMemo(() => [...found.items, ...(query ? [{ create: true }] : [])], [found.items, query])

  const choose = async (index) => {
    const option = options[index]
    if (!option || creating) return
    if (!option.create) return insertNoteLink(editor, state, option)
    setCreating(true)
    try {
      const created = await api.createNote({ title: query })
      insertNoteLink(editor, state, created)
      onCreated?.(created)
    } catch (err) {
      onError?.(err.message)
      dismissNoteLinkSuggestion(editor, state.from)
    } finally {
      setCreating(false)
    }
  }

  // Phím mũi tên / Enter do plugin trong editor chuyển sang (con trỏ vẫn nằm trong nội dung). Đăng ký lại mỗi lần
  // render để handler luôn thấy `options` / `active` mới nhất.
  useEffect(() =>
    registerKeys((event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const delta = event.key === 'ArrowDown' ? 1 : -1
        setActive((i) => (options.length ? (i + delta + options.length) % options.length : 0))
        return true
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && options.length) {
        choose(active)
        return true
      }
      return false
    }),
  )

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label="Chọn ghi chú để liên kết"
      className="fixed z-50 w-72 animate-slide-up overflow-hidden rounded-xl border border-line bg-surface shadow-float"
      style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px] text-muted">
        <span className="font-medium text-ink-soft">Liên kết ghi chú</span>
        <span className="ml-auto inline-flex items-center gap-1">
          <CornerDownLeft className="size-3" /> chọn · Esc đóng
        </span>
      </div>
      <div className="max-h-64 overflow-y-auto py-1">
        {loading && !options.length && (
          <p className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-muted">
            <Loader2 className="size-3.5 animate-spin" /> Đang tìm…
          </p>
        )}
        {!loading && !options.length && <p className="px-3 py-2.5 text-[13px] text-muted">Chưa có ghi chú nào — gõ tên để tạo mới.</p>}
        {options.map((option, index) => (
          <button
            key={option.create ? 'create' : option.id}
            type="button"
            role="option"
            aria-selected={index === active}
            onMouseEnter={() => setActive(index)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(index)}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${index === active ? 'bg-sunken' : ''}`}
          >
            {option.create ? (
              <>
                {creating ? <Loader2 className="size-4 shrink-0 animate-spin text-brand-600" /> : <Plus className="size-4 shrink-0 text-brand-600" />}
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
                  Tạo ghi chú mới “<b className="font-medium">{query}</b>”
                </span>
              </>
            ) : (
              <>
                <FileText className="size-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-ink">{option.title}</span>
                  {option.folder && (
                    <span className="flex items-center gap-1 truncate text-[11.5px] text-muted">
                      <FolderClosed className="size-3" />
                      {option.folder.name}
                    </span>
                  )}
                </span>
              </>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
