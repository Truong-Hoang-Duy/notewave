import { useEffect, useRef } from 'react'

/** Đóng popover/menu khi bấm ra ngoài `ref` hoặc nhấn Esc. */
export function useDismiss(ref, open, onClose) {
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    if (!open) return
    const onPointer = (e) => !ref.current?.contains(e.target) && closeRef.current()
    const onKey = (e) => e.key === 'Escape' && closeRef.current()
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, ref])
}
