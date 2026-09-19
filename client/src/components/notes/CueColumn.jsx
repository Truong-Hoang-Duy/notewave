import { Eye, EyeOff, Link2, Link2Off, MapPin, MoreVertical, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { newCueId } from '../../lib/noteEditor'
import { useAutoGrow } from './useAutoGrow'
import { useDismiss } from './useDismiss'

function AutoGrowTextarea({ value, onChange, onKeyDown, inputRef, ...props }) {
  const ref = useRef(null)
  useAutoGrow(ref, value)
  const setRef = (el) => {
    ref.current = el
    inputRef?.(el)
  }
  return <textarea ref={setRef} rows={1} value={value} onChange={onChange} onKeyDown={onKeyDown} {...props} />
}

function CueMenu({ cue, anchorState, canAnchor, onAnchor, onUnanchor, onGoTo, onDelete }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useDismiss(ref, open, () => setOpen(false))
  const item = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-[var(--note-soft)] disabled:opacity-40'
  const act = (fn) => () => {
    setOpen(false)
    fn()
  }
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Tuỳ chọn câu hỏi"
        className="grid size-8 place-items-center rounded-lg text-[var(--note-muted)] opacity-70 hover:bg-[var(--note-soft)] hover:text-[var(--note-fg)] hover:opacity-100"
      >
        <MoreVertical className="size-4" />
      </button>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-20 mt-1 w-60 animate-fade-in rounded-xl border border-[var(--note-line)] bg-[var(--note-bg)] p-1.5 text-[var(--note-fg)] shadow-float">
          {anchorState === 'ok' && (
            <button role="menuitem" className={item} onClick={act(() => onGoTo(cue.anchor))}>
              <MapPin className="size-4 shrink-0" /> Đi tới đoạn được neo
            </button>
          )}
          <button role="menuitem" className={item} disabled={!canAnchor} onClick={act(() => onAnchor(cue.id))}>
            <Link2 className="size-4 shrink-0" />
            {cue.anchor ? 'Neo lại vào đoạn đang chọn' : 'Neo vào đoạn đang chọn'}
          </button>
          {cue.anchor && (
            <button role="menuitem" className={item} onClick={act(() => onUnanchor(cue.id))}>
              <Link2Off className="size-4 shrink-0" /> Bỏ neo
            </button>
          )}
          {!canAnchor && <p className="px-2.5 pt-1 pb-1.5 text-[12px] leading-snug text-[var(--note-muted)]">Đặt con trỏ vào một đoạn ở phần nội dung trước để neo.</p>}
          <div className="my-1 border-t border-[var(--note-line)]" />
          <button role="menuitem" className={`${item} text-rec`} onClick={act(() => onDelete(cue.id))}>
            <Trash2 className="size-4 shrink-0" /> Xoá câu hỏi
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Cột trái Cornell: danh sách câu hỏi / từ khoá. Mỗi câu có thể neo vào một khối của nội dung (id khối), bấm
 * dấu neo để cuộn tới đoạn đó. Chế độ ôn tập: chỉ đọc, mỗi câu có nút "Xem đáp án" hiện nội dung đoạn được neo.
 * Component cha đổi `key` khi bật/tắt ôn tập -> các đáp án đã mở được reset.
 */
export default function CueColumn({ cues, onChange, activeBlockId, blockIds, studyMode, onAnchorRequest, onGoTo, getAnswer }) {
  const inputs = useRef(new Map())
  const focusNext = useRef(null)
  const [revealed, setRevealed] = useState(() => new Set())

  useEffect(() => {
    if (!focusNext.current) return
    const { id, atEnd } = focusNext.current
    focusNext.current = null
    const el = inputs.current.get(id)
    if (el) {
      el.focus()
      if (atEnd) el.setSelectionRange(el.value.length, el.value.length)
    }
  })

  const inputRefFor = (id) => (el) => {
    if (el) inputs.current.set(id, el)
    else inputs.current.delete(id)
  }

  const update = (id, patch) => onChange(cues.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const insertAfter = (index) => {
    const cue = { id: newCueId(), text: '', anchor: null }
    onChange([...cues.slice(0, index + 1), cue, ...cues.slice(index + 1)])
    focusNext.current = { id: cue.id }
  }
  const remove = (id) => {
    const index = cues.findIndex((c) => c.id === id)
    onChange(cues.filter((c) => c.id !== id))
    const prev = cues[index - 1] ?? cues[index + 1]
    if (prev) focusNext.current = { id: prev.id, atEnd: true }
  }

  const anchorState = (cue) => (!cue.anchor ? 'none' : blockIds.has(cue.anchor) ? 'ok' : 'lost')

  const onKeyDown = (e, cue, index) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      insertAfter(index)
    } else if (e.key === 'Backspace' && cue.text === '' && cues.length > 1) {
      e.preventDefault()
      remove(cue.id)
    }
  }

  const toggleReveal = (id) =>
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const visible = studyMode ? cues.filter((c) => c.text.trim()) : cues

  return (
    <div className="flex flex-col">
      {visible.length === 0 && (
        <p className="px-4 py-6 text-[0.875em] leading-relaxed text-[var(--note-muted)]">
          {studyMode
            ? 'Chưa có câu hỏi nào để ôn tập. Tắt chế độ ôn tập và thêm câu hỏi ở cột này.'
            : 'Ghi từ khoá hoặc câu hỏi gợi nhớ cho từng ý của bài. Neo mỗi câu vào đoạn tương ứng để ôn tập nhanh.'}
        </p>
      )}
      <ol className="flex flex-col">
        {visible.map((cue, index) => {
          const state = anchorState(cue)
          const active = state === 'ok' && cue.anchor === activeBlockId
          const answer = studyMode && revealed.has(cue.id) ? (state === 'ok' ? getAnswer(cue.anchor) : null) : null
          return (
            <li
              key={cue.id}
              className={`group relative border-b border-dashed border-[var(--note-line)] py-1.5 pr-1 pl-3 transition-colors ${active ? 'bg-[var(--note-soft)]' : ''}`}
            >
              <div className="flex items-start gap-1">
                <button
                  type="button"
                  onClick={() => (state === 'ok' ? onGoTo(cue.anchor) : !studyMode && onAnchorRequest(cue.id))}
                  title={
                    state === 'ok'
                      ? 'Đi tới đoạn được neo'
                      : state === 'lost'
                        ? 'Đoạn được neo đã bị xoá khỏi nội dung — bấm để neo lại vào đoạn đang chọn'
                        : 'Neo vào đoạn đang chọn ở cột nội dung'
                  }
                  aria-label={state === 'ok' ? 'Đi tới đoạn được neo' : 'Neo vào đoạn đang chọn'}
                  className={`mt-1 grid size-7 shrink-0 place-items-center rounded-md transition-colors ${
                    state === 'ok'
                      ? 'text-[var(--note-accent)] hover:bg-[var(--note-soft)]'
                      : state === 'lost'
                        ? 'text-warn hover:bg-warn-soft'
                        : 'text-[var(--note-muted)] opacity-40 hover:bg-[var(--note-soft)] hover:opacity-100 group-focus-within:opacity-80'
                  }`}
                >
                  {state === 'ok' ? <MapPin className="size-4" /> : state === 'lost' ? <TriangleAlert className="size-4" /> : <Link2 className="size-4" />}
                </button>
                {studyMode ? (
                  <p className="min-w-0 flex-1 py-1.5 text-[0.95em] leading-relaxed font-medium whitespace-pre-wrap">{cue.text}</p>
                ) : (
                  <AutoGrowTextarea
                    inputRef={inputRefFor(cue.id)}
                    value={cue.text}
                    onChange={(e) => update(cue.id, { text: e.target.value })}
                    onKeyDown={(e) => onKeyDown(e, cue, index)}
                    placeholder={index === 0 ? 'Câu hỏi / từ khoá…' : ''}
                    maxLength={1000}
                    aria-label={`Câu hỏi ${index + 1}`}
                    className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent py-1.5 text-[0.95em] leading-relaxed font-medium text-[var(--note-fg)] outline-none placeholder:font-normal placeholder:text-[var(--note-muted)]/70"
                  />
                )}
                {studyMode ? (
                  state === 'ok' && (
                    <button
                      type="button"
                      onClick={() => toggleReveal(cue.id)}
                      aria-expanded={revealed.has(cue.id)}
                      className="mt-1 inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-[var(--note-accent)] hover:bg-[var(--note-soft)]"
                    >
                      {revealed.has(cue.id) ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      {revealed.has(cue.id) ? 'Ẩn' : 'Xem đáp án'}
                    </button>
                  )
                ) : (
                  <CueMenu
                    cue={cue}
                    anchorState={state}
                    canAnchor={Boolean(activeBlockId)}
                    onAnchor={onAnchorRequest}
                    onUnanchor={(id) => update(id, { anchor: null })}
                    onGoTo={onGoTo}
                    onDelete={remove}
                  />
                )}
              </div>
              {answer !== null && (
                <div className="mt-1 mb-1.5 ml-8 animate-fade-in rounded-lg border-l-2 border-[var(--note-accent)] bg-[var(--note-soft)] px-3 py-2 text-[0.875em] leading-relaxed whitespace-pre-wrap">
                  {answer || <span className="text-[var(--note-muted)] italic">(đoạn được neo đang trống)</span>}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      {!studyMode && (
        <button
          type="button"
          onClick={() => insertAfter(cues.length - 1)}
          className="m-2 inline-flex items-center gap-1.5 self-start rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-[var(--note-accent)] hover:bg-[var(--note-soft)]"
        >
          <Plus className="size-4" /> Thêm câu hỏi
        </button>
      )}
    </div>
  )
}
