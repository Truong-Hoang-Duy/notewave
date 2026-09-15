import { useEffect, useState } from 'react'
import { api } from '../lib/api'

const POLL_MS = 3000
const MAX_BACKOFF_MS = 20000

/**
 * Poll trạng thái xử lý nền cho tới khi completed/failed: mặc định GET /api/upload-transcribe/{id}/status,
 * phiên quét tài liệu truyền `api.ocrStatus`. Lỗi mạng tạm thời thì giãn dần khoảng poll thay vì bỏ cuộc.
 */
export function useUploadStatus(sessionId, enabled = true, fetchStatus = api.uploadStatus) {
  const [state, setState] = useState({ status: 'processing', error: null, connectionIssue: false })

  useEffect(() => {
    if (!sessionId || !enabled) return
    let cancelled = false
    let timer
    let delay = POLL_MS
    const controller = new AbortController()

    setState({ status: 'processing', error: null, connectionIssue: false })

    const tick = async () => {
      try {
        const res = await fetchStatus(sessionId, { signal: controller.signal })
        if (cancelled) return
        delay = POLL_MS
        setState({ status: res.status, error: res.error_message, connectionIssue: false })
        if (res.status !== 'processing') return
      } catch (err) {
        if (cancelled || err?.name === 'AbortError') return
        if (err?.status === 404) {
          setState({ status: 'failed', error: 'Phiên này không còn tồn tại.', connectionIssue: false })
          return
        }
        delay = Math.min(delay * 2, MAX_BACKOFF_MS)
        setState((s) => ({ ...s, connectionIssue: true }))
      }
      timer = setTimeout(tick, delay)
    }
    tick()

    return () => {
      cancelled = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [sessionId, enabled, fetchStatus])

  return state
}
