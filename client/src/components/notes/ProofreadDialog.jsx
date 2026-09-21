import { ArrowRight, Check, SpellCheck, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import Modal from '../Modal'
import { Button, Spinner } from '../ui'

/** Câu ngữ cảnh, tô từ sai để thấy rõ chỗ sẽ được thay. */
function Context({ context, original }) {
  if (!context) return null
  const index = context.indexOf(original)
  if (index < 0) return <p className="mt-1 text-[12.5px] leading-relaxed text-muted">“{context}”</p>
  return (
    <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
      “{context.slice(0, index)}
      <span className="rounded-[3px] bg-rec-soft px-0.5 text-[#8f2a2e]">{original}</span>
      {context.slice(index + original.length)}”
    </p>
  )
}

/**
 * Duyệt đề xuất sửa chính tả cho nội dung ghi chú: chọn từng mục (mặc định chọn hết) rồi bấm áp dụng — lúc đó chữ
 * trong editor mới đổi. Bỏ chọn hết = không sửa gì.
 */
export default function ProofreadDialog({ open, loading, result, onApply, onClose }) {
  const suggestions = useMemo(() => result?.suggestions ?? [], [result])
  // Giữ danh sách id BỊ BỎ CHỌN (mặc định chọn hết): mỗi lần soát lại id là mới nên không cần đồng bộ lại state.
  const [skipped, setSkipped] = useState(() => new Set())
  const chosen = useMemo(() => suggestions.filter((s) => !skipped.has(s.id)), [suggestions, skipped])

  const toggle = (id) =>
    setSkipped((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const total = chosen.reduce((sum, s) => sum + s.occurrences, 0)

  return (
    <Modal
      open={open}
      size="lg"
      onClose={onClose}
      title="Soát lỗi chính tả"
      description="AI đọc nội dung ghi chú và đề xuất chỗ viết sai (tiếng Việt và tiếng Anh). Chỉ những mục bạn chọn mới được thay."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Đóng
          </Button>
          <Button
            variant="primary"
            icon={Check}
            disabled={loading || !chosen.length}
            onClick={() => onApply(chosen)}
          >
            Sửa {chosen.length} mục{total > chosen.length ? ` (${total} chỗ)` : ''}
          </Button>
        </>
      }
    >
      {loading && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Spinner />
          <p className="text-[13px] text-muted">Đang soát lỗi… ghi chú dài có thể mất vài chục giây.</p>
        </div>
      )}

      {!loading && result?.error && (
        <p className="mb-4 rounded-xl bg-warn-soft px-3.5 py-2.5 text-[13px] text-[#7a4a0c]">{result.error}</p>
      )}

      {!loading && !suggestions.length && (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <SpellCheck className="size-7 text-brand-600" />
          <p className="text-sm font-medium text-ink">Không tìm thấy lỗi chính tả nào.</p>
          <p className="max-w-sm text-[13px] leading-relaxed text-muted">
            AI bỏ qua công thức, khối code, đường dẫn và các từ viết tắt cố ý.
          </p>
        </div>
      )}

      {!loading && suggestions.length > 0 && (
        <ul className="space-y-1">
          {suggestions.map((s) => {
            const picked = !skipped.has(s.id)
            return (
              <li key={s.id}>
                <label className={`flex cursor-pointer gap-3 rounded-xl px-3 py-2.5 transition-colors ${picked ? 'bg-brand-50/60' : 'hover:bg-sunken'}`}>
                  <input
                    type="checkbox"
                    checked={picked}
                    onChange={() => toggle(s.id)}
                    className="mt-1 size-4 shrink-0 accent-brand-600"
                    aria-label={`Sửa “${s.original}” thành “${s.corrected}”`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[13.5px]">
                      <span className="rounded-md bg-rec-soft px-1.5 py-0.5 text-[#8f2a2e] line-through decoration-rec/60">{s.original}</span>
                      <ArrowRight className="size-3.5 shrink-0 text-muted" aria-label="thành" />
                      <span className="rounded-md bg-brand-50 px-1.5 py-0.5 font-medium text-brand-700">{s.corrected}</span>
                      {s.reason && <span className="font-sans text-[11.5px] text-muted">· {s.reason}</span>}
                      {s.occurrences > 1 && <span className="font-sans text-[11.5px] text-muted">· {s.occurrences} chỗ</span>}
                    </div>
                    <Context context={s.context} original={s.original} />
                  </div>
                </label>
              </li>
            )
          })}
        </ul>
      )}

      {!loading && suggestions.length > 0 && (
        <p className="mt-4 flex items-start gap-2 text-[12.5px] leading-relaxed text-muted">
          <Sparkles className="mt-0.5 size-3.5 shrink-0" />
          Mỗi mục được thay ở mọi vị trí giống hệt trong ghi chú. Sửa xong vẫn hoàn tác được bằng Ctrl+Z.
        </p>
      )}
    </Modal>
  )
}
