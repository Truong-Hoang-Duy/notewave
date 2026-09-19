import { Check, Palette } from 'lucide-react'
import { useRef, useState } from 'react'
import { NOTE_FONT_SIZES, NOTE_FONTS, NOTE_THEMES, resolveNoteStyle } from '../../lib/noteStyles'
import { Button } from '../ui'
import { useDismiss } from './useDismiss'

function Segmented({ label, options, value, onChange, renderLabel }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[12px] font-semibold tracking-wide text-muted uppercase">{label}</legend>
      <div className="grid grid-cols-4 gap-1 rounded-xl bg-sunken/70 p-1">
        {Object.entries(options).map(([key, opt]) => (
          <button
            key={key}
            type="button"
            aria-pressed={value === key}
            onClick={() => onChange(key)}
            className={`rounded-lg px-1.5 py-1.5 text-[12.5px] font-medium transition-all ${value === key ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'}`}
          >
            {renderLabel ? renderLabel(key, opt) : opt.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/** Giao diện riêng của ghi chú đang mở: màu nền/chữ (theme), font, cỡ chữ. */
export default function NoteStylePicker({ style, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useDismiss(ref, open, () => setOpen(false))
  const s = resolveNoteStyle(style)
  const set = (patch) => onChange({ ...s, ...patch })

  return (
    <div className="relative" ref={ref}>
      <Button size="sm" variant="ghost" icon={Palette} onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}>
        <span className="hidden sm:inline">Giao diện</span>
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Giao diện ghi chú"
          className="absolute top-full right-0 z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] animate-slide-up space-y-4 rounded-2xl border border-line bg-surface p-4 shadow-float"
        >
          <fieldset>
            <legend className="mb-1.5 text-[12px] font-semibold tracking-wide text-muted uppercase">Màu nền</legend>
            <div className="grid grid-cols-6 gap-2">
              {Object.entries(NOTE_THEMES).map(([key, t]) => (
                <button
                  key={key}
                  type="button"
                  title={t.label}
                  aria-label={`Màu ${t.label}`}
                  aria-pressed={s.theme === key}
                  onClick={() => set({ theme: key })}
                  style={{ background: t.bg, color: t.fg, borderColor: s.theme === key ? t.accent : t.line }}
                  className="grid aspect-square place-items-center rounded-xl border-2 text-[13px] font-semibold transition-transform hover:scale-105"
                >
                  {s.theme === key ? <Check className="size-4" style={{ color: t.accent }} /> : 'Aa'}
                </button>
              ))}
            </div>
          </fieldset>
          <Segmented
            label="Font chữ"
            options={NOTE_FONTS}
            value={s.font}
            onChange={(font) => set({ font })}
            renderLabel={(key, opt) => <span style={{ fontFamily: opt.family }}>{opt.label}</span>}
          />
          <Segmented label="Cỡ chữ" options={NOTE_FONT_SIZES} value={s.font_size} onChange={(font_size) => set({ font_size })} />
          <p className="text-[12px] leading-relaxed text-muted">Chỉ áp dụng cho ghi chú này.</p>
        </div>
      )}
    </div>
  )
}
