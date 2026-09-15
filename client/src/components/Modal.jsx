import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'

/** Khung hộp thoại dùng chung: bottom sheet trên mobile, hộp giữa màn hình trên desktop. */
export default function Modal({ open, title, description, onClose, busy = false, size = 'md', children, footer }) {
  const panelRef = useRef(null)
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  useEffect(() => {
    closeRef.current = onClose
    busyRef.current = busy
  })

  // Chỉ chạy khi mở/đóng: không cướp focus của ô đang gõ mỗi lần re-render.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && !busyRef.current && closeRef.current()
    window.addEventListener('keydown', onKey)
    panelRef.current?.querySelector('input, button:not([data-close])')?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [open])

  if (!open) return null
  const width = size === 'lg' ? 'sm:max-w-xl' : 'sm:max-w-md'
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="absolute inset-0 animate-fade-in bg-ink/40 backdrop-blur-[2px]" onClick={() => !busy && onClose()} />
      <div
        ref={panelRef}
        className={`relative flex max-h-[92svh] w-full ${width} animate-slide-up flex-col rounded-t-2xl bg-surface shadow-float sm:rounded-2xl`}
      >
        <div className="flex items-start gap-3 border-b border-line px-5 pt-5 pb-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 id="modal-title" className="text-base font-semibold text-ink">
              {title}
            </h2>
            {description && <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p>}
          </div>
          <button
            data-close
            onClick={onClose}
            disabled={busy}
            className="-mt-1 -mr-2 rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-ink disabled:opacity-50"
            aria-label="Đóng"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6 sm:pb-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
