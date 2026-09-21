import katex from 'katex'
import { useState } from 'react'
import { MATH_CATEGORIES, snippetDisplay } from '../../lib/mathSnippets'

// KaTeX render sẵn cho nhãn nút — cache theo chuỗi để mở lại hộp thoại / đổi nhóm không render lại.
const htmlCache = new Map()
function renderLabel(latex, displayMode = false) {
  const key = `${displayMode ? 'D' : 'I'}${latex}`
  if (!htmlCache.has(key)) {
    let html
    try {
      html = katex.renderToString(snippetDisplay(latex), { throwOnError: true, displayMode: false, output: 'html', strict: 'ignore' })
    } catch {
      html = latex // không bao giờ xảy ra với dữ liệu đã kiểm tra, nhưng không làm hỏng hộp thoại
    }
    htmlCache.set(key, html)
  }
  return htmlCache.get(key)
}

// Nhóm đang mở được nhớ giữa các lần mở hộp thoại (trong phiên làm việc).
let lastCategory = MATH_CATEGORIES[0].id

/** Bảng ký hiệu / mẫu công thức theo nhóm. `onPick(latex)` chèn vào ô LaTeX tại con trỏ. */
export default function MathPalette({ onPick }) {
  const [active, setActive] = useState(lastCategory)
  const category = MATH_CATEGORIES.find((c) => c.id === active) ?? MATH_CATEGORIES[0]
  const isTemplates = category.id === 'templates'
  const isStructures = category.id === 'structures'

  return (
    <div className="flex min-h-0 flex-initial flex-col rounded-xl border border-line">
      <div role="tablist" aria-label="Nhóm ký hiệu" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-1 [scrollbar-width:none] sm:flex-wrap">
        {MATH_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={c.id === category.id}
            onClick={() => {
              lastCategory = c.id
              setActive(c.id)
            }}
            className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium whitespace-nowrap transition-colors ${
              c.id === category.id ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-sunken hover:text-ink'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={category.label} className="scroll-area max-h-52 min-h-[5.5rem] flex-1 overflow-y-auto overscroll-contain p-1.5 sm:max-h-60">
        {isTemplates ? (
          <div className="grid gap-1 sm:grid-cols-2">
            {category.items.map(([latex, label]) => (
              <button
                key={latex}
                type="button"
                onClick={() => onPick(latex)}
                title={latex}
                className="flex flex-col items-start gap-1 overflow-hidden rounded-lg border border-transparent px-2.5 py-2 text-left hover:border-brand-200 hover:bg-brand-50/60"
              >
                <span className="text-[12px] font-medium text-muted">{label}</span>
                <span className="max-w-full overflow-x-auto text-[13px] text-ink [scrollbar-width:none]" dangerouslySetInnerHTML={{ __html: renderLabel(latex) }} />
              </button>
            ))}
          </div>
        ) : (
          <div className={`grid gap-1 ${isStructures ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))]'}`}>
            {category.items.map(([latex, label]) => (
              <button
                key={latex}
                type="button"
                onClick={() => onPick(latex)}
                title={label ? `${label} — ${latex}` : latex}
                aria-label={label ?? latex}
                className={`grid place-items-center overflow-hidden rounded-lg border border-line bg-surface px-1 text-[14px] text-ink transition-colors hover:border-brand-500 hover:bg-brand-50/60 ${
                  isStructures ? 'min-h-16 py-1.5 text-[12px]' : 'h-10'
                }`}
                dangerouslySetInnerHTML={{ __html: renderLabel(latex) }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
