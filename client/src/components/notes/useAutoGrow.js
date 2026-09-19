import { useLayoutEffect } from 'react'

/**
 * Textarea tự cao theo nội dung. Tính lại khi `value` đổi VÀ khi bề rộng phần tử đổi (ResizeObserver) — cần cho
 * textarea mount lúc đang ẩn (tab chưa mở trên mobile: `display:none` -> scrollHeight = 0) rồi mới hiện ra.
 */
export function useAutoGrow(ref, value, minHeight = 0) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      if (!el.offsetParent) return // đang ẩn: đo được 0, chờ lần hiện ra
      el.style.height = '0px'
      el.style.height = `${Math.max(el.scrollHeight, minHeight)}px`
    }
    fit()
    let lastWidth = el.clientWidth
    const observer = new ResizeObserver(() => {
      // Chỉ phản ứng khi bề rộng đổi (hiện ra / xoay màn hình) — tự đặt chiều cao không gây vòng lặp.
      if (el.clientWidth === lastWidth) return
      lastWidth = el.clientWidth
      fit()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, value, minHeight])
}
