import { useEffect, useRef } from 'react'

const BAR_COUNT = 36

/** Sóng âm động theo âm lượng micro thật (AnalyserNode). Khi tạm dừng thì các cột hạ thấp. */
export default function Waveform({ analyser, active, color = '#dc3d43', className = '' }) {
  const canvasRef = useRef(null)
  const levelsRef = useRef(new Float32Array(BAR_COUNT))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
    let frame

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const { clientWidth: w, clientHeight: h } = canvas
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      if (analyser && active) analyser.getByteFrequencyData(data)
      const levels = levelsRef.current
      const gap = 3
      const barW = Math.max(2, (w - gap * (BAR_COUNT - 1)) / BAR_COUNT)
      // Dải tần giọng nói chủ yếu nằm ở nửa dưới phổ.
      const usable = data ? Math.floor(data.length * 0.55) : 0

      for (let i = 0; i < BAR_COUNT; i++) {
        // Đối xứng từ giữa ra hai bên cho cảm giác "sóng".
        const mirrored = Math.abs(i - (BAR_COUNT - 1) / 2) / ((BAR_COUNT - 1) / 2)
        let target = 0.06
        if (data && active) {
          const idx = Math.floor(mirrored * (usable - 1))
          target = Math.max(0.06, (data[idx] / 255) ** 1.4)
        }
        levels[i] += (target - levels[i]) * 0.35
        const barH = Math.max(3, levels[i] * h)
        const x = i * (barW + gap)
        const y = (h - barH) / 2
        ctx.fillStyle = color
        ctx.globalAlpha = active ? 0.35 + levels[i] * 0.65 : 0.25
        ctx.beginPath()
        ctx.roundRect(x, y, barW, barH, barW / 2)
        ctx.fill()
      }
      frame = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(frame)
  }, [analyser, active, color])

  return <canvas ref={canvasRef} className={`block h-10 w-full ${className}`} aria-hidden="true" />
}
