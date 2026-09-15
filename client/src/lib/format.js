export function formatClock(ms) {
  if (ms == null || Number.isNaN(ms)) return '--:--'
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function formatDuration(ms) {
  if (!ms) return null
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h) return `${h} giờ ${m} phút`
  if (m) return s ? `${m} phút ${s} giây` : `${m} phút`
  return `${s} giây`
}

const timeFmt = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' })
const dateFmt = new Intl.DateTimeFormat('vi-VN', { day: 'numeric', month: 'numeric', year: 'numeric' })

export function formatDateTime(iso) {
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a, b) => a.toDateString() === b.toDateString()
  if (sameDay(date, today)) return `Hôm nay, ${timeFmt.format(date)}`
  if (sameDay(date, yesterday)) return `Hôm qua, ${timeFmt.format(date)}`
  return `${dateFmt.format(date)}, ${timeFmt.format(date)}`
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const SOURCE_LABELS = {
  live: 'Ghi âm trực tiếp',
  upload: 'File tải lên',
  ocr: 'Tài liệu quét',
}

// Bảng màu người nói: tông trầm, đủ tương phản trên nền giấy, không trùng màu đỏ "đang ghi".
const SPEAKER_COLORS = ['#2f6554', '#5b54c7', '#b0620e', '#b33b72', '#27709f', '#6a7418', '#8a4fb5', '#8d5a3b']

export function speakerColor(speaker) {
  const n = Number.parseInt(speaker, 10)
  const index = Number.isNaN(n) ? hash(String(speaker)) : n - 1
  return SPEAKER_COLORS[((index % SPEAKER_COLORS.length) + SPEAKER_COLORS.length) % SPEAKER_COLORS.length]
}

export function speakerLabel(speaker) {
  return speaker ? `Người nói ${speaker}` : null
}

function hash(str) {
  let h = 0
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) | 0
  return Math.abs(h)
}
