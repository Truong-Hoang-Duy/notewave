import { CheckCircle2, CircleAlert, X } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), [])

  const show = useCallback(
    (message, { type = 'success', duration = 3500 } = {}) => {
      const id = ++idRef.current
      setToasts((list) => [...list.slice(-2), { id, message, type }])
      setTimeout(() => dismiss(id), duration)
    },
    [dismiss],
  )

  const value = useMemo(
    () => ({ success: (m, o) => show(m, { ...o, type: 'success' }), error: (m, o) => show(m, { duration: 5000, ...o, type: 'error' }) }),
    [show],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 md:bottom-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.type === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex max-w-md animate-slide-up items-start gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-float"
          >
            {t.type === 'error' ? (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-[#ff8a8e]" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-200" />
            )}
            <span className="leading-relaxed">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="-mr-1 rounded p-0.5 text-white/60 hover:text-white" aria-label="Đóng">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  return useContext(ToastContext)
}
