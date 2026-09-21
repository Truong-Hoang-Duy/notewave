/**
 * Nén ảnh trước khi tải lên (không cần thư viện): thu về tối đa `maxSide` px theo cạnh dài, mã hoá WebP (trình duyệt
 * không hỗ trợ mã hoá WebP -> JPEG cho ảnh không trong suốt). GIF giữ nguyên (ảnh động). Kết quả lớn hơn bản gốc ->
 * dùng bản gốc. Ảnh chụp điện thoại 5–8 MB thường còn vài trăm KB.
 */
const MAX_SIDE = 2000
const QUALITY = 0.85

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* định dạng lạ / trình duyệt cũ -> thử <img> */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

export async function compressImage(file, { maxSide = MAX_SIDE } = {}) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file
  let bitmap
  try {
    bitmap = await loadBitmap(file)
  } catch {
    return file // không đọc được -> gửi nguyên bản, backend sẽ kiểm tra định dạng
  }
  const width = bitmap.width || bitmap.naturalWidth
  const height = bitmap.height || bitmap.naturalHeight
  const scale = Math.min(1, maxSide / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()

  let blob = await toBlob(canvas, 'image/webp', QUALITY)
  // Safari cũ không mã hoá WebP (trả PNG): ảnh gốc PNG giữ PNG (có thể trong suốt), còn lại dùng JPEG.
  if (!blob || blob.type !== 'image/webp') blob = file.type === 'image/png' ? await toBlob(canvas, 'image/png') : await toBlob(canvas, 'image/jpeg', QUALITY)
  if (!blob || (blob.size >= file.size && scale === 1)) return file
  const ext = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }[blob.type] ?? 'img'
  const base = (file.name || 'anh').replace(/\.[^.]+$/, '')
  return new File([blob], `${base}.${ext}`, { type: blob.type })
}
