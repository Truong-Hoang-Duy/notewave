import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'

/**
 * Tự lưu ghi chú (không có nút "Lưu"):
 * - `markDirty(field)` sau mỗi thay đổi; lưu sau `delay` ms ngừng gõ, gõ liên tục thì tối đa `maxWait` ms lưu một lần.
 *   `markDirty(field, { immediate: true })` cho thay đổi rời rạc (tag, thư mục, giao diện) -> lưu ngay.
 * - Chỉ gửi field đã đổi (PATCH từng phần). `collect(fields)` do component cung cấp, đọc giá trị MỚI NHẤT lúc gửi
 *   (nội dung editor chỉ được serialize lúc này, không phải mỗi phím gõ).
 * - Bản nháp cục bộ: trước mỗi lần gửi, patch được ghi vào localStorage; chỉ xoá khi máy chủ nhận xong. Lưu lỗi
 *   (Render đang khởi động lại, mất mạng) -> giữ nháp, tự thử lại với độ trễ tăng dần và ngay khi có mạng trở lại.
 *   Mở lại note mà còn nháp mới hơn bản trên máy chủ -> `readNoteDraft` để khôi phục.
 * - Không kiểm tra phiên bản (last-write-wins, quyết định 2026-09-18).
 */
const DRAFT_PREFIX = 'notewave:note-draft:'
const RETRY_DELAYS = [3000, 10000, 30000, 60000]
// Trình duyệt giới hạn tổng body của request keepalive ~64KB.
const KEEPALIVE_LIMIT = 60_000

export function readNoteDraft(noteId) {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + noteId)
    const draft = raw ? JSON.parse(raw) : null
    return draft?.patch && typeof draft.saved_at === 'number' ? draft : null
  } catch {
    return null
  }
}

export function clearNoteDraft(noteId) {
  try {
    localStorage.removeItem(DRAFT_PREFIX + noteId)
  } catch {
    /* ignore */
  }
}

function writeNoteDraft(noteId, patch) {
  try {
    localStorage.setItem(DRAFT_PREFIX + noteId, JSON.stringify({ patch, saved_at: Date.now() }))
  } catch {
    /* hết dung lượng / chế độ riêng tư: vẫn lưu lên máy chủ bình thường */
  }
}

/** @returns {{ status: 'saved'|'pending'|'saving'|'error', error: Error|null, markDirty, flush, cancel }} */
export function useNoteAutosave(noteId, collect, { delay = 1200, maxWait = 8000, onSaved } = {}) {
  const [status, setStatus] = useState('saved')
  const [error, setError] = useState(null)
  const dirty = useRef(new Set())
  const failed = useRef(null) // patch đã gửi nhưng lỗi — gộp vào lần gửi sau
  const inflight = useRef(false)
  const again = useRef(false)
  const disabled = useRef(false)
  const timer = useRef(null)
  const retryTimer = useRef(null)
  const retryCount = useRef(0)
  const firstDirtyAt = useRef(0)
  const collectRef = useRef(collect)
  const onSavedRef = useRef(onSaved)
  useEffect(() => {
    collectRef.current = collect
    onSavedRef.current = onSaved
  })

  const takePatch = () => {
    const fields = dirty.current
    dirty.current = new Set()
    // Field vừa sửa lại sau lần lỗi sẽ ghi đè giá trị cũ trong `failed`.
    const patch = { ...(failed.current ?? {}), ...(fields.size ? collectRef.current(fields) : {}) }
    failed.current = null
    return patch
  }

  const flushRef = useRef(null)
  const schedule = useCallback(
    (wait) => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => flushRef.current(), Math.max(0, wait))
    },
    [],
  )

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    clearTimeout(retryTimer.current)
    timer.current = null
    firstDirtyAt.current = 0
    if (disabled.current) return
    if (inflight.current) {
      again.current = true
      return
    }
    if (!dirty.current.size && !failed.current) return
    const patch = takePatch()
    writeNoteDraft(noteId, patch)
    inflight.current = true
    setStatus('saving')
    try {
      const saved = await api.updateNote(noteId, patch)
      retryCount.current = 0
      setError(null)
      if (!dirty.current.size) clearNoteDraft(noteId)
      onSavedRef.current?.(saved, patch)
      setStatus(dirty.current.size ? 'pending' : 'saved')
    } catch (err) {
      if (disabled.current) return
      failed.current = patch
      setError(err)
      setStatus('error')
      if (err?.status === 404 || err?.status === 422) return // note đã bị xoá / dữ liệu sai: thử lại vô ích
      const wait = RETRY_DELAYS[Math.min(retryCount.current, RETRY_DELAYS.length - 1)]
      retryCount.current += 1
      retryTimer.current = setTimeout(() => flushRef.current(), wait)
    } finally {
      inflight.current = false
      if (again.current && !disabled.current) {
        again.current = false
        schedule(0)
      }
    }
  }, [noteId, schedule])
  useEffect(() => {
    flushRef.current = flush
  }, [flush])

  const markDirty = useCallback(
    (field, { immediate = false } = {}) => {
      if (disabled.current) return
      dirty.current.add(field)
      setStatus((s) => (s === 'saving' || s === 'error' ? s : 'pending'))
      if (immediate) {
        schedule(0)
        return
      }
      const now = Date.now()
      if (!firstDirtyAt.current) firstDirtyAt.current = now
      schedule(Math.min(delay, maxWait - (now - firstDirtyAt.current)))
    },
    [delay, maxWait, schedule],
  )

  /** Ngừng lưu hẳn (vd. vừa xoá note) và bỏ nháp. */
  const cancel = useCallback(() => {
    disabled.current = true
    clearTimeout(timer.current)
    clearTimeout(retryTimer.current)
    dirty.current = new Set()
    failed.current = null
    clearNoteDraft(noteId)
  }, [noteId])

  useEffect(() => {
    const onOnline = () => failed.current && flushRef.current()
    const onHidden = () => document.visibilityState === 'hidden' && flushRef.current()
    // Đóng tab / tải lại trang: ghi nháp đồng bộ rồi gửi request keepalive (không chờ được kết quả -> giữ nháp,
    // lần mở sau so sánh thời gian với bản trên máy chủ).
    const onPageHide = () => {
      if (disabled.current || (!dirty.current.size && !failed.current)) return
      const patch = takePatch()
      writeNoteDraft(noteId, patch)
      const body = JSON.stringify(patch)
      if (body.length < KEEPALIVE_LIMIT) api.updateNote(noteId, patch, { keepalive: true }).catch(() => {})
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [noteId])

  // Rời trang chi tiết trong app (hash router unmount component): gửi nốt phần còn lại.
  useEffect(
    () => () => {
      clearTimeout(retryTimer.current)
      try {
        flushRef.current?.()
      } catch {
        /* cleanup không được ném lỗi (ErrorBoundary) */
      }
    },
    [],
  )

  return { status, error, markDirty, flush, cancel }
}
