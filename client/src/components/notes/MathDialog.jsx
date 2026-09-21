import katex from 'katex'
import { TriangleAlert } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { snippetCaret } from '../../lib/mathSnippets'
import Modal from '../Modal'
import { Button } from '../ui'
import MathPalette from './MathPalette'

function renderPreview(latex, displayMode) {
  if (!latex.trim()) return { html: '', error: null }
  try {
    return { html: katex.renderToString(latex, { displayMode, throwOnError: true, output: 'html' }), error: null }
  } catch (err) {
    return { html: '', error: err.message.replace(/^KaTeX parse error: /, '') }
  }
}

/**
 * Chèn / sửa công thức LaTeX (KaTeX). `initial` = { latex, mode: 'inline' | 'block' }; `warning` hiện khi kết quả đến từ
 * nhận diện nét vẽ và cần kiểm tra lại. Chỉ mount khi mở (state mới mỗi lần mở).
 */
export default function MathDialog({ initial, editing = false, warning, onSubmit, onDelete, onClose }) {
  const [latex, setLatex] = useState(initial?.latex ?? '')
  const [mode, setMode] = useState(initial?.mode ?? 'block')
  const ref = useRef(null)
  const preview = useMemo(() => renderPreview(latex, mode === 'block'), [latex, mode])

  const insertSnippet = (snippet) => {
    const el = ref.current
    const start = el?.selectionStart ?? latex.length
    const end = el?.selectionEnd ?? latex.length
    // Lệnh kết thúc bằng chữ (\alpha, \le...) đứng ngay trước một chữ cái -> thêm dấu cách, tránh thành lệnh lạ "\alphab".
    const text = /\\[a-zA-Z]+$/.test(snippet) && /^[a-zA-Z]/.test(latex.slice(end)) ? `${snippet} ` : snippet
    setLatex(latex.slice(0, start) + text + latex.slice(end))
    const caret = start + snippetCaret(text)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(caret, caret)
    })
  }

  const submit = () => latex.trim() && !preview.error && onSubmit({ latex: latex.trim(), mode })

  return (
    <Modal
      open
      size="lg"
      flexBody
      title={editing ? 'Sửa công thức' : 'Chèn công thức'}
      description="Viết LaTeX, xem trước bên dưới. Gõ nhanh trong nội dung: $$x^2$$ (trong dòng), $$$x^2$$$ (khối riêng)."
      onClose={onClose}
      footer={
        <>
          {editing && (
            <Button variant="danger-ghost" onClick={onDelete} className="mr-auto">
              Xoá công thức
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button variant="primary" onClick={submit} disabled={!latex.trim() || Boolean(preview.error)}>
            {editing ? 'Cập nhật' : 'Chèn'}
          </Button>
        </>
      }
    >
      {/* Chỉ bảng ký hiệu co lại theo chỗ trống (cuộn bên trong); các phần khác giữ nguyên -> hộp thoại không cuộn. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {warning && (
          <p className="flex shrink-0 gap-2 rounded-xl border border-[#f0dcb8] bg-warn-soft px-3 py-2 text-[13px] leading-relaxed text-[#7a4a0c]">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {warning}
          </p>
        )}
        <div className="flex shrink-0 rounded-xl border border-line bg-sunken/60 p-1" role="radiogroup" aria-label="Kiểu hiển thị">
          {[
            ['block', 'Khối riêng'],
            ['inline', 'Trong dòng'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => setMode(value)}
              className={`flex-1 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all ${mode === value ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <textarea
          ref={ref}
          value={latex}
          onChange={(e) => setLatex(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit()
          }}
          rows={2}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}"
          aria-label="LaTeX"
          className="w-full shrink-0 resize-y rounded-xl border border-line bg-surface px-3 py-2 font-mono text-[13.5px] text-ink outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
        />
        <MathPalette onPick={insertSnippet} />
        <div className="min-h-20 shrink-0 overflow-x-auto rounded-xl border border-dashed border-line-strong bg-paper/60 px-4 py-3" aria-live="polite">
          {preview.error ? (
            <p className="text-[13px] text-rec">Chưa đúng cú pháp: {preview.error}</p>
          ) : preview.html ? (
            <div className={mode === 'block' ? 'text-center' : ''} dangerouslySetInnerHTML={{ __html: preview.html }} />
          ) : (
            <p className="text-[13px] text-muted">Xem trước công thức sẽ hiện ở đây.</p>
          )}
        </div>
      </div>
    </Modal>
  )
}
