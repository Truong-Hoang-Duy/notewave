import { useCallback } from 'react'

/**
 * Callback ref: đặt biến CSS `--fit-h` trên phần tử = chiều cao còn lại của viewport, tính từ mép trên
 * phần tử tới đáy màn hình (trừ padding dưới của <main>). Phần tử tự chọn breakpoint dùng biến này
 * (vd. `xl:h-(--fit-h)`), nên mobile vẫn cuộn tự nhiên theo nội dung.
 * Tự đo lại khi kích thước trang đổi (đổi tên phiên, hiện cảnh báo, banner máy chủ…) hoặc khi resize.
 *
 * `mobile: true` — dùng cả trên điện thoại (khung ghi chú): trừ thêm padding dưới của khung app (chỗ dành cho thanh
 * điều hướng cố định ở đáy màn hình) và tính theo `visualViewport` để khung co lại khi bàn phím ảo mở (iOS không đổi
 * `innerHeight` khi hiện bàn phím).
 */
export function useViewportFit({ minHeight = 420, mobile = false } = {}) {
  return useCallback(
    (el) => {
      if (!el) return
      const main = el.closest('main')
      const shell = mobile ? main?.parentElement : null
      const vv = mobile ? window.visualViewport : null
      let frame = 0

      const measure = () => {
        const top = el.getBoundingClientRect().top + window.scrollY
        const padding = (node) => (node ? parseFloat(getComputedStyle(node).paddingBottom) || 0 : 0)
        const bottom = padding(main) + padding(shell)
        // Bàn phím ảo: visualViewport thấp hơn innerHeight. Bỏ qua khi người dùng đang phóng to (scale > 1).
        const viewport = vv && vv.scale <= 1.01 ? Math.min(window.innerHeight, vv.height) : window.innerHeight
        const height = Math.max(minHeight, Math.floor(viewport - top - bottom))
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
      vv?.addEventListener('resize', schedule)
      return () => {
        cancelAnimationFrame(frame)
        observer.disconnect()
        window.removeEventListener('resize', schedule)
        vv?.removeEventListener('resize', schedule)
      }
    },
    [minHeight, mobile],
  )
}
