import { ChevronLeft, ChevronRight, Maximize2, MoveHorizontal } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import { Button, Spinner } from './ui'

// Worker của pdf.js do Vite bundle kèm (không tải từ CDN ngoài). Dùng `workerPort` với module worker vì bản dist
// của pdf.js v6 là ES module — đặt `workerSrc` bằng URL sẽ tạo classic worker và lỗi khi nạp.
pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), {
  type: 'module',
})

const GAP = 12 // khoảng cách giữa các trang (px)
const PADDING = 16 // padding của vùng cuộn
const MAX_DPR = 2 // giới hạn độ phân giải canvas cho đỡ tốn RAM với tài liệu dài

/**
 * Xem trước PDF: cuộn qua TẤT CẢ các trang (mỗi trang chỉ được vẽ khi tới gần tầm nhìn và bị xoá khi cuộn ra xa,
 * nên tài liệu dài vẫn nhẹ). Hai chế độ hiển thị:
 * - "Vừa cả trang" (mặc định): mỗi trang hiện trọn trong khung, cuộn để sang trang tiếp theo.
 * - "Vừa chiều ngang": trang rộng bằng khung (chữ to hơn), cuộn dọc trong từng trang.
 * pdf.js vẽ ra canvas nên giao diện giống nhau trên mọi trình duyệt (Safari iOS không nhúng PDF inline được).
 */
export default function PdfPreview({ file }) {
  const [doc, setDoc] = useState(null)
  const [error, setError] = useState(null)
  const [mode, setMode] = useState('page') // 'page' | 'width'
  const [current, setCurrent] = useState(1)
  const [box, setBox] = useState(null) // kích thước vùng cuộn
  const [basePage, setBasePage] = useState(null) // kích thước trang đầu, dùng để bố trí
  const [scrollEl, setScrollEl] = useState(null)
  const scrollRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    let task = null
    setDoc(null)
    setBasePage(null)
    setCurrent(1)
    setError(null)
    ;(async () => {
      try {
        const data = await file.arrayBuffer()
        task = pdfjs.getDocument({ data })
        const loaded = await task.promise
        const viewport = (await loaded.getPage(1)).getViewport({ scale: 1 })
        if (cancelled) {
          // StrictMode (dev) chạy effect 2 lần: bản bị huỷ phải tự dọn, nếu không sẽ giữ worker của pdf.js.
          task.destroy()?.catch(() => {})
          return
        }
        setBasePage({ width: viewport.width, height: viewport.height })
        setDoc(loaded)
      } catch {
        if (!cancelled) setError('Không đọc được file PDF này (file hỏng hoặc có mật khẩu).')
      }
    })()
    return () => {
      cancelled = true
      // Chỉ PDFDocumentLoadingTask mới có destroy() (pdf.js v6 đã bỏ destroy() của PDFDocumentProxy);
      // destroy() trả Promise và có thể reject khi còn render dở -> nuốt lỗi, đừng để cleanup ném ra ngoài.
      try {
        task?.destroy()?.catch(() => {})
      } catch {
        /* ignore */
      }
    }
  }, [file])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setScrollEl(el)
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [doc])

  // Kích thước hiển thị của mỗi trang (giả định các trang cùng khổ — đúng với hầu hết tài liệu; trang khác khổ
  // vẫn được vẽ đúng tỉ lệ của chính nó).
  const size = useMemo(() => {
    if (!box || !basePage) return null
    const fitWidth = (box.width - PADDING * 2) / basePage.width
    const fitHeight = (box.height - PADDING * 2) / basePage.height
    const scale = mode === 'width' ? fitWidth : Math.min(fitWidth, fitHeight)
    return { width: Math.floor(basePage.width * scale), height: Math.floor(basePage.height * scale) }
  }, [box, basePage, mode])

  const goTo = useCallback(
    (page) => {
      const el = scrollRef.current
      if (!el || !size || !doc) return
      const next = Math.min(Math.max(page, 1), doc.numPages)
      el.scrollTo({ top: (next - 1) * (size.height + GAP), behavior: 'smooth' })
      setCurrent(next)
    },
    [size, doc],
  )

  const onScroll = () => {
    const el = scrollRef.current
    if (!el || !size || !doc) return
    setCurrent(Math.min(doc.numPages, Math.floor(el.scrollTop / (size.height + GAP) + 0.5) + 1))
  }

  if (error) return <p className="m-auto py-10 text-center text-sm text-rec">{error}</p>

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scroll-area relative min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border border-line bg-paper"
      >
        {doc && size ? (
          <div className="flex flex-col items-center gap-3 p-4">
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage key={i} doc={doc} number={i + 1} size={size} root={scrollEl} />
            ))}
          </div>
        ) : (
          <div className="grid h-full place-items-center">
            <Spinner />
          </div>
        )}
      </div>

      {doc && (
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
          {doc.numPages > 1 && (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={() => goTo(current - 1)} disabled={current <= 1} aria-label="Trang trước" />
              <span className="min-w-24 text-center text-[13px] text-muted tabular-nums">
                Trang {current} / {doc.numPages}
              </span>
              <Button
                size="sm"
                variant="ghost"
                icon={ChevronRight}
                onClick={() => goTo(current + 1)}
                disabled={current >= doc.numPages}
                aria-label="Trang sau"
              />
            </div>
          )}
          <Button
            size="sm"
            variant="secondary"
            icon={mode === 'page' ? MoveHorizontal : Maximize2}
            onClick={() => setMode((m) => (m === 'page' ? 'width' : 'page'))}
            title={mode === 'page' ? 'Phóng cho vừa chiều ngang khung' : 'Thu cho trọn cả trang'}
          >
            {mode === 'page' ? 'Vừa chiều ngang' : 'Vừa cả trang'}
          </Button>
        </div>
      )}
    </div>
  )
}

/** Một trang: chỉ vẽ khi tới gần tầm nhìn, bỏ vẽ khi cuộn ra xa để tài liệu dài không phình bộ nhớ. */
function PdfPage({ doc, number, size, root }) {
  const wrapperRef = useRef(null)
  const canvasRef = useRef(null)
  const [near, setNear] = useState(number === 1)

  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => setNear(entries[entries.length - 1].isIntersecting), {
      root: root ?? null,
      rootMargin: '600px 0px',
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [root])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!near) {
      canvas.width = 0 // giải phóng bộ nhớ ảnh của trang đã cuộn qua
      canvas.height = 0
      return
    }
    let cancelled = false
    let task = null
    ;(async () => {
      try {
        const page = await doc.getPage(number)
        if (cancelled) return
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
        // Mỗi trang dùng tỉ lệ của chính nó (phòng tài liệu có trang khác khổ) nhưng vẫn vừa bề ngang đã tính.
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: (size.width / base.width) * dpr })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        task = page.render({ canvasContext: canvas.getContext('2d'), viewport })
        await task.promise
      } catch {
        /* render bị huỷ khi cuộn nhanh / đổi chế độ là bình thường */
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [near, doc, number, size])

  // Khung giữ chỗ đúng kích thước để thanh cuộn không nhảy khi trang chưa được vẽ.
  return (
    <div ref={wrapperRef} style={{ width: size.width, height: size.height }} className="relative shrink-0">
      <canvas ref={canvasRef} style={{ width: size.width, height: size.height }} className="block rounded-lg bg-white shadow-card" aria-label={`Trang ${number}`} />
      {!near && (
        <div className="absolute inset-0 grid place-items-center rounded-lg border border-line bg-sunken/40">
          <span className="text-[12px] text-muted">Trang {number}</span>
        </div>
      )}
    </div>
  )
}
