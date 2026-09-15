import {
  AudioDeviceError,
  AudioPermissionError,
  AudioUnavailableError,
  AuthError,
  MicrophoneSource,
  NetworkError,
  ConnectionError,
  QuotaError,
  SonioxClient,
} from '@soniox/client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { appendTokens, cleanSegments, tokensToSegments } from '../lib/segments'

const RT_MODEL = import.meta.env.VITE_SONIOX_RT_MODEL || 'stt-rt-v5'

/**
 * MicrophoneSource của SDK không công khai MediaStream; lớp con này lấy stream sau khi
 * start() để vẽ sóng âm bằng AnalyserNode mà không phải xin quyền micro lần hai.
 */
class VisualizedMicSource extends MicrophoneSource {
  constructor(onStream) {
    super()
    this.onStream = onStream
  }
  async start(handlers) {
    await super.start(handlers)
    if (this.stream) this.onStream(this.stream)
  }
}

function describeError(err) {
  const chain = []
  for (let e = err; e && chain.length < 5; e = e.cause) chain.push(e)
  const is = (Cls) => chain.some((e) => e instanceof Cls)
  if (is(AudioPermissionError))
    return 'Bạn chưa cấp quyền dùng micro. Hãy bấm biểu tượng ổ khoá trên thanh địa chỉ để cho phép, rồi thử lại.'
  if (is(AudioDeviceError)) return 'Không tìm thấy micro, hoặc micro đang bị ứng dụng khác sử dụng.'
  if (is(AudioUnavailableError))
    return 'Trình duyệt này không hỗ trợ ghi âm. Hãy dùng Chrome, Edge, Safari hoặc Firefox bản mới (trang phải chạy qua HTTPS).'
  const apiErr = chain.find((e) => e instanceof ApiError)
  if (apiErr) return apiErr.message
  if (is(AuthError)) return 'Khoá truy cập Soniox không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.'
  if (is(QuotaError)) return 'Tài khoản Soniox đã hết hạn mức sử dụng.'
  if (is(NetworkError) || is(ConnectionError)) return 'Mất kết nối tới dịch vụ nhận dạng giọng nói. Kiểm tra mạng rồi thử lại.'
  return err?.message ? `Đã xảy ra lỗi: ${err.message}` : 'Đã xảy ra lỗi không xác định.'
}

/**
 * status: idle | starting | recording | paused | reconnecting | stopping | stopped | error
 */
