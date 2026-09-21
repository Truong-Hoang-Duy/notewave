import { Eraser, ScanLine, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import Modal from '../Modal'
import { Button } from '../ui'

const LINE_WIDTH = 3
const PAD = 24 // lề trắng quanh nét vẽ khi cắt ảnh gửi OCR
const EXPORT_SCALE = 1.5 // ảnh gửi OCR rõ hơn một chút so với khung vẽ

/**
 * Bảng vẽ công thức tay (canvas + Pointer Events: chuột, ngón tay, bút). Khi đã dùng bút thì bỏ qua chạm tay (tránh
 * lòng bàn tay). "Nhận diện": cắt sát vùng có nét + lề trắng (Thử nghiệm 1: ảnh nhiều khoảng trắng làm Mistral bịa thêm
 * công thức) -> PNG -> POST /api/notes/formula-ocr -> `onRecognized({ latex, multiple })`.
 */
export default function DrawFormulaDialog({ onRecognized, onClose }) {
  const canvasRef = useRef(null)
  const strokes = useRef([]) // mỗi nét = mảng điểm {x, y} theo px CSS
  const current = useRef(null)
  const penSeen = useRef(false)
  const [count, setCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    drawStrokes(ctx, strokes.current, LINE_WIDTH)
  }, [])

  // Khung vẽ theo đúng kích thước hiển thị × devicePixelRatio (nét sắc trên màn hình retina); vẽ lại khi đổi kích thước.
  useEffect(() => {
    const canvas = canvasRef.current
    const fit = () => {
      const dpr = window.devicePixelRatio || 1
      const { width, height } = canvas.getBoundingClientRect()
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      redraw()
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [redraw])

  const point = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onPointerDown = (e) => {
    if (e.pointerType === 'pen') penSeen.current = true
    else if (e.pointerType === 'touch' && penSeen.current) return
    if (e.button > 0) return
    e.preventDefault()
    canvasRef.current.setPointerCapture(e.pointerId)
    current.current = { id: e.pointerId, points: [point(e)] }
    strokes.current = [...strokes.current, current.current.points]
    setError(null)
    redraw()
  }
  const onPointerMove = (e) => {
    if (!current.current || current.current.id !== e.pointerId) return
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
    for (const ev of events) current.current.points.push(point(ev))
    redraw()
  }
  const onPointerUp = (e) => {
    if (current.current?.id !== e.pointerId) return
    current.current = null
    setCount(strokes.current.length)
  }

  const undo = () => {
    strokes.current = strokes.current.slice(0, -1)
    setCount(strokes.current.length)
    redraw()
  }
  const clear = () => {
    strokes.current = []
    setCount(0)
    redraw()
  }

  const recognize = async () => {
    const blob = await exportCropped(strokes.current)
    if (!blob) return
    setBusy(true)
    setError(null)
    try {
      onRecognized(await api.formulaOcr(blob))
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      size="xl"
      title="Vẽ công thức"
      description="Viết công thức bằng chuột, ngón tay hoặc bút. Viết to, rõ; mỗi lần một công thức."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="ghost" icon={Undo2} onClick={undo} disabled={!count || busy} className="mr-auto">
            <span className="hidden sm:inline">Hoàn tác</span>
          </Button>
          <Button variant="ghost" icon={Eraser} onClick={clear} disabled={!count || busy}>
            <span className="hidden sm:inline">Xoá hết</span>
          </Button>
          <Button variant="primary" icon={ScanLine} onClick={recognize} disabled={!count} loading={busy}>
            Nhận diện
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-label="Khung vẽ công thức"
          className="block h-[min(20rem,45svh)] w-full cursor-crosshair touch-none rounded-xl border border-line bg-white"
        />
        {error && (
          <p role="alert" className="text-[13px] text-rec">
            {error}
          </p>
        )}
        <p className="text-[12.5px] text-muted">Kết quả nhận diện sẽ hiện để bạn xem trước và sửa trước khi chèn vào ghi chú.</p>
      </div>
    </Modal>
  )
}

function drawStrokes(ctx, strokes, width) {
  ctx.strokeStyle = '#151515'
  ctx.fillStyle = '#151515'
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const pts of strokes) {
    if (pts.length === 1) {
      ctx.beginPath()
      ctx.arc(pts[0].x, pts[0].y, width / 2, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }
}

/** Ảnh PNG nền trắng, cắt sát vùng có nét + lề PAD. */
function exportCropped(strokes) {
  const pts = strokes.flat()
  if (!pts.length) return Promise.resolve(null)
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const minX = Math.min(...xs) - PAD
  const minY = Math.min(...ys) - PAD
  const w = Math.max(...xs) + PAD - minX
  const h = Math.max(...ys) + PAD - minY
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(w * EXPORT_SCALE)
  canvas.height = Math.ceil(h * EXPORT_SCALE)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(EXPORT_SCALE, 0, 0, EXPORT_SCALE, -minX * EXPORT_SCALE, -minY * EXPORT_SCALE)
  drawStrokes(ctx, strokes, LINE_WIDTH)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}
