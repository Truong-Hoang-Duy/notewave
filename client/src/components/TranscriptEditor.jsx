import { Check, Pencil, Save, Trash2, Undo2, X } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatClock, speakerColor, speakerLabel } from '../lib/format'
import { partStartAt } from '../lib/segments'
import PartDivider from './PartDivider'
import { Button } from './ui'

function AutoTextarea({ value, onChange, onSave, onCancel }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [value])
  useEffect(() => {
    const el = ref.current
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
  }, [])
  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          onSave()
        }
      }}
      className="block w-full resize-none rounded-xl border border-brand-500 bg-surface px-3 py-2 text-[16.5px] leading-[1.8] text-ink outline-none ring-4 ring-brand-100 sm:text-[17px]"
      aria-label="Nội dung đoạn transcript"
    />
  )
}

function EditableSegment({ segment, showSpeakerColumn, editing, onStartEdit, onCommit, onCancel, onDelete }) {
  const [draft, setDraft] = useState(segment.text)
  const color = segment.speaker ? speakerColor(segment.speaker) : null

  return (
    <article
      className={`group/seg grid gap-x-6 gap-y-1 rounded-xl px-3 py-2.5 transition-colors md:grid-cols-[7.5rem_minmax(0,1fr)_auto] ${
        editing ? 'bg-brand-50/60' : 'hover:bg-paper'
      }`}
    >
      <div className="flex items-baseline gap-2 md:flex-col md:gap-0.5 md:pt-[3px]">
        {showSpeakerColumn && segment.speaker && (
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color }}>
            <span className="size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
            {speakerLabel(segment.speaker)}
          </span>
        )}
        {segment.start_ms != null && <span className="font-mono text-[11.5px] tracking-tight text-muted tabular-nums">{formatClock(segment.start_ms)}</span>}
      </div>

      {editing ? (
        <div className="md:col-span-2">
          <AutoTextarea value={draft} onChange={setDraft} onSave={() => onCommit(draft)} onCancel={onCancel} />
          <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto hidden text-xs text-muted sm:inline">Ctrl + Enter để xong · Esc để huỷ</span>
            <Button size="sm" variant="ghost" icon={X} onClick={onCancel}>
              Huỷ
            </Button>
            <Button size="sm" variant="primary" icon={Check} onClick={() => onCommit(draft)}>
              Xong
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p
            className="cursor-text text-[16.5px] leading-[1.8] text-pretty break-words text-ink sm:text-[17px]"
            onDoubleClick={onStartEdit}
            title="Nhấp đúp để sửa"
          >
            {segment.text}
          </p>
          <div className="flex justify-end gap-1 md:flex-col md:justify-start md:opacity-0 md:group-hover/seg:opacity-100 md:group-focus-within/seg:opacity-100">
            <button onClick={onStartEdit} className="rounded-lg p-1.5 text-muted transition-colors hover:bg-sunken hover:text-ink" aria-label="Sửa đoạn này" title="Sửa">
              <Pencil className="size-4" />
            </button>
            <button onClick={onDelete} className="rounded-lg p-1.5 text-muted transition-colors hover:bg-rec-soft hover:text-rec" aria-label="Xoá đoạn này" title="Xoá">
              <Trash2 className="size-4" />
            </button>
          </div>
        </>
      )}
    </article>
  )
}

/**
 * Chế độ chỉnh sửa transcript: sửa text từng đoạn, xoá đoạn thừa. Mọi thay đổi nằm trong bản nháp,
 * có hoàn tác (Ctrl+Z) và chỉ ghi vào máy chủ khi bấm "Lưu thay đổi".
 */
export default function TranscriptEditor({ initialSegments, partsById, saving, onSave, onCancel, onDirtyChange }) {
  const [segments, setSegments] = useState(initialSegments)
  const [history, setHistory] = useState([]) // các bản trước đó để hoàn tác
  const [editingIndex, setEditingIndex] = useState(null)
  const dirty = history.length > 0

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  const apply = (next) => {
    setHistory((h) => [...h, segments])
    setSegments(next)
  }

  const undo = () => {
    if (!history.length) return
    setEditingIndex(null)
    setSegments(history[history.length - 1])
    setHistory((h) => h.slice(0, -1))
  }

  useEffect(() => {
    const onKey = (e) => {
      const inField = ['TEXTAREA', 'INPUT'].includes(document.activeElement?.tagName)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !inField) {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (!dirty) return
    const handler = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const commitEdit = (index, text) => {
    setEditingIndex(null)
    const trimmed = text.trim()
    if (trimmed === segments[index].text) return
    if (!trimmed) {
      apply(segments.filter((_, i) => i !== index))
      return
    }
    apply(segments.map((s, i) => (i === index ? { ...s, text: trimmed } : s)))
  }

  const remove = (index) => {
    setEditingIndex(null)
    apply(segments.filter((_, i) => i !== index))
  }

  const removedCount = initialSegments.length - segments.length
  const showSpeakerColumn = segments.some((s) => s.speaker)

  return (
    <div>
      {/* Dưới xl dính dưới header app (trang cuộn); từ xl dính đầu vùng cuộn của khối transcript. */}
      <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] z-10 xl:top-0 -mx-5 mb-4 border-b border-line bg-surface/95 px-5 py-3 backdrop-blur sm:-mx-7 sm:px-7">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto min-w-0 text-[13px] leading-snug">
            <p className="font-semibold text-ink">Đang chỉnh sửa transcript</p>
            <p className="text-muted">
              {dirty
                ? `${history.length} thay đổi chưa lưu${removedCount > 0 ? ` · đã xoá ${removedCount} đoạn` : ''}`
                : 'Di chuột (hoặc chạm) vào đoạn để sửa / xoá. Nhấp đúp để sửa nhanh.'}
            </p>
          </div>
          <Button size="sm" variant="ghost" icon={Undo2} onClick={undo} disabled={!dirty || saving} title="Hoàn tác (Ctrl+Z)">
            Hoàn tác
          </Button>
          <Button size="sm" variant="secondary" onClick={onCancel} disabled={saving}>
            {dirty ? 'Huỷ thay đổi' : 'Đóng'}
          </Button>
          <Button size="sm" variant="primary" icon={Save} onClick={() => onSave(segments)} loading={saving} disabled={!dirty || editingIndex !== null}>
            Lưu thay đổi
          </Button>
        </div>
      </div>

      {segments.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Đã xoá hết các đoạn. Bấm “Hoàn tác” nếu xoá nhầm.</p>
      ) : (
        <div className="-mx-3 space-y-2">
          {segments.map((seg, i) => {
            const part = partStartAt(segments, i, partsById)
            return (
              <Fragment key={`${seg.start_ms ?? 'x'}-${i}-${seg.text.length}`}>
                {part && (
                  <div className="px-3 pt-2">
                    <PartDivider title={part.title} offsetMs={part.offset_ms} />
                  </div>
                )}
                <EditableSegment
                  segment={seg}
                  showSpeakerColumn={showSpeakerColumn}
                  editing={editingIndex === i}
                  onStartEdit={() => setEditingIndex(i)}
                  onCommit={(text) => commitEdit(i, text)}
                  onCancel={() => setEditingIndex(null)}
                  onDelete={() => remove(i)}
                />
              </Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}
