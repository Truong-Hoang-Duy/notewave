import { useCallback } from 'react'

/**
 * Callback ref: đặt biến CSS `--fit-h` trên phần tử = chiều cao còn lại của viewport, tính từ mép trên
 * phần tử tới đáy màn hình (trừ padding dưới của <main>). Phần tử tự chọn breakpoint dùng biến này
 * (vd. `xl:h-(--fit-h)`), nên mobile vẫn cuộn tự nhiên theo nội dung.
 * Tự đo lại khi kích thước trang đổi (đổi tên phiên, hiện cảnh báo, banner máy chủ…) hoặc khi resize.
 */
export function useViewportFit({ minHeight = 420 } = {}) {
  return useCallback(
    (el) => {
      if (!el) return
      const main = el.closest('main')
      let frame = 0

      const measure = () => {
        const top = el.getBoundingClientRect().top + window.scrollY
        const bottom = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0
        const height = Math.max(minHeight, Math.floor(window.innerHeight - top - bottom))
        el.style.setProperty('--fit-h', `${height}px`)
      }
      const schedule = () => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(measure)
      }

      measure() // đo ngay lần đầu để không bị nháy layout
      const observer = new ResizeObserver(schedule)
      observer.observe(document.body)
      window.addEventListener('resize', schedule)
      return () => {
        cancelAnimationFrame(frame)
        observer.disconnect()
        window.removeEventListener('resize', schedule)
      }
    },
    [minHeight],
  )
}
