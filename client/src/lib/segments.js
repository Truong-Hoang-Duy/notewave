const CONTROL_TOKENS = new Set(['<end>', '<fin>'])

/**
 * Gộp token real-time vào danh sách segment (mỗi segment = 1 lượt nói liên tục của 1 người).
 * Trả về mảng mới; chỉ segment cuối bị thay bằng object mới nên React re-render tối thiểu.
 */
export function appendTokens(segments, tokens, offsetMs = 0) {
  let result = segments
  let copied = false
  for (const token of tokens) {
    const text = token.text
    if (!text || CONTROL_TOKENS.has(text) || token.translation_status === 'translation') continue
    if (!copied) {
      result = segments.slice()
      copied = true
    }
    const speaker = token.speaker ?? null
    const start = token.start_ms != null ? token.start_ms + offsetMs : null
    const end = token.end_ms != null ? token.end_ms + offsetMs : null
    const last = result[result.length - 1]
    if (!last || last.speaker !== speaker) {
      result.push({ speaker, text: text.trimStart(), start_ms: start, end_ms: end, language: token.language ?? null })
    } else {
      result[result.length - 1] = { ...last, text: last.text + text, end_ms: end ?? last.end_ms }
    }
  }
  return result
}

export function tokensToSegments(tokens, offsetMs = 0) {
  return appendTokens([], tokens, offsetMs)
}

/** Chuẩn hoá trước khi gửi lên backend. */
export function cleanSegments(segments) {
  return segments.map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.text)
}

/** Thông tin phần gộp nếu segment thứ i bắt đầu một phiên gốc mới (chỉ có ở phiên được gộp). */
export function partStartAt(segments, i, partsById) {
  const origin = segments[i]?.origin
  if (!partsById || !origin || (i > 0 && segments[i - 1].origin === origin)) return null
  return partsById.get(origin) ?? { title: 'Phần gộp' }
}
