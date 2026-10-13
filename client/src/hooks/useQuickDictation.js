import { MicrophoneSource, SonioxClient } from '@soniox/client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'

const RT_MODEL = import.meta.env.VITE_SONIOX_RT_MODEL || 'stt-rt-v5'
const CONTROL_TOKENS = new Set(['<end>', '<fin>'])

/**
 * Hook "Ghi âm nhanh" trong ghi chú Cornell (GĐ5):
 * - Dùng WebSocket Realtime Soniox với Temporary Key lấy từ backend.
 * - Nhận dạng trực tiếp tiếng Việt và tiếng Anh (không diarization để giảm tối đa độ trễ).
 * - Kết quả hoàn tất (final tokens) được chèn thẳng vào vị trí con trỏ trong editor Tiptap.
 */
export function useQuickDictation(editor, { onDirty } = {}) {
  const [status, setStatus] = useState('idle') // idle | starting | recording | stopping | error
  const [error, setError] = useState(null)
  const [interimText, setInterimText] = useState('')
  const [elapsedMs, setElapsedMs] = useState(0)

  const clientRef = useRef(null)
  const recordingRef = useRef(null)
  const timerRef = useRef({ startedAt: 0, interval: null })
  const editorRef = useRef(editor)
  const onDirtyRef = useRef(onDirty)

  useEffect(() => {
    editorRef.current = editor
    onDirtyRef.current = onDirty
  })

  const getClient = () => {
    if (!clientRef.current) {
      clientRef.current = new SonioxClient({
        config: async () => {
          const { api_key } = await api.getTemporaryKey()
          return { api_key }
        },
      })
    }
    return clientRef.current
  }

  const stopTimer = () => {
    if (timerRef.current.interval) {
      clearInterval(timerRef.current.interval)
      timerRef.current.interval = null
    }
    setElapsedMs(0)
  }

  const startTimer = () => {
    timerRef.current.startedAt = performance.now()
    if (timerRef.current.interval) clearInterval(timerRef.current.interval)
    timerRef.current.interval = setInterval(() => {
      setElapsedMs(Math.round(performance.now() - timerRef.current.startedAt))
    }, 250)
  }

  const stop = useCallback(async () => {
    if (!recordingRef.current) return
    setStatus('stopping')
    stopTimer()
    try {
      await recordingRef.current.stop()
    } catch {
      /* ignore */
    } finally {
      recordingRef.current = null
      setInterimText('')
      setStatus('idle')
      onDirtyRef.current?.()
    }
  }, [])

  const start = useCallback(async () => {
    if (recordingRef.current) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setError('Cần có kết nối Internet để ghi âm bằng giọng nói.')
      return
    }

    setError(null)
    setInterimText('')
    setStatus('starting')

    try {
      const ed = editorRef.current
      if (ed && !ed.isFocused) {
        ed.commands.focus()
      }

      const client = getClient()
      const recording = client.realtime.record({
        model: RT_MODEL,
        source: new MicrophoneSource(),
        enable_speaker_diarization: false,
        enable_language_identification: true,
        language_hints: ['vi', 'en'],
        enable_endpoint_detection: true,
        auto_reconnect: true,
      })

      recordingRef.current = recording

      recording.on('result', (result) => {
        const finals = []
        const nonFinals = []
        for (const t of result.tokens) {
          if (!t.text || CONTROL_TOKENS.has(t.text)) continue
          if (t.is_final) finals.push(t)
          else nonFinals.push(t)
        }

        const currentEditor = editorRef.current
        if (finals.length && currentEditor) {
          const text = finals.map((t) => t.text).join('')
          if (text) {
            currentEditor.commands.insertContent(text)
            onDirtyRef.current?.()
          }
        }

        const interim = nonFinals.map((t) => t.text).join('')
        setInterimText(interim)
      })

      recording.on('state_change', ({ new_state }) => {
        if (new_state === 'recording') {
          setStatus('recording')
          startTimer()
        } else if (new_state === 'stopped') {
          setStatus('idle')
          stopTimer()
          setInterimText('')
        }
      })

      recording.on('error', (err) => {
        console.error('[QuickDictation] error:', err)
        setError(err.message || 'Lỗi nhận dạng giọng nói.')
        stop()
      })
    } catch (err) {
      console.error('[QuickDictation] start failed:', err)
      setError(err.message || 'Không khởi động được micro.')
      setStatus('idle')
    }
  }, [stop])

  useEffect(() => {
    const rec = recordingRef
    const tm = timerRef
    return () => {
      if (rec.current) {
        rec.current.stop().catch(() => {})
      }
      if (tm.current.interval) {
        clearInterval(tm.current.interval)
      }
    }
  }, [])

  return {
    status,
    isRecording: status === 'recording' || status === 'starting',
    error,
    interimText,
    elapsedMs,
    start,
    stop,
  }
}
