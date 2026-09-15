/**
 * Chép text vào bộ nhớ tạm. Dùng Clipboard API khi có (HTTPS / localhost); nếu không (vd. mở app dev qua
 * IP mạng LAN) thì dùng textarea ẩn + execCommand. Ném lỗi khi trình duyệt từ chối.
 */
export async function copyText(text) {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // rơi xuống cách dự phòng bên dưới
    }
  }

  const previousFocus = document.activeElement
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
  document.body.appendChild(textarea)
  textarea.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } finally {
    textarea.remove()
    previousFocus?.focus?.({ preventScroll: true })
  }
  if (!ok) throw new Error('Trình duyệt không cho phép sao chép vào bộ nhớ tạm.')
}
