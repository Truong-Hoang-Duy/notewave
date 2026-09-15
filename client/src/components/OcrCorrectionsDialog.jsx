import { ArrowRight, Check, CheckCheck, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import Modal from './Modal'
import { Button } from './ui'

const STATUS_LABELS = {
  accepted: { label: 'Đã chấp nhận', tone: 'bg-brand-50 text-brand-700' },
  rejected: { label: 'Đã bỏ qua', tone: 'bg-sunken text-muted' },
  unavailable: { label: 'Không còn áp dụng', tone: 'bg-warn-soft text-warn' },
}

/** Câu ngữ cảnh, tô từ gốc (gạch ngang) để người dùng thấy chỗ sẽ bị thay. */
function Context({ context, original }) {
  if (!context) return null
  const index = context.indexOf(original)
  if (index < 0) return <p className="mt-1.5 text-[13px] leading-relaxed text-muted">“{context}”</p>
  return (
    <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
      “{context.slice(0, index)}
      <span className="rounded-[3px] bg-rec-soft px-0.5 text-[#8f2a2e] line-through decoration-rec/60">{original}</span>
      {context.slice(index + original.length)}”
    </p>
  )
}

function Change({ original, corrected, decided }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[14px]">
      <span className={`rounded-md px-1.5 py-0.5 ${decided ? 'bg-sunken text-muted' : 'bg-rec-soft text-[#8f2a2e] line-through decoration-rec/60'}`}>
        {original}
      </span>
      <ArrowRight className="size-3.5 shrink-0 text-muted" aria-label="thành" />
      <span className={`rounded-md px-1.5 py-0.5 font-medium ${decided ? 'bg-sunken text-ink-soft' : 'bg-brand-50 text-brand-700'}`}>{corrected}</span>
    </div>
  )
}

/**
 * Duyệt đề xuất sửa từ tiếng Anh kiểu "track changes": chấp nhận / bỏ qua từng chỗ hoặc chấp nhận tất cả.
 * Không có gì được áp dụng khi chưa bấm chấp nhận.
 */
export default function OcrCorrectionsDialog({ open, corrections, focusId, deciding, locked, onDecide, onClose }) {
  const listRef = useRef(null)
  const pending = corrections.filter((c) => c.status === 'pending')
  const decided = corrections.filter((c) => c.status !== 'pending')
  const multiPage = new Set(corrections.map((c) => c.page)).size > 1

  useEffect(() => {
    if (!open || !focusId) return
    listRef.current?.querySelector(`[data-id="${focusId}"]`)?.scrollIntoView({ block: 'center' })
  }, [open, focusId])

  return (
    <Modal
      open={open}
      size="lg"
      onClose={onClose}
      busy={deciding === 'all'}
      title="Đề xuất sửa từ tiếng Anh"
      description="AI rà soát các từ tiếng Anh có thể bị viết sai hoặc nhận nhầm. Chỉ những chỗ bạn chấp nhận mới được sửa trong nội dung."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={deciding === 'all'}>
            Đóng
          </Button>
          <Button
            variant="primary"
            icon={CheckCheck}
            loading={deciding === 'all'}
            disabled={!pending.length || locked || (deciding && deciding !== 'all')}
            onClick={() => onDecide({ accept: pending.map((c) => c.id) }, 'all')}
          >
            Chấp nhận tất cả{pending.length ? ` (${pending.length})` : ''}
          </Button>
        </>
      }
    >
      <div ref={listRef} className="space-y-5">
        {locked && (
          <p className="rounded-xl bg-warn-soft px-3.5 py-2.5 text-[13px] text-[#7a4a0c]">
            Đang chỉnh sửa nội dung — lưu hoặc huỷ chỉnh sửa trước khi chấp nhận đề xuất.
          </p>
        )}

        {pending.length === 0 ? (
          <p className="py-2 text-sm text-muted">Đã xử lý hết các đề xuất.</p>
        ) : (
          <ul className="space-y-2.5" aria-label="Đề xuất chờ xác nhận">
            {pending.map((c) => (
              <li
                key={c.id}
                data-id={c.id}
                className={`rounded-xl border px-3.5 py-3 transition-colors ${c.id === focusId ? 'border-warn/50 bg-warn-soft/50' : 'border-line bg-surface'}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {multiPage && <p className="mb-1 text-[11.5px] font-medium tracking-wide text-muted uppercase">Trang {c.page}</p>}
                    <Change original={c.original} corrected={c.corrected} />
                    <Context context={c.context} original={c.original} />
                  </div>
                  <div className="flex w-full gap-1.5 sm:w-auto">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={X}
                      className="flex-1 sm:flex-none"
                      onClick={() => onDecide({ reject: [c.id] }, c.id)}
                      disabled={!!deciding}
                    >
                      Bỏ qua
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={Check}
                      className="flex-1 sm:flex-none"
                      loading={deciding === c.id}
                      onClick={() => onDecide({ accept: [c.id] }, c.id)}
                      disabled={locked || (!!deciding && deciding !== c.id)}
                    >
                      Chấp nhận
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {decided.length > 0 && (
          <details className="group" open={pending.length === 0}>
            <summary className="cursor-pointer list-none text-[13px] font-medium text-muted select-none hover:text-ink">
              <span className="inline-block transition-transform group-open:rotate-90">›</span> Đã xử lý ({decided.length})
            </summary>
            <ul className="mt-2.5 space-y-2">
              {decided.map((c) => (
                <li key={c.id} data-id={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paper px-3.5 py-2.5">
                  <div className="min-w-0">
                    {multiPage && <p className="mb-0.5 text-[11px] font-medium tracking-wide text-muted uppercase">Trang {c.page}</p>}
                    <Change original={c.original} corrected={c.corrected} decided />
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${STATUS_LABELS[c.status]?.tone}`}>
                    {STATUS_LABELS[c.status]?.label}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Modal>
  )
}
