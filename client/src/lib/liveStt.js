/**
 * Client WebSocket nhận dạng giọng nói trực tiếp (Deepgram Nova-3) chạy trên trình duyệt.
 * Không cần SDK ngoài: dùng MediaRecorder kết nối trực tiếp tới Deepgram (hoặc qua WS proxy của backend).
 */

try {
  localStorage.removeItem('notewave:stt-provider')
} catch {
  /* localStorage bị chặn */
}

export class AudioPermissionError extends Error {
  constructor(message = 'Chưa cấp quyền dùng micro.') {
    super(message)
    this.name = 'AudioPermissionError'
  }
}

export class AudioDeviceError extends Error {
  constructor(message = 'Không tìm thấy hoặc không mở được micro.') {
    super(message)
    this.name = 'AudioDeviceError'
  }
}

export class AudioUnavailableError extends Error {
  constructor(message = 'Trình duyệt không hỗ trợ ghi âm.') {
    super(message)
    this.name = 'AudioUnavailableError'
  }
}

export class AuthError extends Error {
  constructor(message = 'Khoá kết nối tạm thời không hợp lệ hoặc đã hết hạn.') {
    super(message)
    this.name = 'AuthError'
  }
}

export class QuotaError extends Error {
  constructor(message = 'Tài khoản dịch vụ nhận dạng giọng nói đã hết hạn mức.') {
    super(message)
    this.name = 'QuotaError'
  }
}

export class ConnectionError extends Error {
  constructor(message = 'Mất kết nối tới dịch vụ nhận dạng giọng nói.') {
    super(message)
    this.name = 'ConnectionError'
  }
}

const RECORDER_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
]

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const type of RECORDER_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported?.(type)) return type
  }
  return ''
}

async function acquireMicStream() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof WebSocket === 'undefined') {
    throw new AudioUnavailableError()
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
  } catch (err) {
    const name = err?.name || ''
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      throw new AudioPermissionError()
    }
    if (
      name === 'NotFoundError' ||
      name === 'DevicesNotFoundError' ||
      name === 'NotReadableError' ||
      name === 'TrackStartError' ||
      name === 'OverconstrainedError'
    ) {
      throw new AudioDeviceError()
    }
    throw new AudioUnavailableError(err?.message)
  }
}

function parseDeepgramMessage(raw, onResult) {
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return
  }
  if (data.type !== 'Results') return
  const alt = data.channel?.alternatives?.[0]
  if (!alt) return
  const transcript = (alt.transcript || '').trim()
  const words = alt.words || []
  if (!transcript && !words.length) return

  const isFinal = Boolean(data.is_final)
  const lang = data.channel?.detected_language || 'vi'
  const tokens = words.length
    ? words.map((w) => ({
        text: ' ' + (w.punctuated_word || w.word || ''),
        speaker: w.speaker != null ? String(Number(w.speaker) + 1) : null,
        start_ms: w.start != null ? Math.round(w.start * 1000) : null,
        end_ms: w.end != null ? Math.round(w.end * 1000) : null,
        language: lang,
        is_final: isFinal,
      }))
    : [
        {
          text: ' ' + transcript,
          speaker: null,
          start_ms: data.start != null ? Math.round(data.start * 1000) : null,
          end_ms: data.start != null && data.duration != null ? Math.round((data.start + data.duration) * 1000) : null,
          language: lang,
          is_final: isFinal,
        },
      ]
  onResult?.({ tokens })
}

function resolveWsUrl(rawUrl) {
  if (!rawUrl) return ''
  if (rawUrl.startsWith('ws://') || rawUrl.startsWith('wss://')) return rawUrl
  const base = (import.meta.env.VITE_API_BASE_URL || window.location.origin).replace(/\/$/, '')
  const wsBase = base.replace(/^http/, 'ws')
  return `${wsBase}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`
}

/**
 * Khởi tạo một phiên ghi âm trực tiếp qua WebSocket (Deepgram).
 * @param {object} options
 * @param {() => Promise<{ api_key: string, ws_url: string }>} options.getConfig
 * @param {(stream: MediaStream) => void} [options.onStream]
 * @param {(result: { tokens: Array }) => void} [options.onResult]
 * @param {(state: { new_state: string }) => void} [options.onStateChange]
 * @param {() => void} [options.onSessionRestart]
 * @param {() => void} [options.onMuted]
 * @param {() => void} [options.onUnmuted]
 * @param {(err: Error) => void} [options.onError]
 * @param {number} [options.maxReconnectAttempts=3]
 */