export function useLiveTranscription() {
  const [status, setStatus] = useState('idle')
  const [segments, setSegments] = useState([])
  const [interim, setInterim] = useState([])
  const [error, setError] = useState(null)
  const [warning, setWarning] = useState(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [analyser, setAnalyser] = useState(null)

  const clientRef = useRef(null)
  const recordingRef = useRef(null)
  const segmentsRef = useRef([])
  const interimTokensRef = useRef([])
  const offsetRef = useRef(0)
  const sessionCountRef = useRef(0)
  const audioCtxRef = useRef(null)
  const wakeLockRef = useRef(null)
  const timerRef = useRef({ startedAt: 0, accumulated: 0, running: false, interval: null })

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

  // ---- Đồng hồ (tính theo thời gian thực, trừ khoảng tạm dừng) ----
  const timerNow = () => {
    const t = timerRef.current
    return t.accumulated + (t.running ? performance.now() - t.startedAt : 0)
  }
  const timerStart = () => {
    const t = timerRef.current
    if (t.running) return
    t.running = true
    t.startedAt = performance.now()
    clearInterval(t.interval)
    t.interval = setInterval(() => setElapsedMs(timerNow()), 250)
  }
  const timerPause = () => {
    const t = timerRef.current
    if (!t.running) return
    t.accumulated = timerNow()
    t.running = false
    clearInterval(t.interval)
    setElapsedMs(t.accumulated)
  }
  const timerReset = () => {
    const t = timerRef.current
    clearInterval(t.interval)
    timerRef.current = { startedAt: 0, accumulated: 0, running: false, interval: null }
    setElapsedMs(0)
  }

  const releaseMedia = useCallback(() => {
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    setAnalyser(null)
    wakeLockRef.current?.release().catch(() => {})
    wakeLockRef.current = null
  }, [])

  const handleStream = (stream) => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      const ctx = new Ctx()
      const node = ctx.createAnalyser()
      node.fftSize = 256
      node.smoothingTimeConstant = 0.75
      ctx.createMediaStreamSource(stream).connect(node)
      audioCtxRef.current = ctx
      setAnalyser(node)
    } catch {
      // Không vẽ được sóng âm cũng không ảnh hưởng tới việc ghi.
    }
  }

  const start = useCallback(async () => {
    if (recordingRef.current) return
    setError(null)
    setWarning(null)
    setSegments([])
    setInterim([])
    segmentsRef.current = []
    interimTokensRef.current = []
    offsetRef.current = 0
    sessionCountRef.current = 0
    timerReset()
    setStatus('starting')

    const recording = getClient().realtime.record({
      model: RT_MODEL,
      source: new VisualizedMicSource(handleStream),
      enable_speaker_diarization: true,
      enable_language_identification: true,
      language_hints: ['vi', 'en'],
      enable_endpoint_detection: true,
      auto_reconnect: true,
      max_reconnect_attempts: 5,
    })
    recordingRef.current = recording

    recording.on('result', (result) => {
      const finals = []
      const nonFinals = []
      for (const t of result.tokens) (t.is_final ? finals : nonFinals).push(t)
      if (finals.length) {
        segmentsRef.current = appendTokens(segmentsRef.current, finals, offsetRef.current)
        setSegments(segmentsRef.current)
      }
      interimTokensRef.current = nonFinals
      setInterim(tokensToSegments(nonFinals, offsetRef.current))
    })

    recording.on('session_restart', () => {
      sessionCountRef.current += 1
      if (sessionCountRef.current > 1) {
        // Sau khi kết nối lại, mốc thời gian của Soniox bắt đầu lại từ 0 — cộng dồn để không bị lùi.
        const last = segmentsRef.current[segmentsRef.current.length - 1]
        offsetRef.current = last?.end_ms ?? Math.round(timerNow())
      }
      interimTokensRef.current = []
      setInterim([])
    })

    recording.on('state_change', ({ new_state }) => {
      if (new_state === 'recording') {
        setStatus('recording')
        setWarning(null)
        timerStart()
      } else if (new_state === 'paused') {
        setStatus('paused')
        timerPause()
      } else if (new_state === 'reconnecting') {
        setStatus('reconnecting')
        setWarning('Mất kết nối — đang thử kết nối lại…')
      } else if (new_state === 'stopping') {
        setStatus('stopping')
        timerPause()
      }
    })

    recording.on('source_muted', () => setWarning('Micro đang bị tắt tiếng từ hệ thống hoặc thiết bị.'))
    recording.on('source_unmuted', () => setWarning(null))

    recording.on('error', (err) => {
      timerPause()
      releaseMedia()
      recordingRef.current = null
      setError(describeError(err))
      // Giữ lại phần transcript đã có để người dùng vẫn lưu được.
      setStatus(segmentsRef.current.length ? 'stopped' : 'error')
    })

    try {
      wakeLockRef.current = await navigator.wakeLock?.request('screen')
    } catch {
      /* không hỗ trợ hoặc bị từ chối — không sao */
    }
  }, [releaseMedia]) // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(async () => {
    const recording = recordingRef.current
    if (!recording) return
    setStatus('stopping')
    timerPause()
    try {
      await recording.stop()
    } catch {
      /* lỗi đã được xử lý qua sự kiện 'error' */
    }
    // Token chưa kịp final (hiếm khi còn sau stop) vẫn được giữ lại.
    if (interimTokensRef.current.length) {
      segmentsRef.current = appendTokens(segmentsRef.current, interimTokensRef.current, offsetRef.current)
      interimTokensRef.current = []
      setSegments(segmentsRef.current)
      setInterim([])
    }
    recordingRef.current = null
    releaseMedia()
    setStatus('stopped')
  }, [releaseMedia]) // eslint-disable-line react-hooks/exhaustive-deps

  const pause = useCallback(() => recordingRef.current?.pause(), [])
  const resume = useCallback(() => recordingRef.current?.resume(), [])

  const reset = useCallback(() => {
    recordingRef.current?.cancel()
    recordingRef.current = null
    releaseMedia()
    segmentsRef.current = []
    interimTokensRef.current = []
    setSegments([])
    setInterim([])
    setError(null)
    setWarning(null)
    timerReset()
    setStatus('idle')
  }, [releaseMedia]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      recordingRef.current?.cancel()
      clearInterval(timerRef.current.interval)
      audioCtxRef.current?.close().catch(() => {})
    },
    [],
  )

  return {
    status,
    segments,
    interim,
    error,
    warning,
    elapsedMs,
    analyser,
    start,
    stop,
    pause,
    resume,
    reset,
    getResult: () => ({ segments: cleanSegments(segmentsRef.current), duration_ms: Math.round(timerNow()) }),
  }
}
