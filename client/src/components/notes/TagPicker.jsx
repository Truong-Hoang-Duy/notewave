import { Hash, Plus, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { noteLibraryActions, useNoteLibrary } from '../../hooks/useNoteLibrary'
import { useToast } from '../Toast'
import { useDismiss } from './useDismiss'

/** Tag của ghi chú: chip có nút gỡ + ô thêm tag (gợi ý tag sẵn có, Enter để tạo tag mới). */
export default function TagPicker({ tags, onChange }) {
  const toast = useToast()
  const { tags: allTags } = useNoteLibrary()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  useDismiss(ref, open, () => {
    setOpen(false)
    setQuery('')
  })

  const selectedIds = new Set(tags.map((t) => t.id))
  const q = query.trim().replace(/^#/, '').toLowerCase()
  const suggestions = useMemo(
    () => allTags.filter((t) => !tags.some((s) => s.id === t.id) && (!q || t.name.toLowerCase().includes(q))).slice(0, 8),
    [allTags, tags, q],
  )
  const exact = allTags.find((t) => t.name.toLowerCase() === q)

  const add = (tag) => {
    if (!selectedIds.has(tag.id)) onChange([...tags, { id: tag.id, name: tag.name }])
    setQuery('')
  }

  const submit = async () => {
    if (!q) return
    if (exact) return add(exact)
    setBusy(true)
    try {
      add(await noteLibraryActions.createTag(query))
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span key={tag.id} className="inline-flex h-7 items-center gap-1 rounded-full bg-brand-50 pr-1 pl-2.5 text-[12.5px] font-medium text-brand-700">
          <Hash className="size-3" />
          {tag.name}
          <button
            type="button"
            onClick={() => onChange(tags.filter((t) => t.id !== tag.id))}
            className="grid size-5 place-items-center rounded-full text-brand-600 hover:bg-brand-100"
            aria-label={`Gỡ tag ${tag.name}`}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 text-[12.5px] font-medium text-muted hover:border-brand-500 hover:text-brand-700"
        >
          <Plus className="size-3.5" /> Tag
        </button>
        {open && (
          <div className="absolute top-full left-0 z-40 mt-2 w-64 animate-slide-up rounded-xl border border-line bg-surface p-2 shadow-float">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                }
              }}
              maxLength={50}
              disabled={busy}
              placeholder="Tìm hoặc tạo tag…"
              aria-label="Tên tag"
              className="h-9 w-full rounded-lg border border-line bg-paper/60 px-3 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
            />
            <div className="mt-1.5 max-h-56 overflow-y-auto">
              {suggestions.map((t) => (
                <button key={t.id} type="button" onClick={() => add(t)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-paper">
                  <Hash className="size-3.5 shrink-0 text-brand-600" />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  <span className="text-[11px] text-muted tabular-nums">{t.note_count}</span>
                </button>
              ))}
              {q && !exact && (
                <button type="button" onClick={submit} disabled={busy} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-brand-700 hover:bg-brand-50">
                  <Plus className="size-3.5 shrink-0" />
                  <span className="truncate">Tạo tag “{query.trim().replace(/^#/, '')}”</span>
                </button>
              )}
              {!q && suggestions.length === 0 && <p className="px-2.5 py-2 text-[13px] text-muted">Gõ tên để tạo tag đầu tiên.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