export function createLiveRecording({
  getConfig,
  onStream,
  onResult,
  onStateChange,
  onSessionRestart,
  onMuted,
  onUnmuted,
  onError,
  maxReconnectAttempts = 3,
}) {
  let stream = null
  let ws = null
  let recorder = null
  let keepAliveTimer = null
  let paused = false
  let stopping = false
  let cancelled = false
  let reconnectCount = 0
  let reconnectTimer = null

  const setState = (new_state) => {
    if (!cancelled) onStateChange?.({ new_state })
  }

  const clearAudioCapture = () => {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer)
      keepAliveTimer = null
    }
    if (recorder) {
      try {
        if (recorder.state !== 'inactive') recorder.stop()
      } catch {
        /* ignore */
      }
      recorder = null
    }
  }

  const releaseAll = () => {
    clearTimeout(reconnectTimer)
    clearAudioCapture()
    if (ws) {
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close()
      } catch {
        /* ignore */
      }
      ws = null
    }
    if (stream) {
      for (const track of stream.getTracks()) {
        track.onmute = null
        track.onunmute = null
        track.stop()
      }
      stream = null
    }
  }

  const startDeepgramCapture = () => {
    const mimeType = pickMimeType()
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    recorder = rec
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0 && !paused && ws?.readyState === WebSocket.OPEN) {
        ws.send(e.data)
      }
    }
    rec.start(250)
    keepAliveTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'KeepAlive' }))
      }
    }, 8000)
  }

  const connectSocket = async (isReconnect = false) => {
    let cfg
    try {
      cfg = await getConfig()
    } catch (err) {
      releaseAll()
      onError?.(err)
      return
    }
    if (cancelled || stopping) return

    const wsUrl = resolveWsUrl(cfg.ws_url)
    const isBackendProxy = Boolean(cfg.ws_url?.startsWith('/api/'))
    try {
      ws = !isBackendProxy && cfg.api_key ? new WebSocket(wsUrl, ['bearer', cfg.api_key]) : new WebSocket(wsUrl)
    } catch (err) {
      releaseAll()
      onError?.(new ConnectionError(err?.message))
      return
    }

    ws.onopen = () => {
      if (cancelled || stopping) return
      reconnectCount = 0
      onSessionRestart?.()
      clearAudioCapture()
      try {
        startDeepgramCapture()
      } catch (err) {
        releaseAll()
        onError?.(new AudioDeviceError(err?.message))
        return
      }
      setState(paused ? 'paused' : 'recording')
    }

    ws.onmessage = (event) => {
      if (cancelled) return
      if (typeof event.data !== 'string') return
      parseDeepgramMessage(event.data, onResult)
    }

    ws.onerror = () => {
      // onclose sẽ xử lý kết nối lại hoặc báo lỗi cuối cùng.
    }

    ws.onclose = (event) => {
      if (cancelled || stopping) return
      clearAudioCapture()
      if (event.code === 4001 || event.code === 4003 || event.code === 1008) {
        releaseAll()
        onError?.(new AuthError())
        return
      }
      if (reconnectCount < maxReconnectAttempts && !isReconnect) {
        reconnectCount += 1
        setState('reconnecting')
        reconnectTimer = setTimeout(() => connectSocket(true), 1000 * reconnectCount)
        return
      }
      releaseAll()
      onError?.(new ConnectionError())
    }
  }

  ;(async () => {
    try {
      stream = await acquireMicStream()
      if (cancelled || stopping) {
        releaseAll()
        return
      }
      const track = stream.getAudioTracks()[0]
      if (track) {
        track.onmute = () => onMuted?.()
        track.onunmute = () => onUnmuted?.()
      }
      onStream?.(stream)
      await connectSocket(false)
    } catch (err) {
      releaseAll()
      if (!cancelled) onError?.(err)
    }
  })()

  return {
    pause() {
      if (paused || stopping || cancelled) return
      paused = true
      if (recorder && recorder.state === 'recording') {
        try {
          recorder.pause()
        } catch {
          /* ignore */
        }
      }
      setState('paused')
    },
    resume() {
      if (!paused || stopping || cancelled) return
      paused = false
      if (recorder && recorder.state === 'paused') {
        try {
          recorder.resume()
        } catch {
          /* ignore */
        }
      }
      setState('recording')
    },
    async stop() {
      if (stopping || cancelled) return
      stopping = true
      setState('stopping')
      clearTimeout(reconnectTimer)
      clearAudioCapture()
      if (ws && ws.readyState === WebSocket.OPEN) {
        await new Promise((resolve) => {
          const timeout = setTimeout(resolve, 500)
          const prevClose = ws.onclose
          ws.onclose = (e) => {
            clearTimeout(timeout)
            prevClose?.(e)
            resolve()
          }
          try {
            ws.send(JSON.stringify({ type: 'CloseStream' }))
          } catch {
            clearTimeout(timeout)
            resolve()
          }
        })
      }
      releaseAll()
      setState('stopped')
    },
    cancel() {
      cancelled = true
      releaseAll()
    },
  }
}
